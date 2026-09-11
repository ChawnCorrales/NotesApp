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
