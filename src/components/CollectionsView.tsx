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
  addToCollection,
  createCollection,
  listCollectionSummaries,
  type CollectionSummary,
} from "@/lib/services";
import { carriedType, DRAG_ENTITY, DRAG_NOTE } from "@/lib/dnd";
import { accentVar } from "@/lib/theme/palette";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function CollectionsView() {
  const { campaign } = useCampaign();
  const { navigate, openInNewTab } = useNavigation();

  const [draft, setDraft] = useState("");
  /** Collection currently under a drag, for the drop highlight. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /**
   * What a collection card accepts.
   *
   * Notes and entities, because a collection holds both — that is the whole
   * point of it, and the reason it is not a folder. A folder dragged from the
   * tree is not on this list: a collection groups things a GM is thinking
   * about, and a folder is where files live.
   */
  const ACCEPTS = [DRAG_ENTITY, DRAG_NOTE] as const;

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
            prep. Notes and entities can be in as many as you like, and can be
            dragged straight onto a card from the sidebar.
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
                  data-collection-name={collection.name}
                  onClick={() =>
                    navigate({
                      kind: "collection",
                      collectionId: collection.collectionId,
                    })
                  }
                  onDragOver={(e) => {
                    if (!carriedType(e, ACCEPTS)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    setDropTarget(collection.collectionId);
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => {
                    const type = carriedType(e, ACCEPTS);
                    if (!type) return;
                    e.preventDefault();
                    setDropTarget(null);

                    const memberId = e.dataTransfer.getData(type);
                    if (!memberId) return;
                    /*
                      Adding, not moving. A note keeps its folder and an entity
                      keeps its Canon section — membership is an extra fact
                      about them, which is why the cursor says copy.
                    */
                    void addToCollection({
                      collectionId: collection.collectionId,
                      memberType: type === DRAG_ENTITY ? "entity" : "note",
                      memberId,
                    });
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openInNewTab({
                        kind: "collection",
                        collectionId: collection.collectionId,
                      });
                    }
                  }}
                  className={`flex h-full w-full flex-col items-start rounded-lg border bg-surface p-3 text-left transition-colors ${
                    dropTarget === collection.collectionId
                      ? "border-candle ring-1 ring-candle/60"
                      : "border-hair hover:border-strong hover:shadow-lg"
                  }`}
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
