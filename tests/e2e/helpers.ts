/**
 * Shared steps for the end-to-end tests.
 *
 * Each helper performs the action the way a person would — clicking the same
 * buttons, typing into the same editor — so that a regression in the real UI
 * fails the test rather than being routed around.
 */

import { expect, type Page } from "@playwright/test";

/** Debounced save (600ms) plus the reindex pass (400ms), with headroom. */
export const SETTLE_MS = 1_600;

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Campaign navigation" })).toBeVisible();
}

/** Creates a note and gives it a title. Returns once the editor is ready. */
export async function createNote(page: Page, title: string): Promise<void> {
  // Always via the sidebar, which is present on every view. The Campaign Canon
  // offers its own "+ New note", but routing every test through one control
  // keeps failures pointing at the feature under test.
  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: "+ Quick note" })
    .click();

  const titleField = page.getByLabel("Note title");
  await expect(titleField).toBeVisible();
  // Wait for the editor to actually swap to the new note. Playwright types
  // faster than React commits the navigation, and the title field is briefly
  // still bound to the previous note — filling it then renames the wrong one.
  // A freshly created note always has an empty title, which makes this a real
  // condition rather than a sleep.
  await expect(titleField).toHaveValue("");
  await titleField.fill(title);
}

export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator(".ProseMirror");
  await editor.click();
  await page.keyboard.type(text);
  // Wait until ProseMirror has committed every character. Without this, a
  // following keyboard selection can start while the last few keystrokes are
  // still in flight and select the wrong span — which shows up as an entity
  // named "eyhaven".
  await expect(editor).toContainText(text);
}

/**
 * Selects the last occurrence of `word` in the editor.
 *
 * Done by placing a DOM Range rather than driving Shift+ArrowLeft. Keyboard
 * selection proved systematically off by one here - the first arrow after Shift
 * goes down does not extend the selection - which produced entities named "sh"
 * and "eyhaven". The behaviour under test is creating an entity *from a
 * selection*, not the browser's arrow-key handling, so a deterministic
 * selection tests the right thing. ProseMirror still syncs from the DOM
 * selection, so everything downstream is exercised for real.
 */
async function selectWordInEditor(page: Page, word: string): Promise<void> {
  const selected = await page.evaluate((target) => {
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    if (!editor) return false;
    editor.focus();

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const index = (node.textContent ?? "").lastIndexOf(target);
      if (index < 0) continue;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + target.length);

      const selection = window.getSelection();
      if (!selection) return false;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return true;
    }
    return false;
  }, word);

  expect(selected, `could not find "${word}" in the editor`).toBe(true);
}

/** Promotes an occurrence of `word` in the current note into an entity. */
export async function createEntityFromTrailingWord(
  page: Page,
  word: string,
  category: string,
): Promise<void> {
  await selectWordInEditor(page, word);

  await page.getByRole("button", { name: /^Create entity from/ }).click();

  const dialog = page.getByRole("dialog", { name: "Create entity" });
  await expect(dialog).toBeVisible();
  // The dialog pre-fills from the selection, so this both documents the
  // expected behaviour and catches a selection that grabbed the wrong span.
  await expect(dialog.getByLabel("Name")).toHaveValue(word);

  await dialog.getByRole("button", { name: category, exact: true }).click();
  await dialog.getByRole("button", { name: "Create entity" }).click();
  await expect(dialog).toBeHidden();
}

/** Waits for debounced persistence to land before asserting on stored state. */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(SETTLE_MS);
}

export function mentions(page: Page) {
  return page.locator(".entity-mention");
}

/**
 * The content area, excluding the sidebar.
 *
 * Note titles appear in both places, so backlink assertions have to say which
 * one they mean — otherwise they can pass on a sidebar entry while the entity
 * page shows nothing.
 */
export function content(page: Page) {
  return page.getByRole("main");
}

/** A note listed in the entity page's backlinks. */
export function backlink(page: Page, title: string) {
  return content(page).getByRole("button", { name: title, exact: true });
}

export async function openSidebarNote(page: Page, title: string): Promise<void> {
  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: title, exact: true })
    .click();
}

/** Reads the app's persisted state straight from IndexedDB. */
export async function readStore(page: Page, storeName: string): Promise<unknown[]> {
  return page.evaluate(async (name) => {
    const request = indexedDB.open("notesapp");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<unknown[]>((resolve) => {
      const tx = database.transaction(name, "readonly").objectStore(name).getAll();
      tx.onsuccess = () => resolve(tx.result as unknown[]);
    });
  }, storeName);
}
