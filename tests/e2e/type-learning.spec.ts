/**
 * Teaching the app a word it does not know (PRD §8).
 *
 * The built-in list cannot contain an invented world's vocabulary. This is the
 * loop that fixes that, and it only counts if it works end to end: classify a
 * "sanctum" once by hand, and the next sanctum is guessed.
 *
 * The rules themselves are covered as pure functions and against the database
 * elsewhere. What only a browser proves is that the lesson is actually written
 * when the dialog is used the way a person uses it.
 */

import { expect, test, type Page } from "@playwright/test";
import { createNote, openApp, selectWordInEditor, typeInEditor } from "./helpers";

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Create entity" });
}

function selectedCategory(page: Page) {
  return dialog(page).locator("button.border-candle");
}

async function openCreateFor(page: Page, word: string) {
  await selectWordInEditor(page, word);
  await page.getByTestId("selection-create").click();
  await expect(dialog(page)).toBeVisible();
}

/** Writes a note and promotes `word` into an entity under `category`. */
async function classify(page: Page, title: string, sentence: string, word: string, category: string) {
  await createNote(page, title);
  await typeInEditor(page, sentence);
  await openCreateFor(page, word);
  await dialog(page).getByRole("button", { name: category, exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create entity" }).click();
  await expect(dialog(page)).toBeHidden();
}

test("a word it has never seen is guessed after you classify one", async ({ page }) => {
  await openApp(page);

  // "sanctum" is not in the built-in list, so the first one is all manual.
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ashgate is a sanctum.");
  await openCreateFor(page, "Ashgate");
  await expect(page.getByTestId("type-suggestion")).toHaveCount(0);
  await expect(selectedCategory(page)).toHaveCount(0);

  await dialog(page).getByRole("button", { name: "Locations", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create entity" }).click();
  await expect(dialog(page)).toBeHidden();

  // The second one is guessed, and says the campaign taught it.
  await createNote(page, "Session 2");
  await typeInEditor(page, "Wyrdhold is a sanctum.");
  await openCreateFor(page, "Wyrdhold");

  await expect(selectedCategory(page)).toHaveText(/Locations/);
  await expect(page.getByTestId("type-suggestion")).toContainText("sanctum");
  await expect(page.getByTestId("type-suggestion")).toContainText(
    "where you filed the last one",
  );
});

test("correcting a wrong guess teaches the correction", async ({ page }) => {
  await openApp(page);

  // "smith" ships as a Character. This campaign means something else by it.
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ashgate is a smith.");
  await openCreateFor(page, "Ashgate");
  await expect(selectedCategory(page)).toHaveText(/Characters/);

  await dialog(page).getByRole("button", { name: "Factions", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Create entity" }).click();
  await expect(dialog(page)).toBeHidden();

  // The override wins next time, over the word the app shipped with.
  await createNote(page, "Session 2");
  await typeInEditor(page, "Duskhollow is a smith.");
  await openCreateFor(page, "Duskhollow");

  await expect(selectedCategory(page)).toHaveText(/Factions/);
});

test("what it learned survives a reload", async ({ page }) => {
  await openApp(page);
  await classify(page, "Session 1", "Ashgate is a sanctum.", "Ashgate", "Locations");

  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Campaign navigation" }),
  ).toBeVisible();

  await createNote(page, "Session 2");
  await typeInEditor(page, "Wyrdhold is a sanctum.");
  await openCreateFor(page, "Wyrdhold");

  await expect(selectedCategory(page)).toHaveText(/Locations/);
});

test("it still says nothing about a sentence that classifies nothing", async ({
  page,
}) => {
  await openApp(page);
  await classify(page, "Session 1", "Ashgate is a sanctum.", "Ashgate", "Locations");

  await createNote(page, "Session 2");
  await typeInEditor(page, "Wyrdhold stood empty in the rain.");
  await openCreateFor(page, "Wyrdhold");

  // Learning a noun must not make the app eager about sentences without one.
  await expect(page.getByTestId("type-suggestion")).toHaveCount(0);
  await expect(selectedCategory(page)).toHaveCount(0);
});
