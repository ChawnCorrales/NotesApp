/**
 * The extensions that define the note schema.
 *
 * Shared deliberately. The editor and the Markdown importer must agree on what
 * a note can contain, or an import can produce a document the editor silently
 * drops on load. Anything that only affects presentation or behaviour — the
 * placeholder, entity highlighting — is layered on by the editor instead, since
 * it contributes nothing to the schema.
 */

import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";

export function createContentExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
      },
    }),
    TableKit.configure({ table: { resizable: true } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}
