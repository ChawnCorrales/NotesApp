"use client";

/**
 * Putting the thing you are looking at into a collection.
 *
 * Mounted on both the note editor and an entity page, because a collection is
 * explicitly a bundle of *both* (§31) and a control that only worked on one of
 * them would make that half true.
 *
 * Membership is a toggle rather than an "add" action with a separate remove
 * somewhere else: the popover shows every collection in the campaign with the
 * current ones ticked, so the same control answers "what is this in?" and
 * "put it in another one". Creating a collection from here matters more than it
 * looks — being sent to a management screen mid-sentence is exactly the
 * interruption §3 says must not happen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addToCollection,
  createCollection,
  getCollectionsForMember,
  listCollections,
  removeFromCollection,
  type Collection,
  type CollectionMemberType,
} from "@/lib/services";
import { accentVar } from "@/lib/theme/palette";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function AddToCollection({
  memberType,
  memberId,
}: {
  memberType: CollectionMemberType;
  memberId: string;
}) {
  const { campaign } = useCampaign();
  const { navigate } = useNavigation();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const campaignId = campaign?.id;

  const all = useLiveQuery(
    () => (campaignId ? listCollections(campaignId) : Promise.resolve<Collection[]>([])),
    [campaignId],
    [] as Collection[],
  );

  const mine = useLiveQuery(
    () => getCollectionsForMember(memberType, memberId),
    [memberType, memberId],
    [] as Collection[],
  );

  const memberOf = new Set(mine.map((c) => c.id));

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = useCallback(
    async (collectionId: string, isMember: boolean) => {
      const request = { collectionId, memberType, memberId };
      if (isMember) await removeFromCollection(request);
      else await addToCollection(request);
    },
    [memberType, memberId],
  );

  const createAndAdd = useCallback(async () => {
    const name = draft.trim();
    if (!campaignId || !name) return;
    const collection = await createCollection(campaignId, name);
    await addToCollection({ collectionId: collection.id, memberType, memberId });
    setDraft("");
  }, [campaignId, draft, memberType, memberId]);

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-1.5">
      {/* The memberships read as chips even when the popover is shut, so the
          answer to "what is this filed under" costs no clicks. */}
      {mine.map((collection) => (
        <button
          key={collection.id}
          type="button"
          data-testid="member-collection"
          onClick={() => navigate({ kind: "collection", collectionId: collection.id })}
          title={`Open ${collection.name}`}
          className="flex items-center gap-1.5 rounded-full border border-hair px-2 py-0.5 text-xs text-ink-muted transition-colors hover:border-strong hover:text-ink"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: accentVar(collection.colorKey) }}
          />
          {collection.name}
        </button>
      ))}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        data-testid="add-to-collection"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-dashed border-hair px-2 py-0.5 text-xs text-ink-faint transition-colors hover:border-candle hover:text-candle"
      >
        {mine.length === 0 ? "+ Add to collection" : "+"}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Collections"
          className="absolute left-0 top-full z-30 mt-1.5 w-64 overflow-hidden rounded-lg border border-strong bg-raised shadow-2xl"
        >
          <div className="max-h-56 overflow-y-auto py-1">
            {all.map((collection) => {
              const isMember = memberOf.has(collection.id);
              return (
                <label
                  key={collection.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  <input
                    type="checkbox"
                    checked={isMember}
                    onChange={() => void toggle(collection.id, isMember)}
                  />
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: accentVar(collection.colorKey) }}
                  />
                  <span className="truncate">{collection.name}</span>
                </label>
              );
            })}

            {all.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-ink-faint">
                No collections yet.
              </p>
            )}
          </div>

          <div className="border-t border-hair p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void createAndAdd();
                }
              }}
              placeholder="New collection…"
              aria-label="New collection name"
              className="w-full rounded border border-hair bg-abyss px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
