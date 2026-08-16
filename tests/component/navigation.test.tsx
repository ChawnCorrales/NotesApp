/**
 * Tabs, and Back/Forward within each of them (PRD §49).
 *
 * Two properties matter and are easy to get wrong: each tab keeps its own
 * history, and closing a tab never leaves the user stranded.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  NavigationProvider,
  useNavigation,
  type View,
} from "@/components/navigation-context";

function describeView(view: View): string {
  switch (view.kind) {
    case "note":
      return `note:${view.noteId}`;
    case "entity":
      return `entity:${view.entityId}`;
    case "section":
      return `section:${view.entityTypeId}`;
    case "search":
      return `search:${view.query}`;
    default:
      return view.kind;
  }
}

function Harness() {
  const {
    current,
    tabs,
    activeTabId,
    canGoBack,
    canGoForward,
    navigate,
    openInNewTab,
    closeTab,
    selectTab,
    back,
    forward,
  } = useNavigation();

  return (
    <div>
      <p data-testid="current">{describeView(current)}</p>
      <p data-testid="tab-count">{tabs.length}</p>
      <ul>
        {tabs.map((tab, i) => (
          <li key={tab.id}>
            <button onClick={() => selectTab(tab.id)}>select {i}</button>
            <button onClick={() => closeTab(tab.id)}>close {i}</button>
            <span data-testid={`tab-${i}`}>{describeView(tab.view)}</span>
            <span data-testid={`tab-${i}-active`}>
              {tab.id === activeTabId ? "active" : "idle"}
            </span>
          </li>
        ))}
      </ul>
      <button onClick={() => navigate({ kind: "note", noteId: "n1" })}>note 1</button>
      <button onClick={() => navigate({ kind: "entity", entityId: "marrow" })}>
        marrow
      </button>
      <button onClick={() => navigate({ kind: "entity", entityId: "queen" })}>
        queen
      </button>
      <button onClick={() => openInNewTab({ kind: "entity", entityId: "queen" })}>
        queen in new tab
      </button>
      <button onClick={back} disabled={!canGoBack}>
        Back
      </button>
      <button onClick={forward} disabled={!canGoForward}>
        Forward
      </button>
    </div>
  );
}

function renderHarness() {
  return render(
    <NavigationProvider>
      <Harness />
    </NavigationProvider>,
  );
}

const current = () => screen.getByTestId("current").textContent;
const tabCount = () => screen.getByTestId("tab-count").textContent;

describe("opening tabs", () => {
  it("starts on the Campaign Canon in a single tab", () => {
    renderHarness();

    expect(current()).toBe("canon");
    expect(tabCount()).toBe("1");
  });

  it("opens a new tab and focuses it", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "queen in new tab" }));

    expect(tabCount()).toBe("2");
    expect(current()).toBe("entity:queen");
    expect(screen.getByTestId("tab-1-active")).toHaveTextContent("active");
  });

  it("leaves the original tab where it was", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "queen in new tab" }));

    expect(screen.getByTestId("tab-0")).toHaveTextContent("note:n1");
    expect(screen.getByTestId("tab-1")).toHaveTextContent("entity:queen");
  });

  it("switches back to a tab without disturbing it", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "queen in new tab" }));
    await user.click(screen.getByRole("button", { name: "select 0" }));

    expect(current()).toBe("note:n1");
  });
});

describe("history is per tab", () => {
  it("keeps separate back stacks", async () => {
    const user = userEvent.setup();
    renderHarness();

    // Tab 0: canon -> note -> marrow
    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));

    // Tab 1 starts fresh.
    await user.click(screen.getByRole("button", { name: "queen in new tab" }));
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();

    // Going back in tab 0 must not be affected by anything tab 1 did.
    await user.click(screen.getByRole("button", { name: "select 0" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(current()).toBe("note:n1");
    expect(screen.getByTestId("tab-1")).toHaveTextContent("entity:queen");
  });

  it("retraces a trail one step at a time", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));
    await user.click(screen.getByRole("button", { name: "queen" }));

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(current()).toBe("entity:marrow");

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(current()).toBe("note:n1");

    await user.click(screen.getByRole("button", { name: "Forward" }));
    expect(current()).toBe("entity:marrow");
  });

  it("truncates the forward trail when navigating somewhere new", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "queen" }));

    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
    expect(current()).toBe("entity:queen");
  });

  it("does not stack a duplicate entry for the view already open", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(current()).toBe("note:n1");
  });

  it("supports Alt+Arrow shortcuts on the active tab", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "marrow" }));

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(current()).toBe("note:n1");

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(current()).toBe("entity:marrow");
  });
});

describe("closing tabs", () => {
  it("focuses the neighbour when the active tab closes", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "queen in new tab" }));
    await user.click(screen.getByRole("button", { name: "close 1" }));

    expect(tabCount()).toBe("1");
    expect(current()).toBe("note:n1");
  });

  it("leaves the active tab alone when another closes", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "queen in new tab" }));
    await user.click(screen.getByRole("button", { name: "close 0" }));

    expect(tabCount()).toBe("1");
    expect(current()).toBe("entity:queen");
  });

  it("never leaves the user with no tabs", async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole("button", { name: "note 1" }));
    await user.click(screen.getByRole("button", { name: "close 0" }));

    // Closing the last tab starts a fresh one rather than emptying the window.
    expect(tabCount()).toBe("1");
    expect(current()).toBe("canon");
  });
});
