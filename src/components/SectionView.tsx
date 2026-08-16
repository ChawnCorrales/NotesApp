"use client";

/**
 * Everything in one Campaign Canon section — "All Locations", "All Deities".
 *
 * Generated entirely from entities and their mentions, so this is a view of the
 * campaign rather than a list anybody maintains.
 */

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getMentionCounts, updateEntityType } from "@/lib/db/repositories";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CreateEntityDialog } from "./CreateEntityDialog";

export function SectionView({ entityTypeId }: { entityTypeId: string }) {
  const { campaign, entities, typeById } = useCampaign();
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
  const mentionCounts = useLiveQuery(
    () =>
      campaign
        ? getMentionCounts(campaign.id)
        : Promise.resolve(new Map<string, number>()),
    [campaign?.id, entities],
    new Map<string, number>(),
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
              <li key={entity.id}>
                <button
                  type="button"
                  data-testid="section-entity"
                  onClick={() => navigate({ kind: "entity", entityId: entity.id })}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openInNewTab({ kind: "entity", entityId: entity.id });
                    }
                  }}
                  className="flex w-full flex-col items-start rounded-lg border border-hair bg-surface p-3 text-left transition-colors hover:border-strong hover:shadow-lg"
                  style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
                >
                  <span className="truncate text-sm text-ink">{entity.name}</span>
                  <span className="mt-0.5 text-xs text-ink-faint">
                    {count === 0
                      ? "not yet mentioned"
                      : `${count} ${count === 1 ? "note" : "notes"}`}
                  </span>
                </button>
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
