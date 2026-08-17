"use client";

/**
 * One collection, and everything in it (PRD §31).
 *
 * Notes and entities are listed separately rather than interleaved, because
 * they are answers to different questions — "what did I write" and "who is
 * involved" — and a single mixed list makes both harder to scan.
 *
 * Removing something here removes the *membership*, never the thing. A
 * collection is a statement about notes and entities, not a container that owns
 * them, and the wording of the control says so.
 */

import { useCallback, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  deleteCollection,
  getCollection,
  getCollectionContents,
  removeFromCollection,
  updateCollection,
  type CollectionContents,
} from "@/lib/services";
import { THEME_KEYS, accentVar } from "@/lib/theme/palette";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function CollectionView({ collectionId }: { collectionId: string }) {
  const { typeById } = useCampaign();
  const { navigate } = useNavigation();

  const collection = useLiveQuery(() => getCollection(collectionId), [collectionId]);

  const contents = useLiveQuery(
    () => getCollectionContents(collectionId),
    [collectionId],
    { notes: [], entities: [] } as CollectionContents,
  );

  /**
   * Local drafts for the text fields.
   *
   * Same reason as everywhere else: each keystroke writes to IndexedDB and only
   * comes back on the next round trip, so a value driven straight from the live
   * query drops characters when typing outruns it. `null` means "nothing typed
   * yet — show what is stored". The caller keys this component on the id, so a
   * different collection remounts rather than inheriting a stale draft.
   */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const remove = useCallback(
    (memberType: "note" | "entity", memberId: string) =>
      void removeFromCollection({ collectionId, memberType, memberId }),
    [collectionId],
  );

  if (!collection) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        This collection no longer exists.
      </div>
    );
  }

  const accent = accentVar(collection.colorKey);
  const total = contents.notes.length + contents.entities.length;

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="border-b border-hair pb-5" style={{ boxShadow: `inset 3px 0 0 ${accent}` }}>
        <div className="pl-3">
          <input
            value={nameDraft ?? collection.name}
            onChange={(e) => {
              setNameDraft(e.target.value);
              void updateCollection(collectionId, { name: e.target.value });
            }}
            aria-label="Collection name"
            className="w-full bg-transparent text-2xl font-semibold text-ink focus:outline-none"
          />

          <textarea
            value={descriptionDraft ?? collection.description}
            onChange={(e) => {
              setDescriptionDraft(e.target.value);
              void updateCollection(collectionId, { description: e.target.value });
            }}
            placeholder="What is this collection for?"
            aria-label="Collection description"
            rows={2}
            className="mt-2 w-full resize-y rounded border border-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-faint">
              {total === 0 ? "Nothing in it yet" : `${total} ${total === 1 ? "item" : "items"}`}
            </span>

            <div className="flex flex-wrap items-center gap-1">
              {THEME_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-label={`Colour ${key}`}
                  onClick={() => void updateCollection(collectionId, { colorKey: key })}
                  className={`h-4 w-4 rounded-full border transition-transform hover:scale-110 ${
                    collection.colorKey === key ? "border-ink" : "border-transparent"
                  }`}
                  style={{ backgroundColor: accentVar(key) }}
                />
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-ink-muted">
                    Delete this collection? Its notes and entities are kept.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void deleteCollection(collectionId);
                      navigate({ kind: "collections" });
                    }}
                    className="rounded bg-blood/20 px-2.5 py-1 text-xs text-blood hover:bg-blood/30"
                  >
                    Yes, delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="rounded border border-hair px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-blood hover:text-blood"
                >
                  Delete collection
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {total === 0 && (
        <p className="mt-6 text-sm text-ink-faint">
          Open a note or an entity and use “Add to collection” to put it here.
        </p>
      )}

      {contents.entities.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Entities
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
            {contents.entities.map((entity) => {
              const type = typeById.get(entity.entityTypeId);
              return (
                <li
                  key={entity.id}
                  data-testid="collection-entity"
                  className="flex items-center gap-2 rounded border border-hair bg-surface px-2.5 py-1.5"
                >
                  <span
                    aria-hidden="true"
                    style={{ color: accentVar(type?.themeKey ?? "concept") }}
                  >
                    {type?.icon ?? "◇"}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate({ kind: "entity", entityId: entity.id })}
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink-muted hover:text-candle"
                  >
                    {entity.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${entity.name} from collection`}
                    onClick={() => remove("entity", entity.id)}
                    className="shrink-0 text-xs text-ink-faint hover:text-blood"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {contents.notes.length > 0 && (
        <section className="mt-6 pb-10">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Notes
          </h2>
          <ul className="space-y-1">
            {contents.notes.map((note) => (
              <li
                key={note.id}
                data-testid="collection-note"
                className="flex items-center gap-3 rounded border border-hair px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigate({ kind: "note", noteId: note.id })}
                    className="block w-full truncate text-left text-sm text-ink hover:text-candle"
                  >
                    {note.title || "Untitled note"}
                  </button>
                  {note.contentText && (
                    <p className="truncate text-xs text-ink-faint">
                      {note.contentText.slice(0, 80)}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${note.title || "Untitled note"} from collection`}
                  onClick={() => remove("note", note.id)}
                  className="shrink-0 text-xs text-ink-faint hover:text-blood"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
