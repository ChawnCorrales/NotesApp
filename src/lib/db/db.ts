/**
 * Local-first persistence.
 *
 * Everything the app knows lives in IndexedDB, and every read the UI performs
 * goes through here. There is no server in this build — but the shape of this
 * module is the reason there can be one later: the UI never talks to storage
 * directly, so a sync engine can be inserted underneath without the components
 * noticing (PRD §33, §36).
 */

import Dexie, { type Table } from "dexie";
import type {
  Campaign,
  Entity,
  EntityAlias,
  EntityGroup,
  EntityGroupMember,
  EntityMention,
  EntityType,
  Favorite,
  Folder,
  MentionSuppression,
  Note,
  NoteTag,
  Relationship,
  Tag,
  Task,
  VisitRecord,
} from "./types";

export class NotesAppDatabase extends Dexie {
  campaigns!: Table<Campaign, string>;
  notes!: Table<Note, string>;
  folders!: Table<Folder, string>;
  tags!: Table<Tag, string>;
  noteTags!: Table<NoteTag, string>;
  entityTypes!: Table<EntityType, string>;
  entities!: Table<Entity, string>;
  entityAliases!: Table<EntityAlias, string>;
  entityMentions!: Table<EntityMention, string>;
  relationships!: Table<Relationship, string>;
  tasks!: Table<Task, string>;
  favorites!: Table<Favorite, string>;
  visits!: Table<VisitRecord, string>;
  mentionSuppressions!: Table<MentionSuppression, string>;
  entityGroups!: Table<EntityGroup, string>;
  entityGroupMembers!: Table<EntityGroupMember, string>;

  constructor() {
    super("notesapp");

    this.version(1).stores({
      campaigns: "id, name, updatedAt",
      notes: "id, campaignId, folderId, updatedAt, title, [campaignId+updatedAt]",
      folders: "id, campaignId, parentFolderId",
      tags: "id, campaignId, name",
      noteTags: "id, noteId, tagId, [noteId+tagId]",
      entityTypes: "id, campaignId, sortOrder",
      entities: "id, campaignId, entityTypeId, name",
      entityAliases: "id, entityId, alias",
      // Mentions are queried three ways: by note (repaint/backlinks), by entity
      // (the mentions list), and by both (rebuilding one note's mentions).
      entityMentions: "id, entityId, noteId, campaignId, [noteId+entityId]",
      relationships: "id, campaignId, sourceEntityId, targetEntityId",
      tasks: "id, campaignId, noteId, completed",
      favorites: "id, noteId",
      visits: "id, campaignId, noteId, visitedAt",
    });

    this.version(2).stores({
      mentionSuppressions:
        "id, campaignId, noteId, entityId, [noteId+entityId+occurrenceIndex]",
      entityGroups: "id, campaignId, name",
      entityGroupMembers: "id, groupId, entityId, [groupId+entityId]",
    });

    // Adding a plain field needs no index change, but existing rows would read
    // back `undefined`. Backfilling here keeps every consumer from having to
    // treat "missing" and "false" as the same thing.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<EntityType>("entityTypes")
          .toCollection()
          .modify((type) => {
            type.hidden = false;
          });
      });
  }
}

/**
 * Dexie is constructed at module scope, which is safe: it does not touch the
 * IndexedDB global until the first query opens the connection, and every module
 * that queries it is inside a `"use client"` boundary.
 */
export const db = new NotesAppDatabase();

export function newId(): string {
  return crypto.randomUUID();
}

/** Entity categories every new campaign starts with (PRD §7). */
const BUILT_IN_ENTITY_TYPES: ReadonlyArray<{
  name: string;
  icon: string;
  themeKey: string;
}> = [
  // Plural, because these read as Campaign Canon section headings first and
  // as a category picker second.
  { name: "Characters", icon: "☿", themeKey: "npc" },
  { name: "Player Characters", icon: "✦", themeKey: "pc" },
  { name: "Locations", icon: "⌂", themeKey: "location" },
  { name: "Factions", icon: "⚑", themeKey: "faction" },
  { name: "Items", icon: "◈", themeKey: "item" },
  { name: "Events", icon: "✧", themeKey: "event" },
  { name: "Quests", icon: "❖", themeKey: "quest" },
  { name: "Deities", icon: "☉", themeKey: "deity" },
  { name: "Creatures", icon: "☠", themeKey: "creature" },
  { name: "Organizations", icon: "⚿", themeKey: "organization" },
  { name: "Mysteries", icon: "⁇", themeKey: "mystery" },
  { name: "Concepts", icon: "◇", themeKey: "concept" },
];

/**
 * Ensures there is a campaign to write into.
 *
 * The PRD is emphatic that nothing should stand between opening the app and
 * typing (§3, §24), so first launch silently provisions a campaign and its
 * entity categories rather than presenting a setup wizard.
 */
export async function ensureCampaign(): Promise<Campaign> {
  const existing = await db.campaigns.orderBy("updatedAt").last();
  if (existing) return existing;

  const now = Date.now();
  const campaign: Campaign = {
    id: newId(),
    name: "Untitled Campaign",
    description: "",
    themeId: "grimoire",
    createdAt: now,
    updatedAt: now,
  };

  await db.transaction("rw", db.campaigns, db.entityTypes, async () => {
    await db.campaigns.add(campaign);
    await db.entityTypes.bulkAdd(
      BUILT_IN_ENTITY_TYPES.map((type, index) => ({
        id: newId(),
        campaignId: campaign.id,
        name: type.name,
        icon: type.icon,
        themeKey: type.themeKey,
        isBuiltIn: true,
        sortOrder: index,
        hidden: false,
      })),
    );
  });

  return campaign;
}
