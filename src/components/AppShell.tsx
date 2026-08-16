"use client";

/**
 * The application frame: menu bar, tab strip, sidebar, and the active view.
 *
 * Chrome is arranged so the writing surface stays the largest thing on screen —
 * §47 asks for atmosphere, §48 for calm, and the compromise is a dense but
 * shallow shell wrapped around a roomy editor.
 */

import { useCallback, useState } from "react";
import { createNote } from "@/lib/services";
import { triggerMarkdownImport } from "@/lib/import/import-trigger";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CampaignCanon } from "./CampaignCanon";
import { CommandPalette } from "./CommandPalette";
import { EntityPage } from "./EntityPage";
import { GlobalCreate } from "./GlobalCreate";
import { GraphView } from "./GraphView";
import { NoteEditor } from "./NoteEditor";
import { SearchView } from "./SearchView";
import { SectionView } from "./SectionView";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TasksView } from "./TasksView";
import { TrashView } from "./TrashView";
import { Toolbar } from "./Toolbar";

export function AppShell() {
  const { campaign, ready } = useCampaign();
  const { current, canGoBack, canGoForward, back, forward, navigate } =
    useNavigation();

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [focusMode, setFocusMode] = useState(false);

  const handleQuickNote = useCallback(async () => {
    if (!campaign) return;
    const note = await createNote(campaign.id);
    navigate({ kind: "note", noteId: note.id });
  }, [campaign, navigate]);

  if (!ready) {
    return (
      <main className="flex h-screen items-center justify-center text-ink-faint">
        Opening the archive…
      </main>
    );
  }

  // Focus mode strips the shell back to the document itself. Everything is one
  // keystroke away through the command palette, so nothing becomes unreachable.
  const showChrome = !focusMode;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {showChrome && (
        <Toolbar
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible((v) => !v)}
          focusMode={focusMode}
          onToggleFocus={() => setFocusMode((v) => !v)}
          onImportMarkdown={triggerMarkdownImport}
        />
      )}

      {showChrome && <TabBar />}

      <div className="flex min-h-0 flex-1">
        {showChrome && sidebarVisible && <Sidebar />}

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-hair px-4 py-1.5">
            <button
              type="button"
              onClick={back}
              disabled={!canGoBack}
              aria-label="Back"
              title="Back (Alt+←)"
              className="rounded px-2 py-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              ←
            </button>
            <button
              type="button"
              onClick={forward}
              disabled={!canGoForward}
              aria-label="Forward"
              title="Forward (Alt+→)"
              className="rounded px-2 py-1 text-ink-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
            >
              →
            </button>

            {focusMode && (
              <button
                type="button"
                onClick={() => setFocusMode(false)}
                className="rounded border border-hair px-2 py-0.5 text-xs text-ink-muted hover:border-strong hover:text-ink"
              >
                Leave focus mode
              </button>
            )}

            <span className="ml-auto text-xs text-ink-faint">
              Ctrl/Cmd + K for commands
            </span>
          </header>

          <div className="min-h-0 flex-1">
            <ActiveView view={current} onQuickNote={handleQuickNote} />
          </div>
        </main>
      </div>

      <CommandPalette />
      <GlobalCreate />
    </div>
  );
}

function ActiveView({
  view,
  onQuickNote,
}: {
  view: ReturnType<typeof useNavigation>["current"];
  onQuickNote: () => void;
}) {
  switch (view.kind) {
    case "note":
      // Keyed so switching notes remounts the editor rather than reusing an
      // instance still holding the previous document.
      return <NoteEditor key={view.noteId} noteId={view.noteId} />;
    case "entity":
      return <EntityPage key={view.entityId} entityId={view.entityId} />;
    case "section":
      return <SectionView key={view.entityTypeId} entityTypeId={view.entityTypeId} />;
    case "graph":
      return <GraphView />;
    case "tasks":
      return <TasksView />;
    case "trash":
      return <TrashView />;
    case "search":
      return <SearchView key={view.query} query={view.query} />;
    case "canon":
    default:
      return <CampaignCanon onQuickNote={onQuickNote} />;
  }
}
