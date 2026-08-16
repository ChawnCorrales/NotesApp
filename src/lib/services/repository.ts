/**
 * The Dexie-backed implementation of the service layer.
 *
 * This is the only module that knows the app stores data in IndexedDB.
 * Components never import it directly — they import `lib/services`, which is
 * the surface a server API would eventually mirror. Keeping the boundary here
 * is what makes a second implementation possible without touching the UI.
 *
 * It is also the seam where a sync engine lives: every mutation below is the
 * natural place to enqueue a pending sync operation (PRD §36).
 */

import { db, newId } from "../db/db";
import { NOT_DELETED } from "../db/types";
import type {
  Entity,
  EntityAlias,
  EntityGroup,
  EntityMention,
  EntityType,
  Folder,
  ID,
  Note,
  Relationship,
  Task,
} from "../db/types";
import { wouldCreateCycle } from "../folders/tree";
import {
  filterSuppressed,
  suppressionKey,
  type EntityMatch,
} from "../entities/recognizer";
import { parseMarkdownDocument } from "../import/markdown";
import { deriveTasksFromContent } from "../notes/derive";

const EMPTY_SUPPRESSIONS: ReadonlySet<string> = new Set();

/* ------------------------------------------------------- indexed queries */

/**
 * Range bounds for compound-index scans.
 *
 * Written out rather than using `Dexie.minKey`/`Dexie.maxKey`, whose concrete
 * values depend on what the host environment supports — a string sentinel under
 * plain Node, an array sentinel once IndexedDB is present. Load-bearing query
 * bounds should not change shape between the browser and the test runner.
 *
 * Ids are strings, so `""` sorts below and `"￿"` above any of them.
 * Timestamps are numbers, so the infinities bound them exactly.
 */
const ID_LOW = "";
const ID_HIGH = "￿";
const TIME_LOW = -Infinity;
const TIME_HIGH = Infinity;

/**
 * Every live note in a campaign, read through
 * `[campaignId+deletedAt+updatedAt]`.
 *
 * Shared so the several places that need this — search, the folder tree, the
 * command palette, re-indexing — all get the index rather than each
 * rediscovering it, and none of them can drift back into reading trashed rows.
 */
export function liveNotesQuery(campaignId: ID) {
  return db.notes
    .where("[campaignId+deletedAt+updatedAt]")
    .between(
      [campaignId, NOT_DELETED, TIME_LOW],
      [campaignId, NOT_DELETED, TIME_HIGH],
    );
}

export async function listLiveNotes(campaignId: ID): Promise<Note[]> {
  return liveNotesQuery(campaignId).toArray();
}

/** The `limit` most recently edited live notes, newest first. */
export async function listRecentNotes(campaignId: ID, limit: number): Promise<Note[]> {
  // Ordered by the index, so this reads `limit` rows rather than the campaign.
  return liveNotesQuery(campaignId).reverse().limit(limit).toArray();
}

/* ------------------------------------------------------------------ notes */

export async function createNote(
  campaignId: ID,
  init: Partial<Pick<Note, "title" | "content" | "contentText" | "folderId">> = {},
): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: newId(),
    campaignId,
    title: init.title ?? "",
    content: init.content ?? "",
    contentText: init.contentText ?? "",
    folderId: init.folderId ?? null,
    visibility: "gm",
    isLocked: false,
    localOnly: false,
    createdAt: now,
    updatedAt: now,
    syncVersion: 0,
    deletedAt: NOT_DELETED,
  };

  await db.notes.add(note);
  return note;
}

export async function updateNote(
  noteId: ID,
  changes: Partial<Omit<Note, "id" | "campaignId" | "createdAt">>,
): Promise<void> {
  await db.notes.update(noteId, { ...changes, updatedAt: Date.now() });
}

/**
 * Moves a note to the trash.
 *
 * Its mentions and tasks go with it. That is what keeps every other query
 * honest without each one having to remember to filter: a trashed note stops
 * appearing in backlinks, mention counts and the task viewer because the rows
 * those views read are gone, not because each caller checked a flag.
 *
 * The note's own content is untouched, so restoring is exact.
 */
export async function trashNote(noteId: ID): Promise<void> {
  await db.transaction("rw", [db.notes, db.entityMentions, db.tasks], async () => {
    await db.notes.update(noteId, { deletedAt: Date.now() });
    await db.entityMentions.where("noteId").equals(noteId).delete();
    await db.tasks.where("noteId").equals(noteId).delete();
  });
}

