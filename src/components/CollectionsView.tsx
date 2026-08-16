"use client";

/**
 * Every collection in the campaign (PRD §31).
 *
 * The counterpart to the Campaign Canon: the Canon organises by *what a thing
 * is*, this organises by *what the GM is thinking about*. "Red Queen
 * Investigation" holds an NPC, two locations and four session notes, and no
 * section could ever hold that mix.
 */

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  createCollection,
  listCollectionSummaries,
  type CollectionSummary,
} from "@/lib/services";
import { accentVar } from "@/lib/theme/palette";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function CollectionsView() {
  const { campaign } = useCampaign();
  const { navigate, openInNewTab } = useNavigation();

  const [draft, setDraft] = useState("");

  const campaignId = campaign?.id;

  const collections = useLiveQuery(
    () =>
      campaignId
        ? listCollectionSummaries(campaignId)
        : Promise.resolve<CollectionSummary[]>([]),
    [campaignId],
    [] as CollectionSummary[],
  );

  async function create() {
    const name = draft.trim();
    if (!campaignId || !name) return;
    const collection = await createCollection(campaignId, name);
    setDraft("");
    navigate({ kind: "collection", collectionId: collection.id });
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="mb-6 flex flex-wrap items-end gap-3 border-b border-hair pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Collections</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Bundles that cut across the Canon — a mystery, an arc, a session&rsquo;s
            prep. Notes and entities can be in as many as you like.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            placeholder="New collection…"
            aria-label="New collection name"
            className="rounded border border-hair bg-surface px-2.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={!draft.trim()}
            className="rounded bg-candle/15 px-2.5 py-1 text-sm text-candle transition-colors hover:bg-candle/25 disabled:opacity-40"
          >
            + New
          </button>
        </div>
      </header>

      {collections.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No collections yet. Make one here, or add a note or entity to a new
          collection from its own page.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {collections.map((collection) => {
            const accent = accentVar(collection.colorKey);
            return (
              <li key={collection.collectionId}>
                <button
                  type="button"
                  data-testid="collection-card"
                  onClick={() =>
                    navigate({
                      kind: "collection",
                      collectionId: collection.collectionId,
                    })
                  }
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openInNewTab({
                        kind: "collection",
                        collectionId: collection.collectionId,
                      });
                    }
                  }}
                  className="flex h-full w-full flex-col items-start rounded-lg border border-hair bg-surface p-3 text-left transition-colors hover:border-strong hover:shadow-lg"
                  style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                >
                  <span className="truncate text-sm text-ink">
                    {collection.name}
                  </span>
                  {collection.description && (
                    <span className="mt-1 line-clamp-2 text-xs text-ink-muted">
                      {collection.description}
                    </span>
                  )}
                  <span className="mt-1.5 text-xs text-ink-faint">
                    {describe(collection)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** "3 notes · 2 entities", or the honest empty case. */
function describe({ noteCount, entityCount }: CollectionSummary): string {
  if (noteCount === 0 && entityCount === 0) return "empty";
  const parts: string[] = [];
  if (noteCount > 0) parts.push(`${noteCount} ${noteCount === 1 ? "note" : "notes"}`);
  if (entityCount > 0) {
    parts.push(`${entityCount} ${entityCount === 1 ? "entity" : "entities"}`);
  }
  return parts.join(" · ");
}
