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
  buildRecognizer,
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
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

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
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

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
    await createRelationship(campaign.id, marrow.id, greyhaven.id, "works in");

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
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("keeps old text matching when the previous name is kept as an alias", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "Session 1", "Marrow waits.");

    await addAlias(marrow.id, "Marrow");
    await renameEntity(marrow.id, "Old Marrow");
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("stops matching the old name when it was not kept as an alias", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 1", "Marrow waits.");

    await renameEntity(marrow.id, "Bastiona");
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    expect(await getBacklinks(marrow.id)).toHaveLength(0);
  });
});

describe("merging duplicate entities", () => {
  it("folds mentions, aliases and relationships into the target", async () => {
    const { campaign, npcType, locationType } = fixture;
    const keep = await createNpc(campaign.id, npcType.id, "Marrow");
    const duplicate = await createNpc(campaign.id, npcType.id, "Old Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship(campaign.id, duplicate.id, greyhaven.id, "works in");

    const note = await createNoteWithText(campaign.id, "S1", "Old Marrow waits.");
    expect((await getBacklinks(duplicate.id)).map((n) => n.id)).toEqual([note.id]);

    const { mergeEntities } = await import("@/lib/services");
    await mergeEntities(duplicate.id, keep.id);
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

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

    const rebuilt = await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

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
    await reindexCampaign(campaign.id, await buildRecognizer(campaign.id));

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });
});
