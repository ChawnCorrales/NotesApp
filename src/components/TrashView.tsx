"use client";

/**
 * The trash (PRD §23).
 *
 * Deleting a note removes writing, so the delete gesture is a move to here
 * rather than destruction. This view is where that becomes irreversible, and it
 * says so plainly instead of relying on the user to infer it.
 */

import { useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteNote,
  emptyTrash,
  listTrashedNotes,
  restoreNote,
} from "@/lib/services";
import type { Note } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

function deletedWhen(timestamp: number): string {
  if (!timestamp) return "";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function TrashView() {
  const { campaign, recognizer } = useCampaign();
  const { navigate } = useNavigation();

  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  const trashed = useLiveQuery(
    () => (campaign ? listTrashedNotes(campaign.id) : Promise.resolve<Note[]>([])),
    [campaign?.id],
    [] as Note[],
  );

  const restore = useCallback(
    async (note: Note) => {
      await restoreNote(note.id, recognizer);
      navigate({ kind: "note", noteId: note.id });
    },
    [recognizer, navigate],
  );

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="mb-6 flex flex-wrap items-end gap-3 border-b border-hair pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Trash</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Deleted notes stay here until you remove them for good.
          </p>
        </div>

        {trashed.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {confirmingEmpty ? (
              <>
                <span className="text-xs text-ink-muted">
                  Delete {trashed.length} {trashed.length === 1 ? "note" : "notes"}{" "}
                  permanently?
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingEmpty(false);
                    if (campaign) void emptyTrash(campaign.id);
                  }}
                  className="rounded bg-blood/20 px-2.5 py-1 text-xs text-blood hover:bg-blood/30"
                >
                  Yes, delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingEmpty(false)}
                  className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingEmpty(true)}
                className="rounded border border-hair px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-blood hover:text-blood"
              >
                Empty trash
              </button>
            )}
          </div>
        )}
      </header>

      {trashed.length === 0 ? (
        <p className="text-sm text-ink-faint">The trash is empty.</p>
      ) : (
        <ul className="space-y-1">
          {trashed.map((note) => (
            <li
              key={note.id}
              data-testid="trashed-note"
              data-note-title={note.title || "Untitled note"}
              className="flex items-center gap-3 rounded border border-hair px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-ink">
                  {note.title || "Untitled note"}
                </p>
                <p className="truncate text-xs text-ink-faint">
                  Deleted {deletedWhen(note.deletedAt)}
                  {note.contentText ? ` · ${note.contentText.slice(0, 60)}` : ""}
                </p>
              </div>

              <button
                type="button"
                onClick={() => void restore(note)}
                className="shrink-0 rounded bg-candle/15 px-2.5 py-1 text-xs text-candle transition-colors hover:bg-candle/25"
              >
                Restore
              </button>
              <button
                type="button"
                aria-label={`Delete ${note.title || "Untitled note"} permanently`}
                onClick={() => void deleteNote(note.id)}
                className="shrink-0 rounded px-2 py-1 text-xs text-ink-faint transition-colors hover:text-blood"
              >
                Delete forever
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
