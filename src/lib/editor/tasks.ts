/**
 * Pulling checkbox items out of a document for the global task viewer (§29).
 *
 * Shared between the editor's save path and the Markdown importer so that a
 * task written here and a task imported from a file end up identical.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

export interface ExtractedTask {
  text: string;
  completed: boolean;
}

export function extractTasks(doc: PMNode): ExtractedTask[] {
  const tasks: ExtractedTask[] = [];

  doc.descendants((node) => {
    if (node.type.name === "taskItem") {
      const text = node.textContent.trim();
      if (text) {
        tasks.push({ text, completed: Boolean(node.attrs.checked) });
      }
    }
    return true;
  });

  return tasks;
}
