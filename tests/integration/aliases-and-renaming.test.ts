/**
 * Aliases, renaming, and merging (PRD §12, §62).
 *
 * The §62 requirement is explicit: renaming an entity must preserve existing
 * relationships and keep aliases working. This is where the "derived, not
 * stored" mention design has to earn its keep — a rename touches one row, and
 * everything downstream re-derives.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  addAlias,
  createRelationship,
  getBacklinks,
  reindexCampaign,
  removeAlias,
  renameEntity,
} from "@/lib/services";
import {
  createNoteWithText,
  createNpc,
  createTestCampaign,
  resetDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("aliases", () => {
  it("matches future text through a newly added alias", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");
    await addAlias(queen.id, "Verena");

    const note = await createNoteWithText(campaign.id, "Later", "Verena watches.");

    const mentions = await db.entityMentions.where("noteId").equals(note.id).toArray();
    expect(mentions).toHaveLength(1);
    expect(mentions[0].entityId).toBe(queen.id);
    expect(mentions[0].detectedText).toBe("Verena");
  });

  it("matches text written before the alias existed, after a reindex", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");
    const note = await createNoteWithText(
      campaign.id,
      "Session 4",
      "Verena refused to answer.",
    );

    // Nothing matched when the note was written.
    expect(await getBacklinks(queen.id)).toHaveLength(0);

    await addAlias(queen.id, "Verena");
    await reindexCampaign(campaign.id);

    const backlinks = await getBacklinks(queen.id);
    expect(backlinks.map((n) => n.id)).toEqual([note.id]);
  });

  it("stops recognising through an alias once it is removed", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");
    const aliasRecord = await addAlias(queen.id, "Verena");
    const note = await createNoteWithText(campaign.id, "Session 4", "Verena watches.");

    expect(await getBacklinks(queen.id)).toHaveLength(1);

    await removeAlias(aliasRecord!.id);
    await reindexCampaign(campaign.id);

    expect(await getBacklinks(queen.id)).toHaveLength(0);
    // The entity and the note itself are untouched — only the derived index changed.
    expect(await db.entities.get(queen.id)).toBeTruthy();
    expect((await db.notes.get(note.id))?.contentText).toBe("Verena watches.");
  });

  it("does not duplicate an alias that already exists", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");

    await addAlias(queen.id, "Verena");
    await addAlias(queen.id, "verena");

    const aliases = await db.entityAliases.where("entityId").equals(queen.id).toArray();
    expect(aliases).toHaveLength(1);
  });
});

describe("renaming an entity", () => {
  it("keeps the same identity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    await renameEntity(marrow.id, "Old Marrow");

    const reloaded = await db.entities.get(marrow.id);
    expect(reloaded?.id).toBe(marrow.id);
    expect(reloaded?.name).toBe("Old Marrow");
  });

  it("preserves relationships", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship({ campaignId: campaign.id, sourceEntityId: marrow.id, targetEntityId: greyhaven.id, relationshipType: "works in" });

    await renameEntity(marrow.id, "Old Marrow");

    const relationships = await db.relationships
      .where("sourceEntityId")
      .equals(marrow.id)
      .toArray();
    expect(relationships).toHaveLength(1);
    expect(relationships[0].relationshipType).toBe("works in");
    expect(relationships[0].targetEntityId).toBe(greyhaven.id);
  });

  it("keeps backlinks for notes that use the new name", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "Session 3", "Old Marrow waits.");

    await renameEntity(marrow.id, "Old Marrow");
    await reindexCampaign(campaign.id);

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("keeps old text matching when the previous name is kept as an alias", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "Session 1", "Marrow waits.");

    await addAlias(marrow.id, "Marrow");
    await renameEntity(marrow.id, "Old Marrow");
    await reindexCampaign(campaign.id);

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("stops matching the old name when it was not kept as an alias", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 1", "Marrow waits.");

    await renameEntity(marrow.id, "Bastiona");
    await reindexCampaign(campaign.id);

    expect(await getBacklinks(marrow.id)).toHaveLength(0);
  });
});

describe("merging duplicate entities", () => {
  it("folds mentions, aliases and relationships into the target", async () => {
    const { campaign, npcType, locationType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship({ campaignId: campaign.id, sourceEntityId: duplicate.id, targetEntityId: greyhaven.id, relationshipType: "works in" });

    const note = await createNoteWithText(campaign.id, "S1", "Old Marrow waits.");
    expect((await getBacklinks(duplicate.id)).map((n) => n.id)).toEqual([note.id]);

    const { mergeEntities } = await import("@/lib/services");
    await mergeEntities(duplicate.id, keep.id);
    await reindexCampaign(campaign.id);

    expect(await db.entities.get(duplicate.id)).toBeUndefined();
    // The old name survives as an alias, so the text still resolves.
    expect((await getBacklinks(keep.id)).map((n) => n.id)).toEqual([note.id]);

    const relationships = await db.relationships
      .where("sourceEntityId")
      .equals(keep.id)
      .toArray();
    expect(relationships).toHaveLength(1);
  });
});

describe("re-indexing", () => {
  it("reconstructs the entire mention index from persisted notes", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow writes. Marrow waits.");
    await createNoteWithText(campaign.id, "B", "Marrow again.");

    // Simulate a corrupted or discarded index.
    await db.entityMentions.clear();
    expect(await getBacklinks(marrow.id)).toHaveLength(0);

    const rebuilt = await reindexCampaign(campaign.id);

    expect(rebuilt).toBe(3);
    expect(await getBacklinks(marrow.id)).toHaveLength(2);
  });

  it("backlinks a note written before the entity existed", async () => {
    const { campaign, npcType } = fixture;
    const note = await createNoteWithText(
      campaign.id,
      "Session 1",
      "The party met Marrow at his shop.",
    );

    // The GM flags a name they have already been writing about for weeks.
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await reindexCampaign(campaign.id);

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });
});

/**
 * What a merge must not lose.
 *
 * Everything that pointed at the source entity has to end up pointing at the
 * target or be deliberately dropped. Anything left behind references a row that
 * no longer exists, and the symptom is never an error — it is a collection that
 * quietly has one fewer thing in it than the user put there.
 *
 * These only became reachable when merge got a button; before that the function
 * was service-layer only.
 */
