/**
 * Collections: conceptual bundles of notes and entities.
 *
 * The distinction being protected: a folder is storage and a collection is
 * meaning. Filing a note somewhere moves it; adding it to a collection does
 * not. And a collection never owns what it lists — deleting one must leave
 * every note and entity exactly where it was.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  addToCollection,
  createCollection,
  createFolder,
  deleteCollection,
  deleteEntity,
  deleteNote,
  getCollection,
  getCollectionContents,
  getCollectionsForMember,
  listCollections,
  moveNoteToFolder,
  removeFromCollection,
  trashNote,
  updateCollection,
} from "@/lib/services";
import {
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

/** The PRD's worked example, as a fixture. */
async function redQueenInvestigation() {
  const { campaign, npcType, locationType } = fixture;
  const collection = await createCollection(campaign.id, "Red Queen Investigation");
  const session = await createNoteWithText(campaign.id, "Session 12", "They met.");
  const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
  const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");

  await addToCollection(collection.id, "note", session.id);
  await addToCollection(collection.id, "entity", marrow.id);
  await addToCollection(collection.id, "entity", greyhaven.id);

  return { collection, session, marrow, greyhaven };
}

describe("creating collections", () => {
  it("creates one with a name and colour", async () => {
    const collection = await createCollection(
      fixture.campaign.id,
      "  The Traitors  ",
      "faction",
    );

    expect(collection.name).toBe("The Traitors");
    expect(collection.colorKey).toBe("faction");
  });

  it("falls back to a usable name", async () => {
    const collection = await createCollection(fixture.campaign.id, "   ");

    expect(collection.name).toBe("New collection");
  });

  it("lists a campaign's collections alphabetically", async () => {
    const { campaign } = fixture;
    await createCollection(campaign.id, "Zephyr");
    await createCollection(campaign.id, "Ashen");

    expect((await listCollections(campaign.id)).map((c) => c.name)).toEqual([
      "Ashen",
      "Zephyr",
    ]);
  });

  it("does not leak collections across campaigns", async () => {
    const other = await createTestCampaign();
    await createCollection(fixture.campaign.id, "Mine");
    await createCollection(other.campaign.id, "Theirs");

    expect((await listCollections(fixture.campaign.id)).map((c) => c.name)).toEqual([
      "Mine",
    ]);
  });
});

describe("mixed membership", () => {
  it("holds notes and entities together", async () => {
    const { collection, session, marrow, greyhaven } = await redQueenInvestigation();

    const contents = await getCollectionContents(collection.id);

    expect(contents.notes.map((n) => n.id)).toEqual([session.id]);
    expect(contents.entities.map((e) => e.id).sort()).toEqual(
      [marrow.id, greyhaven.id].sort(),
    );
  });

  it("lets one thing belong to several collections", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const a = await createCollection(campaign.id, "Investigation");
    const b = await createCollection(campaign.id, "Merchants");

    await addToCollection(a.id, "entity", marrow.id);
    await addToCollection(b.id, "entity", marrow.id);

    expect((await getCollectionsForMember("entity", marrow.id)).map((c) => c.name)).toEqual(
      ["Investigation", "Merchants"],
    );
  });

  it("is idempotent", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const collection = await createCollection(campaign.id, "A");

    await addToCollection(collection.id, "entity", marrow.id);
    await addToCollection(collection.id, "entity", marrow.id);

    expect(await db.collectionMembers.count()).toBe(1);
  });

  it("keeps note and entity membership separate even for a shared id", async () => {
    // Ids are UUIDs so this cannot happen naturally, but the composite key must
    // still distinguish the two kinds rather than collapsing them.
    const collection = await createCollection(fixture.campaign.id, "A");
    await addToCollection(collection.id, "note", "shared-id");
    await addToCollection(collection.id, "entity", "shared-id");

    expect(await db.collectionMembers.count()).toBe(2);
  });

  it("removes a single membership without touching the rest", async () => {
    const { collection, session, marrow } = await redQueenInvestigation();

    await removeFromCollection(collection.id, "entity", marrow.id);

    const contents = await getCollectionContents(collection.id);
    expect(contents.entities.map((e) => e.id)).not.toContain(marrow.id);
    expect(contents.notes.map((n) => n.id)).toEqual([session.id]);
  });

  it("survives a reload", async () => {
    const { collection, session } = await redQueenInvestigation();

    await reopenDatabase();

    const contents = await getCollectionContents(collection.id);
    expect(contents.notes.map((n) => n.id)).toEqual([session.id]);
    expect(contents.entities).toHaveLength(2);
  });
});

