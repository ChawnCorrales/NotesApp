"use client";

/**
 * The menu that appears when you select a phrase while writing (PRD §8).
 *
 * This is the product's central gesture, so it comes to the selection rather
 * than making the user go to it. Three answers to "what is this phrase?":
 *
 *   Create         it is something new
 *   Link existing  it is something I already have, under another name
 *   Ignore         it is not what the app thinks it is
 *
 * Link existing adds an *alias*, not a one-off link, because that is the only
 * durable form in this app: mentions are derived from the recogniser's
 * vocabulary and rebuilt on every re-index, so a hand-placed link would be
 * erased the next time anything triggered one. The alias is also the more useful
 * answer — naming "the merchant" as Marrow lights him up in every note, not just
 * this sentence — but that reach is worth stating out loud, so the panel says so.
 *
 * Ignore only appears when the selection actually covers a recognised mention.
 * There is nothing to suppress otherwise, and an item that does nothing when
 * clicked is worse than one that is not there.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "./campaign-context";

/** How far below the selection the menu sits, in pixels. */
const OFFSET = 8;

export interface SelectionTarget {
  text: string;
  x: number;
  y: number;
  /** Set when the selection covers a recognised mention. */
  mention: { entityId: string; occurrence: number } | null;
}

export function SelectionMenu({
  target,
  onCreate,
  onLink,
  onIgnore,
  onDismiss,
}: {
  target: SelectionTarget;
  onCreate: () => void;
  onLink: (entityId: string) => void;
  onIgnore: () => void;
  onDismiss: () => void;
}) {
  const { entities, typeById } = useCampaign();

  const [linking, setLinking] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (linking) filterInput.current?.focus();
  }, [linking]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase() || target.text.toLowerCase();
    return entities
      .filter((e) => e.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [entities, filter, target.text]);

  // Falls back to every entity, so an unrelated phrase still offers something
  // to link to rather than an empty panel.
  const options = matches.length > 0 ? matches : entities.slice(0, 8);

  return (
    <div
      ref={containerRef}
      data-testid="selection-menu"
      role="dialog"
      aria-label={`Actions for “${target.text}”`}
      style={{ left: target.x, top: target.y + OFFSET }}
      // Keeps the editor selection alive: a mousedown that moves focus would
      // collapse it, and every action here needs to know what was selected.
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 w-64 overflow-hidden rounded-md border border-strong bg-raised shadow-xl"
    >
      {!linking ? (
        <>
          <p className="truncate border-b border-hair px-3 py-2 text-sm text-ink">
            “{target.text}”
          </p>

          <button
            type="button"
            data-testid="selection-create"
            aria-label={`Create entity from “${target.text}”`}
            onClick={onCreate}
            className="block w-full px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Create entity
          </button>

          <button
            type="button"
            data-testid="selection-link"
            aria-label={`Link “${target.text}” to an existing entity`}
            onClick={() => setLinking(true)}
            className="block w-full px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
          >
            Link to existing…
          </button>

          {target.mention && (
            <button
              type="button"
              data-testid="selection-ignore"
              aria-label={`Ignore this mention of “${target.text}”`}
              onClick={onIgnore}
              className="block w-full border-t border-hair px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-blood"
            >
              Ignore here
            </button>
          )}
        </>
      ) : (
        <>
          <div className="border-b border-hair px-3 py-2">
            <input
              ref={filterInput}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find an entity…"
              aria-label="Find an entity to link to"
              className="w-full rounded border border-hair bg-abyss px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
            />
            <p className="mt-1.5 text-[0.68rem] leading-snug text-ink-faint">
              Adds “{target.text}” as another name for it, everywhere.
            </p>
          </div>

          <div className="max-h-48 overflow-y-auto py-1">
            {options.map((entity) => {
              const type = typeById.get(entity.entityTypeId);
              return (
                <button
                  key={entity.id}
                  type="button"
                  data-testid="selection-link-option"
                  onClick={() => onLink(entity.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <span aria-hidden="true" className="shrink-0 opacity-70">
                    {type?.icon ?? "◇"}
                  </span>
                  <span className="truncate">{entity.name}</span>
                </button>
              );
            })}

            {options.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-ink-faint">
                No entities yet — use Create entity instead.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
