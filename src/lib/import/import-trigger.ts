/**
 * A command channel for "open the Markdown file picker".
 *
 * The file input has to live next to the import UI that reports the result, but
 * the toolbar needs to open it from the other side of the layout. Passing a
 * handler through every intervening component to reach one button is worse than
 * a small registration point that says exactly what it is.
 */

type Trigger = () => void;

let handler: Trigger | null = null;

/** Called by the import UI; returns an unregister function for cleanup. */
export function registerImportTrigger(trigger: Trigger): () => void {
  handler = trigger;
  return () => {
    if (handler === trigger) handler = null;
  };
}

export function triggerMarkdownImport(): void {
  handler?.();
}
