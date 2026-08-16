/**
 * All writes go through here.
 *
 * Components never call Dexie directly. Besides keeping the UI honest, this is
 * the seam where a sync engine eventually lives: every mutation below is the
 * natural place to also enqueue a pending sync operation (PRD §36).
 */

import { db, newId } from "./db";
import type {
  Entity,
  EntityAlias,
  EntityGroup,
  EntityMention,
  EntityType,
  ID,
  Note,
  Relationship,
  Task,
} from "./types";
import {
  filterSuppressed,
  suppressionKey,
  type EntityMatch,
} from "../entities/recognizer";
import { parseMarkdownDocument } from "../import/markdown";

const EMPTY_SUPPRESSIONS: ReadonlySet<string> = new Set();

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
 * Deletes a note and everything derived from it.
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

  const record: EntityAlias = { id: newId(), entityId, alias: trimmed };
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
  const [notes, suppressions] = await Promise.all([
    db.notes.where("campaignId").equals(campaignId).toArray(),
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

/** Notes that mention `entityId`, most recently edited first (PRD §11, §13). */
export async function getBacklinks(entityId: ID): Promise<Note[]> {
  const mentions = await db.entityMentions.where("entityId").equals(entityId).toArray();
  const noteIds = [...new Set(mentions.map((m) => m.noteId))];
  const notes = await db.notes.bulkGet(noteIds);

  return notes
    .filter((n): n is Note => Boolean(n))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** How many notes mention each entity, for popovers and graph node weighting. */
export async function getMentionCounts(campaignId: ID): Promise<Map<ID, number>> {
  const mentions = await db.entityMentions.where("campaignId").equals(campaignId).toArray();
  const notesByEntity = new Map<ID, Set<ID>>();

  for (const mention of mentions) {
    let set = notesByEntity.get(mention.entityId);
    if (!set) {
      set = new Set();
      notesByEntity.set(mention.entityId, set);
    }
    set.add(mention.noteId);
  }

  return new Map([...notesByEntity].map(([id, notes]) => [id, notes.size]));
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