describe("collections are meaning, folders are storage", () => {
  it("adding to a collection does not move the note", async () => {
    const { campaign } = fixture;
    const folder = await createFolder(campaign.id, "Sessions");
    const note = await createNoteWithText(campaign.id, "Session 12", "Text.");
    await moveNoteToFolder(note.id, folder.id);

    const collection = await createCollection(campaign.id, "Investigation");
    await addToCollection(collection.id, "note", note.id);

    // Still filed exactly where the user put it.
    expect((await db.notes.get(note.id))?.folderId).toBe(folder.id);
  });

  it("a note can be in one folder and several collections at once", async () => {
    const { campaign } = fixture;
    const folder = await createFolder(campaign.id, "Sessions");
    const note = await createNoteWithText(campaign.id, "Session 12", "Text.");
    await moveNoteToFolder(note.id, folder.id);

    const a = await createCollection(campaign.id, "Investigation");
    const b = await createCollection(campaign.id, "Loose Ends");
    await addToCollection(a.id, "note", note.id);
    await addToCollection(b.id, "note", note.id);

    expect(await getCollectionsForMember("note", note.id)).toHaveLength(2);
    expect((await db.notes.get(note.id))?.folderId).toBe(folder.id);
  });
});

describe("colour is presentation only", () => {
  it("recolouring does not change membership", async () => {
    const { collection, session } = await redQueenInvestigation();

    await updateCollection(collection.id, { colorKey: "deity" });

    expect((await getCollection(collection.id))?.colorKey).toBe("deity");
    expect((await getCollectionContents(collection.id)).notes.map((n) => n.id)).toEqual([
      session.id,
    ]);
  });

  it("two collections sharing a colour stay distinct", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const verena = await createNpc(campaign.id, npcType.id, "Verena");
    const a = await createCollection(campaign.id, "A", "faction");
    const b = await createCollection(campaign.id, "B", "faction");

    await addToCollection(a.id, "entity", marrow.id);
    await addToCollection(b.id, "entity", verena.id);

    expect((await getCollectionContents(a.id)).entities.map((e) => e.id)).toEqual([
      marrow.id,
    ]);
    expect((await getCollectionContents(b.id)).entities.map((e) => e.id)).toEqual([
      verena.id,
    ]);
  });
});

describe("deleting", () => {
  it("deleting a collection keeps its contents", async () => {
    const { collection, session, marrow } = await redQueenInvestigation();

    await deleteCollection(collection.id);

    // A collection is a statement about things, not a container that owns them.
    expect(await getCollection(collection.id)).toBeUndefined();
    expect(await db.notes.get(session.id)).toBeTruthy();
    expect(await db.entities.get(marrow.id)).toBeTruthy();
    expect(await db.collectionMembers.count()).toBe(0);
  });

  it("deleting an entity removes it from collections", async () => {
    const { collection, marrow } = await redQueenInvestigation();

    await deleteEntity(marrow.id);

    const contents = await getCollectionContents(collection.id);
    expect(contents.entities.map((e) => e.id)).not.toContain(marrow.id);
  });

  it("permanently deleting a note removes it from collections", async () => {
    const { collection, session } = await redQueenInvestigation();

    await deleteNote(session.id);

    expect((await getCollectionContents(collection.id)).notes).toHaveLength(0);
    expect(await getCollectionsForMember("note", session.id)).toHaveLength(0);
  });

  it("trashing a note hides it but keeps the membership for restore", async () => {
    const { collection, session } = await redQueenInvestigation();

    await trashNote(session.id);

    // Hidden from the collection...
    expect((await getCollectionContents(collection.id)).notes).toHaveLength(0);
    // ...but the membership survives, so restoring puts it back.
    expect(await getCollectionsForMember("note", session.id)).toHaveLength(1);

    const { restoreNote } = await import("@/lib/services");
    const { EntityRecognizer } = await import("@/lib/entities/recognizer");
    await restoreNote(session.id, new EntityRecognizer([]));

    expect((await getCollectionContents(collection.id)).notes).toHaveLength(1);
  });
});
