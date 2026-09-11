/**
 * The campaign mind map (PRD sections 16-18).
 *
 * The graph is meant to emerge from writing rather than be built. These tests
 * check that what emerges is correct: one node per entity, edges for stated
 * relationships, and nodes that lead back to the entity they represent.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  content,
  createEntityFromTrailingWord,
  createNote,
  openApp,
  settle,
  typeInEditor,
} from "./helpers";

function graphNodes(page: Page) {
  return page.locator(".react-flow__node");
}

async function openMindMap(page: Page) {
  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: "Mind map" })
    .click();
}

async function createEntity(
  page: Page,
  noteTitle: string,
  sentence: string,
  name: string,
  category: string,
) {
  await createNote(page, noteTitle);
  await typeInEditor(page, sentence);
  await createEntityFromTrailingWord(page, name, category);
}

test("entities appear as nodes and lead back to their page", async ({ page }) => {
  await openApp(page);

  await createEntity(page, "S1", "The shop belongs to Marrow", "Marrow", "Characters");
  await createEntity(page, "S2", "The road runs to Greyhaven", "Greyhaven", "Locations");
  await settle(page);

  await openMindMap(page);

  await expect(graphNodes(page)).toHaveCount(2);
  await expect(graphNodes(page).first()).toBeVisible();

  // Clicking a node opens that entity, not merely some entity.
  await graphNodes(page).filter({ hasText: "Greyhaven" }).click();
  await expect(page.getByLabel("Entity name")).toHaveValue("Greyhaven");
});

test("a stated relationship becomes an edge", async ({ page }) => {
  await openApp(page);

  await createEntity(page, "S1", "The shop belongs to Marrow", "Marrow", "Characters");
  await createEntity(page, "S2", "The road runs to Greyhaven", "Greyhaven", "Locations");

  // Record the relationship on Greyhaven's page (we are already on it).
  await page.getByPlaceholder(/works in, knows/).fill("contains");
  await page.getByLabel("Related entity").selectOption({ label: "Marrow" });
  await content(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("contains")).toBeVisible();

  await settle(page);
  await openMindMap(page);

  await expect(graphNodes(page)).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});

test("aliases do not produce a second node for the same entity", async ({ page }) => {
  await openApp(page);

  await createEntity(
    page,
    "Court",
    "The court answers to the Red Queen",
    "Red Queen",
    "Characters",
  );

  const aliasField = page.getByPlaceholder(/Add alias/);
  await aliasField.fill("Verena");
  await aliasField.press("Enter");
  await aliasField.fill("The Crimson Monarch");
  await aliasField.press("Enter");

  await createNote(page, "Session 9");
  await typeInEditor(page, "Verena and the Crimson Monarch are the same person.");
  await settle(page);

  await openMindMap(page);

  // Three names, one entity, one node.
  await expect(graphNodes(page)).toHaveCount(1);
});

test("category filters hide and restore nodes", async ({ page }) => {
  await openApp(page);

  await createEntity(page, "S1", "The shop belongs to Marrow", "Marrow", "Characters");
  await createEntity(page, "S2", "The road runs to Greyhaven", "Greyhaven", "Locations");
  await settle(page);

  await openMindMap(page);
  await expect(graphNodes(page)).toHaveCount(2);

  await content(page).getByRole("button", { name: /Location/ }).click();
  await expect(graphNodes(page)).toHaveCount(1);

  await content(page).getByRole("button", { name: /Location/ }).click();
  await expect(graphNodes(page)).toHaveCount(2);
});

test("the empty graph explains itself", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Just notes");
  await typeInEditor(page, "Nothing has been flagged yet.");

  await openMindMap(page);

  await expect(page.getByText("The map is empty.")).toBeVisible();
});

/**
 * Focus mode (PRD section 17).
 *
 * "Show only entities within two relationship hops of Marrow" — the reason the
 * map stays usable once a campaign has more entities than fit on a screen.
 *
 * These assert on how many nodes are drawn, because that is the whole promise:
 * fewer things, chosen by their distance from one.
 */

/** Builds a small chain: Marrow — Greyhaven — Cult, plus an unrelated Ash. */
async function buildChain(page: Page) {
  await openApp(page);

  await createEntity(page, "S1", "The shop belongs to Marrow", "Marrow", "Characters");
  await createEntity(page, "S2", "They rode to Greyhaven", "Greyhaven", "Locations");
  await createEntity(page, "S3", "The Cult meets at dusk", "Cult", "Factions");
  await createEntity(page, "S4", "Ash waits alone", "Ash", "Characters");
  await settle(page);

  // Relate them by hand, so the edges are stated rather than inferred.
  await relate(page, "Characters", "Marrow", "works in", "Greyhaven");
  await relate(page, "Locations", "Greyhaven", "hosts", "Cult");
}

/**
 * States a relationship from the entity page of `from`.
 *
 * Reached through the sidebar section and the card's `data-entity-name`
 * rather than through search: an earlier version went via the search results
 * and could not find the entity reliably, which made four tests fail for a
 * reason that had nothing to do with the graph.
 */
async function relate(page: Page, section: string, from: string, kind: string, to: string) {
  const sidebar = page.getByRole("navigation", { name: "Campaign navigation" });

  await sidebar.locator(`[data-section-name="${section}"]`).click();
  await content(page).locator(`[data-entity-name="${from}"]`).click();
  await expect(content(page).getByLabel("Entity name")).toHaveValue(from);

  await content(page).getByPlaceholder("works in, knows, controls…").fill(kind);
  await content(page).getByLabel("Related entity").selectOption({ label: to });
  await content(page).getByRole("button", { name: "Add", exact: true }).click();

  // The relationship lands in the list before the next step depends on it.
  await expect(content(page).getByText(kind, { exact: true })).toBeVisible();
}
test("focusing narrows the map to a neighbourhood", async ({ page }) => {
  await buildChain(page);
  await openMindMap(page);

  await expect(graphNodes(page)).toHaveCount(4);

  await content(page).getByLabel("Focus on an entity").selectOption({ label: "Marrow" });

  // Marrow, Greyhaven, Cult — but not Ash, who is connected to nothing.
  await expect(graphNodes(page)).toHaveCount(3);
  await expect(content(page).getByTestId("focus-summary")).toContainText("3 of 4");
});

test("one hop shows less than two", async ({ page }) => {
  await buildChain(page);
  await openMindMap(page);

  await content(page).getByLabel("Focus on an entity").selectOption({ label: "Marrow" });
  await content(page).getByTestId("hops-1").click();

  // Just Marrow and Greyhaven.
  await expect(graphNodes(page)).toHaveCount(2);
});

test("the whole map comes back", async ({ page }) => {
  await buildChain(page);
  await openMindMap(page);

  await content(page).getByLabel("Focus on an entity").selectOption({ label: "Marrow" });
  await expect(graphNodes(page)).toHaveCount(3);

  await content(page).getByTestId("clear-focus").click();

  await expect(graphNodes(page)).toHaveCount(4);
  await expect(content(page).getByTestId("focus-summary")).toHaveCount(0);
});

test("the hop controls only appear once something is focused", async ({ page }) => {
  await buildChain(page);
  await openMindMap(page);

  await expect(content(page).getByTestId("hops-2")).toHaveCount(0);

  await content(page).getByLabel("Focus on an entity").selectOption({ label: "Marrow" });

  await expect(content(page).getByTestId("hops-2")).toBeVisible();
});
