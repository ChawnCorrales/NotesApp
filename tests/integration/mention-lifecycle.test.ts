/**
 * The full mention lifecycle against real storage.
 *
 * Recognition is only half the promise; the other half is that the *index*
 * tracks the text faithfully as it is edited. These run against a real
 * IndexedDB, through the same repository calls the editor makes on save.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import { createNote } from "@/lib/services";
import {
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

async function mentionsFor(noteId: string) {
  return db.entityMentions.where("noteId").equals(noteId).toArray();
}

describe("mention lifecycle", () => {
  it("creates a mention when the entity name is typed", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id, title: "Session 1" });

    await writeNote(campaign.id, note.id, "Marrow greets the party.");

    const mentions = await mentionsFor(note.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].entityId).toBe(marrow.id);
    expect(mentions[0].detectedText).toBe("Marrow");
  });

  it("removes the mention when the text is deleted", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    await writeNote(campaign.id, note.id, "Marrow greets the party.");
    await writeNote(campaign.id, note.id, "The party arrives alone.");

    expect(await mentionsFor(note.id)).toHaveLength(0);
  });

  it("removes the mention when the text is edited so it no longer matches", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    await writeNote(campaign.id, note.id, "Marrow greets the party.");
    await writeNote(campaign.id, note.id, "Marrowbone greets the party.");

    expect(await mentionsFor(note.id)).toHaveLength(0);
  });

  it("recreates the mention when the text is typed again", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    await writeNote(campaign.id, note.id, "Marrow greets the party.");
    await writeNote(campaign.id, note.id, "The party arrives alone.");
    await writeNote(campaign.id, note.id, "Then Marrow appears after all.");

    const mentions = await mentionsFor(note.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].from).toBe(5);
  });

  it("tracks several mentions of the same entity in one note", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    await writeNote(
      campaign.id,
      note.id,
      "Marrow lied. Later Marrow admitted it. Marrow left.",
    );

    const mentions = await mentionsFor(note.id);
    expect(mentions).toHaveLength(3);
    expect(mentions.every((m) => m.entityId === marrow.id)).toBe(true);
    expect(mentions.map((m) => m.occurrence).sort()).toEqual([0, 1, 2]);
  });

  it("adjusts the remaining mentions when one of several is removed", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    await writeNote(campaign.id, note.id, "Marrow lied. Marrow left.");
    await writeNote(campaign.id, note.id, "Marrow lied.");

    const mentions = await mentionsFor(note.id);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].occurrence).toBe(0);
  });

  it("does not leak mentions between notes", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const first = await createNote({ campaignId: campaign.id });
    const second = await createNote({ campaignId: campaign.id });

    await writeNote(campaign.id, first.id, "Marrow greets the party.");
    await writeNote(campaign.id, second.id, "Nobody is here.");

    expect(await mentionsFor(first.id)).toHaveLength(1);
    expect(await mentionsFor(second.id)).toHaveLength(0);
  });

  it("replaces rather than accumulates mentions on repeated saves", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });

    // Saving is debounced but frequent; duplicated rows would inflate every
    // mention count in the app.
    await writeNote(campaign.id, note.id, "Marrow greets the party.");
    await writeNote(campaign.id, note.id, "Marrow greets the party.");
    await writeNote(campaign.id, note.id, "Marrow greets the party.");

    expect(await mentionsFor(note.id)).toHaveLength(1);
  });

  it("drops a note's mentions when the note is deleted", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNote({ campaignId: campaign.id });
    await writeNote(campaign.id, note.id, "Marrow greets the party.");

    const { deleteNote } = await import("@/lib/services");
    await deleteNote(note.id);

    expect(await mentionsFor(note.id)).toHaveLength(0);
  });
});
