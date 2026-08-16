/**
 * Schema migrations must never lose or hide a user's work.
 *
 * Every test here does the same thing a real upgrade does: builds a database
 * under an older released schema, seeds it with data shaped the way that
 * version wrote it, then opens it with the current `NotesAppDatabase` and lets
 * Dexie run the upgrades.
 *
 * Assertions go through the app's own queries wherever possible, not raw table
 * reads. That distinction is the whole point: when `deletedAt` became part of
 * an index, every note was still present in its table and simultaneously
 * invisible to every list in the UI. A test that read the table directly would
 * have passed while the app showed the user nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  getBacklinks,
  getGroupsForEntity,
  getMentionCounts,
  getSuppressionKeysForNote,
  listAliases,
  listEntityTypes,
  listLiveNotes,
  listRecentNotes,
  listTrashedNotes,
} from "@/lib/services";
import { NOT_DELETED } from "@/lib/db/types";
import { buildFolderTree } from "@/lib/folders/tree";
import {
  deleteAppDatabase,
  openLegacyDatabase,
  seedLegacyCampaign,
  type LegacyFixture,
} from "../helpers/legacy-db";

/**
 * Stands up a database at `fromVersion`, then opens it with the current schema.
 *
 * The app's singleton connection is used deliberately, so the repositories
 * under test are reading the very database that was just migrated.
 */
async function migrateFrom(fromVersion: number): Promise<LegacyFixture> {
  if (db.isOpen()) db.close();
  await deleteAppDatabase();

  const legacy = await openLegacyDatabase(fromVersion);
  const fixture = await seedLegacyCampaign(legacy, fromVersion);
  legacy.close();

  // Opening the current schema is what runs the upgrades.
  await db.open();
  return fixture;
}

beforeEach(() => {
  if (db.isOpen()) db.close();
});

afterEach(async () => {
  if (db.isOpen()) db.close();
  await deleteAppDatabase();
  await db.open();
});

/** Every released version a user could still be sitting on. */
const LEGACY_VERSIONS = [1, 2, 3, 4, 5];

describe.each(LEGACY_VERSIONS)("upgrading from version %i", (from) => {
  let fixture: LegacyFixture;

  beforeEach(async () => {
    fixture = await migrateFrom(from);
  });

  it("keeps the campaign", async () => {
    const campaign = await db.campaigns.get(fixture.campaignId);

    expect(campaign?.name).toBe("The Black Crown");
  });

  it("keeps every note, with its content", async () => {
    const notes = await db.notes.toArray();

    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.title).sort()).toEqual(["Greyhaven", "Session 1"]);
    expect(notes.every((n) => n.contentText.includes("Marrow"))).toBe(true);
    expect(notes.every((n) => n.content.includes("paragraph"))).toBe(true);
  });

  it("leaves every note visible to the lists the user sees", async () => {
    // The regression that motivated this file: notes present in storage but
    // absent from every indexed read.
    const live = await listLiveNotes(fixture.campaignId);
    const recent = await listRecentNotes(fixture.campaignId, 10);

    expect(live).toHaveLength(2);
    expect(recent).toHaveLength(2);
    expect(await listTrashedNotes(fixture.campaignId)).toHaveLength(0);
  });

  it("gives every note a numeric deletedAt", async () => {
    const notes = await db.notes.toArray();

    expect(notes.every((n) => n.deletedAt === NOT_DELETED)).toBe(true);
  });

  it("keeps entities and their categories", async () => {
    const entities = await db.entities.toArray();

    expect(entities.map((e) => e.name).sort()).toEqual(["Greyhaven", "Marrow"]);
    expect(entities.every((e) => fixture.entityTypeIds.includes(e.entityTypeId))).toBe(
      true,
    );
    expect(entities.every((e) => e.autoLink)).toBe(true);
  });

  it("keeps entity types, ordered and not hidden", async () => {
    const types = await listEntityTypes(fixture.campaignId);

    expect(types.map((t) => t.name)).toEqual(["NPC", "Location"]);
    expect(types.every((t) => t.hidden === false)).toBe(true);
  });

  it("keeps aliases, and makes them findable by campaign", async () => {
    const aliases = await listAliases(fixture.campaignId);

    // Before version 5 an alias had no campaignId at all; the upgrade has to
    // derive it, or the recogniser silently loses the alias.
    expect(aliases.map((a) => a.alias)).toEqual(["Old Marrow"]);
    expect(aliases[0].campaignId).toBe(fixture.campaignId);
  });

  it("keeps mentions, so backlinks and counts still work", async () => {
    const backlinks = await getBacklinks(fixture.entityIds[0]);
    const counts = await getMentionCounts(fixture.campaignId);

    expect(backlinks.map((n) => n.id)).toEqual([fixture.noteIds[0]]);
    expect(counts.get(fixture.entityIds[0])).toBe(1);
    expect(counts.get(fixture.entityIds[1])).toBe(1);
  });

  it("keeps relationships, queryable from both ends", async () => {
    const outgoing = await db.relationships
      .where("sourceEntityId")
      .equals(fixture.entityIds[0])
      .toArray();
    const incoming = await db.relationships
      .where("targetEntityId")
      .equals(fixture.entityIds[1])
      .toArray();

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].relationshipType).toBe("works in");
    expect(incoming).toHaveLength(1);
  });

  it("keeps the folder hierarchy", async () => {
    const folders = await db.folders.toArray();
    const tree = buildFolderTree(folders);

    expect(folders).toHaveLength(2);
    expect(tree).toHaveLength(1);
    expect(tree[0].folder.name).toBe("Lore");
    expect(tree[0].children[0].folder.name).toBe("Factions");
  });

  it("keeps notes filed where they were", async () => {
    const filed = await db.notes.get(fixture.noteIds[0]);

    expect(filed?.folderId).toBe(fixture.folderIds[0]);
  });

  it("keeps tasks", async () => {
    const tasks = await db.tasks.toArray();

    expect(tasks.map((t) => t.text)).toEqual(["Decide who killed Marrow"]);
    expect(tasks[0].completed).toBe(false);
  });

  it("keeps tags, favourites and visit history", async () => {
    expect(await db.tags.count()).toBe(1);
    expect(await db.noteTags.count()).toBe(1);
    expect(await db.favorites.count()).toBe(1);
    expect(await db.visits.count()).toBe(1);
  });
});

