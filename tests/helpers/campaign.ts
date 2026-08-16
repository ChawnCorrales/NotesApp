/**
 * Fixtures for integration tests.
 *
 * These build state through the same repository functions the app uses, rather
 * than inserting rows directly. A fixture that writes its own rows can drift
 * from what the product actually does, and then the tests pass while the app is
 * broken.
 */

import { db, newId } from "@/lib/db/db";
import { createEntity, createNote, syncMentionsForNote } from "@/lib/services";
import type { Campaign, Entity, EntityType, Note } from "@/lib/db/types";
import { EntityRecognizer } from "@/lib/entities/recognizer";

/** Clears every table so each test starts from a known-empty database. */
export async function resetDatabase(): Promise<void> {
  if (!db.isOpen()) await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
}

/**
 * Simulates a browser reload.
 *
 * Closing and reopening the connection forces the next read to come from
 * storage rather than any in-memory state Dexie is holding — which is the
 * property the persistence tests are actually asserting.
 */
export async function reopenDatabase(): Promise<void> {
  db.close();
  await db.open();
}

export interface TestCampaign {
  campaign: Campaign;
  npcType: EntityType;
  locationType: EntityType;
}

export async function createTestCampaign(): Promise<TestCampaign> {
  const now = Date.now();
  const campaign: Campaign = {
    id: newId(),
    name: "Test Campaign",
    description: "",
    themeId: "grimoire",
    createdAt: now,
    updatedAt: now,
  };
  await db.campaigns.add(campaign);

  const npcType: EntityType = {
    id: newId(),
    campaignId: campaign.id,
    name: "NPC",
    icon: "☿",
    themeKey: "npc",
    isBuiltIn: true,
    sortOrder: 0,
    hidden: false,
  };
  const locationType: EntityType = {
    id: newId(),
    campaignId: campaign.id,
    name: "Location",
    icon: "⌂",
    themeKey: "location",
    isBuiltIn: true,
    sortOrder: 1,
    hidden: false,
  };
  await db.entityTypes.bulkAdd([npcType, locationType]);

  return { campaign, npcType, locationType };
}

/** Builds a recogniser from whatever is currently in the database. */
export async function buildRecognizer(campaignId: string): Promise<EntityRecognizer> {
  const entities = await db.entities.where("campaignId").equals(campaignId).toArray();
  const aliases = await db.entityAliases
    .where("entityId")
    .anyOf(entities.map((e) => e.id))
    .toArray();
  return EntityRecognizer.fromCampaign(entities, aliases);
}

/**
 * Writes note text and re-runs recognition over it, the way saving in the
 * editor does. This is the single most-used step in the integration tests.
 */
export async function writeNote(
  campaignId: string,
  noteId: string,
  text: string,
): Promise<void> {
  await db.notes.update(noteId, { contentText: text, updatedAt: Date.now() });
  const recognizer = await buildRecognizer(campaignId);
  await syncMentionsForNote(noteId, campaignId, recognizer.findMatches(text));
}

export async function createNoteWithText(
  campaignId: string,
  title: string,
  text: string,
): Promise<Note> {
  const note = await createNote(campaignId, { title });
  await writeNote(campaignId, note.id, text);
  const saved = await db.notes.get(note.id);
  return saved as Note;
}

export async function createNpc(
  campaignId: string,
  typeId: string,
  name: string,
): Promise<Entity> {
  return createEntity(campaignId, name, typeId);
}