/**
 * Restores a note from the trash and rebuilds what trashing removed.
 *
 * Takes a recogniser rather than reaching for one, so a restore re-indexes
 * against the campaign's *current* entity vocabulary — a name flagged while the
 * note sat in the trash is recognised the moment it comes back.
 */
export async function restoreNote(
  noteId: ID,
  recognizer: { findMatches: (text: string) => EntityMatch[] },
): Promise<void> {
  const note = await db.notes.get(noteId);
  if (!note) return;

  await db.notes.update(noteId, { deletedAt: NOT_DELETED });
  await syncMentionsForNote(noteId, note.campaignId, recognizer.findMatches(note.contentText));
  await syncTasksForNote(noteId, note.campaignId, deriveTasksFromContent(note.content));
}

/**
 * Notes currently in the trash, most recently deleted first.
 *
 * Read through the same index as live notes, from just above the sentinel, so
 * the campaign's live notes are never touched.
 */
export async function listTrashedNotes(campaignId: ID): Promise<Note[]> {
  const notes = await db.notes
    .where("[campaignId+deletedAt+updatedAt]")
    .between(
      [campaignId, NOT_DELETED + 1, TIME_LOW],
      [campaignId, TIME_HIGH, TIME_HIGH],
    )
    .toArray();

  return notes.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Permanently removes every note in the trash. */
export async function emptyTrash(campaignId: ID): Promise<number> {
  const trashed = await listTrashedNotes(campaignId);
  for (const note of trashed) {
    await deleteNote(note.id);
  }
  return trashed.length;
}

/**
 * Permanently deletes a note and everything derived from it.
 *
 * Mentions and tasks are regenerated from note content, so they have no meaning
 * once the note is gone and would otherwise leave phantom backlinks pointing at
 * a note that no longer exists.
 */
export async function deleteNote(noteId: ID): Promise<void> {
  // Passed as an array: Dexie's positional overloads stop at five tables.
  await db.transaction(
    "rw",
    [
      db.notes,
      db.entityMentions,
      db.tasks,
      db.favorites,
      db.noteTags,
      db.visits,
      db.mentionSuppressions,
    ],
    async () => {
      await db.notes.delete(noteId);
      await db.entityMentions.where("noteId").equals(noteId).delete();
      await db.tasks.where("noteId").equals(noteId).delete();
      await db.favorites.where("noteId").equals(noteId).delete();
      await db.noteTags.where("noteId").equals(noteId).delete();
      await db.visits.where("noteId").equals(noteId).delete();
      await db.mentionSuppressions.where("noteId").equals(noteId).delete();
    },
  );
}

/* ----------------------------------------------------------------- import */

export interface MarkdownFile {
  name: string;
  content: string;
}

export interface ImportOutcome {
  imported: Note[];
  /** Files that could not be parsed, kept so the UI can name them. */
  failed: { name: string; reason: string }[];
}

/**
 * Imports Markdown files as notes (PRD §19).
 *
 * Each file is parsed and indexed independently, so one malformed document
 * cannot abort the batch and leave the user with a half-finished import and no
 * idea which file broke it.
 *
 * Recognition runs against the campaign's existing vocabulary as each note
 * lands, which means an import of twenty session logs immediately backlinks
 * every entity the GM has already flagged.
 */
export async function importMarkdownNotes(
  campaignId: ID,
  files: MarkdownFile[],
  recognizer: { findMatches: (text: string) => EntityMatch[] },
): Promise<ImportOutcome> {
  const imported: Note[] = [];
  const failed: ImportOutcome["failed"] = [];

  for (const file of files) {
    try {
      const parsed = parseMarkdownDocument(file.content, file.name);

      const note = await createNote(campaignId, {
        title: parsed.title,
        content: JSON.stringify(parsed.doc),
        contentText: parsed.text,
      });

      await syncMentionsForNote(note.id, campaignId, recognizer.findMatches(parsed.text));
      await syncTasksForNote(note.id, campaignId, parsed.tasks);

      imported.push(note);
    } catch (error) {
      failed.push({
        name: file.name,
        reason: error instanceof Error ? error.message : "Could not read file",
      });
    }
  }

  return { imported, failed };
}

/* ---------------------------------------------------------------- folders */

export async function createFolder(
  campaignId: ID,
  name: string,
  parentFolderId: ID | null = null,
): Promise<Folder> {
  const folder: Folder = {
    id: newId(),
    campaignId,
    parentFolderId,
    name: name.trim() || "New folder",
    createdAt: Date.now(),
  };

  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(folderId: ID, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.folders.update(folderId, { name: trimmed });
}

export interface MoveFolderResult {
  moved: boolean;
  reason?: string;
}

/**
 * Reparents a folder, refusing moves that would detach a subtree.
 *
 * The check happens here rather than only in the UI because a drop target is
 * not the only way in — and a folder moved inside itself disappears from the
 * tree entirely, taking every note under it out of reach.
 */
export async function moveFolder(
  folderId: ID,
  newParentId: ID | null,
): Promise<MoveFolderResult> {
  const folder = await db.folders.get(folderId);
  if (!folder) return { moved: false, reason: "That folder no longer exists." };
  if (folder.parentFolderId === newParentId) return { moved: true };

  const siblings = await db.folders
    .where("campaignId")
    .equals(folder.campaignId)
    .toArray();

  if (wouldCreateCycle(siblings, folderId, newParentId)) {
    return {
      moved: false,
      reason: "A folder cannot be moved inside itself.",
    };
  }

  await db.folders.update(folderId, { parentFolderId: newParentId });
  return { moved: true };
}

/**
 * Deletes a folder and lifts its contents to the parent.
 *
 * Never cascades. A folder is a filing decision, not a container the user
 * intends to own the notes inside it — deleting "Session logs" should not
 * delete the sessions.
 */
export async function deleteFolder(
  folderId: ID,
): Promise<{ notesMoved: number; foldersMoved: number }> {
  const folder = await db.folders.get(folderId);
  if (!folder) return { notesMoved: 0, foldersMoved: 0 };

  const parentId = folder.parentFolderId;

  return db.transaction("rw", [db.folders, db.notes], async () => {
    const childFolders = await db.folders
      .where("parentFolderId")
      .equals(folderId)
      .toArray();
    await Promise.all(
      childFolders.map((child) =>
        db.folders.update(child.id, { parentFolderId: parentId }),
      ),
    );

    const notes = await db.notes.where("folderId").equals(folderId).toArray();
    await Promise.all(
      notes.map((note) => db.notes.update(note.id, { folderId: parentId })),
    );

    await db.folders.delete(folderId);
    return { notesMoved: notes.length, foldersMoved: childFolders.length };
  });
}

/** Files a note into a folder, or to the top level when `folderId` is null. */
export async function moveNoteToFolder(
  noteId: ID,
  folderId: ID | null,
): Promise<void> {
  await db.notes.update(noteId, { folderId, updatedAt: Date.now() });
}

/* --------------------------------------------------------------- entities */

export async function createEntity(
  campaignId: ID,
  name: string,
  entityTypeId: ID,
  description = "",
): Promise<Entity> {
  const now = Date.now();
  const entity: Entity = {
    id: newId(),
    campaignId,
    name: name.trim(),
    entityTypeId,
    description,
    autoLink: true,
    createdAt: now,
    updatedAt: now,
  };

  await db.entities.add(entity);
  return entity;
}

/**
 * Renames an entity.
 *
 * Nothing else has to change: mentions are derived from the current name on the
 * next scan, and relationships reference the id, so both survive untouched.
 * This is the §62 requirement that renaming preserves existing relationships.
 */
export async function renameEntity(entityId: ID, name: string): Promise<void> {
  await db.entities.update(entityId, { name: name.trim(), updatedAt: Date.now() });
}

export async function updateEntity(
  entityId: ID,
  changes: Partial<Omit<Entity, "id" | "campaignId" | "createdAt">>,
): Promise<void> {
  await db.entities.update(entityId, { ...changes, updatedAt: Date.now() });
}

export async function deleteEntity(entityId: ID): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.entities,
      db.entityAliases,
      db.entityMentions,
      db.relationships,
      db.mentionSuppressions,
      db.entityGroupMembers,
    ],
    async () => {
      await db.entities.delete(entityId);
      await db.entityAliases.where("entityId").equals(entityId).delete();
      await db.entityMentions.where("entityId").equals(entityId).delete();
      await db.relationships.where("sourceEntityId").equals(entityId).delete();
      await db.relationships.where("targetEntityId").equals(entityId).delete();
      await db.mentionSuppressions.where("entityId").equals(entityId).delete();
      await db.entityGroupMembers.where("entityId").equals(entityId).delete();
    },
  );
}

