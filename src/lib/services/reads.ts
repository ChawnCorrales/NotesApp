/**
 * Read operations the UI needs, expressed in domain terms.
 *
 * These exist so components never reach for Dexie themselves. Each one is a
 * question a server endpoint could answer unchanged — "the aliases for this
 * entity", "this entity's relationships in both directions" — rather than a
 * table and a where-clause.
 *
 * Everything here returns plain serialisable data. Nothing returns a Dexie
 * `Collection`, `Table`, or query builder, because those cannot cross a network
 * boundary and would tie the UI to this particular storage engine.
 */

import { db } from "../db/db";
import { listLiveNotes } from "./repository";
import type {
  Campaign,
  Entity,
  EntityAlias,
  EntityMention,
  EntityType,
  Folder,
  ID,
  MentionSuppression,
  Note,
  Relationship,
  Task,
} from "../db/types";

/* ------------------------------------------------------------------ notes */

export async function getNote(noteId: ID): Promise<Note | undefined> {
  return db.notes.get(noteId);
}

/**
 * Titles for a campaign's live notes, keyed by id.
 *
 * A map rather than a list because every caller is resolving "what is this note
 * called" for something that already holds an id — a task, a tab, a backlink.
 */
export async function getNoteTitles(campaignId: ID): Promise<Map<ID, string>> {
  const notes = await listLiveNotes(campaignId);
  return new Map(notes.map((n) => [n.id, n.title || "Untitled note"]));
}

/* ---------------------------------------------------------------- folders */

export async function listFolders(campaignId: ID): Promise<Folder[]> {
  return db.folders.where("campaignId").equals(campaignId).toArray();
}

/* --------------------------------------------------------------- entities */

export async function getEntity(entityId: ID): Promise<Entity | undefined> {
  return db.entities.get(entityId);
}

export async function listEntities(campaignId: ID): Promise<Entity[]> {
  return db.entities.where("campaignId").equals(campaignId).toArray();
}

/** Entities filed under one Canon section. */
export async function listEntitiesOfType(
  campaignId: ID,
  entityTypeId: ID,
): Promise<Entity[]> {
  return db.entities
    .where("[campaignId+entityTypeId]")
    .equals([campaignId, entityTypeId])
    .toArray();
}

export async function listAliasesForEntity(entityId: ID): Promise<EntityAlias[]> {
  return db.entityAliases.where("entityId").equals(entityId).toArray();
}

/* --------------------------------------------------------------- mentions */

export async function listMentionsForEntity(entityId: ID): Promise<EntityMention[]> {
  return db.entityMentions.where("entityId").equals(entityId).toArray();
}

export async function listSuppressionsForNote(
  noteId: ID,
): Promise<MentionSuppression[]> {
  return db.mentionSuppressions.where("noteId").equals(noteId).toArray();
}

/* ---------------------------------------------------------- relationships */

export interface EntityRelationships {
  outgoing: Relationship[];
  incoming: Relationship[];
}

/**
 * An entity's relationships in both directions.
 *
 * Returned together because "what is this connected to" is one question to the
 * user, even though it is two index reads.
 */
export async function getEntityRelationships(
  entityId: ID,
): Promise<EntityRelationships> {
  const [outgoing, incoming] = await Promise.all([
    db.relationships.where("sourceEntityId").equals(entityId).toArray(),
    db.relationships.where("targetEntityId").equals(entityId).toArray(),
  ]);
  return { outgoing, incoming };
}

export async function listRelationships(campaignId: ID): Promise<Relationship[]> {
  return db.relationships.where("campaignId").equals(campaignId).toArray();
}

/* ------------------------------------------------------------------ tasks */

export async function listTasks(campaignId: ID): Promise<Task[]> {
  return db.tasks.where("campaignId").equals(campaignId).toArray();
}

/* --------------------------------------------------------------- campaign */

export async function getCampaign(campaignId: ID): Promise<Campaign | undefined> {
  return db.campaigns.get(campaignId);
}

export async function listEntityTypesUnordered(campaignId: ID): Promise<EntityType[]> {
  return db.entityTypes.where("campaignId").equals(campaignId).toArray();
}
