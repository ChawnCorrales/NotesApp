/**
 * Nested folders in the sidebar.
 *
 * Filing is meant to be cheap and reversible: make a folder, drag a note in,
 * drag it back out. These check that, and that the destructive-looking action
 * (deleting a folder) is not actually destructive.
 */

import { expect, test, type Page } from "@playwright/test";
import { createNote, openApp, typeInEditor } from "./helpers";

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Campaign navigation" });
}

function folderRow(page: Page, name: string) {
  return page.locator(`[data-testid="folder-row"][data-folder-name="${name}"]`);
}

function noteRow(page: Page, title: string) {
  return page.locator(`[data-testid="folder-note"][data-note-title="${title}"]`);
}

/** Creates a top-level folder and names it. */
async function newFolder(page: Page, name: string) {
  await sidebar(page).getByRole("button", { name: "New folder", exact: true }).click();
  const field = page.getByLabel("Folder name");
  await field.fill(name);
  await field.press("Enter");
  await expect(folderRow(page, name)).toBeVisible();
}

test("creates, renames and nests folders", async ({ page }) => {
  await openApp(page);

  await newFolder(page, "Lore");

  // A subfolder, created from the parent's row.
  await folderRow(page, "Lore")
    .getByRole("button", { name: "New subfolder in Lore" })
    .click();
  const field = page.getByLabel("Folder name");
  await field.fill("Factions");
  await field.press("Enter");

  await expect(folderRow(page, "Factions")).toBeVisible();

  // Renaming in place.
  await folderRow(page, "Lore").getByRole("button", { name: "Rename Lore" }).click();
  const rename = page.getByLabel("Folder name");
  await rename.fill("Worldbuilding");
  await rename.press("Enter");

  await expect(folderRow(page, "Worldbuilding")).toBeVisible();
  await expect(folderRow(page, "Lore")).toHaveCount(0);
});

test("files a note into a folder and back out", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party made camp.");
  await newFolder(page, "Sessions");

  // Notes start unfiled.
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");

  await noteRow(page, "Session 1")
    .getByRole("button", { name: "Move Session 1" })
    .click();
  await page.getByRole("dialog", { name: "Move Session 1" }).getByRole("button", { name: "Sessions" }).click();

  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");
  await folderRow(page, "Sessions").getByRole("button", { name: "Expand Sessions" }).click();
  await expect(noteRow(page, "Session 1")).toBeVisible();

  // And back to the top level.
  await noteRow(page, "Session 1")
    .getByRole("button", { name: "Move Session 1" })
    .click();
  await page
    .getByRole("dialog", { name: "Move Session 1" })
    .getByRole("button", { name: "Top level" })
    .click();

  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");
});

test("dragging a note onto a folder files it", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await newFolder(page, "Sessions");

  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");

  await noteRow(page, "Session 1").dragTo(folderRow(page, "Sessions"));

  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");
  await folderRow(page, "Sessions").getByRole("button", { name: "Expand Sessions" }).click();
  await expect(noteRow(page, "Session 1")).toBeVisible();
});

test("dragging a note onto Unfiled removes it from its folder", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await newFolder(page, "Sessions");
  await noteRow(page, "Session 1").dragTo(folderRow(page, "Sessions"));
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");

  await folderRow(page, "Sessions").getByRole("button", { name: "Expand Sessions" }).click();
  await noteRow(page, "Session 1").dragTo(page.getByTestId("unfiled-drop"));

  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");
});

test("refuses to move a folder inside its own subtree", async ({ page }) => {
  await openApp(page);

  await newFolder(page, "Lore");
  await folderRow(page, "Lore")
    .getByRole("button", { name: "New subfolder in Lore" })
    .click();
  const field = page.getByLabel("Folder name");
  await field.fill("Factions");
  await field.press("Enter");

  // The picker does not offer the invalid destination in the first place.
  await folderRow(page, "Lore").getByRole("button", { name: "Move Lore" }).click();
  const dialog = page.getByRole("dialog", { name: "Move Lore" });
  await expect(dialog.getByRole("button", { name: "Lore / Factions" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  // And the drag path is refused with an explanation.
  await folderRow(page, "Lore").dragTo(folderRow(page, "Factions"));

  await expect(page.getByRole("status")).toContainText("cannot be moved inside itself");
  await expect(folderRow(page, "Lore")).toBeVisible();
  await expect(folderRow(page, "Factions")).toBeVisible();
});

test("deleting a folder keeps its contents", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await newFolder(page, "Sessions");
  await noteRow(page, "Session 1").dragTo(folderRow(page, "Sessions"));
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");

  await folderRow(page, "Sessions").getByRole("button", { name: "Delete Sessions" }).click();

  await expect(folderRow(page, "Sessions")).toHaveCount(0);
  // The note came back to the top level rather than being deleted with it.
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (1)");
  await expect(page.getByRole("status")).toContainText("moved up a level");
});

test("folders and filing survive a reload", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await newFolder(page, "Sessions");
  await noteRow(page, "Session 1").dragTo(folderRow(page, "Sessions"));
  await expect(page.getByTestId("unfiled-drop")).toContainText("Unfiled (0)");

  await page.reload();
  await expect(sidebar(page)).toBeVisible();

  await expect(folderRow(page, "Sessions")).toBeVisible();
  await folderRow(page, "Sessions").getByRole("button", { name: "Expand Sessions" }).click();
  await expect(noteRow(page, "Session 1")).toBeVisible();
});