export async function addAlias(entityId: ID, alias: string): Promise<EntityAlias | null> {
  const trimmed = alias.trim();
  if (!trimmed) return null;

  const existing = await db.entityAliases
    .where("entityId")
    .equals(entityId)
    .filter((a) => a.alias.toLowerCase() === trimmed.toLowerCase())
    .first();
  if (existing) return existing;

  const entity = await db.entities.get(entityId);
  const record: EntityAlias = {
    id: newId(),
    entityId,
    alias: trimmed,
    campaignId: entity?.campaignId ?? "",
  };
  await db.entityAliases.add(record);
  return record;
}

export async function removeAlias(aliasId: ID): Promise<void> {
  await db.entityAliases.delete(aliasId);
}

/**
 * Folds `sourceId` into `targetId` (PRD §12).
 *
 * The source's name becomes an alias of the target rather than being discarded,
 * so text that only ever used the old name still resolves. Relationships are
 * repointed and self-references dropped, which is what would otherwise appear
 * after merging two entities that were already related to each other.
 */
export async function mergeEntities(sourceId: ID, targetId: ID): Promise<void> {
  if (sourceId === targetId) return;

  await db.transaction(
    "rw",
    db.entities,
    db.entityAliases,
    db.entityMentions,
    db.relationships,
    async () => {
      const source = await db.entities.get(sourceId);
      if (!source) return;

      await db.entityAliases.add({
        id: newId(),
        entityId: targetId,
        alias: source.name,
        campaignId: source.campaignId,
      });

      const inheritedAliases = await db.entityAliases
        .where("entityId")
        .equals(sourceId)
        .toArray();
      await db.entityAliases.bulkPut(
        inheritedAliases.map((a) => ({ ...a, entityId: targetId })),
      );

      await db.entityMentions.where("entityId").equals(sourceId).modify({
        entityId: targetId,
      });

      await db.relationships.where("sourceEntityId").equals(sourceId).modify({
        sourceEntityId: targetId,
      });
      await db.relationships.where("targetEntityId").equals(sourceId).modify({
        targetEntityId: targetId,
      });

      const selfLoops = await db.relationships
        .where("sourceEntityId")
        .equals(targetId)
        .filter((r) => r.targetEntityId === targetId)
        .primaryKeys();
      await db.relationships.bulkDelete(selfLoops);

      await db.entities.delete(sourceId);
    },
  );
}