describe("merging keeps everything that pointed at the source", () => {
  it("moves collection membership onto the surviving entity", async () => {
    const { campaign, npcType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");

    const { createCollection, addToCollection, getCollectionContents, mergeEntities } =
      await import("@/lib/services");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");
    await addToCollection({
      collectionId: collection.id,
      memberType: "entity",
      memberId: duplicate.id,
    });

    await mergeEntities(duplicate.id, keep.id);

    const contents = await getCollectionContents(collection.id);
    expect(contents.entities.map((e) => e.id)).toEqual([keep.id]);
  });

  it("does not leave two memberships when both were in one collection", async () => {
    const { campaign, npcType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");

    const { createCollection, addToCollection, getCollectionContents, mergeEntities } =
      await import("@/lib/services");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");
    for (const memberId of [keep.id, duplicate.id]) {
      await addToCollection({ collectionId: collection.id, memberType: "entity", memberId });
    }

    await mergeEntities(duplicate.id, keep.id);

    expect((await getCollectionContents(collection.id)).entities).toHaveLength(1);
    expect(await db.collectionMembers.count()).toBe(1);
  });

  it("leaves other collections alone", async () => {
    const { campaign, npcType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");
    const other = await createNpc(campaign.id, npcType.id, "Verena");

    const { createCollection, addToCollection, getCollectionContents, mergeEntities } =
      await import("@/lib/services");
    const arc = await createCollection(campaign.id, "Arc");
    const cast = await createCollection(campaign.id, "Cast");
    await addToCollection({ collectionId: arc.id, memberType: "entity", memberId: duplicate.id });
    await addToCollection({ collectionId: cast.id, memberType: "entity", memberId: other.id });

    await mergeEntities(duplicate.id, keep.id);

    expect((await getCollectionContents(arc.id)).entities.map((e) => e.id)).toEqual([keep.id]);
    expect((await getCollectionContents(cast.id)).entities.map((e) => e.id)).toEqual([other.id]);
  });

  it("drops the source's mention suppressions rather than orphaning them", async () => {
    const { campaign, npcType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Old Marrow waits.");

    const { suppressMention, mergeEntities } = await import("@/lib/services");
    await suppressMention({
      campaignId: campaign.id,
      noteId: note.id,
      entityId: duplicate.id,
      occurrenceIndex: 0,
    });

    await mergeEntities(duplicate.id, keep.id);

    // Kept, they would name an occurrence of an entity that no longer exists,
    // and the target's occurrences are renumbered by the merge anyway.
    expect(
      await db.mentionSuppressions.where("entityId").equals(duplicate.id).count(),
    ).toBe(0);
  });

  it("does not disturb the target's own suppressions", async () => {
    const { campaign, npcType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    const { suppressMention, mergeEntities } = await import("@/lib/services");
    await suppressMention({
      campaignId: campaign.id,
      noteId: note.id,
      entityId: keep.id,
      occurrenceIndex: 0,
    });

    await mergeEntities(duplicate.id, keep.id);

    expect(
      await db.mentionSuppressions.where("entityId").equals(keep.id).count(),
    ).toBe(1);
  });
});

describe("deleting an entity", () => {
  it("removes it and everything derived from it, leaving the notes alone", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship({
      campaignId: campaign.id,
      sourceEntityId: marrow.id,
      targetEntityId: greyhaven.id,
      relationshipType: "works in",
    });
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits in Greyhaven.");

    const { deleteEntity } = await import("@/lib/services");
    await deleteEntity(marrow.id);

    expect(await db.entities.get(marrow.id)).toBeUndefined();
    expect(await db.entityMentions.where("entityId").equals(marrow.id).count()).toBe(0);
    expect(await db.relationships.count()).toBe(0);

    // The writing is untouched — the words stay, they just stop lighting up.
    const stored = await db.notes.get(note.id);
    expect(stored?.contentText).toBe("Marrow waits in Greyhaven.");
    expect(await db.entities.get(greyhaven.id)).toBeTruthy();
  });

  it("removes it from collections", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    const { createCollection, addToCollection, getCollectionContents, deleteEntity } =
      await import("@/lib/services");
    const collection = await createCollection(campaign.id, "Arc");
    await addToCollection({
      collectionId: collection.id,
      memberType: "entity",
      memberId: marrow.id,
    });

    await deleteEntity(marrow.id);

    expect((await getCollectionContents(collection.id)).entities).toHaveLength(0);
  });

  it("stops the name being recognised in notes written afterwards", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    const { deleteEntity } = await import("@/lib/services");
    await deleteEntity(marrow.id);
    await reindexCampaign(campaign.id);

    expect(await db.entityMentions.count()).toBe(0);
  });
});
