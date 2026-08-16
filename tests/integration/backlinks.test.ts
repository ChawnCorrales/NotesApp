/**
 * Backlinks (PRD §11, §13).
 *
 * "Referenced in 8 notes" is the payoff the product promises. It has to count
 * *notes*, not occurrences — a note that names Marrow six times is still one
 * place to go and read about him.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getBacklinks, getMentionCounts } from "@/lib/services";
import {
  createNoteWithText,
  createNpc,
  createTestCampaign,
  resetDatabase,
  writeNote,
  type TestCampaign,
  noteCountFor,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("backlinks", () => {
  it("lists a note once it mentions the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(
      campaign.id,
      "Session 12",
      "Marrow sends the party a letter.",
    );

    const backlinks = await getBacklinks(marrow.id);

    expect(backlinks.map((n) => n.id)).toEqual([note.id]);
  });

  it("lists every note that mentions the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 12", "Marrow writes.");
    await createNoteWithText(campaign.id, "Session 13", "Marrow again.");
    await createNoteWithText(campaign.id, "Session 14", "No one of note.");

    const backlinks = await getBacklinks(marrow.id);

    expect(backlinks).toHaveLength(2);
    expect(backlinks.map((n) => n.title).sort()).toEqual(["Session 12", "Session 13"]);
  });

  it("lists a note once even when it mentions the entity many times", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(
      campaign.id,
      "Session 12",
      "Marrow lied. Marrow left. Marrow returned. Marrow lied again.",
    );

    const backlinks = await getBacklinks(marrow.id);

    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].id).toBe(note.id);
  });

  it("counts notes rather than occurrences", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow. Marrow. Marrow.");
    await createNoteWithText(campaign.id, "B", "Marrow.");

    const counts = await getMentionCounts(campaign.id);

    expect(noteCountFor(counts, marrow.id)).toBe(2);
  });

  it("removes the backlink when the last mention in a note is deleted", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "Session 12", "Marrow writes.");

    await writeNote(campaign.id, note.id, "Nobody writes.");

    expect(await getBacklinks(marrow.id)).toHaveLength(0);
  });

  it("keeps the backlink while any mention remains in the note", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(
      campaign.id,
      "Session 12",
      "Marrow lied. Marrow left.",
    );

    await writeNote(campaign.id, note.id, "Marrow lied.");

    expect(await getBacklinks(marrow.id)).toHaveLength(1);
  });

  it("removes only the affected note's backlink", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const first = await createNoteWithText(campaign.id, "A", "Marrow writes.");
    await createNoteWithText(campaign.id, "B", "Marrow again.");

    await writeNote(campaign.id, first.id, "Silence.");

    const backlinks = await getBacklinks(marrow.id);
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].title).toBe("B");
  });

  it("orders backlinks by most recently edited", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const older = await createNoteWithText(campaign.id, "Older", "Marrow writes.");
    await createNoteWithText(campaign.id, "Newer", "Marrow again.");

    // Touch the older note so it becomes the most recent.
    await writeNote(campaign.id, older.id, "Marrow writes once more.");

    const backlinks = await getBacklinks(marrow.id);
    expect(backlinks[0].title).toBe("Older");
  });
});
