"use client";

/**
 * Ctrl/Cmd+K command palette (PRD §51).
 *
 * Actions and content share one list on purpose. The PRD's accessibility goals
 * (§48) favour a single obvious entry point over a menu tree, and in practice
 * "open Marrow" and "create a note" are the same intent — get somewhere without
 * taking hands off the keyboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createNote, listLiveNotes } from "@/lib/services";
import type { Note } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

const MAX_RESULTS = 40;

export function CommandPalette() {
  const { campaign, entities, typeById } = useCampaign();
  const { navigate } = useNavigation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rawActiveIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const notes = useLiveQuery(
    () => (campaign ? listLiveNotes(campaign.id) : Promise.resolve<Note[]>([])),
    [campaign?.id],
    [] as Note[],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIndex(0);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const commands = useMemo<Command[]>(() => {
    const actions: Command[] = [
      {
        id: "new-note",
        label: "Create note",
        hint: "action",
        run: async () => {
          if (!campaign) return;
          const note = await createNote(campaign.id);
          navigate({ kind: "note", noteId: note.id });
        },
      },
      {
        id: "open-tasks",
        label: "Open tasks",
        hint: "action",
        run: () => navigate({ kind: "tasks" }),
      },
      {
        id: "open-graph",
        label: "Open mind map",
        hint: "action",
        run: () => navigate({ kind: "graph" }),
      },
      {
        id: "search",
        label: query.trim() ? `Search for “${query.trim()}”` : "Search notes",
        hint: "action",
        run: () => navigate({ kind: "search", query: query.trim() }),
      },
    ];

    const entityCommands: Command[] = entities.map((entity) => ({
      id: `entity-${entity.id}`,
      label: entity.name,
      hint: typeById.get(entity.entityTypeId)?.name ?? "entity",
      run: () => navigate({ kind: "entity", entityId: entity.id }),
    }));

    const noteCommands: Command[] = notes.map((note) => ({
      id: `note-${note.id}`,
      label: note.title || "Untitled note",
      hint: "note",
      run: () => navigate({ kind: "note", noteId: note.id }),
    }));

    return [...actions, ...entityCommands, ...noteCommands];
  }, [campaign, entities, notes, typeById, navigate, query]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands.slice(0, MAX_RESULTS);
    return commands
      .filter((c) => c.label.toLowerCase().includes(needle))
      .slice(0, MAX_RESULTS);
  }, [commands, query]);

  // Clamped during render rather than corrected in an effect, so the highlight
  // is never briefly out of range as the result list shrinks under the cursor.
  const activeIndex = Math.min(rawActiveIndex, Math.max(0, results.length - 1));

  const run = useCallback(
    async (command: Command | undefined) => {
      if (!command) return;
      close();
      await command.run();
    },
    [close],
  );

  const runActive = useCallback(
    () => run(results[activeIndex]),
    [run, results, activeIndex],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-strong bg-raised shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              void runActive();
            }
          }}
          placeholder="Search or run a command…"
          className="w-full border-b border-hair bg-transparent px-4 py-3 text-ink placeholder:text-ink-faint focus:outline-none"
        />

        <ul className="max-h-80 overflow-y-auto py-1">
          {results.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => void run(command)}
                className={`flex w-full items-baseline gap-3 px-4 py-2 text-left text-sm ${
                  index === activeIndex ? "bg-candle/15 text-candle" : "text-ink-muted"
                }`}
              >
                <span className="flex-1 truncate">{command.label}</span>
                {command.hint && (
                  <span className="text-xs text-ink-faint">{command.hint}</span>
                )}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-faint">No matches.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
