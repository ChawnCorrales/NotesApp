/**
 * Local persistence (PRD §33).
 *
 * Offline operation is mandatory, which makes "does it survive a reload" a
 * product requirement rather than an implementation detail. Each test closes
 * and reopens the database so the assertions read from storage rather than
 * whatever Dexie happened to be holding in memory.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  addAlias,
  createRelationship,
  getBacklinks,
  reindexCampaign,
  suppressMention,
} from "@/lib/services";
import {
  buildRecognizer,
  createNoteWithText,
  createNpc,
  createTestCampaign,
  reopenDatabase,
  resetDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("surviving a reload", () => {
  it("keeps notes and their text", async () => {
    const { campaign } = fixture;
    const note = await createNoteWithText(
      campaign.id,
      "Session 1",
      "The party arrives in Greyhaven.",
    );

    await reopenDatabase();

    const reloaded = await db.notes.get(note.id);
    expect(reloaded?.title).toBe("Session 1");
    expect(reloaded?.contentText).toBe("The party arrives in Greyhaven.");
  });

  it("keeps entities and their category", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    await reopenDatabase();

    const reloaded = await db.entities.get(marrow.id);
    expect(reloaded?.name).toBe("Marrow");
    expect(reloaded?.entityTypeId).toBe(npcType.id);
    expect(reloaded?.autoLink).toBe(true);
  });

  it("keeps aliases, and they still resolve after reopening", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");
    await addAlias(queen.id, "Verena");

    await reopenDatabase();

    const recognizer = await buildRecognizer(campaign.id);
    const matches = recognizer.findMatches("Verena watches from the tower.");
    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe(queen.id);
  });

  it("keeps relationships", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship({ campaignId: campaign.id, sourceEntityId: marrow.id, targetEntityId: greyhaven.id, relationshipType: "works in" });

    await reopenDatabase();

    const relationships = await db.relationships
      .where("campaignId")
      .equals(campaign.id)
      .toArray();
    expect(relationships).toHaveLength(1);
    expect(relationships[0].relationshipType).toBe("works in");
  });

  it("keeps suppression decisions", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    await suppressMention({ campaignId: campaign.id, noteId: note.id, entityId: ash.id, occurrenceIndex: 0 });
    await reopenDatabase();

    const suppressions = await db.mentionSuppressions
      .where("noteId")
      .equals(note.id)
      .toArray();
    expect(suppressions).toHaveLength(1);
    expect(suppressions[0].occurrenceIndex).toBe(0);
  });

  it("keeps backlinks", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    await reopenDatabase();

    expect(await getBacklinks(marrow.id)).toHaveLength(1);
  });
});

describe("rebuilding derived data", () => {
  it("reconstructs the backlink index from notes and entities alone", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createNoteWithText(campaign.id, "A", "Marrow works in Greyhaven.");
    await createNoteWithText(campaign.id, "B", "Greyhaven is quiet. Greyhaven waits.");

    // The mention table is derived; throwing it away must be recoverable.
    await db.entityMentions.clear();
    await reopenDatabase();
    await reindexCampaign(campaign.id);

    expect(await getBacklinks(marrow.id)).toHaveLength(1);
    expect(await getBacklinks(greyhaven.id)).toHaveLength(2);
  });

  it("honours persisted suppressions when rebuilding", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    await suppressMention({ campaignId: campaign.id, noteId: note.id, entityId: ash.id, occurrenceIndex: 0 });
    await db.entityMentions.clear();
    await reopenDatabase();
    await reindexCampaign(campaign.id);

    // The rebuild must not resurrect a mention the user already rejected.
    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions).toHaveLength(1);
    expect(mentions[0].occurrence).toBe(1);
  });

  it("produces the same index when run twice", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow waits. Marrow lied.");

    const first = await reindexCampaign(campaign.id);
    const second = await reindexCampaign(campaign.id);

    expect(first).toBe(second);
    expect(await db.entityMentions.count()).toBe(first);
  });
});
