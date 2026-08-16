"use client";

/**
 * Tabs, and Back/Forward within each of them (PRD §49).
 *
 * A GM cross-referencing three notes and an entity page should not have to
 * choose which one stays open. Each tab owns an independent history stack, so
 * following Marrow → Red Queen → Cult of Glass in one tab leaves the session
 * notes in another exactly where they were.
 *
 * History is per tab rather than global on purpose: a single shared stack makes
 * Back mean "wherever I was last, in any tab", which is precisely the behaviour
 * that makes tabbed interfaces feel broken.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type View =
  | { kind: "canon" }
  | { kind: "section"; entityTypeId: string }
  | { kind: "note"; noteId: string }
  | { kind: "entity"; entityId: string }
  | { kind: "graph" }
  | { kind: "tasks" }
  | { kind: "trash" }
  | { kind: "search"; query: string };

/** Which view a new tab — and app launch — lands on. */
export type HomeView = "canon" | "graph";

const HOME_VIEW_KEY = "notesapp:home-view";

export interface TabSummary {
  id: string;
  view: View;
}

interface NavigationValue {
  tabs: readonly TabSummary[];
  activeTabId: string;
  current: View;
  canGoBack: boolean;
  canGoForward: boolean;
  homeView: HomeView;
  setHomeView: (view: HomeView) => void;
  /** Navigates within the active tab. */
  navigate: (view: View) => void;
  openInNewTab: (view: View) => void;
  closeTab: (tabId: string) => void;
  selectTab: (tabId: string) => void;
  back: () => void;
  forward: () => void;
}

const NavigationContext = createContext<NavigationValue | null>(null);

export function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "note" && b.kind === "note") return a.noteId === b.noteId;
  if (a.kind === "entity" && b.kind === "entity") return a.entityId === b.entityId;
  if (a.kind === "section" && b.kind === "section")
    return a.entityTypeId === b.entityTypeId;
  if (a.kind === "search" && b.kind === "search") return a.query === b.query;
  return true;
}

interface Tab {
  id: string;
  history: View[];
  index: number;
}

interface TabsState {
  tabs: Tab[];
  activeId: string;
}

function newTabId(): string {
  return crypto.randomUUID();
}

function createTab(view: View): Tab {
  return { id: newTabId(), history: [view], index: 0 };
}

function readHomeView(): HomeView {
  if (typeof window === "undefined") return "canon";
  return window.localStorage.getItem(HOME_VIEW_KEY) === "graph" ? "graph" : "canon";
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [homeView, setHomeViewState] = useState<HomeView>(readHomeView);

  const [state, setState] = useState<TabsState>(() => {
    const tab = createTab({ kind: readHomeView() === "graph" ? "graph" : "canon" });
    return { tabs: [tab], activeId: tab.id };
  });

  const setHomeView = useCallback((view: HomeView) => {
    setHomeViewState(view);
    window.localStorage.setItem(HOME_VIEW_KEY, view);
  }, []);

  /** Applies a change to the active tab, leaving the others untouched. */
  const updateActive = useCallback((change: (tab: Tab) => Tab) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((tab) => (tab.id === prev.activeId ? change(tab) : tab)),
    }));
  }, []);

  const navigate = useCallback(
    (view: View) => {
      updateActive((tab) => {
        const truncated = tab.history.slice(0, tab.index + 1);
        // Re-opening the view already showing should not stack a duplicate,
        // or the first Back press appears to do nothing.
        if (sameView(truncated[truncated.length - 1], view)) return tab;
        return { ...tab, history: [...truncated, view], index: truncated.length };
      });
    },
    [updateActive],
  );

  const openInNewTab = useCallback((view: View) => {
    setState((prev) => {
      const tab = createTab(view);
      // Inserted after the active tab, the way browsers do it, so a burst of
      // opens reads left to right in the order they were made.
      const at = prev.tabs.findIndex((t) => t.id === prev.activeId) + 1;
      const tabs = [...prev.tabs.slice(0, at), tab, ...prev.tabs.slice(at)];
      return { tabs, activeId: tab.id };
    });
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setState((prev) => {
        const at = prev.tabs.findIndex((t) => t.id === tabId);
        if (at === -1) return prev;

        const remaining = prev.tabs.filter((t) => t.id !== tabId);

        // Never leave the user with no tabs; closing the last one starts fresh.
        if (remaining.length === 0) {
          const tab = createTab({ kind: homeView === "graph" ? "graph" : "canon" });
          return { tabs: [tab], activeId: tab.id };
        }

        if (prev.activeId !== tabId) return { ...prev, tabs: remaining };

        // Focus the neighbour to the left, falling back to the right.
        const next = remaining[Math.max(0, at - 1)];
        return { tabs: remaining, activeId: next.id };
      });
    },
    [homeView],
  );

  const selectTab = useCallback((tabId: string) => {
    setState((prev) =>
      prev.tabs.some((t) => t.id === tabId) ? { ...prev, activeId: tabId } : prev,
    );
  }, []);

  const back = useCallback(() => {
    updateActive((tab) => ({ ...tab, index: Math.max(0, tab.index - 1) }));
  }, [updateActive]);

  const forward = useCallback(() => {
    updateActive((tab) => ({
      ...tab,
      index: Math.min(tab.history.length - 1, tab.index + 1),
    }));
  }, [updateActive]);

  /**
   * Alt+Arrow and the mouse's dedicated back/forward buttons, matching what the
   * same gestures do in a browser. Ctrl/Cmd+W is deliberately not bound —
   * browsers claim it, and losing a tab of campaign notes to a missed keystroke
   * is not a trade worth making.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      }
    }

    function onMouseUp(event: MouseEvent) {
      if (event.button === 3) {
        event.preventDefault();
        back();
      } else if (event.button === 4) {
        event.preventDefault();
        forward();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [back, forward]);

  const value = useMemo<NavigationValue>(() => {
    const active =
      state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];

    return {
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        view: tab.history[tab.index] ?? { kind: "canon" },
      })),
      activeTabId: active.id,
      current: active.history[active.index] ?? { kind: "canon" },
      canGoBack: active.index > 0,
      canGoForward: active.index < active.history.length - 1,
      homeView,
      setHomeView,
      navigate,
      openInNewTab,
      closeTab,
      selectTab,
      back,
      forward,
    };
  }, [
    state,
    homeView,
    setHomeView,
    navigate,
    openInNewTab,
    closeTab,
    selectTab,
    back,
    forward,
  ]);

  return (
    <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("useNavigation must be used inside NavigationProvider");
  return value;
}
