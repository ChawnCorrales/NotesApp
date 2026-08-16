/**
 * Domain types.
 *
 * These mirror the PRD's data model (§54) closely enough that the eventual
 * Postgres schema is a direct translation. Fields that only matter once there
 * is a server — `syncVersion`, `localOnly`, `visibility` — are carried from the
 * start so that adding sync later is an additive change rather than a migration
 * of every row.
 */

export type ID = string;

/** Who may see a piece of content. Only `gm` is reachable in the current build. */
export type Visibility = "gm" | "players" | "selected" | "revealed";

export interface Campaign {
  id: ID;
  name: string;
  description: string;
  themeId: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: ID;
  campaignId: ID;
  title: string;
  /** TipTap/ProseMirror document, JSON-serialised. */
  content: string;
  /**
   * Flattened plain text of `content`, maintained on every save.
   *
   * Denormalised on purpose: search and entity recognition both need the plain
   * text far more often than the document changes, and re-flattening the
   * ProseMirror tree on each query would dominate search cost.
   */
  contentText: string;
  folderId: ID | null;
  visibility: Visibility;
  isLocked: boolean;
  localOnly: boolean;
  createdAt: number;
  updatedAt: number;
  syncVersion: number;
}

export interface Folder {
  id: ID;
  campaignId: ID;
  parentFolderId: ID | null;
  name: string;
  createdAt: number;
}

export interface Tag {
  id: ID;
  campaignId: ID;
  name: string;
}

export interface NoteTag {
  id: ID;
  noteId: ID;
  tagId: ID;
}

/**
 * A category of entity — and, in the UI, a Campaign Canon section.
 *
 * These are the same thing on purpose. The Canon's sections are exactly the
 * campaign's entity categories, so renaming "NPC" to "Characters" renames it
 * everywhere. Modelling sections separately would give an entity both a type
 * and a section, with nothing stopping the two from disagreeing.
 */
export interface EntityType {
  id: ID;
  campaignId: ID;
  name: string;
  /** Emoji or short glyph, rendered in popovers, the sidebar and graph nodes. */
  icon: string;
  /** Key into the active theme's entity palette; see `globals.css`. */
  themeKey: string;
  /** Built-in types are seeded per campaign; user-created ones are not. */
  isBuiltIn: boolean;
  sortOrder: number;
  /**
   * Hidden sections stay out of the Canon and the sidebar without being
   * deleted. A category a campaign never uses is clutter, but deleting one that
   * still has entities would orphan them — hiding is the reversible option.
   */
  hidden: boolean;
}

export interface Entity {
  id: ID;
  campaignId: ID;
  name: string;
  entityTypeId: ID;
  description: string;
  /**
   * When false the entity still exists and keeps its relationships, but its
   * name and aliases are excluded from automatic recognition (PRD §10,
   * "Stop Auto-Linking"). Existing mentions are dropped on the next rescan.
   */
  autoLink: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EntityAlias {
  id: ID;
  entityId: ID;
  alias: string;
}

/**
 * One appearance of an entity inside a note.
 *
 * Derived data, never authored. The recogniser rebuilds every mention for a
 * note each time that note is saved, so these rows are a queryable index of
 * "what did the text say at last save", not a durable annotation. That is what
 * makes §62 fall out for free: delete the text and the mention simply is not
 * regenerated. Nothing has to be migrated when an entity is renamed either.
 *
 * `from`/`to` are offsets into the note's flattened `contentText`, matching the
 * PRD's `text_offset_start`/`text_offset_end`. They are not ProseMirror
 * positions: the editor recomputes those live when painting, so persisting them
 * would only create a second representation that could disagree with the first.
 */
export interface EntityMention {
  id: ID;
  entityId: ID;
  noteId: ID;
  campaignId: ID;
  from: number;
  to: number;
  /** The literal text matched, which may be an alias rather than the name. */
  detectedText: string;
  /** Ordinal among this entity's mentions in this note; see MentionSuppression. */
  occurrence: number;
}

/**
 * A single occurrence the user marked as "not this entity".
 *
 * Recognition is text matching, so it will sometimes be wrong — a tavern called
 * The Ash, a player whose surname is a place name. §32 says the system must not
 * silently overrule the user, so the correction is recorded rather than the
 * entity being globally disabled.
 *
 * Occurrences are identified by their ordinal within the note rather than by
 * character offset, because offsets shift on every edit and would detach the
 * suppression from the word it was attached to. The tradeoff is that inserting
 * an *earlier* occurrence of the same entity shifts which one is suppressed;
 * that is rarer, and far less damaging, than a suppression that silently drifts
 * every time the paragraph above it is edited.
 */
export interface MentionSuppression {
  id: ID;
  campaignId: ID;
  noteId: ID;
  entityId: ID;
  /** Zero-based index among that entity's matches in the note, in order. */
  occurrenceIndex: number;
}

/**
 * A user-defined grouping of entities (e.g. "The Traitors", "Session 4 cast").
 *
 * Distinct from EntityType: a type answers "what kind of thing is this" and an
 * entity has exactly one, whereas an entity may belong to any number of groups.
 */
export interface EntityGroup {
  id: ID;
  campaignId: ID;
  name: string;
  /**
   * Presentation only. Group colour is a display concern and is deliberately
   * not an identifier — membership is keyed on `groupId`, so recolouring a
   * group can never change who is in it.
   */
  colorKey: string;
  createdAt: number;
}

export interface EntityGroupMember {
  id: ID;
  groupId: ID;
  entityId: ID;
}

export interface Relationship {
  id: ID;
  campaignId: ID;
  sourceEntityId: ID;
  targetEntityId: ID;
  /** Free-form and user-extensible, e.g. "works in", "knows", "controls". */
  relationshipType: string;
  description: string;
  createdAt: number;
}

export interface Task {
  id: ID;
  campaignId: ID;
  /** The note the task was written in, so the viewer can link back (§29). */
  noteId: ID | null;
  text: string;
  completed: boolean;
  dueDate: number | null;
  createdAt: number;
}

export interface Favorite {
  id: ID;
  noteId: ID;
  createdAt: number;
}

/** A note the user opened, for the Recent list and Back/Forward history (§49). */
export interface VisitRecord {
  id: ID;
  campaignId: ID;
  noteId: ID;
  visitedAt: number;
}
