"use client";

/**
 * Everything in one Campaign Canon section — "All Locations", "All Deities".
 *
 * Generated entirely from entities and their mentions, so this is a view of the
 * campaign rather than a list anybody maintains.
 */

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getMentionCounts,
  updateEntity,
  updateEntityType,
  type EntityMentionCount,
} from "@/lib/services";
import { DRAG_ENTITY } from "@/lib/dnd";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CreateEntityDialog } from "./CreateEntityDialog";

export function SectionView({ entityTypeId }: { entityTypeId: string }) {
  const { campaign, entities, entityTypes, typeById } = useCampaign();
  const { navigate, openInNewTab } = useNavigation();

  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);

  const type = typeById.get(entityTypeId);

  const members = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return entities
      .filter((e) => e.entityTypeId === entityTypeId)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entities, entityTypeId, filter]);

  /** Note counts per entity, so each card can say how present it is. */
  const counts = useLiveQuery(
    () =>
      campaign
        ? getMentionCounts(campaign.id)
        : Promise.resolve<EntityMentionCount[]>([]),
    [campaign?.id, entities],
    [] as EntityMentionCount[],
  );

  // The service returns an array, because a Map does not survive JSON. Callers
  // that want lookup build one, which is a line of code and cannot silently
  // arrive empty over a network.
  const mentionCounts = useMemo(
    () => new Map(counts.map((c) => [c.entityId, c.noteCount])),
    [counts],
  );

  if (!type) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        This section no longer exists.
      </div>
    );
  }

  const accent = `var(--entity-${type.themeKey})`;

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="mb-6 flex flex-wrap items-center gap-3 border-b border-hair pb-5">
        <span aria-hidden="true" className="text-3xl" style={{ color: accent }}>
          {type.icon}
        </span>
        <input
          value={type.name}
          onChange={(e) => void updateEntityType(type.id, { name: e.target.value })}
          aria-label="Section name"
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold text-ink focus:outline-none"
        />

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          aria-label={`Filter ${type.name}`}
          className="rounded border border-hair bg-surface px-2.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded bg-candle/15 px-2.5 py-1 text-sm text-candle transition-colors hover:bg-candle/25"
        >
          + New
        </button>
      </header>

      {members.length === 0 ? (
        <p className="text-sm text-ink-faint">
          {filter
            ? "Nothing here matches that filter."
            : `Nothing in ${type.name} yet. Highlight a name while writing to add one.`}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {members.map((entity) => {
            const count = mentionCounts.get(entity.id) ?? 0;
            return (
              <li
                key={entity.id}
                className="group relative rounded-lg border border-hair bg-surface transition-colors hover:border-strong hover:shadow-lg"
                style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
              >
                <button
                  type="button"
                  data-testid="section-entity"
                  data-entity-name={entity.name}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_ENTITY, entity.id);
                    // Both, because an entity can be *moved* to another Canon
                    // section or *copied* into a collection. Declaring only
                    // "move" makes the browser cancel a copy drop outright,
                    // before the target's handler is ever called — which is
                    // exactly how this was found.
                    e.dataTransfer.effectAllowed = "copyMove";
                  }}
                  onClick={() => navigate({ kind: "entity", entityId: entity.id })}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openInNewTab({ kind: "entity", entityId: entity.id });
                    }
                  }}
                  className="flex w-full flex-col items-start p-3 pr-8 text-left"
                >
                  <span className="truncate text-sm text-ink">{entity.name}</span>
                  <span className="mt-0.5 text-xs text-ink-faint">
                    {count === 0
                      ? "not yet mentioned"
                      : `${count} ${count === 1 ? "note" : "notes"}`}
                  </span>
                </button>

                {/*
                  The same move, reachable without a mouse.
                  Dragging is the pleasant way to do this and the only way that
                  is unavailable to a keyboard, a screen reader, or a touch
                  screen — so the section list is also a control, sitting on the
                  card rather than behind a visit to the entity's own page.
                */}
                <select
                  value={entity.entityTypeId}
                  aria-label={`Move ${entity.name} to another section`}
                  onChange={(e) => void updateEntity(entity.id, { entityTypeId: e.target.value })}
                  className="absolute right-1 top-1 w-6 cursor-pointer appearance-none rounded bg-transparent text-center text-xs text-ink-faint opacity-0 transition-opacity hover:text-ink focus:opacity-100 group-hover:opacity-100"
                  title="Move to another section"
                >
                  {entityTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}

      {creating && campaign && (
        <CreateEntityDialog
          campaignId={campaign.id}
          initialName=""
          defaultTypeId={type.id}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
