/**
 * What can be dragged, and onto what.
 *
 * The MIME type is the whole type system for drag-and-drop: a drop target
 * decides whether to accept by asking what kinds the drag is carrying. Two
 * distinct types rather than one shared string means a note dragged over a
 * Canon section is simply not a valid drop, without either side checking an id
 * against a table to find out.
 *
 * The payload is always an id. Anything richer would have to be serialised into
 * the drag, and would then be stale by the time it landed.
 */

/** A note or a folder, dragged within the folder tree. */
export const DRAG_FILE = "application/x-notesapp";

/** An entity, dragged from a Canon section onto another section. */
export const DRAG_ENTITY = "application/x-notesapp-entity";

/** True when a drag event is carrying `type`. */
export function carries(event: React.DragEvent, type: string): boolean {
  return Array.from(event.dataTransfer.types).includes(type);
}
