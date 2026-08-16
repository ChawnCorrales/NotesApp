/**
 * The shapes that cross the service boundary.
 *
 * Every public operation's input and output is named here, so the boundary is
 * something you can read in one place rather than infer from signatures. When
 * a server implementation arrives, these become request and response bodies
 * unchanged.
 *
 * Three rules, each learned from a way this can go quietly wrong.
 *
 * ## 1. Everything must survive JSON
 *
 * `Map` and `Set` do not. `JSON.stringify(new Map([["a", 1]]))` is `"{}"` — no
 * error, no warning, just an empty object at the other end. So responses use
 * arrays and records, and the `JsonSafe` constraint below makes a violation a
 * compile error rather than an empty result in production.
 *
 * Timestamps are numbers rather than `Date` for the same reason: a `Date`
 * survives `stringify` as an ISO string and comes back a string, so a
 * round-trip silently changes the type.
 *
 * ## 2. Inputs are data, never behaviour
 *
 * An operation may not accept a function, a class instance, or anything else
 * that cannot be serialised. If an operation needs the entity recogniser, it
 * builds it from the campaign — a server has no other option, and having the
 * local implementation do the same keeps the two honest.
 *
 * ## 3. One identifier is a path parameter; anything more is a body
 *
 * `getNote(noteId)` maps to `GET /notes/:id` and stays positional. Operations
 * taking several inputs — especially several ids of the same type, where the
 * compiler cannot catch a swapped pair — take a named request object. Adding a
 * field to one of those later does not break existing callers.
 */

import type {
  Collection,
  CollectionMemberType,
  Entity,
  ID,
  Note,
} from "../db/types";

/* ------------------------------------------------------- serialisability */

/** Anything `JSON.stringify` round-trips without changing its type. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Compile-time proof that a response type survives JSON.
 *
 * Resolves to `T` when every field is serialisable, and to `never` otherwise —
 * so `const _check: JsonSafe<MyResponse> = value` fails to compile if someone
 * adds a `Map`, `Set`, `Date`, or function to a response.
 */
export type JsonSafe<T> = T extends JsonValue
  ? T
  : T extends readonly (infer U)[]
    ? readonly JsonSafe<U>[]
    : T extends Map<unknown, unknown> | Set<unknown> | Date | ((...args: never[]) => unknown)
      ? never
      : T extends object
        ? { [K in keyof T]: JsonSafe<T[K]> }
        : never;

/* -------------------------------------------------------------- results */

/**
 * Why an operation refused.
 *
 * `code` is the stable part — a client switches on it, and a server maps it to
 * a status (`not_found` → 404, `conflict` → 409, `invalid` → 422). `message` is
 * for humans and may be reworded freely.
 */
export interface ServiceError {
  code: "not_found" | "conflict" | "invalid";
  message: string;
  /** Extra context, e.g. how many entities blocked a section delete. */
  details?: Record<string, string | number>;
}

/**
 * An operation that can refuse for a domain reason.
 *
 * Used only where refusal is an ordinary outcome the UI must explain — moving a
 * folder into itself, deleting a section that still holds entities. Genuine
 * bugs still throw; this is not an error-code style.
 */
export type Result<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: ServiceError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T = void>(
  code: ServiceError["code"],
  message: string,
  details?: ServiceError["details"],
): Result<T> {
  return { ok: false, error: { code, message, details } };
}

/* ------------------------------------------------------------- requests */

export interface CreateNoteRequest {
  campaignId: ID;
  title?: string;
  content?: string;
  contentText?: string;
  folderId?: ID | null;
}

export interface CreateEntityRequest {
  campaignId: ID;
  name: string;
  entityTypeId: ID;
  description?: string;
}

export interface CreateRelationshipRequest {
  campaignId: ID;
  sourceEntityId: ID;
  targetEntityId: ID;
  relationshipType: string;
  description?: string;
}

export interface CreateEntityTypeRequest {
  campaignId: ID;
  name: string;
  icon: string;
  themeKey: string;
}

export interface CollectionMemberRequest {
  collectionId: ID;
  memberType: CollectionMemberType;
  memberId: ID;
}

export interface SuppressMentionRequest {
  campaignId: ID;
  noteId: ID;
  entityId: ID;
  occurrenceIndex: number;
}

export interface UnsuppressMentionRequest {
  noteId: ID;
  entityId: ID;
  occurrenceIndex: number;
}

export interface ImportMarkdownRequest {
  campaignId: ID;
  files: MarkdownFile[];
}

export interface MarkdownFile {
  name: string;
  content: string;
}

/* ------------------------------------------------------------ responses */

/**
 * How many notes mention an entity.
 *
 * An array rather than the `Map` this used to be — see rule 1. Callers that
 * want lookup build their own map, which is a line of code and cannot silently
 * become empty over a network.
 */
export interface EntityMentionCount {
  entityId: ID;
  noteCount: number;
}

/** How many entities are filed under a Canon section. */
export interface EntityTypeCount {
  entityTypeId: ID;
  entityCount: number;
}

/** A note's id and display title, for tabs, task links and backlinks. */
export interface NoteSummary {
  noteId: ID;
  title: string;
}

/** What a collection holds. */
export interface CollectionContents {
  notes: Note[];
  entities: Entity[];
}

/** Outcome of a Markdown import, which can partly succeed. */
export interface ImportOutcome {
  imported: Note[];
  /** Files that could not be read or parsed, named so the UI can say which. */
  failed: { name: string; reason: string }[];
}

export type { Collection, CollectionMemberType };