/** Tables that only exist from version 2 onwards. */
describe.each([2, 3, 4, 5])("upgrading from version %i keeps v2 data", (from) => {
  let fixture: LegacyFixture;

  beforeEach(async () => {
    fixture = await migrateFrom(from);
  });

  it("keeps entity groups and their membership", async () => {
    const groups = await getGroupsForEntity(fixture.entityIds[0]);

    expect(groups.map((g) => g.name)).toEqual(["The Traitors"]);
    expect(groups[0].colorKey).toBe("faction");
  });

  it("keeps false-positive corrections", async () => {
    const keys = await getSuppressionKeysForNote(fixture.noteIds[1]);

    // A correction the user already made must not come undone in an upgrade.
    expect(keys.size).toBe(1);
    expect(await db.mentionSuppressions.count()).toBe(1);
  });
});

describe("the version 4 regression specifically", () => {
  it("repairs notes written with a null deletedAt", async () => {
    const fixture = await migrateFrom(4);

    // Version 4 wrote null. Version 5 began indexing the field, and IndexedDB
    // skips records whose indexed key is null — so these notes were intact and
    // invisible until version 6 normalised them.
    const stored = await db.notes.toArray();
    expect(stored.every((n) => typeof n.deletedAt === "number")).toBe(true);

    expect(await listLiveNotes(fixture.campaignId)).toHaveLength(2);
  });
});

describe("upgrading is safe to repeat", () => {
  it("changes nothing when the database is already current", async () => {
    const fixture = await migrateFrom(1);

    const before = await db.notes.toArray();
    db.close();
    await db.open();
    const after = await db.notes.toArray();

    expect(after).toEqual(before);
    expect(await listLiveNotes(fixture.campaignId)).toHaveLength(2);
  });
});

describe("an empty legacy database", () => {
  it("upgrades without inventing anything", async () => {
    if (db.isOpen()) db.close();
    await deleteAppDatabase();

    const legacy = await openLegacyDatabase(1);
    legacy.close();

    await db.open();

    expect(await db.notes.count()).toBe(0);
    expect(await db.campaigns.count()).toBe(0);
  });
});
