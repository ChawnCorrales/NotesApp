/**
 * "Not this entity", end to end through storage (PRD §32).
 *
 * The behaviour that matters: the correction is narrow. It removes one mention
 * and the backlink it justified, and it changes nothing about the entity, the
 * note, or recognition anywhere else.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  getBacklinks,
  getSuppressionKeysForNote,
  reindexCampaign,
  suppressMention,
  unsuppressMention,
} from "@/lib/services";
import { filterSuppressed, suppressionKey } from "@/lib/entities/recognizer";
import {
  buildRecognizer,
  createNoteWithText,
  createNpc,
  createTestCampaign,
  resetDatabase,
  writeNote,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("suppressing one occurrence", () => {
  it("removes that mention from the index", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(
      campaign.id,
      "S1",
      "Ash spoke. Ash left. Ash returned.",
    );

    await suppressMention(campaign.id, note.id, ash.id, 1);

    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions.map((m) => m.occurrence).sort()).toEqual([0, 2]);
  });

  it("keeps the backlink while other occurrences remain", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    await suppressMention(campaign.id, note.id, ash.id, 0);

    expect((await getBacklinks(ash.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("removes the backlink when the suppressed one was the only mention", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke once.");

    await suppressMention(campaign.id, note.id, ash.id, 0);

    expect(await getBacklinks(ash.id)).toHaveLength(0);
  });

  it("does not affect the same entity in other notes", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const suppressedNote = await createNoteWithText(campaign.id, "A", "Ash spoke.");
    const otherNote = await createNoteWithText(campaign.id, "B", "Ash spoke here too.");

    await suppressMention(campaign.id, suppressedNote.id, ash.id, 0);

    const backlinks = await getBacklinks(ash.id);
    expect(backlinks.map((n) => n.id)).toEqual([otherNote.id]);
  });

  it("leaves the entity itself enabled for auto-linking", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke.");

    await suppressMention(campaign.id, note.id, ash.id, 0);

    // Suppression is not a back door to disabling the entity globally.
    expect((await db.entities.get(ash.id))?.autoLink).toBe(true);
    const recognizer = await buildRecognizer(campaign.id);
    expect(recognizer.findMatches("Ash appears elsewhere.")).toHaveLength(1);
  });

  it("leaves the note text untouched", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke.");

    await suppressMention(campaign.id, note.id, ash.id, 0);

    expect((await db.notes.get(note.id))?.contentText).toBe("Ash spoke.");
  });

  it("survives re-saving the note", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");
    await suppressMention(campaign.id, note.id, ash.id, 0);

    // The user keeps typing; the save path must not resurrect the mention.
    await writeNote(campaign.id, note.id, "Ash spoke. Ash left. And that was that.");

    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions.map((m) => m.occurrence)).toEqual([1]);
  });

  it("survives a full campaign reindex", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");
    await suppressMention(campaign.id, note.id, ash.id, 0);

    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions.map((m) => m.occurrence)).toEqual([1]);
  });

  it("is idempotent", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    await suppressMention(campaign.id, note.id, ash.id, 0);
    await suppressMention(campaign.id, note.id, ash.id, 0);

    expect(await db.mentionSuppressions.count()).toBe(1);
  });
});

describe("undoing a suppression", () => {
  it("restores the mention on the next reindex", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    await suppressMention(campaign.id, note.id, ash.id, 0);
    await unsuppressMention(note.id, ash.id, 0);
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions.map((m) => m.occurrence).sort()).toEqual([0, 1]);
  });
});

describe("suppression keys", () => {
  it("expose exactly what the editor needs to filter decorations", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");
    await suppressMention(campaign.id, note.id, ash.id, 1);

    const keys = await getSuppressionKeysForNote(note.id);
    const recognizer = await buildRecognizer(campaign.id);
    const visible = filterSuppressed(
      recognizer.findMatches("Ash spoke. Ash left."),
      keys,
    );

    expect(keys.has(suppressionKey(ash.id, 1))).toBe(true);
    expect(visible.map((m) => m.occurrence)).toEqual([0]);
  });
});
