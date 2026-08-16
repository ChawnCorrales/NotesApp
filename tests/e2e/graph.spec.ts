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