/* --------------------------------------------------------------- mentions */

/**
 * Replaces every mention recorded for a note.
 *
 * Delete-then-insert rather than a diff. The recogniser already produces the
 * complete, authoritative set for the note, and at the scale of one note's
 * mentions the write is trivial — whereas a diff would have to reason about
 * positions shifting, which is exactly the bookkeeping this design avoids.
 */
export async function syncMentionsForNote(
  noteId: ID,
  campaignId: ID,
  matches: EntityMatch[],
): Promise<void> {
  // Suppressed occurrences are excluded here rather than at the UI layer, so a
  // correction removes the backlink too. A mention the user has explicitly
  // rejected must not keep the note listed on the entity's page.
  const suppressed = await getSuppressionKeysForNote(noteId);
  const kept = filterSuppressed(matches, suppressed);

  const rows: EntityMention[] = kept.map((match) => ({
    id: newId(),
    entityId: match.entityId,
    noteId,
    campaignId,
    from: match.start,
    to: match.end,
    detectedText: match.detectedText,
    occurrence: match.occurrence,
  }));

  await db.transaction("rw", db.entityMentions, async () => {
    await db.entityMentions.where("noteId").equals(noteId).delete();
    if (rows.length > 0) await db.entityMentions.bulkAdd(rows);
  });
}

/**
 * Rebuilds the mention index for every note in a campaign.
 *
 * Without this, mentions would only ever be computed for the note being edited,
 * and the central promise of the product would quietly half-work: flag "Marrow"
 * today and the six sessions you already wrote about him would never appear as
 * backlinks, because those notes are not going to be saved again.
 *
 * Runs whenever the entity vocabulary changes — a new entity, a rename, an
 * added alias, an auto-link toggle — which is rare compared to typing. Cost is
 * one linear scan per note, and the automaton is shared across all of them.
 */
