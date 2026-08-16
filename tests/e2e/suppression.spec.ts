/**
 * "Not this entity" in the real editor (PRD section 32).
 *
 * Recognition is text matching, so it will sometimes be wrong. What matters is
 * that correcting it is cheap, narrow, and permanent - the user should not have
 * to make the same correction twice.
 */

import { expect, test } from "@playwright/test";
import {
  backlink,
  createEntityFromTrailingWord,
  createNote,
  mentions,
  openApp,
  openSidebarNote,
  readStore,
  settle,
  typeInEditor,
} from "./helpers";

test("rejecting one occurrence leaves the others recognised", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Names");
  await typeInEditor(page, "A name to remember: Ash");
  await createEntityFromTrailingWord(page, "Ash", "Characters");

  await createNote(page, "Session 5");
  await typeInEditor(page, "Ash spoke first. Ash left later. Ash never returned.");
  await expect(mentions(page)).toHaveCount(3);
  await settle(page);

  // The middle one is a different Ash - a tavern, not the NPC.
  await mentions(page).nth(1).click();
  await page.getByTestId("popover-not-this-entity").click();

  await expect(mentions(page)).toHaveCount(2);
  await settle(page);

  // The correction is recorded, not inferred.
  const suppressions = await readStore(page, "mentionSuppressions");
  expect(suppressions).toHaveLength(1);

  // And it survives a reload.
  await page.reload();
  await openSidebarNote(page, "Session 5");
  await expect(mentions(page)).toHaveCount(2);
});

test("a rejected occurrence does not disable the entity elsewhere", async ({
  page,
}) => {
  await openApp(page);

  await createNote(page, "Names");
  await typeInEditor(page, "A name to remember: Ash");
  await createEntityFromTrailingWord(page, "Ash", "Characters");

  await createNote(page, "Session 5");
  await typeInEditor(page, "Ash spoke first. Ash left later.");
  await expect(mentions(page)).toHaveCount(2);
  await settle(page);

  await mentions(page).first().click();
  await page.getByTestId("popover-not-this-entity").click();
  // Wait on the visible consequence rather than a fixed delay, so the write
  // that follows cannot start while the suppression is still in flight.
  await expect(mentions(page)).toHaveCount(1);
  await settle(page);

  // Another note is untouched by the correction.
  await createNote(page, "Session 6");
  await typeInEditor(page, "Ash appeared again at the gate.");
  await expect(mentions(page)).toHaveCount(1);
});

test("rejecting the only mention removes the note's backlink", async ({ page }) => {
  await openApp(page);

  await createNote(page, "Names");
  await typeInEditor(page, "A name to remember: Ash");
  await createEntityFromTrailingWord(page, "Ash", "Characters");

  await createNote(page, "Session 5");
  await typeInEditor(page, "Ash spoke once and left.");
  await expect(mentions(page)).toHaveCount(1);
  await settle(page);

  await mentions(page).first().click();
  await page.getByTestId("popover-not-this-entity").click();
  await expect(mentions(page)).toHaveCount(0);
  await settle(page);

  await openSidebarNote(page, "Names");
  await expect(mentions(page)).toHaveCount(1);
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();

  // Only the note that introduced the name remains.
  await expect(page.getByText(/Mentioned in 1 note/)).toBeVisible();
  await expect(backlink(page, "Session 5")).toBeHidden();
});
