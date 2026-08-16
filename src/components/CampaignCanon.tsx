"use client";

/**
 * The Campaign Canon (PRD §30).
 *
 * The GM's notes *are* the wiki: every card here is generated from entities
 * they created while writing, and the counts move on their own. Nothing on this
 * page is a second copy of information that has to be kept in step.
 *
 * Sections are the campaign's entity categories, so editing one here renames it
 * everywhere — see the note on `EntityType`.
 */

import { useCallback, useMemo, useState } from "react";
import {
  createEntityType,
  deleteEntityType,
  reorderEntityTypes,
  updateEntityType,
} from "@/lib/services";
import type { EntityType } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

/** Palette keys a section can be coloured with; mirrors the theme's entity vars. */
const THEME_KEYS = [
  "npc",
  "pc",
  "location",
  "faction",
  "item",
  "event",
  "quest",
  "deity",
  "creature",
  "organization",
  "mystery",
  "concept",
] as const;

const ICON_CHOICES = [
  "☿", "✦", "⌂", "⚑", "◈", "✧", "❖", "☉", "☠", "⚿", "⁇", "◇",
  "♆", "⚔", "✵", "☾", "⚗", "†", "❧", "⌘",
];

export function CampaignCanon({ onQuickNote }: { onQuickNote: () => void }) {
  const { campaign, entities, entityTypes } = useCampaign();
  const { navigate, openInNewTab } = useNavigation();

  const [editing, setEditing] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entity of entities) {
      map.set(entity.entityTypeId, (map.get(entity.entityTypeId) ?? 0) + 1);
    }
    return map;
  }, [entities]);

  const visible = useMemo(
    () => entityTypes.filter((t) => showHidden || !t.hidden),
    [entityTypes, showHidden],
  );

  const hiddenCount = entityTypes.filter((t) => t.hidden).length;

  /**
   * Moves a section, by drag or by keyboard.
   *
   * Reordering is offered through buttons as well as dragging, because
   * drag-and-drop alone is unusable with a keyboard and §48 puts accessibility
   * ahead of polish.
   */
  const move = useCallback(
    async (typeId: string, direction: -1 | 1) => {
      const ordered = [...entityTypes].sort((a, b) => a.sortOrder - b.sortOrder);
      const from = ordered.findIndex((t) => t.id === typeId);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= ordered.length) return;

      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      await reorderEntityTypes(ordered.map((t) => t.id));
    },
    [entityTypes],
  );

  const handleDrop = useCallback(
    async (targetId: string) => {
      if (!dragging || dragging === targetId) return;

      const ordered = [...entityTypes].sort((a, b) => a.sortOrder - b.sortOrder);
      const from = ordered.findIndex((t) => t.id === dragging);
      const to = ordered.findIndex((t) => t.id === targetId);
      if (from === -1 || to === -1) return;

      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      await reorderEntityTypes(ordered.map((t) => t.id));
      setDragging(null);
    },
    [dragging, entityTypes],
  );

  const addSection = useCallback(async () => {
    if (!campaign) return;
    const created = await createEntityType(campaign.id, "New section", "◇", "concept");
    setEditing(created.id);
  }, [campaign]);

  const remove = useCallback(async (type: EntityType) => {
    const result = await deleteEntityType(type.id);
    if (!result.deleted) setNotice(result.reason ?? "Could not remove that section.");
  }, []);

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="mb-7 flex flex-wrap items-end gap-3 border-b border-hair pb-5">
        <div>
          <h1 className="font-semibold tracking-wide text-ink text-2xl">
            {campaign?.name ?? "Campaign canon"}
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Everything your notes have revealed so far.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="rounded border border-hair px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-strong hover:text-ink"
            >
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </button>
          )}
          <button
            type="button"
            onClick={() => void addSection()}
            className="rounded border border-hair px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-strong hover:text-ink"
          >
            + New section
          </button>
          {/* The Canon is the landing page now, so writing has to start here
              too — §3 says organisation must never gate capture. */}
          <button
            type="button"
            onClick={onQuickNote}
            className="rounded bg-candle/15 px-2.5 py-1 text-xs text-candle transition-colors hover:bg-candle/25"
          >
            + New note
          </button>
        </div>
      </header>

      {notice && (
        <p
          role="status"
          className="mb-4 rounded border border-blood/40 bg-blood/10 px-3 py-2 text-sm text-ink-muted"
        >
          {notice}{" "}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="underline hover:text-ink"
          >
            Dismiss
          </button>
        </p>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
        {visible.map((type, index) => (
          <li key={type.id}>
            <SectionCard
              type={type}
              count={counts.get(type.id) ?? 0}
              isFirst={index === 0}
              isLast={index === visible.length - 1}
              editing={editing === type.id}
              onEdit={() => setEditing(type.id)}
              onDoneEditing={() => setEditing(null)}
              onOpen={() => navigate({ kind: "section", entityTypeId: type.id })}
              onOpenInNewTab={() =>
                openInNewTab({ kind: "section", entityTypeId: type.id })
              }
              onMove={(direction) => void move(type.id, direction)}
              onRemove={() => void remove(type)}
              onDragStart={() => setDragging(type.id)}
              onDropOn={() => void handleDrop(type.id)}
              isDragging={dragging === type.id}
            />
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="text-sm text-ink-faint">
          Every section is hidden. Add one, or show the hidden sections above.
        </p>
      )}
    </div>
  );
}

function SectionCard({
  type,
  count,
  isFirst,
  isLast,
  editing,
  onEdit,
  onDoneEditing,
  onOpen,
  onOpenInNewTab,
  onMove,
  onRemove,
  onDragStart,
  onDropOn,
  isDragging,
}: {
  type: EntityType;
  count: number;
  isFirst: boolean;
  isLast: boolean;
  editing: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
  onOpen: () => void;
  onOpenInNewTab: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDropOn: () => void;
  isDragging: boolean;
}) {
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const accent = `var(--entity-${type.themeKey})`;

  if (editing) {
    return (
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: accent, background: "var(--bg-raised)" }}
      >
        <label className="mb-1 block text-[0.65rem] uppercase tracking-wider text-ink-faint">
          Section name
        </label>
        <input
          autoFocus
          value={nameDraft ?? type.name}
          onChange={(e) => {
            setNameDraft(e.target.value);
            void updateEntityType(type.id, { name: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") onDoneEditing();
          }}
          aria-label="Section name"
          className="w-full rounded border border-hair bg-surface px-2 py-1 text-sm text-ink focus:border-strong focus:outline-none"
        />

        <p className="mt-3 mb-1 text-[0.65rem] uppercase tracking-wider text-ink-faint">
          Icon
        </p>
        <div className="flex flex-wrap gap-1">
          {ICON_CHOICES.map((icon) => (
            <button
              key={icon}
              type="button"
              aria-label={`Icon ${icon}`}
              onClick={() => void updateEntityType(type.id, { icon })}
              className={`h-7 w-7 rounded border text-sm transition-colors ${
                type.icon === icon
                  ? "border-candle text-candle"
                  : "border-hair text-ink-muted hover:border-strong hover:text-ink"
              }`}
            >
              {icon}
            </button>
          ))}
        </div>

        <p className="mt-3 mb-1 text-[0.65rem] uppercase tracking-wider text-ink-faint">
          Colour
        </p>
        <div className="flex flex-wrap gap-1">
          {THEME_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={`Colour ${key}`}
              onClick={() => void updateEntityType(type.id, { themeKey: key })}
              style={{ background: `var(--entity-${key})` }}
              className={`h-5 w-5 rounded-full border transition-transform ${
                type.themeKey === key
                  ? "scale-110 border-ink"
                  : "border-transparent hover:scale-105"
              }`}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onDoneEditing}
            className="rounded bg-candle/20 px-2.5 py-1 text-xs text-candle hover:bg-candle/30"
          >
            Done
          </button>
          <button
            type="button"
            onClick={() => void updateEntityType(type.id, { hidden: !type.hidden })}
            className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            {type.hidden ? "Unhide" : "Hide"}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto rounded px-2 py-1 text-xs text-ink-faint hover:text-blood"
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      data-testid="canon-section"
      data-section-name={type.name}
      // No hover translate: a grid of cards that shift under the pointer is
      // both harder to click and needless motion.
      className={`group relative flex h-full flex-col rounded-lg border border-hair bg-surface p-4 transition-colors hover:border-strong hover:shadow-lg ${
        isDragging ? "opacity-40" : ""
      } ${type.hidden ? "opacity-50" : ""}`}
      style={{ boxShadow: `inset 3px 0 0 ${accent}` }}
    >
      <button
        type="button"
        onClick={onOpen}
        onAuxClick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onOpenInNewTab();
          }
        }}
        className="flex flex-1 flex-col items-start text-left"
      >
        <span
          aria-hidden="true"
          className="mb-2 text-3xl transition-transform group-hover:scale-110"
          style={{ color: accent }}
        >
          {type.icon}
        </span>
        <span className="text-base font-medium text-ink">{type.name}</span>
        <span className="mt-0.5 text-xs text-ink-faint">
          {count} {count === 1 ? "entry" : "entries"}
          {type.hidden && " · hidden"}
        </span>
      </button>

      <div className="mt-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label={`Move ${type.name} earlier`}
          disabled={isFirst}
          onClick={() => onMove(-1)}
          className="rounded px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink disabled:opacity-30"
        >
          ←
        </button>
        <button
          type="button"
          aria-label={`Move ${type.name} later`}
          disabled={isLast}
          onClick={() => onMove(1)}
          className="rounded px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink disabled:opacity-30"
        >
          →
        </button>
        <button
          type="button"
          aria-label={`Edit ${type.name}`}
          onClick={onEdit}
          className="ml-auto rounded px-1.5 py-0.5 text-xs text-ink-faint hover:text-candle"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