export async function reindexCampaign(
  campaignId: ID,
  recognizer: { findMatches: (text: string) => EntityMatch[] },
): Promise<number> {
  // Trashed notes are excluded by the index range, or the next vocabulary
  // change would rebuild mentions for them and quietly restore their backlinks.
  const [notes, suppressions] = await Promise.all([
    listLiveNotes(campaignId),
    db.mentionSuppressions.where("campaignId").equals(campaignId).toArray(),
  ]);

  // Grouped once rather than queried per note: a full reindex over a large
  // campaign would otherwise issue one lookup per note.
  const suppressedByNote = new Map<ID, Set<string>>();
  for (const s of suppressions) {
    let set = suppressedByNote.get(s.noteId);
    if (!set) {
      set = new Set();
      suppressedByNote.set(s.noteId, set);
    }
    set.add(suppressionKey(s.entityId, s.occurrenceIndex));
  }

  const rows: EntityMention[] = [];
  for (const note of notes) {
    const matches = filterSuppressed(
      recognizer.findMatches(note.contentText),
      suppressedByNote.get(note.id) ?? EMPTY_SUPPRESSIONS,
    );

    for (const match of matches) {
      rows.push({
        id: newId(),
        entityId: match.entityId,
        noteId: note.id,
        campaignId,
        from: match.start,
        to: match.end,
        detectedText: match.detectedText,
        occurrence: match.occurrence,
      });
    }
  }

  await db.transaction("rw", db.entityMentions, async () => {
    await db.entityMentions.where("campaignId").equals(campaignId).delete();
    if (rows.length > 0) await db.entityMentions.bulkAdd(rows);
  });

  return rows.length;
}

/**
 * Notes that mention `entityId`, most recently edited first (PRD §11, §13).
 *
 * The distinct note ids come from index keys via `[entityId+noteId]`, so an
 * entity named in a hundred places still costs one key read per distinct note
 * rather than loading a hundred mention rows to throw most of them away.
 */
