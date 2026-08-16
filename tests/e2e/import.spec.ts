/**
 * Importing Markdown through the real file picker.
 *
 * The promise being tested: bring your existing notes in, and they immediately
 * behave like notes written here - recognised, backlinked, navigable.
 */

import { expect, test, type Page } from "@playwright/test";
import {
  backlink,
  createEntityFromTrailingWord,
  createNote,
  mentions,
  openApp,
  settle,
  typeInEditor,
} from "./helpers";

function markdownFile(name: string, content: string) {
  return { name, mimeType: "text/markdown", buffer: Buffer.from(content, "utf-8") };
}

async function importFiles(
  page: Page,
  files: ReturnType<typeof markdownFile>[],
): Promise<void> {
  await page.getByTestId("import-markdown-input").setInputFiles(files);
  await expect(page.getByTestId("import-summary")).toBeVisible();
}

test("imported notes are recognised and backlinked", async ({ page }) => {
  await openApp(page);

  // An entity the GM has already flagged.
  await createNote(page, "Names");
  await typeInEditor(page, "A name to remember: Marrow");
  await createEntityFromTrailingWord(page, "Marrow", "Characters");
  await settle(page);

  await importFiles(page, [
    markdownFile(
      "session-12.md",
      "# Session 12\n\nA letter arrived, signed by Marrow.\n\n- [ ] Decide who killed Marrow\n",
    ),
  ]);

  // The import opens the first note it created.
  await expect(page.getByLabel("Note title")).toHaveValue("Session 12");
  await expect(page.locator(".ProseMirror")).toContainText("A letter arrived");

  // Two mentions in the imported note: the sentence and the task.
  await expect(mentions(page)).toHaveCount(2);

  await settle(page);
  await mentions(page).first().click();
  await page.getByTestId("popover-open-entity").click();

  await expect(page.getByText(/Mentioned in 2 notes/)).toBeVisible();
  await expect(backlink(page, "Session 12")).toBeVisible();
});

test("imports several files at once and reports the count", async ({ page }) => {
  await openApp(page);

  await importFiles(page, [
    markdownFile("a.md", "# Alpha\n\nFirst."),
    markdownFile("b.md", "# Beta\n\nSecond."),
    markdownFile("c.md", "# Gamma\n\nThird."),
  ]);

  await expect(page.getByTestId("import-summary")).toContainText("Imported 3 notes");

  const sidebar = page.getByRole("navigation", { name: "Campaign navigation" });
  await expect(sidebar.getByRole("button", { name: "Alpha", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Beta", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Gamma", exact: true })).toBeVisible();
});

test("imported structure survives, including tables and tasks", async ({ page }) => {
  await openApp(page);

  await importFiles(page, [
    markdownFile(
      "cast.md",
      [
        "---",
        "title: Greyhaven Cast",
        "---",
        "",
        "## Merchants",
        "",
        "| Name | Role |",
        "| --- | --- |",
        "| Marrow | Curiosities |",
        "",
        "- [x] Name the inn",
        "- [ ] Stat the innkeeper",
      ].join("\n"),
    ),
  ]);

  // Front matter wins over the heading.
  await expect(page.getByLabel("Note title")).toHaveValue("Greyhaven Cast");

  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("table")).toHaveCount(1);
  await expect(editor.locator('ul[data-type="taskList"] li')).toHaveCount(2);
  await expect(editor.locator("h2")).toContainText("Merchants");

  // The checked state survived the round trip. Asserted on the checkbox the
  // user sees rather than on a data attribute, which the task node view does
  // not mirror onto the list item.
  await expect(editor.getByRole("checkbox", { name: /Name the inn/ })).toBeChecked();
  await expect(
    editor.getByRole("checkbox", { name: /Stat the innkeeper/ }),
  ).not.toBeChecked();
});

test("imported notes persist across a reload", async ({ page }) => {
  await openApp(page);

  await importFiles(page, [markdownFile("lore.md", "# Lore\n\nThe Ashen Crown was lost.")]);
  await expect(page.getByLabel("Note title")).toHaveValue("Lore");
  await settle(page);

  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Campaign navigation" }),
  ).toBeVisible();

  await page
    .getByRole("navigation", { name: "Campaign navigation" })
    .getByRole("button", { name: "Lore", exact: true })
    .click();

  await expect(page.locator(".ProseMirror")).toContainText("The Ashen Crown was lost.");
});
