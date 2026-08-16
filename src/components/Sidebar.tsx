"use client";

/**
 * Primary navigation (PRD §23).
 *
 * Ordered by what the PRD says people actually reach for: capture first, then
 * recent work, then the entity categories that make up the Campaign Canon
 * (§30). Everything is a flat, always-visible list rather than nested
 * disclosure, because §48 warns against hidden navigation.
 */

import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createNote, listRecentNotes } from "@/lib/services";
import type { Note } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { ImportMarkdown } from "./ImportMarkdown";
import { FolderTree } from "./FolderTree";

/** How many recent notes to show before it stops being a shortcut. */
const RECENT_LIMIT = 12;

export function Sidebar() {
  const { campaign, entities, entityTypes } = useCampaign();
  const { current, navigate, openInNewTab } = useNavigation();

  const [query, setQuery] = useState("");

  const campaignId = campaign?.id;

  // Reads twelve rows off the index rather than the whole campaign.
  const recentNotes = useLiveQuery(
    () =>
      campaignId
        ? listRecentNotes(campaignId, RECENT_LIMIT)
        : Promise.resolve<Note[]>([]),
    [campaignId],
    [] as Note[],
  );

  const entitiesByType = useMemo(() => {
    const grouped = new Map<string, typeof entities>();
    for (const entity of entities) {
      const list = grouped.get(entity.entityTypeId) ?? [];
      list.push(entity);
      grouped.set(entity.entityTypeId, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return grouped;
  }, [entities]);

  const handleQuickNote = useCallback(async () => {
    if (!campaignId) return;
    const note = await createNote({ campaignId: campaignId });
    navigate({ kind: "note", noteId: note.id });
  }, [campaignId, navigate]);

  const isActive = useCallback(
    (kind: string, id?: string) => {
      if (current.kind !== kind) return false;
      if (kind === "note" && current.kind === "note") return current.noteId === id;
      if (kind === "entity" && current.kind === "entity") return current.entityId === id;
      return true;
    },
    [current],
  );

  return (
    <nav
      aria-label="Campaign navigation"
      className="flex h-full w-64 shrink-0 flex-col border-r border-hair bg-surface"
    >
      <div className="border-b border-hair px-4 py-4">
        <p className="truncate text-sm font-semibold tracking-wide text-ink">
          {campaign?.name ?? "…"}
        </p>
      </div>

      <div className="px-3 py-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) {
              navigate({ kind: "search", query: query.trim() });
            }
          }}
          placeholder="Search…"
          aria-label="Search"
          className="w-full rounded border border-hair bg-abyss px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
        />

        <button
          type="button"
          onClick={() => void handleQuickNote()}
          className="mt-2 w-full rounded bg-candle/15 px-2.5 py-1.5 text-sm text-candle transition-colors hover:bg-candle/25"
        >
          + Quick note
        </button>

        <ImportMarkdown />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Recent is a shortcut list, the folder tree below is the browser.
            A note can appear in both, the same way an editor lists open files
            alongside the file tree. */}
        <Section title="Recent">
          <div data-testid="recent-notes">
            {recentNotes.map((note) => (
              <Item
                key={note.id}
                active={isActive("note", note.id)}
                onClick={() => navigate({ kind: "note", noteId: note.id })}
              >
                {note.title || "Untitled note"}
              </Item>
            ))}
          </div>
          {recentNotes.length === 0 && <Empty>No notes yet.</Empty>}
        </Section>

        {/* Categories link straight to their section. The Canon and section
            views now do the browsing that inline expansion used to. */}
        <Section title="Campaign canon">
          <Item
            active={current.kind === "canon"}
            onClick={() => navigate({ kind: "canon" })}
          >
            ❦ All sections
          </Item>
          {entityTypes
            .filter((type) => !type.hidden)
            .map((type) => {
              const members = entitiesByType.get(type.id) ?? [];
              const active =
                current.kind === "section" && current.entityTypeId === type.id;

              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => navigate({ kind: "section", entityTypeId: type.id })}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openInNewTab({ kind: "section", entityTypeId: type.id });
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
                    active
                      ? "bg-raised text-candle"
                      : "text-ink-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: `var(--entity-${type.themeKey})` }}
                  >
                    {type.icon}
                  </span>
                  <span className="flex-1 truncate">{type.name}</span>
                  <span className="text-xs text-ink-faint">{members.length}</span>
                </button>
              );
            })}
        </Section>

        <div className="mt-3">
          <FolderTree />
        </div>

        <Section title="Campaign">
          <Item active={isActive("tasks")} onClick={() => navigate({ kind: "tasks" })}>
            Tasks
          </Item>
          <Item active={isActive("graph")} onClick={() => navigate({ kind: "graph" })}>
            Mind map
          </Item>
          <Item active={isActive("trash")} onClick={() => navigate({ kind: "trash" })}>
            Trash
          </Item>
        </Section>
      </div>
    </nav>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="px-2 pb-1 text-[0.68rem] uppercase tracking-wider text-ink-faint">
        {title}
      </p>
      {children}
    </div>
  );
}

function Item({
  children,
  onClick,
  active,
  indented,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  indented?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full truncate rounded px-2 py-1 text-left text-sm transition-colors ${
        indented ? "pl-7" : ""
      } ${
        active
          ? "bg-raised text-candle"
          : "text-ink-muted hover:bg-raised hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-1 text-sm text-ink-faint">{children}</p>;
}
