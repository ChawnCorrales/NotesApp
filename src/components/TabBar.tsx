"use client";

/**
 * Browser-style tabs.
 *
 * Labels are resolved per tab from live data, so renaming a note or an entity
 * renames its tab immediately — a tab still reading "Untitled note" after the
 * note has a name makes the strip useless for navigation.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { getCollection, getNote } from "@/lib/services";
import type { Collection, Note } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation, type View } from "./navigation-context";

interface Label {
  icon: string;
  text: string;
}

function staticLabel(view: View): Label {
  switch (view.kind) {
    case "graph":
      return { icon: "✦", text: "Mind map" };
    case "tasks":
      return { icon: "☑", text: "Tasks" };
    case "search":
      return { icon: "⌕", text: view.query || "Search" };
    case "collections":
      return { icon: "◫", text: "Collections" };
    // Without this a trash tab fell through to the default and read
    // "Campaign canon", which is a different view entirely.
    case "trash":
      return { icon: "🗑", text: "Trash" };
    case "canon":
    default:
      return { icon: "❦", text: "Campaign canon" };
  }
}

function useTabLabel(view: View): Label {
  const { entityById, typeById } = useCampaign();

  const note = useLiveQuery(
    () =>
      view.kind === "note"
        ? getNote(view.noteId)
        : Promise.resolve<Note | undefined>(undefined),
    [view.kind === "note" ? view.noteId : null],
  );

  const collection = useLiveQuery(
    () =>
      view.kind === "collection"
        ? getCollection(view.collectionId)
        : Promise.resolve<Collection | undefined>(undefined),
    [view.kind === "collection" ? view.collectionId : null],
  );

  if (view.kind === "note") {
    return { icon: "✎", text: note?.title?.trim() || "Untitled note" };
  }

  if (view.kind === "entity") {
    const entity = entityById.get(view.entityId);
    const type = entity ? typeById.get(entity.entityTypeId) : undefined;
    return { icon: type?.icon ?? "◇", text: entity?.name ?? "Entity" };
  }

  if (view.kind === "section") {
    const type = typeById.get(view.entityTypeId);
    return { icon: type?.icon ?? "❦", text: type?.name ?? "Section" };
  }

  if (view.kind === "collection") {
    return { icon: "◫", text: collection?.name ?? "Collection" };
  }

  return staticLabel(view);
}

function Tab({
  id,
  view,
  active,
  closable,
}: {
  id: string;
  view: View;
  active: boolean;
  closable: boolean;
}) {
  const { selectTab, closeTab } = useNavigation();
  const label = useTabLabel(view);

  return (
    <div
      role="tab"
      aria-selected={active}
      data-testid="tab"
      className={`group flex min-w-0 max-w-52 shrink-0 items-center gap-1.5 border-r border-hair px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-surface text-ink shadow-[inset_0_-2px_0_var(--accent-candle)]"
          : "text-ink-faint hover:bg-surface/60 hover:text-ink-muted"
      }`}
    >
      <button
        type="button"
        onClick={() => selectTab(id)}
        // Middle-click closes, as it does everywhere else with tabs.
        onAuxClick={(e) => {
          if (e.button === 1 && closable) {
            e.preventDefault();
            closeTab(id);
          }
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span aria-hidden="true" className="shrink-0 opacity-70">
          {label.icon}
        </span>
        <span className="truncate">{label.text}</span>
      </button>

      {closable && (
        <button
          type="button"
          aria-label={`Close ${label.text}`}
          onClick={() => closeTab(id)}
          className="shrink-0 rounded px-1 leading-none text-ink-faint opacity-0 transition-opacity hover:text-blood group-hover:opacity-100 focus:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function TabBar() {
  const { tabs, activeTabId, openInNewTab, homeView } = useNavigation();

  return (
    <div
      role="tablist"
      aria-label="Open tabs"
      className="flex items-stretch border-b border-hair bg-abyss"
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            view={tab.view}
            active={tab.id === activeTabId}
            // The last tab has no close control: closing it would only spawn a
            // replacement, which reads as a bug rather than a feature.
            closable={tabs.length > 1}
          />
        ))}
      </div>

      <button
        type="button"
        aria-label="New tab"
        title="New tab"
        onClick={() => openInNewTab({ kind: homeView === "graph" ? "graph" : "canon" })}
        className="shrink-0 px-3 text-ink-faint transition-colors hover:bg-surface hover:text-candle"
      >
        +
      </button>
    </div>
  );
}
