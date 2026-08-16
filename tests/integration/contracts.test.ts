/**
 * The service boundary must survive being serialised.
 *
 * Every public operation's response is put through `JSON.parse(JSON.stringify(…))`
 * and compared to the original. That is exactly what a server would do to it,
 * and the failure it catches is a quiet one: `JSON.stringify(new Map())` is
 * `"{}"`, so returning a Map does not throw — it arrives empty.
 *
 * `JsonSafe` in `contracts.ts` catches the same mistake at compile time. This
 * catches it at the value level, including anything that slips in through an
 * `any` or a cast.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  addToCollection,
  createCollection,
  createFolder,
  createRelationship,
  deleteEntityType,
  getBacklinks,
  getCampaignGraph,
  getCollectionContents,
  getCollectionsForMember,
  getEntityCountsByType,
  getEntityRelationships,
  getMentionCounts,
  getMentionPairs,
  getNoteTitles,
  getNeighbourhood,
  importMarkdownNotes,
  listCollections,
  listEntities,
  listEntityTypes,
  listFolders,
  listLiveNotes,
  listRecentNotes,
  listRelationships,
  listTasks,
  listTrashedNotes,
  moveFolder,
  searchCampaign,
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

/**
 * Fails when `value` does not round-trip through JSON unchanged.
 *
 * `toEqual` alone is not enough: an empty `Map` and an empty object are
 * distinguishable, but a populated Map becomes `{}` and would be caught here
 * precisely because the two stop matching.
 */
function expectJsonSafe(label: string, value: unknown) {
  const round = JSON.parse(JSON.stringify(value));
  expect(round, `${label} does not survive JSON`).toEqual(value);
}

async function populatedCampaign() {
  const { campaign, npcType, locationType } = fixture;

  const folder = await createFolder(campaign.id, "Lore");
  const note = await createNoteWithText(
    campaign.id,
    "Session 12",
    "Marrow keeps a shop in Greyhaven.",
  );
  const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
  const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
  await createRelationship({
    campaignId: campaign.id,
    sourceEntityId: marrow.id,
    targetEntityId: greyhaven.id,
    relationshipType: "works in",
  });
  const collection = await createCollection(campaign.id, "Investigation");
  await addToCollection({
    collectionId: collection.id,
    memberType: "note",
    memberId: note.id,
  });
  await addToCollection({
    collectionId: collection.id,
    memberType: "entity",
    memberId: marrow.id,
  });

  return { campaign, folder, note, marrow, greyhaven, collection };
}

describe("every public response survives JSON", () => {
  it("round-trips reads over a populated campaign", async () => {
    const { campaign, note, marrow, collection } = await populatedCampaign();
    const id = campaign.id;

    expectJsonSafe("listLiveNotes", await listLiveNotes(id));
    expectJsonSafe("listRecentNotes", await listRecentNotes(id, 5));
    expectJsonSafe("listTrashedNotes", await listTrashedNotes(id));
    expectJsonSafe("getNoteTitles", await getNoteTitles(id));
    expectJsonSafe("listFolders", await listFolders(id));
    expectJsonSafe("listEntities", await listEntities(id));
    expectJsonSafe("listEntityTypes", await listEntityTypes(id));
    expectJsonSafe("listTasks", await listTasks(id));
    expectJsonSafe("listRelationships", await listRelationships(id));
    expectJsonSafe("listCollections", await listCollections(id));

    expectJsonSafe("getBacklinks", await getBacklinks(marrow.id));
    expectJsonSafe("getMentionCounts", await getMentionCounts(id));
    expectJsonSafe("getMentionPairs", await getMentionPairs(id));
    expectJsonSafe("getEntityCountsByType", await getEntityCountsByType(id));
    expectJsonSafe("getEntityRelationships", await getEntityRelationships(marrow.id));
    expectJsonSafe("getCollectionContents", await getCollectionContents(collection.id));
    expectJsonSafe(
      "getCollectionsForMember",
      await getCollectionsForMember("note", note.id),
    );
    expectJsonSafe("getCampaignGraph", await getCampaignGraph(id));
    expectJsonSafe("searchCampaign", await searchCampaign(id, "Marrow", { entities: [], aliases: [] }));
  });

  it("round-trips a refused operation", async () => {
    const { campaign, folder } = await populatedCampaign();
    const child = await createFolder(campaign.id, "Factions", folder.id);

    const refused = await moveFolder(folder.id, child.id);
    const accepted = await moveFolder(child.id, null);

    expect(refused.ok).toBe(false);
    expectJsonSafe("moveFolder refused", refused);
    expectJsonSafe("moveFolder accepted", accepted);
  });

  it("round-trips a refusal carrying details", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    const refused = await deleteEntityType(npcType.id);

    expect(refused.ok).toBe(false);
    // `details` carries an entity count; numbers survive, and this proves the
    // shape does not smuggle anything that does not.
    expectJsonSafe("deleteEntityType refused", refused);
  });

  it("round-trips an import outcome", async () => {
    const outcome = await importMarkdownNotes({
      campaignId: fixture.campaign.id,
      files: [{ name: "a.md", content: "# A\n\nBody." }],
    });

    expectJsonSafe("importMarkdownNotes", outcome);
  });

  it("round-trips empty results", async () => {
    const id = fixture.campaign.id;

    // The empty case is where a Map would pass unnoticed: `{}` and an empty
    // Map both look like nothing.
    expectJsonSafe("empty notes", await listLiveNotes(id));
    expectJsonSafe("empty counts", await getMentionCounts(id));
    expectJsonSafe("empty graph", await getCampaignGraph(id));
    expectJsonSafe("empty collections", await listCollections(id));
  });
});

describe("operations take data, never behaviour", () => {
  it("re-indexes without being handed a recogniser", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    const { reindexCampaign } = await import("@/lib/services");

    // The whole argument list is serialisable, so this call could be made over
    // HTTP as-is. An automaton could not have been.
    const args = [campaign.id];
    expectJsonSafe("reindexCampaign args", args);
    expect(await reindexCampaign(campaign.id)).toBeGreaterThan(0);
  });

  it("restores a note without being handed a recogniser", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    const { trashNote, restoreNote } = await import("@/lib/services");
    await trashNote(note.id);
    await restoreNote(note.id);

    // Recognition was rebuilt internally, against the current vocabulary.
    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });
});

describe("graph traversal returns something serialisable", () => {
  it("returns entity ids as an array, not a Set", async () => {
    const { campaign, marrow } = await populatedCampaign();

    const reached = await getNeighbourhood(campaign.id, marrow.id, 2);

    expectJsonSafe("getNeighbourhood", reached);
    expect(Array.isArray(reached)).toBe(true);
    expect(reached).toContain(marrow.id);
  });
});
