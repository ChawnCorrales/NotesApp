/**
 * The service layer: every operation the application can perform.
 *
 * Components import from here and nowhere else in the data stack. They must not
 * import `lib/db/*` — that is the storage engine, and the whole point of this
 * boundary is that it can be replaced.
 *
 *     components  ->  lib/services  ->  lib/db (Dexie / IndexedDB)
 *                                   \-> lib/services/http (later)
 *
 * The operations below are grouped the way a server API would expose them. That
 * grouping is the deliverable: when there is an API, each group becomes a set of
 * endpoints and this file gains a second implementation, without the UI
 * changing shape.
 *
 * Two rules keep that door open:
 *
 *  1. Arguments and return values are plain serialisable data. Nothing here
 *     returns a Dexie `Collection`, `Table`, or query builder — those cannot
 *     cross a network boundary.
 *  2. Operations are named for what the user is doing, not for the tables
 *     involved. `getEntityRelationships` survives a schema change;
 *     `queryRelationshipsBySourceId` does not.
 *
 * ## Where authentication and permissions will attach
 *
 * Deliberately not implemented, but the seams are chosen:
 *
 *  - **Actor.** Every operation is already scoped by `campaignId`. A server
 *    implementation adds the caller as the first argument or as ambient
 *    request context, and the local implementation ignores it. No signature
 *    below has to be redesigned to make room.
 *  - **Permissions.** Authorisation belongs *inside* this layer, not in
 *    components — a check in the UI is a suggestion, not a rule. The Postgres
 *    RLS policies in `supabase/migrations/0002` already express the intended
 *    model, so the service layer and the database agree by construction.
 *  - **GM/player visibility.** `Note.visibility` exists and is always `gm`
 *    today. When players arrive, the read operations here are the single place
 *    that has to filter on it. That is why components never query notes
 *    directly: one missed filter in one component is a leak of the GM's secrets.
 *  - **API keys.** A concern of the transport, not of these operations. They
 *    authenticate a caller into an actor, which is the argument above.
 *
 * ## The one thing that will not survive unchanged
 *
 * Components wrap these calls in Dexie's `useLiveQuery`, which re-runs them when
 * the underlying tables change. That reactivity is a property of local storage,
 * not of the operations. Over HTTP it becomes polling, SSE, or websockets — a
 * change to how results are *subscribed to*, not to what is asked for.
 */

/* ------------------------------------------------------------------ notes */
export {
  createNote,
  updateNote,
  deleteNote,
  trashNote,
  restoreNote,
  emptyTrash,
  listLiveNotes,
  listRecentNotes,
  listTrashedNotes,
  moveNoteToFolder,
} from "./repository";
export { getNote, getNoteTitles } from "./reads";

/* -------------------------------------------------- folders and structure */
export {
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  type MoveFolderResult,
} from "./repository";
export { listFolders } from "./reads";

/* --------------------------------------------------------------- entities */
export {
  createEntity,
  updateEntity,
  renameEntity,
  deleteEntity,
  mergeEntities,
  addAlias,
  removeAlias,
  listAliases,
} from "./repository";
export {
  getEntity,
  listEntities,
  listEntitiesOfType,
  listAliasesForEntity,
} from "./reads";

/* ------------------------------------ metadata: sections, groups, tasks */
export {
  createEntityType,
  updateEntityType,
  reorderEntityTypes,
  deleteEntityType,
  listEntityTypes,
  getEntityCountsByType,
  type DeleteSectionResult,
} from "./repository";
export {
  createEntityGroup,
  setEntityGroupColor,
  addEntityToGroup,
  removeEntityFromGroup,
  getGroupsForEntity,
  getEntitiesInGroup,
} from "./repository";
export { syncTasksForNote } from "./repository";
export { listTasks, listEntityTypesUnordered } from "./reads";

/* --------------------------------------------------------- relationships */
export { createRelationship, deleteRelationship } from "./repository";
export {
  getEntityRelationships,
  listRelationships,
  type EntityRelationships,
} from "./reads";

/* ------------------------------------------------- mentions and backlinks */
export {
  syncMentionsForNote,
  reindexCampaign,
  getBacklinks,
  getMentionCounts,
  getMentionPairs,
  suppressMention,
  unsuppressMention,
  getSuppressionKeysForNote,
} from "./repository";
export { listMentionsForEntity, listSuppressionsForNote } from "./reads";

/* ----------------------------------------------------------------- search */
export {
  searchCampaign,
  searchNotes,
  searchEntities,
  type SearchResults,
  type NoteHit,
  type EntityHit,
} from "./search";

/* -------------------------------------------------------- graph traversal */
export {
  getCampaignGraph,
  getNeighbourhood,
  inferCoOccurrence,
  combineEdges,
  traverse,
  CO_OCCURRENCE_THRESHOLD,
  type CampaignGraph,
  type GraphEdge,
} from "./graph";

/* ----------------------------------------------------------------- import */
export {
  importMarkdownNotes,
  type MarkdownFile,
  type ImportOutcome,
} from "./repository";

/* --------------------------------------------------------------- campaign */
export { getCampaign } from "./reads";
/**
 * Provisioning the first campaign.
 *
 * Re-exported from the storage module because it is genuinely a bootstrap
 * concern today. With a server it becomes "the campaigns this actor can open",
 * which is the natural place for the first permission check.
 */
export { ensureCampaign } from "../db/db";
