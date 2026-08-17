/**
 * The floating selection menu (PRD §8).
 *
 * Selecting a phrase is the product's central gesture, so the menu is tested
 * through what it produces rather than how it looks: linking must make the
 * phrase recognised everywhere, and ignoring must remove exactly one mention
 * and leave the others.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  backlink,
  content,
  createEntityFromTrailingWord,
  createNote,
  mentions,
  openApp,
  openSidebarNote,
  selectWordInEditor,
  settle,
  typeInEditor,
} from "./helpers";

function menu(page: Page) {
  return page.getByTestId("selection-menu");
}

test("the menu appears at a selection and offers create and link", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");

  await selectWordInEditor(page, "Marrow");

  await expect(menu(page)).toBeVisible();
  await expect(page.getByTestId("selection-create")).toBeVisible();
  await expect(page.getByTestId("selection-link")).toBeVisible();
  // Nothing is recognised here yet, so there is nothing to ignore.
  await expect(page.getByTestId("selection-ignore")).toHaveCount(0);
});

test("Escape dismisses the menu without changing anything", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");

  await selectWordInEditor(page, "Marrow");
  await expect(menu(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(menu(page)).toBeHidden();
  await expect(mentions(page)).toHaveCount(0);
});

test("the menu closes for good after acting on the selection", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ash spoke. Later Ash left. Ash returned.");
  await createEntityFromTrailingWord(page, "Ash", "Characters");
  await settle(page);

  await openSidebarNote(page, "Session 1");
  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 1");

  await selectWordInEditor(page, "Ash");
  await page.getByTestId("selection-ignore").click();

  // Acting on a selection leaves that selection standing, and ignoring changes
  // the vocabulary — which repaints the editor a moment later, off the live
  // query. The menu must not ride back in on that repaint.
  await expect(menu(page)).toBeHidden();
  await settle(page);
  await expect(menu(page)).toBeHidden();
});

test("dismissing does not block the menu on the next selection", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");

  await selectWordInEditor(page, "dusk");
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();

  // Suppressing the menu forever would be a worse bug than showing it too often.
  await selectWordInEditor(page, "party");
  await expect(menu(page)).toBeVisible();
});

test("linking a phrase to an existing entity recognises it everywhere", async ({
  page,
}) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  // A second note calls him something else entirely.
  await createNote(page, "Session 2");
  await typeInEditor(page, "A letter arrives from the shopkeeper.");
  await expect(mentions(page)).toHaveCount(0);

  await selectWordInEditor(page, "shopkeeper");
  await page.getByTestId("selection-link").click();
  await page
    .getByTestId("selection-link-option")
    .filter({ hasText: "Marrow" })
    .click();

  // The phrase lights up in the note being written...
  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page).first()).toHaveText("shopkeeper");
  await settle(page);

  // ...and the entity now counts both notes, which is the point of an alias
  // over a one-off link.
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();
  await expect(backlink(page, "Session 1")).toBeVisible();
  await expect(backlink(page, "Session 2")).toBeVisible();
});

test("a linked phrase is recognised in notes written later", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await createNote(page, "Session 2");
  await typeInEditor(page, "The shopkeeper waits.");
  await selectWordInEditor(page, "shopkeeper");
  await page.getByTestId("selection-link").click();
  await page
    .getByTestId("selection-link-option")
    .filter({ hasText: "Marrow" })
    .click();
  await settle(page);

  await createNote(page, "Session 3");
  await typeInEditor(page, "Later the shopkeeper closes up.");

  await expect(mentions(page)).toHaveCount(1);
});

test("Ignore removes one recognised mention and leaves the others", async ({
  page,
}) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ash spoke. Later Ash left. Ash returned.");
  await createEntityFromTrailingWord(page, "Ash", "Characters");
  await settle(page);

  // Creating an entity opens its page; the menu lives in the editor.
  await openSidebarNote(page, "Session 1");
  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 1");

  await expect(mentions(page)).toHaveCount(3);

  // Select the last one; Ignore is offered because the selection covers it.
  await selectWordInEditor(page, "Ash");
  await expect(page.getByTestId("selection-ignore")).toBeVisible();
  await page.getByTestId("selection-ignore").click();

  await expect(mentions(page)).toHaveCount(2);
  await settle(page);

  // Still an entity, still recognised elsewhere — this rejects an occurrence,
  // not the entity.
  await createNote(page, "Session 2");
  await typeInEditor(page, "Ash appears again.");
  await expect(mentions(page)).toHaveCount(1);
});

test("the ignored occurrence stays ignored after a reload", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ash spoke. Later Ash left. Ash returned.");
  await createEntityFromTrailingWord(page, "Ash", "Characters");
  await settle(page);

  // Creating an entity opens its page; the menu lives in the editor.
  await openSidebarNote(page, "Session 1");
  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 1");

  await selectWordInEditor(page, "Ash");
  await page.getByTestId("selection-ignore").click();
  await expect(mentions(page)).toHaveCount(2);
  await settle(page);

  await page.reload();
  await page
    .getByTestId("recent-notes")
    .getByRole("button", { name: "Session 1", exact: true })
    .click();

  await expect(content(page).getByLabel("Note title")).toHaveValue("Session 1");
  await expect(mentions(page)).toHaveCount(2);
});
