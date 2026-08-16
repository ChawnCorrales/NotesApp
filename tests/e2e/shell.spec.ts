/**
 * The workspace shell: Campaign Canon, sections, tabs, toolbar, global create.
 *
 * These check the app behaves like a workspace rather than a single document —
 * that things stay open, that the Canon is browsable, and that a section can be
 * reshaped without touching what is filed under it.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  createEntityFromTrailingWord,
  createNote,
  openApp,
  typeInEditor,
} from "./helpers";

function sections(page: Page) {
  return page.locator('[data-testid="canon-section"]');
}

function tabs(page: Page) {
  return page.locator('[data-testid="tab"]');
}

function section(page: Page, name: string) {
  return page.locator(`[data-testid="canon-section"][data-section-name="${name}"]`);
}

test("opens on the Campaign Canon with a card per section", async ({ page }) => {
  await openApp(page);

  await expect(sections(page)).toHaveCount(12);
  await expect(section(page, "Characters")).toBeVisible();
  await expect(section(page, "Locations")).toBeVisible();
  await expect(section(page, "Deities")).toBeVisible();
});

test("a section card opens that section, and counts reflect the notes", async ({
  page,
}) => {
  await openApp(page);

  // Nothing filed yet.
  await expect(section(page, "Characters")).toContainText("0 entries");

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party meets Marrow");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");

  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: "❦ All sections" })
    .click();

  await expect(section(page, "Characters")).toContainText("1 entry");

  await section(page, "Characters").getByRole("button").first().click();
  await expect(page.getByLabel("Section name")).toHaveValue("Characters");
  await expect(page.locator('[data-testid="section-entity"]')).toHaveCount(1);
});

test("sections can be renamed, recoloured and hidden", async ({ page }) => {
  await openApp(page);

  await section(page, "Deities").getByRole("button", { name: "Edit Deities" }).click();

  const nameField = page.getByLabel("Section name");
  await nameField.fill("Powers That Be");
  await page.getByRole("button", { name: "Icon ♆" }).click();
  // Enter commits, same as the Done button. Used here because the card sits low
  // in a grid that reflows as each edit saves, and clicking mid-reflow is a
  // fight with the layout rather than a test of the feature.
  await nameField.press("Enter");

  await expect(section(page, "Powers That Be")).toBeVisible();
  await expect(section(page, "Deities")).toHaveCount(0);

  // Hiding takes it off the board without destroying anything.
  await section(page, "Powers That Be")
    .getByRole("button", { name: "Edit Powers That Be" })
    .click();
  await page.getByRole("button", { name: "Hide" }).click();
  await page.getByLabel("Section name").press("Enter");

  await expect(sections(page)).toHaveCount(11);
  await expect(page.getByRole("button", { name: /Show hidden \(1\)/ })).toBeVisible();
});

test("a new section can be created and ordered", async ({ page }) => {
  await openApp(page);

  await page.getByRole("button", { name: "+ New section" }).click();
  const nameField = page.getByLabel("Section name");
  await nameField.fill("Ships");
  await nameField.press("Enter");

  await expect(section(page, "Ships")).toBeVisible();
  await expect(sections(page)).toHaveCount(13);

  const names = () =>
    sections(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-section-name")),
    );

  // A new section lands last.
  await expect.poll(names).toEqual(expect.arrayContaining(["Ships"]));
  expect((await names()).at(-1)).toBe("Ships");

  await section(page, "Ships").getByRole("button", { name: "Move Ships earlier" }).click();

  // Polled, because the reorder is a database write the grid re-renders from —
  // reading the DOM straight after the click races it.
  await expect.poll(async () => (await names()).at(-2)).toBe("Ships");
});

test("tabs keep separate views open", async ({ page }) => {
  await openApp(page);

  await expect(tabs(page)).toHaveCount(1);

  await createNote(page, "Session 1");
  await typeInEditor(page, "The party made camp.");

  // A second tab starts on the Canon, leaving the note where it was.
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(tabs(page)).toHaveCount(2);
  await expect(sections(page).first()).toBeVisible();

  await tabs(page).first().click();
  await expect(page.getByLabel("Note title")).toHaveValue("Session 1");

  await tabs(page).nth(1).click();
  await expect(sections(page).first()).toBeVisible();
});

test("closing a tab returns to its neighbour", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Session 1");
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(tabs(page)).toHaveCount(2);

  await tabs(page).nth(1).getByRole("button", { name: /^Close/ }).click();

  await expect(tabs(page)).toHaveCount(1);
  await expect(page.getByLabel("Note title")).toHaveValue("Session 1");
});

test("the toolbar navigates and the global button creates", async ({ page }) => {
  await openApp(page);

  await page.getByRole("menuitem", { name: "View" }).click();
  // "Mind map" appears twice in this menu: once to navigate, once under
  // "Start on". The first is the navigation item.
  await page.getByRole("menuitem", { name: "Mind map" }).first().click();
  await expect(page.getByText("The map is empty.")).toBeVisible();

  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Campaign canon" }).first().click();
  await expect(sections(page).first()).toBeVisible();

  await page.getByTestId("global-create").click();
  await page.getByRole("menuitem", { name: "New note" }).click();
  await expect(page.getByLabel("Note title")).toBeVisible();
});

test("the sidebar can be hidden from the View menu", async ({ page }) => {
  await openApp(page);

  const sidebar = page.getByRole("navigation", { name: "Campaign navigation" });
  await expect(sidebar).toBeVisible();

  await page.getByRole("menuitem", { name: "View" }).click();
  await page.getByRole("menuitem", { name: "Hide sidebar" }).click();

  await expect(sidebar).toBeHidden();
});
