/**
 * Frozen snapshots of the database schema as it was at each released version,
 * plus data shaped the way that version actually wrote it.
 *
 * These exist so a migration can be tested the way it happens in the wild: a
 * database created by an older build of the app, then opened by the current
 * one.
 *
 * NOTHING IN HERE MAY BE EDITED TO MATCH NEW CODE. These are history. If a
 * schema definition below is changed to make a test pass, the test stops
 * describing what is on real users' machines and the next migration bug ships
 * unnoticed — which is exactly how notes went invisible once `deletedAt`
 * became part of an index.
 */

import Dexie from "dexie";

/** The database name the app uses; migration tests take it over deliberately. */
export const APP_DB_NAME = "notesapp";

/** Version 1: the original vertical slice. */
const V1_STORES: Record<string, string> = {
  campaigns: "id, name, updatedAt",
  notes: "id, campaignId, folderId, updatedAt, title, [campaignId+updatedAt]",
  folders: "id, campaignId, parentFolderId",
  tags: "id, campaignId, name",
  noteTags: "id, noteId, tagId, [noteId+tagId]",
  entityTypes: "id, campaignId, sortOrder",
  entities: "id, campaignId, entityTypeId, name",
  entityAliases: "id, entityId, alias",
  entityMentions: "id, entityId, noteId, campaignId, [noteId+entityId]",
  relationships: "id, campaignId, sourceEntityId, targetEntityId",
  tasks: "id, campaignId, noteId, completed",
  favorites: "id, noteId",
  visits: "id, campaignId, noteId, visitedAt",
};

/** Version 2 added suppressions and entity groups. */
const V2_STORES: Record<string, string> = {
  mentionSuppressions:
    "id, campaignId, noteId, entityId, [noteId+entityId+occurrenceIndex]",
  entityGroups: "id, campaignId, name",
  entityGroupMembers: "id, groupId, entityId, [groupId+entityId]",
};

/** Versions 3 and 4 changed data only, not stores. */
const NO_STORE_CHANGE: Record<string, string> = {};

/** Version 5 reworked the indexes. */
const V5_STORES: Record<string, string> = {
  notes:
    "id, campaignId, folderId, updatedAt, title, [campaignId+updatedAt], [campaignId+deletedAt+updatedAt], [folderId+deletedAt]",
  entityTypes: "id, campaignId, sortOrder, [campaignId+sortOrder]",
  entities: "id, campaignId, entityTypeId, name, [campaignId+entityTypeId]",
  entityAliases: "id, entityId, alias, campaignId",
  entityMentions:
    "id, entityId, noteId, campaignId, [noteId+entityId], [entityId+noteId], [campaignId+entityId+noteId]",
  tasks: "id, campaignId, noteId",
};

/**
 * Opens a raw Dexie handle declaring the schema exactly as of `version`.
 *
 * No upgrade callbacks: this stands in for an old build of the app, which had
 * no knowledge of anything later.
 */
export async function openLegacyDatabase(version: number): Promise<Dexie> {
  const legacy = new Dexie(APP_DB_NAME);

  legacy.version(1).stores(V1_STORES);
  if (version >= 2) legacy.version(2).stores(V2_STORES);
  if (version >= 3) legacy.version(3).stores(NO_STORE_CHANGE);
  if (version >= 4) legacy.version(4).stores(NO_STORE_CHANGE);
  if (version >= 5) legacy.version(5).stores(V5_STORES);

  await legacy.open();
  return legacy;
}

export interface LegacyFixture {
  campaignId: string;
  noteIds: string[];
  entityIds: string[];
  entityTypeIds: string[];
  folderIds: string[];
  groupId?: string;
}

/**
 * Fills a legacy database with a campaign that exercises every table.
 *
 * Records are written in the shape that version produced — notably, notes have
 * no `deletedAt` before version 4 and an explicit `null` at version 4, entity
 * types have no `hidden` before version 3, and aliases have no `campaignId`
 * before version 5.
 */
