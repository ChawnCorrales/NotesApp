/**
 * What can be dragged, and onto what.
 *
 * The MIME type is the whole type system for drag-and-drop: a drop target
 * decides whether to accept by asking what kinds the drag is carrying. Distinct
 * types rather than one shared string mean a folder dragged over a collection is
 * simply not a valid drop, without either side checking an id against a table to
 * find out what it is.
 *
 * The payload is always an id. Anything richer would have to be serialised into
 * the drag and would be stale by the time it landed.
 *
 * `DRAG_NOTE` and `DRAG_FOLDER` were one type until collections started
 * accepting drops. Within the folder tree the distinction did not matter,
 * because it tracked the dragged kind in component state — but that state does
 * not cross to another component, and a collection can hold a note while a
 * folder means nothing to it.
 */

/** A note, dragged from the folder tree or the sidebar. */
export const DRAG_NOTE = "application/x-notesapp-note";

/** A folder, dragged within the folder tree. */
export const DRAG_FOLDER = "application/x-notesapp-folder";

/** An entity, dragged from a Canon section. */
export const DRAG_ENTITY = "application/x-notesapp-entity";

/** True when a drag event is carrying `type`. */
export function carries(event: React.DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer.types).includes(type);
}

/** The first of `types` the drag is carrying, or null. */
export function carriedType(
  event: React.DragEvent,
  types: readonly string[],
): string | null {
  return types.find((type) => carries(event, type)) ?? null;
}