export async function getBacklinks(entityId: ID): Promise<Note[]> {
  const keys = (await db.entityMentions
    .where("[entityId+noteId]")
    .between([entityId, ID_LOW], [entityId, ID_HIGH])
    .uniqueKeys()) as unknown as [ID, ID][];

  const notes = await db.notes.bulkGet(keys.map(([, noteId]) => noteId));

  return notes
    .filter((n): n is Note => Boolean(n))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * How many notes mention each entity, for popovers and graph node weighting.
 *
 * "How many distinct notes" is answered from `[campaignId+entityId+noteId]`
 * index keys without loading a single row. This is the query most exposed to
 * the PRD's 100,000-mention target (§63) — it runs on the Canon, the section
 * views and the graph.
 */
export async function getMentionCounts(campaignId: ID): Promise<Map<ID, number>> {
  const keys = (await db.entityMentions
    .where("[campaignId+entityId+noteId]")
    .between(
      [campaignId, ID_LOW, ID_LOW],
      [campaignId, ID_HIGH, ID_HIGH],
    )
    .uniqueKeys()) as unknown as [ID, ID, ID][];

  const counts = new Map<ID, number>();
  for (const [, entityId] of keys) {
    counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Distinct (noteId, entityId) pairs for a campaign, for co-occurrence.
 *
 * The graph only needs to know which entities share a note, never the mention
 * text or offsets, so this reads index keys instead of rows.
 */
export async function getMentionPairs(
  campaignId: ID,
): Promise<{ noteId: ID; entityId: ID }[]> {
  const keys = (await db.entityMentions
    .where("[campaignId+entityId+noteId]")
    .between(
      [campaignId, ID_LOW, ID_LOW],
      [campaignId, ID_HIGH, ID_HIGH],
    )
    .uniqueKeys()) as unknown as [ID, ID, ID][];

  return keys.map(([, entityId, noteId]) => ({ entityId, noteId }));
}

/** A campaign's aliases, read directly rather than via its entity ids. */
export async function listAliases(campaignId: ID): Promise<EntityAlias[]> {
  return db.entityAliases.where("campaignId").equals(campaignId).toArray();
}

/** A campaign's entity categories, in display order, straight from the index. */
export async function listEntityTypes(campaignId: ID): Promise<EntityType[]> {
  return db.entityTypes
    .where("[campaignId+sortOrder]")
    .between([campaignId, TIME_LOW], [campaignId, TIME_HIGH])
    .toArray();
}

/* ------------------------------------------------------------ suppressions */

/**
 * Marks one occurrence as "not this entity" (PRD §32).
 *
 * Scoped to a single occurrence in a single note. The entity keeps matching
 * everywhere else, including elsewhere in the same note — a correction is a
 * statement about one piece of text, not about the entity.
 */
export async function suppressMention(
  campaignId: ID,
  noteId: ID,
  entityId: ID,
  occurrenceIndex: number,
): Promise<void> {
  const existing = await db.mentionSuppressions
    .where("[noteId+entityId+occurrenceIndex]")
    .equals([noteId, entityId, occurrenceIndex])
    .first();
  if (existing) return;

  await db.mentionSuppressions.add({
    id: newId(),
    campaignId,
    noteId,
    entityId,
    occurrenceIndex,
  });

  await db.entityMentions
    .where("[noteId+entityId]")
    .equals([noteId, entityId])
    .filter((m) => m.occurrence === occurrenceIndex)
    .delete();
}

export async function unsuppressMention(
  noteId: ID,
  entityId: ID,
  occurrenceIndex: number,
): Promise<void> {
  await db.mentionSuppressions
    .where("[noteId+entityId+occurrenceIndex]")
    .equals([noteId, entityId, occurrenceIndex])
    .delete();
}

/** Suppression keys for one note, ready to hand to `filterSuppressed`. */
export async function getSuppressionKeysForNote(
  noteId: ID,
): Promise<ReadonlySet<string>> {
  const rows = await db.mentionSuppressions.where("noteId").equals(noteId).toArray();
  return new Set(rows.map((r) => suppressionKey(r.entityId, r.occurrenceIndex)));
}

/* ----------------------------------------------------------------- groups */

export async function createEntityGroup(
  campaignId: ID,
  name: string,
  colorKey = "concept",
): Promise<EntityGroup> {
  const group: EntityGroup = {
    id: newId(),
    campaignId,
    name: name.trim(),
    colorKey,
    createdAt: Date.now(),
  };
  await db.entityGroups.add(group);
  return group;
}

/**
 * Recolours a group.
 *
 * Membership is keyed on the group's id, so this touches presentation only —
 * nothing about which entities belong, or about the entities themselves.
 */
export async function setEntityGroupColor(
  groupId: ID,
  colorKey: string,
): Promise<void> {
  await db.entityGroups.update(groupId, { colorKey });
}

/** Adds an entity to a group. An entity may belong to any number of groups. */
export async function addEntityToGroup(
  groupId: ID,
  entityId: ID,
): Promise<void> {
  const existing = await db.entityGroupMembers
    .where("[groupId+entityId]")
    .equals([groupId, entityId])
    .first();
  if (existing) return;

  await db.entityGroupMembers.add({ id: newId(), groupId, entityId });
}

export async function removeEntityFromGroup(
  groupId: ID,
  entityId: ID,
): Promise<void> {
  await db.entityGroupMembers
    .where("[groupId+entityId]")
    .equals([groupId, entityId])
    .delete();
}

export async function getGroupsForEntity(entityId: ID): Promise<EntityGroup[]> {
  const members = await db.entityGroupMembers
    .where("entityId")
    .equals(entityId)
    .toArray();
  const groups = await db.entityGroups.bulkGet(members.map((m) => m.groupId));
  return groups.filter((g): g is EntityGroup => Boolean(g));
}

export async function getEntitiesInGroup(groupId: ID): Promise<Entity[]> {
  const members = await db.entityGroupMembers
    .where("groupId")
    .equals(groupId)
    .toArray();
  const entities = await db.entities.bulkGet(members.map((m) => m.entityId));
  return entities.filter((e): e is Entity => Boolean(e));
}

/* ---------------------------------------------------------- relationships */

export async function createRelationship(
  campaignId: ID,
  sourceEntityId: ID,
  targetEntityId: ID,
  relationshipType: string,
  description = "",
): Promise<Relationship | null> {
  if (sourceEntityId === targetEntityId) return null;

  const relationship: Relationship = {
    id: newId(),
    campaignId,
    sourceEntityId,
    targetEntityId,
    relationshipType: relationshipType.trim() || "related to",
    description,
    createdAt: Date.now(),
  };

  await db.relationships.add(relationship);
  return relationship;
}

export async function deleteRelationship(id: ID): Promise<void> {
  await db.relationships.delete(id);
}

/* ------------------------------------------------------------------ tasks */

/**
 * Rewrites the tasks extracted from one note.
 *
 * Completion state is keyed on the task text so that ticking a box, then
 * editing an unrelated line, does not silently un-tick it. Tasks whose text is
 * edited are treated as new, which is the honest reading — the note no longer
 * contains the thing that was completed.
 */
export async function syncTasksForNote(
  noteId: ID,
  campaignId: ID,
  taskTexts: { text: string; completed: boolean }[],
): Promise<void> {
  await db.transaction("rw", db.tasks, async () => {
    const existing = await db.tasks.where("noteId").equals(noteId).toArray();
    const previousDates = new Map(existing.map((t) => [t.text, t.dueDate]));

    await db.tasks.where("noteId").equals(noteId).delete();

    const rows: Task[] = taskTexts.map((task) => ({
      id: newId(),
      campaignId,
      noteId,
      text: task.text,
      completed: task.completed,
      dueDate: previousDates.get(task.text) ?? null,
      createdAt: Date.now(),
    }));

    if (rows.length > 0) await db.tasks.bulkAdd(rows);
  });
}

/* ---------------------------------------------------------- entity types */

export async function createEntityType(
  campaignId: ID,
  name: string,
  icon: string,
  themeKey: string,
): Promise<EntityType> {
  const count = await db.entityTypes.where("campaignId").equals(campaignId).count();
  const type: EntityType = {
    id: newId(),
    campaignId,
    name: name.trim(),
    icon,
    themeKey,
    isBuiltIn: false,
    sortOrder: count,
    hidden: false,
  };

  await db.entityTypes.add(type);
  return type;
}

export async function updateEntityType(
  entityTypeId: ID,
  changes: Partial<Pick<EntityType, "name" | "icon" | "themeKey" | "hidden">>,
): Promise<void> {
  const next = { ...changes };
  if (typeof next.name === "string") next.name = next.name.trim();
  await db.entityTypes.update(entityTypeId, next);
}

/**
 * Rewrites the display order of a campaign's sections.
 *
 * Takes the full ordered list rather than a move instruction, because that is
 * what a drag-and-drop reorder actually produces and it leaves no room for the
 * stored order to drift from what the user sees.
 */
export async function reorderEntityTypes(orderedIds: ID[]): Promise<void> {
  await db.transaction("rw", db.entityTypes, async () => {
    await Promise.all(
      orderedIds.map((id, index) => db.entityTypes.update(id, { sortOrder: index })),
    );
  });
}

export interface DeleteSectionResult {
  deleted: boolean;
  /** Populated when deletion was refused, for the UI to explain. */
  reason?: string;
  entityCount?: number;
}

/**
 * Deletes a section, but only when nothing depends on it.
 *
 * Every entity carries a type, so removing a category that is still in use
 * would leave entities pointing at nothing. Refusing and telling the user how
 * many entities are in the way is more useful than either cascading the delete
 * or silently reassigning them — hiding is right there as the reversible
 * alternative.
 */
export async function deleteEntityType(
  entityTypeId: ID,
): Promise<DeleteSectionResult> {
  const entityCount = await db.entities
    .where("entityTypeId")
    .equals(entityTypeId)
    .count();

  if (entityCount > 0) {
    return {
      deleted: false,
      entityCount,
      reason: `${entityCount} ${entityCount === 1 ? "entity is" : "entities are"} still in this section. Move them, or hide the section instead.`,
    };
  }

  await db.entityTypes.delete(entityTypeId);
  return { deleted: true };
}

/** How many entities sit in each section, for the Canon's cards. */
export async function getEntityCountsByType(
  campaignId: ID,
): Promise<Map<ID, number>> {
  const entities = await db.entities.where("campaignId").equals(campaignId).toArray();
  const counts = new Map<ID, number>();
  for (const entity of entities) {
    counts.set(entity.entityTypeId, (counts.get(entity.entityTypeId) ?? 0) + 1);
  }
  return counts;
}
