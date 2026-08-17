/**
 * Guessing a category from the writing (PRD §8).
 *
 * The rules themselves are covered exhaustively as pure functions in
 * `tests/unit/type-inference.test.ts`. What only a browser can prove is that the
 * note's text reaches the dialog at all, that the guess pre-selects a category
 * the campaign actually has, and — the part that matters — that it remains a
 * suggestion rather than a decision.
 */

import { expect, test, type Page } from "@playwright/test";
import { createNote, openApp, selectWordInEditor, typeInEditor } from "./helpers";

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Create entity" });
}

/** Selects `word` and opens the create dialog through the selection menu. */
async function openCreateFor(page: Page, word: string) {
  await selectWordInEditor(page, word);
  await page.getByTestId("selection-create").click();
  await expect(dialog(page)).toBeVisible();
}

/** The category currently selected, read from the highlighted button. */
function selectedCategory(page: Page) {
  return dialog(page).locator("button.border-candle");
}

test("a stated category is pre-selected, with the word it came from", async ({
  page,
}) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Ash is a god of the deep roads.");

  await openCreateFor(page, "Ash");

  await expect(page.getByTestId("type-suggestion")).toContainText("Deities");
  await expect(page.getByTestId("type-suggestion")).toContainText("god");
  await expect(selectedCategory(page)).toHaveText(/Deities/);
});

test("the guess is a default, not a decision", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Marrow is a merchant in Greyhaven.");

  await openCreateFor(page, "Marrow");
  await expect(selectedCategory(page)).toHaveText(/Characters/);

  // Overriding must stick, and the explanation must stop claiming otherwise.
  await dialog(page).getByRole("button", { name: "Factions", exact: true }).click();
  await expect(selectedCategory(page)).toHaveText(/Factions/);
  await expect(page.getByTestId("type-suggestion")).toHaveCount(0);

  await dialog(page).getByRole("button", { name: "Create entity" }).click();
  await expect(dialog(page)).toBeHidden();

  // The entity page reflects the override, not the guess.
  await expect(page.getByLabel("Entity name")).toHaveValue("Marrow");
  await expect(page.getByLabel("Category")).toHaveValue(/.+/);
  const category = await page.getByLabel("Category").inputValue();
  const chosen = await page
    .getByLabel("Category")
    .locator(`option[value="${category}"]`)
    .textContent();
  expect(chosen).toBe("Factions");
});

test("accepting the guess files the entity under it", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "They rode to the city of Greyhaven.");

  await openCreateFor(page, "Greyhaven");
  await expect(selectedCategory(page)).toHaveText(/Locations/);

  await dialog(page).getByRole("button", { name: "Create entity" }).click();
  await expect(dialog(page)).toBeHidden();

  const category = await page.getByLabel("Category").inputValue();
  const chosen = await page
    .getByLabel("Category")
    .locator(`option[value="${category}"]`)
    .textContent();
  expect(chosen).toBe("Locations");
});

test("nothing is pre-selected when the note does not say", async ({ page }) => {
  await openApp(page);
  await createNote(page, "Session 1");
  await typeInEditor(page, "Marrow walked in and sat down without a word.");

  await openCreateFor(page, "Marrow");

  // No guess, no explanation, and Create stays disabled until a human chooses —
  // which is the correct outcome, not a degraded one.
  await expect(page.getByTestId("type-suggestion")).toHaveCount(0);
  await expect(selectedCategory(page)).toHaveCount(0);
  await expect(
    dialog(page).getByRole("button", { name: "Create entity" }),
  ).toBeDisabled();
});

test("creating from a Canon section still uses that section", async ({ page }) => {
  await openApp(page);

  // No surrounding writing here, so there is nothing to infer from and the
  // section the user is standing in must win.
  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: /Locations/ })
    .click();
  await page.getByRole("button", { name: "+ New" }).click();

  await expect(dialog(page)).toBeVisible();
  await expect(selectedCategory(page)).toHaveText(/Locations/);
  await expect(page.getByTestId("type-suggestion")).toHaveCount(0);
});
