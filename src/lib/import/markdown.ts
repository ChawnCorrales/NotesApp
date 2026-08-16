/**
 * Markdown import.
 *
 * A GM arriving with an existing pile of notes is the most likely way this app
 * ever gets used on a real campaign, and re-typing them is not an option. Every
 * imported note becomes an ordinary note, so recognition, backlinks, and the
 * graph apply to it exactly as if it had been typed here.
 *
 * The route is Markdown -> HTML -> TipTap JSON rather than Markdown -> JSON
 * directly. TipTap 3 can parse Markdown, but only via a lexer supplied per
 * extension, and it ships no tokenizer of its own. Going through HTML instead
 * means TipTap's own `parseHTML` rules decide how each construct maps into the
 * schema, which is the definition we actually want to match.
 */

import MarkdownIt from "markdown-it";
import { generateJSON, getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { createContentExtensions } from "../editor/extensions";
import { flattenDoc } from "../editor/doc-text";
import { extractTasks, type ExtractedTask } from "../editor/tasks";

export interface ParsedMarkdown {
  title: string;
  /** TipTap document, ready to store as a note's `content`. */
  doc: JSONContent;
  /** Flattened text, matching exactly what the editor would compute. */
  text: string;
  /** Checkbox items found in the file, for the global task viewer. */
  tasks: ExtractedTask[];
  /** Where the title came from, so the UI can explain itself if needed. */
  titleSource: "frontmatter" | "heading" | "filename";
}

/**
 * `html: false` is a security decision, not a formatting one.
 *
 * Imported files are untrusted input. Passing raw HTML through would let a
 * `.md` file inject arbitrary markup into a note; TipTap would strip most of
 * it, but relying on a downstream sanitiser is the wrong place to draw the
 * line. Markdown constructs are all this needs to understand.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TASK_MARKER = /^\[([ xX])\]\s+/;

interface FrontMatter {
  title?: string;
  body: string;
}

/**
 * Splits off a leading YAML front matter block.
 *
 * Only `title` is read. Parsing arbitrary YAML would mean pulling in a parser
 * to support keys nothing consumes yet; the block is stripped either way so it
 * never leaks into the note body as stray text.
 */
export function splitFrontMatter(source: string): FrontMatter {
  const match = source.match(FRONT_MATTER);
  if (!match) return { body: source };

  const titleLine = match[1]
    .split(/\r?\n/)
    .find((line) => /^title\s*:/i.test(line));

  const title = titleLine
    ?.replace(/^title\s*:/i, "")
    .trim()
    .replace(/^["']|["']$/g, "");

  return { title: title || undefined, body: source.slice(match[0].length) };
}

/**
 * Rewrites GFM checkbox lists into the markup TipTap's task list expects.
 *
 * markdown-it has no task-list support, so `- [ ] thing` arrives as a plain
 * list item whose text begins with "[ ] ". Without this the checkboxes import
 * as literal brackets and never reach the task viewer.
 */
function convertTaskLists(root: Document): void {
  for (const list of Array.from(root.querySelectorAll("ul"))) {
    const items = Array.from(list.children).filter(
      (child) => child.tagName.toLowerCase() === "li",
    );

    const taskItems = items.filter((item) => TASK_MARKER.test(item.textContent ?? ""));
    if (taskItems.length === 0) continue;

    list.setAttribute("data-type", "taskList");

    for (const item of items) {
      const text = item.textContent ?? "";
      const match = text.match(TASK_MARKER);
      if (!match) continue;

      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", match[1] === " " ? "false" : "true");

      // Strip the marker from the first text node rather than resetting the
      // item's content, so inline formatting inside the task survives.
      const walker = root.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const firstText = walker.nextNode();
      if (firstText?.textContent) {
        firstText.textContent = firstText.textContent.replace(TASK_MARKER, "");
      }
    }
  }
}

/**
 * Removes a leading H1 when it has been promoted to the note's title, so the
 * heading does not appear twice once the note is opened.
 */
function removeLeadingHeading(root: Document): void {
  const body = root.body;
  const first = body.firstElementChild;
  if (first && first.tagName.toLowerCase() === "h1") {
    first.remove();
  }
}

function firstHeadingText(root: Document): string | undefined {
  const heading = root.body.firstElementChild;
  if (!heading || heading.tagName.toLowerCase() !== "h1") return undefined;
  const text = heading.textContent?.trim();
  return text || undefined;
}

/** Derives a readable title from a file name: `session-01.md` -> `session-01`. */
export function titleFromFilename(filename: string): string {
  return filename.replace(/\.(md|markdown|txt)$/i, "").trim() || "Untitled note";
}

/**
 * Converts one Markdown document into a note.
 *
 * Title precedence is front matter, then a leading H1, then the file name —
 * most explicit signal first.
 */
export function parseMarkdownDocument(
  source: string,
  filename: string,
): ParsedMarkdown {
  const { title: frontMatterTitle, body } = splitFrontMatter(source);

  const html = md.render(body);
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  convertTaskLists(parsed);

  const headingTitle = firstHeadingText(parsed);

  let title: string;
  let titleSource: ParsedMarkdown["titleSource"];

  if (frontMatterTitle) {
    title = frontMatterTitle;
    titleSource = "frontmatter";
  } else if (headingTitle) {
    title = headingTitle;
    titleSource = "heading";
    removeLeadingHeading(parsed);
  } else {
    title = titleFromFilename(filename);
    titleSource = "filename";
  }

  const extensions = createContentExtensions();
  const doc = generateJSON(parsed.body.innerHTML, extensions);

  // Text is derived by running the real document through the same flattening
  // the editor uses, rather than re-serialising the Markdown. That guarantees
  // an imported note and a typed note produce identical text for the same
  // content, so entity offsets agree.
  const node = PMNode.fromJSON(getSchema(extensions), doc);
  const text = flattenDoc(node).text;

  return { title, doc, text, tasks: extractTasks(node), titleSource };
}
