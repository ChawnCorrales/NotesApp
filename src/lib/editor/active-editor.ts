/**
 * Which editor the toolbar is talking to.
 *
 * The toolbar sits above the view switcher, while the editor is mounted deep
 * inside whichever note is open. Rather than thread the instance up through
 * every layer, the open editor publishes itself here and the toolbar subscribes.
 *
 * Kept outside React state on purpose: the value is an imperative handle, not
 * rendering data, and writing it from an effect would mean a render pass every
 * time a note is opened.
 */

import { useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";

let current: Editor | null = null;
const listeners = new Set<() => void>();

export function setActiveEditor(editor: Editor | null): void {
  if (current === editor) return;
  current = editor;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Editor | null {
  return current;
}

function getServerSnapshot(): Editor | null {
  return null;
}

/** The editor currently open, or null when the active view is not a note. */
export function useActiveEditor(): Editor | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
