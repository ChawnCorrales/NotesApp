/**
 * Collections, end to end (PRD §31).
 *
 * The journey being protected is the PRD's own worked example: a GM mid-session
 * decides that a note and an NPC both belong to the same investigation, and
 * files them without leaving what they were doing. Everything else here —
 * the sidebar entry, the browse-all view, removal — exists to make that bundle
 * findable again afterwards.
 */

import { expect, test } from "@playwright/test";
import {
  content,
  createEntityFromTrailingWord,
  createNote,
  openApp,
  settle,
  typeInEditor,
} from "./helpers";

/** Opens the collections popover on whatever page is showing. */
async function openCollectionPopover(page: import("@playwright/test").Page) {
  await content(page).getByTestId("add-to-collection").click();
  await expect(page.getByRole("menu", { name: "Collections" })).toBeVisible();
}

function sidebar(page: import("@playwright/test").Page) {
  return page.getByRole("navigation", { name: "Campaign navigation" });
}

test("a note and an entity can be filed into the same collection", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "Marrow keeps a shop in Greyhaven.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  // Creating the entity landed us on its page, so file the entity first —
  // inventing the collection here rather than going somewhere to make it.
  await expect(content(page).getByLabel("Entity name")).toHaveValue("Marrow");
  await openCollectionPopover(page);
  await page.getByLabel("New collection name").fill("Red Queen Investigation");
  await page.getByLabel("New collection name").press("Enter");

  // The chip appears immediately, so the page now says what it belongs to.
  await expect(content(page).getByTestId("member-collection")).toHaveText([
    "Red Queen Investigation",
  ]);

  // Now the note, through the same control on a different kind of page.
  await page
    .getByTestId("recent-notes")
    .getByRole("button", { name: "Session 12", exact: true })
    .click();
  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 12");

  await openCollectionPopover(page);
  // click() rather than check(): the box is driven by stored membership, so it
  // flips only once the write round-trips, and check() demands it be immediate.
  await page
    .getByRole("menu", { name: "Collections" })
    .getByLabel("Red Queen Investigation")
    .click();
  await expect(content(page).getByTestId("member-collection")).toHaveText([
    "Red Queen Investigation",
  ]);

  // The collection now holds one of each, and is reachable from the sidebar.
  await sidebar(page)
    .getByTestId("sidebar-collection")
    .filter({ hasText: "Red Queen Investigation" })
    .click();

  await expect(content(page).getByLabel("Collection name")).toHaveValue(
    "Red Queen Investigation",
  );
  await expect(content(page).getByTestId("collection-note")).toHaveCount(1);
  await expect(content(page).getByTestId("collection-entity")).toHaveCount(1);
});

test("collections are browsable, and a card shows what it holds", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  await openCollectionPopover(page);
  await page.getByLabel("New collection name").fill("Arc One");
  await page.getByLabel("New collection name").press("Enter");

  await sidebar(page).getByRole("button", { name: "◫ All collections" }).click();

  const card = content(page)
    .getByTestId("collection-card")
    .filter({ hasText: "Arc One" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 note");

  await card.click();
  await expect(content(page).getByLabel("Collection name")).toHaveValue("Arc One");
});

test("removing a note from a collection keeps the note", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  await openCollectionPopover(page);
  await page.getByLabel("New collection name").fill("Arc One");
  await page.getByLabel("New collection name").press("Enter");
  await expect(content(page).getByTestId("member-collection")).toHaveCount(1);

  await sidebar(page)
    .getByTestId("sidebar-collection")
    .filter({ hasText: "Arc One" })
    .click();
  await content(page)
    .getByRole("button", { name: "Remove Session 12 from collection" })
    .click();

  await expect(content(page).getByTestId("collection-note")).toHaveCount(0);

  // The note itself is untouched — a collection is a statement about notes,
  // not a container that owns them.
  await page
    .getByTestId("recent-notes")
    .getByRole("button", { name: "Session 12", exact: true })
    .click();
  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 12");
  await expect(page.locator(".ProseMirror")).toContainText("They met at dusk.");
});

test("deleting a collection leaves its contents alone", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  await openCollectionPopover(page);
  await page.getByLabel("New collection name").fill("Arc One");
  await page.getByLabel("New collection name").press("Enter");

  await sidebar(page)
    .getByTestId("sidebar-collection")
    .filter({ hasText: "Arc One" })
    .click();
  await content(page).getByRole("button", { name: "Delete collection" }).click();
  await content(page).getByRole("button", { name: "Yes, delete" }).click();

  // Sent back to the browse-all view, with the collection gone from both places.
  await expect(content(page).getByTestId("collection-card")).toHaveCount(0);
  await expect(sidebar(page).getByTestId("sidebar-collection")).toHaveCount(0);

  await page
    .getByTestId("recent-notes")
    .getByRole("button", { name: "Session 12", exact: true })
    .click();
  await expect(page.locator(".ProseMirror")).toContainText("They met at dusk.");
});

test("a collection survives a reload", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 12");
  await typeInEditor(page, "They met at dusk.");
  await settle(page);

  await openCollectionPopover(page);
  await page.getByLabel("New collection name").fill("Arc One");
  await page.getByLabel("New collection name").press("Enter");
  await expect(content(page).getByTestId("member-collection")).toHaveCount(1);

  await page.reload();
  await expect(sidebar(page)).toBeVisible();

  await sidebar(page)
    .getByTestId("sidebar-collection")
    .filter({ hasText: "Arc One" })
    .click();
  await expect(content(page).getByTestId("collection-note")).toHaveCount(1);
});
