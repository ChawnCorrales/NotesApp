/**
 * Getting rid of an entity (PRD §12).
 *
 * Two ways out, and which one the user reaches for matters. Merging keeps
 * everything the duplicate collected; deleting throws it away. Both are here
 * because the interesting assertions are about what *survives* — above all the
 * writing, which neither operation may touch.
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
  settle,
  typeInEditor,
} from "./helpers";

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Campaign navigation" });
}

/**
 * Opens a Canon section.
 *
 * Anchored, because "Characters" is also a substring of "Player Characters" and
 * an unanchored match resolves to both.
 */
function section(page: Page, name: string) {
  return sidebar(page).getByRole("button", { name: new RegExp(`^${name}\\b`) });
}

/**
 * Opens an entity from its Canon section.
 *
 * Selected by exact name rather than card text: "Marrow" appears inside "Old
 * Marrow", so a text filter matches the wrong card in precisely the duplicate
 * scenario these tests are about.
 */
async function openEntity(page: Page, sectionName: string, name: string) {
  await section(page, sectionName).click();
  await content(page).locator(`[data-entity-name="${name}"]`).click();
  await expect(content(page).getByLabel("Entity name")).toHaveValue(name);
}

test("an entity can be deleted, and the writing is untouched", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await content(page).getByTestId("delete-entity").click();
  // The confirmation says what goes with it rather than just asking twice.
  await expect(content(page)).toContainText("1 backlink");
  await content(page).getByTestId("confirm-delete-entity").click();

  // Landed in the section, which no longer lists it.
  await expect(content(page).getByTestId("section-entity")).toHaveCount(0);

  await openSidebarNote(page, "Session 1");
  await expect(page.locator(".ProseMirror")).toContainText(
    "The party meets Marrow at dusk.",
  );
  // The words stay; they simply stop lighting up.
  await expect(mentions(page)).toHaveCount(0);
});

test("deleting is refused until confirmed", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await content(page).getByTestId("delete-entity").click();
  await content(page).getByRole("button", { name: "Cancel" }).click();

  await expect(content(page).getByLabel("Entity name")).toHaveValue("Marrow");
  await openSidebarNote(page, "Session 1");
  await expect(mentions(page)).toHaveCount(1);
});

test("merging a duplicate keeps the mentions both of them collected", async ({
  page,
}) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  // A second name for the same person. Deliberately not "Old Marrow": once
  // Marrow is recognised it renders as its own element, so no single text node
  // holds the phrase and the selection helper cannot find it.
  await createNote(page, "Session 2");
  await typeInEditor(page, "A letter arrives from Blackthumb.");
  await createEntityFromTrailingWord(page, "Blackthumb", "Characters");
  await settle(page);

  await openEntity(page, "Characters", "Blackthumb");
  await content(page).getByTestId("merge-entity").click();
  await content(page).getByLabel("Merge into").selectOption({ label: "Marrow" });
  await content(page).getByRole("button", { name: "Merge", exact: true }).click();

  // Landed on the survivor, which now answers for both notes.
  await expect(content(page).getByLabel("Entity name")).toHaveValue("Marrow");
  await settle(page);
  await expect(backlink(page, "Session 1")).toBeVisible();
  await expect(backlink(page, "Session 2")).toBeVisible();

  // And the old name still resolves, because it survives as an alias.
  await openSidebarNote(page, "Session 2");
  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page).first()).toHaveText("Blackthumb");
});

test("merging leaves one entity where there were two", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Marrow and Blackthumb are the same person.");
  await createEntityFromTrailingWord(page, "Blackthumb", "Characters");
  await settle(page);
  await openSidebarNote(page, "Session 1");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await openEntity(page, "Characters", "Blackthumb");
  await content(page).getByTestId("merge-entity").click();
  await content(page).getByLabel("Merge into").selectOption({ label: "Marrow" });
  await content(page).getByRole("button", { name: "Merge", exact: true }).click();
  await expect(content(page).getByLabel("Entity name")).toHaveValue("Marrow");

  await section(page, "Characters").click();
  await expect(content(page).getByTestId("section-entity")).toHaveCount(1);
});

test("merge is offered before delete, and unavailable with nothing to merge into", async ({
  page,
}) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow at dusk.");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  // The only entity in the campaign: there is nowhere to merge it.
  await expect(content(page).getByTestId("merge-entity")).toBeDisabled();
  await expect(content(page).getByTestId("delete-entity")).toBeEnabled();
});