export async function seedLegacyCampaign(
  legacy: Dexie,
  version: number,
): Promise<LegacyFixture> {
  const now = 1_700_000_000_000;
  const id = (prefix: string, n = 0) => `${prefix}-${n}`;

  const campaignId = id("campaign");
  await legacy.table("campaigns").add({
    id: campaignId,
    name: "The Black Crown",
    description: "A campaign that predates the current schema.",
    themeId: "grimoire",
    createdAt: now,
    updatedAt: now,
  });

  const entityTypeIds = [id("type", 0), id("type", 1)];
  await legacy.table("entityTypes").bulkAdd(
    entityTypeIds.map((typeId, i) => ({
      id: typeId,
      campaignId,
      name: i === 0 ? "NPC" : "Location",
      icon: i === 0 ? "☿" : "⌂",
      themeKey: i === 0 ? "npc" : "location",
      isBuiltIn: true,
      sortOrder: i,
      // `hidden` only exists from version 3.
      ...(version >= 3 ? { hidden: false } : {}),
    })),
  );

  const folderIds = [id("folder", 0), id("folder", 1)];
  await legacy.table("folders").bulkAdd([
    { id: folderIds[0], campaignId, parentFolderId: null, name: "Lore", createdAt: now },
    {
      id: folderIds[1],
      campaignId,
      parentFolderId: folderIds[0],
      name: "Factions",
      createdAt: now,
    },
  ]);

  const noteIds = [id("note", 0), id("note", 1)];
  await legacy.table("notes").bulkAdd(
    noteIds.map((noteId, i) => ({
      id: noteId,
      campaignId,
      title: i === 0 ? "Session 1" : "Greyhaven",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Marrow keeps a shop in Greyhaven." }],
          },
        ],
      }),
      contentText: "Marrow keeps a shop in Greyhaven.",
      folderId: i === 0 ? folderIds[0] : null,
      visibility: "gm",
      isLocked: false,
      localOnly: false,
      createdAt: now + i,
      updatedAt: now + i,
      syncVersion: 0,
      // Version 4 introduced the field and wrote null into it. Earlier
      // versions have no such field at all. Both must survive.
      ...(version >= 4 ? { deletedAt: null } : {}),
    })),
  );

  const entityIds = [id("entity", 0), id("entity", 1)];
  await legacy.table("entities").bulkAdd([
    {
      id: entityIds[0],
      campaignId,
      name: "Marrow",
      entityTypeId: entityTypeIds[0],
      description: "A merchant.",
      autoLink: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: entityIds[1],
      campaignId,
      name: "Greyhaven",
      entityTypeId: entityTypeIds[1],
      description: "",
      autoLink: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await legacy.table("entityAliases").bulkAdd([
    {
      id: id("alias", 0),
      entityId: entityIds[0],
      alias: "Old Marrow",
      // `campaignId` only exists from version 5.
      ...(version >= 5 ? { campaignId } : {}),
    },
  ]);

  await legacy.table("entityMentions").bulkAdd([
    {
      id: id("mention", 0),
      entityId: entityIds[0],
      noteId: noteIds[0],
      campaignId,
      from: 0,
      to: 6,
      detectedText: "Marrow",
      occurrence: 0,
    },
    {
      id: id("mention", 1),
      entityId: entityIds[1],
      noteId: noteIds[0],
      campaignId,
      from: 26,
      to: 35,
      detectedText: "Greyhaven",
      occurrence: 0,
    },
  ]);

  await legacy.table("relationships").add({
    id: id("relationship", 0),
    campaignId,
    sourceEntityId: entityIds[0],
    targetEntityId: entityIds[1],
    relationshipType: "works in",
    description: "",
    createdAt: now,
  });

  await legacy.table("tasks").add({
    id: id("task", 0),
    campaignId,
    noteId: noteIds[0],
    text: "Decide who killed Marrow",
    completed: false,
    dueDate: null,
    createdAt: now,
  });

  await legacy.table("tags").add({ id: id("tag", 0), campaignId, name: "session" });
  await legacy
    .table("noteTags")
    .add({ id: id("notetag", 0), noteId: noteIds[0], tagId: id("tag", 0) });
  await legacy
    .table("favorites")
    .add({ id: id("favorite", 0), noteId: noteIds[0], createdAt: now });
  await legacy.table("visits").add({
    id: id("visit", 0),
    campaignId,
    noteId: noteIds[0],
    visitedAt: now,
  });

  let groupId: string | undefined;
  if (version >= 2) {
    groupId = id("group", 0);
    await legacy
      .table("entityGroups")
      .add({ id: groupId, campaignId, name: "The Traitors", colorKey: "faction", createdAt: now });
    await legacy
      .table("entityGroupMembers")
      .add({ id: id("member", 0), groupId, entityId: entityIds[0] });

    await legacy.table("mentionSuppressions").add({
      id: id("suppression", 0),
      campaignId,
      noteId: noteIds[1],
      entityId: entityIds[0],
      occurrenceIndex: 0,
    });
  }

  return { campaignId, noteIds, entityIds, entityTypeIds, folderIds, groupId };
}

/** Removes the database entirely, so each test starts from nothing. */
export async function deleteAppDatabase(): Promise<void> {
  await Dexie.delete(APP_DB_NAME);
}
