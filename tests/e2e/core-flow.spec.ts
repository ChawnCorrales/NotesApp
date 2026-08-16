/**
 * The core product flow (PRD section 61).
 *
 * This is the scenario the PRD names as the definition of success: write, flag
 * a name once, and have later mentions recognise themselves and accumulate into
 * a navigable knowledge base. If this test passes, the product hypothesis
 * survives; if it fails, nothing else in the suite matters much.
 */

import { expect, test } from "@playwright/test";
import {
  backlink,
  createEntityFromTrailingWord,
  createNote,
  mentions,
  openApp,
  openSidebarNote,
  settle,
  typeInEditor,
} from "./helpers";

test("flag a name once, and later mentions link themselves", async ({ page }) => {
  await openApp(page);

  // 1-3. Write a note and promote "Marrow" into an NPC.
  await createNote(page, "Session 1");
  await typeInEditor(page, "The party arrives in Greyhaven and meets Marrow");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");

  // Creating the entity opens its page.
  await expect(page.getByLabel("Entity name")).toHaveValue("Marrow");

  // 4-6. A brand new note recognises the name with no further action.
  await createNote(page, "Session 2");
  await typeInEditor(page, "A letter arrives, sealed and signed by Marrow");

  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page).first()).toHaveText("Marrow");
  await expect(mentions(page).first()).toHaveAttribute("data-entity-theme", "npc");

  await settle(page);

  // 7-8. Following the mention reaches the entity, which lists both notes.
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();

  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();
  await expect(backlink(page, "Session 2")).toBeVisible();
  await expect(backlink(page, "Session 1")).toBeVisible();

  // 9. Back returns to the note we came from.
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByLabel("Note title")).toHaveValue("Session 2");

  // 10. Delete the word. It sits at the end of the note, so backspacing over it
  // is exactly what a user would do.
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < "Marrow".length; i++) {
    await page.keyboard.press("Backspace");
  }

  // 11. The mention - and the backlink it justified - are gone.
  await expect(mentions(page)).toHaveCount(0);
  await settle(page);

  await openSidebarNote(page, "Session 1");
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();

  await expect(page.getByText(/Mentioned in 1 note/)).toBeVisible();
  await expect(backlink(page, "Session 2")).toBeHidden();
  await expect(backlink(page, "Session 1")).toBeVisible();

  // 12. All of it survives a reload - there is no server holding any of this.
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Campaign navigation" }),
  ).toBeVisible();

  await openSidebarNote(page, "Session 1");
  await expect(page.getByLabel("Note title")).toHaveValue("Session 1");
  await expect(mentions(page)).toHaveCount(1);

  await openSidebarNote(page, "Session 2");
  await expect(page.locator(".ProseMirror")).toContainText("A letter arrives");
  await expect(mentions(page)).toHaveCount(0);
});

test("an entity created after the fact backlinks notes already written", async ({
  page,
}) => {
  await openApp(page);

  // The GM has been writing about Greyhaven for weeks before flagging it.
  await createNote(page, "Old Session");
  await typeInEditor(page, "They made camp outside Greyhaven and waited.");
  await settle(page);

  await createNote(page, "New Session");
  await typeInEditor(page, "The road leads back to Greyhaven");
  await createEntityFromTrailingWord(page, "Greyhaven", "Locations");

  await settle(page);

  // The older note must appear too, without ever being reopened or edited.
  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();
  await expect(backlink(page, "Old Session")).toBeVisible();
});

test("aliases resolve to the same entity", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Court");
  await typeInEditor(page, "The court answers to the Red Queen");
  await createEntityFromTrailingWord(page, "Red Queen", "Characters");

  const aliasField = page.getByPlaceholder(/Add alias/);
  await aliasField.fill("Verena");
  await aliasField.press("Enter");

  await createNote(page, "Later");
  await typeInEditor(page, "Verena refused to answer the summons.");

  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page).first()).toHaveText("Verena");

  await settle(page);
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();

  // Both spellings point at one entity, so both notes are listed.
  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();
});

test("does not match an entity name inside a longer word", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Boundaries");
  await typeInEditor(page, "A name to remember: Ash");
  await createEntityFromTrailingWord(page, "Ash", "Characters");

  await createNote(page, "Prose");
  await typeInEditor(
    page,
    "The Ashen Crown lay in ashes, and a flash lit Ashford. Only Ash remained.",
  );

  // Exactly one match: the standalone name, not the four words containing it.
  await expect(mentions(page)).toHaveCount(1);
  await expect(mentions(page).first()).toHaveText("Ash");
});
