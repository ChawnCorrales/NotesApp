/**
 * Dragging an entity onto a Canon section.
 *
 * Only a real browser has a DataTransfer, so this is the one place the gesture
 * can be exercised end to end. The assertion is never "the drag happened" — it
 * is that the entity has actually changed section, which is visible in two
 * places at once: it leaves the section it was in and appears in the one it was
 * dropped on.
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

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Campaign navigation" });
}

/** A Canon section in the sidebar, by exact name. */
function section(page: Page, name: string) {
  return sidebar(page).locator(`[data-section-name="${name}"]`);
}

/** An entity card in the section view, by exact name. */
function card(page: Page, name: string) {
  return content(page).locator(`[data-entity-name="${name}"]`);
}

/** Creates one entity and leaves the browser on its section. */
async function setUpMarrow(page: Page) {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await section(page, "Characters").click();
  await expect(card(page, "Marrow")).toBeVisible();
}

test("dragging an entity onto a section moves it there", async ({ page }) => {
  await setUpMarrow(page);

  await card(page, "Marrow").dragTo(section(page, "Locations"));

  // Gone from where it was...
  await expect(card(page, "Marrow")).toHaveCount(0);

  // ...and present where it landed.
  await section(page, "Locations").click();
  await expect(card(page, "Marrow")).toBeVisible();
});

test("the counts in the sidebar follow the move", async ({ page }) => {
  await setUpMarrow(page);

  await expect(section(page, "Characters")).toContainText("1");
  await expect(section(page, "Locations")).toContainText("0");

  await card(page, "Marrow").dragTo(section(page, "Locations"));

  // The counts are derived from the entities, so they move on their own.
  await expect(section(page, "Characters")).toContainText("0");
  await expect(section(page, "Locations")).toContainText("1");
});

test("the entity keeps its mentions and backlinks", async ({ page }) => {
  await setUpMarrow(page);

  await card(page, "Marrow").dragTo(section(page, "Locations"));
  await section(page, "Locations").click();
  await card(page, "Marrow").click();

  // Recategorising is not re-creating: the writing that referred to it is
  // untouched, so the backlink survives.
  await expect(content(page).getByLabel("Entity name")).toHaveValue("Marrow");
  await expect(content(page).getByText(/Mentioned in 1 note/)).toBeVisible();
});

test("dropping on the section it is already in changes nothing", async ({ page }) => {
  await setUpMarrow(page);

  await card(page, "Marrow").dragTo(section(page, "Characters"));

  await expect(card(page, "Marrow")).toBeVisible();
  await expect(section(page, "Characters")).toContainText("1");
});

test("the picker on the card does the same move without a mouse", async ({ page }) => {
  await setUpMarrow(page);

  await content(page)
    .getByLabel("Move Marrow to another section")
    .selectOption({ label: "Locations" });

  await expect(card(page, "Marrow")).toHaveCount(0);
  await section(page, "Locations").click();
  await expect(card(page, "Marrow")).toBeVisible();
});

test("a note dragged from the folder tree is not a valid drop", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  const note = page.getByTestId("recent-notes").getByRole("button", {
    name: "Session 1",
    exact: true,
  });

  await note.dragTo(section(page, "Characters"));

  // Sections take entities. A note carries a different drag type, so nothing
  // happens — rather than the section quietly acquiring something odd.
  await expect(section(page, "Characters")).toContainText("0");
  await expect(
    page.getByTestId("recent-notes").getByRole("button", { name: "Session 1", exact: true }),
  ).toBeVisible();
});

/**
 * Dropping onto a collection instead of a section.
 *
 * The same gesture with a different meaning: a Canon section takes an entity
 * *out* of wherever it was, a collection simply also holds it. These check that
 * the second really is additive.
 */
function collectionCard(page: Page, name: string) {
  return content(page).locator(`[data-collection-name="${name}"]`);
}

function collectionRow(page: Page, name: string) {
  return sidebar(page).locator(`[data-collection-name="${name}"]`);
}

async function makeCollection(page: Page, name: string) {
  await sidebar(page).getByRole("button", { name: "◫ All collections" }).click();
  await content(page).getByLabel("New collection name").fill(name);
  await content(page).getByRole("button", { name: "+ New" }).click();
  // Creating opens it; go back to the browse-all view where the cards are.
  await sidebar(page).getByRole("button", { name: "◫ All collections" }).click();
  await expect(collectionCard(page, name)).toBeVisible();
}

test("a note can be dragged from Recent onto a collection card", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  await makeCollection(page, "Red Queen");

  const note = page.getByTestId("recent-notes").getByRole("button", {
    name: "Session 12",
    exact: true,
  });
  await note.dragTo(collectionCard(page, "Red Queen"));

  await expect(collectionCard(page, "Red Queen")).toContainText("1 note");
});

test("an entity dropped on a collection stays in its Canon section", async ({
  page,
}) => {
  await setUpMarrow(page);
  await makeCollection(page, "Red Queen");

  // Entities live in the section view, so the sidebar row is the target here.
  await section(page, "Characters").click();

  const row = collectionRow(page, "Red Queen");
  // The sidebar scrolls. A target below the fold is not under the pointer, no
  // matter what its drop handler says.
  await row.scrollIntoViewIfNeeded();
  await card(page, "Marrow").dragTo(row);

  // Added to the collection...
  await row.click();
  await expect(content(page).getByTestId("collection-entity")).toHaveCount(1);

  // ...and still a Character, because joining a collection is not a move.
  await section(page, "Characters").click();
  await expect(card(page, "Marrow")).toBeVisible();
});
