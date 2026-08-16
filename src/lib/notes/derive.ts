/**
 * Rebuilding a note's derived data from what is stored.
 *
 * Mentions and tasks are indexes over note content, normally produced by the
 * editor as you type. Restoring a note from the trash has to reproduce them
 * without an editor, so the derivation lives here where both paths can use it.
 */

import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { createContentExtensions } from "../editor/extensions";
import { extractTasks, type ExtractedTask } from "../editor/tasks";

/**
 * Reads the task list out of a stored note document.
 *
 * Returns nothing for notes with no content rather than throwing: a blank note
 * is ordinary, and a malformed one should not be able to block a restore.
 */
export function deriveTasksFromContent(content: string): ExtractedTask[] {
  if (!content.trim()) return [];

  try {
    const json = JSON.parse(content) as Record<string, unknown>;
    const node = PMNode.fromJSON(getSchema(createContentExtensions()), json);
    return extractTasks(node);
  } catch {
    return [];
  }
}
