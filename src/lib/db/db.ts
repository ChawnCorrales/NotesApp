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
import { NOT_DELETED } from "./types";
import type {
  Campaign,
  Collection,
  CollectionMember,
  Entity,
  EntityAlias,
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
  collections!: Table<Collection, string>;
  collectionMembers!: Table<CollectionMember, string>;

  /**
   * `name` is a parameter so migration tests can stand up a database under the
   * historical schema and then open it through this class, exercising the real
   * upgrade path rather than a reimplementation of it.
   */
  constructor(name = "notesapp") {
    super(name);

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

    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<Note>("notes")
          .toCollection()
          .modify((note) => {
            note.deletedAt = NOT_DELETED;
          });
      });

    /**
     * Indexes for the queries the UI actually runs.
     *
     * The additions all exist to remove a full table read from a path the user
     * hits constantly:
     *
     *  notes[campaignId+deletedAt+updatedAt]  Recent, and every "live notes"
     *      list. Previously each of these read every note in the campaign and
     *      filtered in memory, because `deletedAt` was null for live notes and
     *      IndexedDB will not index null.
     *  notes[folderId+deletedAt]  Listing or emptying one folder.
     *  entityMentions[campaignId+entityId+noteId] and [entityId+noteId]
     *      Mention counts and backlinks are "how many distinct notes", which
     *      these answer from index keys alone — no row loads. This is the
     *      heaviest table by far at the PRD's 100,000-mention target.
     *  entityTypes[campaignId+sortOrder]  Canon section order, previously a
     *      load-then-sort-in-JS.
     *  entities[campaignId+entityTypeId]  Entities within one Canon section.
     *  entityAliases campaignId  Building the recogniser vocabulary was a
     *      two-step: fetch every entity id, then `anyOf` that list.
     *
     * `tasks.completed` is dropped: booleans are not valid IndexedDB keys, so
     * that index silently held nothing while still costing write work.
     */
    this.version(5)
      .stores({
        notes:
          "id, campaignId, folderId, updatedAt, title, [campaignId+updatedAt], [campaignId+deletedAt+updatedAt], [folderId+deletedAt]",
        entityTypes: "id, campaignId, sortOrder, [campaignId+sortOrder]",
        entities: "id, campaignId, entityTypeId, name, [campaignId+entityTypeId]",
        entityAliases: "id, entityId, alias, campaignId",
        entityMentions:
          "id, entityId, noteId, campaignId, [noteId+entityId], [entityId+noteId], [campaignId+entityId+noteId]",
        tasks: "id, campaignId, noteId",
      })
      .upgrade(async (tx) => {
        // Backfill the campaign an alias belongs to, from its entity.
        const entities = await tx.table<Entity>("entities").toArray();
        const campaignByEntity = new Map(entities.map((e) => [e.id, e.campaignId]));

        await tx
          .table<EntityAlias>("entityAliases")
          .toCollection()
          .modify((alias) => {
            alias.campaignId = campaignByEntity.get(alias.entityId) ?? "";
          });
      });

    /**
     * Repairs notes still holding `deletedAt: null`.
     *
     * Version 4 originally wrote null, and a database that already ran it keeps
     * that value — editing a past version's upgrade does not re-run it. Once
     * version 5 started indexing `deletedAt`, those notes fell out of every
     * index that includes it, because IndexedDB skips records with a null key.
     * The notes were intact and completely invisible, which is the worst shape
     * a bug like this can take.
     *
     * Written as a normalisation rather than a null check so it also catches
     * anything left `undefined` by an interrupted upgrade.
     */
    this.version(6)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<Note>("notes")
          .toCollection()
          .modify((note) => {
            if (typeof note.deletedAt !== "number") {
              note.deletedAt = NOT_DELETED;
            }
          });
      });

    /**
     * Entity groups become collections, which can also hold notes.
     *
     * The copy and the removal of the old tables are deliberately two versions.
     * Dexie applies a version's store changes *before* running its upgrade
     * function, so a store dropped in version 7 could not be read by version
     * 7's own upgrade — the groups would be gone before anything copied them.
     */
    this.version(7)
      .stores({
        collections: "id, campaignId, [campaignId+name]",
        collectionMembers:
          "id, collectionId, memberId, [collectionId+memberType+memberId], [memberType+memberId]",
      })
      .upgrade(async (tx) => {
        const groups = await tx.table("entityGroups").toArray();
        const members = await tx.table("entityGroupMembers").toArray();

        await tx.table<Collection>("collections").bulkAdd(
          groups.map((group) => ({
            id: group.id,
            campaignId: group.campaignId,
            name: group.name,
            description: "",
            colorKey: group.colorKey ?? "concept",
            createdAt: group.createdAt ?? 0,
            updatedAt: group.createdAt ?? 0,
          })),
        );

        // Ids are preserved so a membership that already existed keeps its
        // identity; only the shape changes.
        await tx.table<CollectionMember>("collectionMembers").bulkAdd(
          members.map((member) => ({
            id: member.id,
            collectionId: member.groupId,
            memberType: "entity" as const,
            memberId: member.entityId,
            addedAt: 0,
          })),
        );
      });

    /** Only now, once the data is safely copied, are the old tables removed. */
    this.version(8).stores({
      entityGroups: null,
      entityGroupMembers: null,
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
