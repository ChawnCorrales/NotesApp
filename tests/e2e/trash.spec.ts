/**
 * Deleting and restoring notes.
 *
 * Deleting is the one gesture in the app that can destroy work, so what these
 * check is that it does not: the note leaves every list, and comes back whole.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  createEntityFromTrailingWord,
  createNote,
  mentions,
  openApp,
  settle,
  typeInEditor,
} from "./helpers";

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Campaign navigation" });
}

function noteRow(page: Page, title: string) {
  return page.locator(`[data-testid="folder-note"][data-note-title="${title}"]`);
}

function trashedNote(page: Page, title: string) {
  return page.locator(`[data-testid="trashed-note"][data-note-title="${title}"]`);
}

async function openTrash(page: Page) {
  await sidebar(page).getByRole("button", { name: "Trash", exact: true }).click();
}

test("deleting a note moves it to the trash", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party made camp.");
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");

  await noteRow(page, "Session 1").getByRole("button", { name: "Delete Session 1" }).click();

  // Gone from the sidebar, present in the trash.
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");
  await expect(page.getByRole("status")).toContainText("Moved “Session 1” to the trash");

  await openTrash(page);
  await expect(trashedNote(page, "Session 1")).toBeVisible();
});

test("a trashed note is restored with its content intact", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party made camp beside the river.");
  await settle(page);

  await noteRow(page, "Session 1").getByRole("button", { name: "Delete Session 1" }).click();
  await openTrash(page);
  await trashedNote(page, "Session 1").getByRole("button", { name: "Restore" }).click();

  // Restoring opens the note again.
  await expect(page.getByLabel("Note title")).toHaveValue("Session 1");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The party made camp beside the river.",
  );
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");
});

test("a trashed note drops out of an entity's backlinks, and returns on restore", async ({
  page,
}) => {
  await openApp(page);

  await createNote(page, "Names");
  await typeInEditor(page, "A name to remember: Marrow");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");

  await createNote(page, "Session 5");
  await typeInEditor(page, "A letter arrived from Marrow.");
  await settle(page);

  // Reached through the mention itself, which is how a GM would get there.
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();
  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();

  // The entity page stays open while the note is deleted from the sidebar, so
  // the count updating is itself the assertion.
  await noteRow(page, "Session 5").getByRole("button", { name: "Delete Session 5" }).click();
  await expect(page.getByText(/Mentioned in 1 note/)).toBeVisible();

  await openTrash(page);
  await trashedNote(page, "Session 5").getByRole("button", { name: "Restore" }).click();
  await settle(page);

  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();
  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();
});

test("a trashed note is excluded from search", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The Ashen Crown was lost at Hollowbridge.");
  await settle(page);

  await sidebar(page).getByLabel("Search").fill("Hollowbridge");
  await sidebar(page).getByLabel("Search").press("Enter");
  await expect(page.getByRole("main").getByText("Session 1")).toBeVisible();

  await noteRow(page, "Session 1").getByRole("button", { name: "Delete Session 1" }).click();

  await sidebar(page).getByLabel("Search").fill("Hollowbridge");
  await sidebar(page).getByLabel("Search").press("Enter");
  await expect(page.getByText("No notes match.")).toBeVisible();
});

test("emptying the trash asks first, then deletes for good", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "Disposable.");
  await noteRow(page, "Session 1").getByRole("button", { name: "Delete Session 1" }).click();

  await openTrash(page);
  await page.getByRole("button", { name: "Empty trash" }).click();

  // The irreversible step is the only one that confirms.
  await expect(page.getByText(/Delete 1 note permanently\?/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, delete" }).click();

  await expect(trashedNote(page, "Session 1")).toHaveCount(0);
  await expect(page.getByText("The trash is empty.")).toBeVisible();
});

test("the trash survives a reload", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "Kept in the trash.");
  await noteRow(page, "Session 1").getByRole("button", { name: "Delete Session 1" }).click();
  await settle(page);

  await page.reload();
  await expect(sidebar(page)).toBeVisible();
  await openTrash(page);

  await expect(trashedNote(page, "Session 1")).toBeVisible();
});
