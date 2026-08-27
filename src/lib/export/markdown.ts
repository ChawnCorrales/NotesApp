/**
 * Markdown export: the reverse of `lib/import/markdown.ts`.
 *
 * Written by hand over the TipTap JSON rather than pulling in
 * `prosemirror-markdown`, for one reason that matters: its default serialiser
 * knows nothing about tables or task lists, so half of it would be custom
 * anyway — and writing all of it here means the output is defined as exactly
 * the constructs the importer can read back. The two are tested as a round
 * trip, which is only meaningful if they were built against each other.
 *
 * The schema is small and closed (see `lib/editor/extensions.ts`): 17 node
 * types and 6 marks. Every one is handled below except `underline`, which has
 * no Markdown spelling — the text survives, the underline does not. Emitting
 * `<u>` instead would be lossy in a worse way, since the importer runs
 * markdown-it with `html: false` and would bring the tags back as literal text.
 */

import type { JSONContent } from "@tiptap/core";
import { suppressionKey, type EntityRecognizer } from "../entities/recognizer";

export interface MarkdownOptions {
  /**
   * When present, recognised entity names are wrapped in `[[wikilinks]]`.
   *
   * Omit it to export exactly what was typed. Supplying it is what carries the
   * campaign's connections into Obsidian and similar tools, which read
   * `[[Name]]` as a link.
   */
  recognizer?: EntityRecognizer;
  /** Occurrences the user marked "not this entity"; never linked. */
  suppressed?: ReadonlySet<string>;
}

/** A run of text with its marks, used while resolving wikilinks in a block. */
interface Run {
  text: string;
  marks: JSONContent["marks"];
}

/**
 * Characters that change meaning anywhere in a line.
 *
 * Deliberately short. An earlier version also escaped `.`, `-`, `#` and `>`,
 * which turned every ordinary sentence into "the shop\\." — technically
 * correct, unreadable as a file, and not something anyone would want to open
 * in another editor. Those four only mean anything at the start of a line, and
 * are handled there instead.
 */
const ESCAPE = /([\\`*_[\]])/g;

/**
 * Escapes Markdown punctuation in body text.
 *
 * Without this a note containing "5 * 3" or "[draft]" changes meaning on the
 * way out, which is a silent corruption of someone's writing.
 */
function escapeText(value: string): string {
  return value.replace(ESCAPE, "\\$1");
}

/**
 * Escapes a leading character that would otherwise start a block.
 *
 * A paragraph beginning "- but only just" is prose, and must not come back as
 * a list item. Applied to the rendered line rather than to each text run,
 * because only the first character of the line can do this.
 */
function guardBlockStart(text: string): string {
  const ordered = text.match(/^(\s*)(\d+)([.)])/);
  if (ordered) {
    return `${ordered[1]}${ordered[2]}\\${ordered[3]}${text.slice(ordered[0].length)}`;
  }
  return text.replace(/^(\s*)([#>+-])/, "$1\\$2");
}

function markNames(marks: JSONContent["marks"]): Set<string> {
  return new Set((marks ?? []).map((m) => m.type));
}

/** Wraps `text` in the delimiters for its marks, innermost first. */
function applyMarks(text: string, marks: JSONContent["marks"]): string {
  if (!text) return "";
  const names = markNames(marks);

  // Code first: its content is literal, so nothing inside is escaped and no
  // other mark may add characters within the backticks.
  if (names.has("code")) {
    const fence = text.includes("`") ? "``" : "`";
    const padded = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
    return fence + padded + fence;
  }

  let out = escapeText(text);
  if (names.has("bold")) out = `**${out}**`;
  if (names.has("italic")) out = `*${out}*`;
  if (names.has("strike")) out = `~~${out}~~`;

  const link = (marks ?? []).find((m) => m.type === "link");
  if (link?.attrs?.href) out = `[${out}](${String(link.attrs.href)})`;

  return out;
}

/**
 * Splits a block's runs at entity match boundaries and wraps the matches.
 *
 * Matching happens across the whole block rather than per text node, because
 * that is how the editor does it: "Mar**row**" is one mention on screen, and an
 * export that missed it would quietly drop a link the user can see.
 *
 * Occurrence numbering follows document order for the same reason — it has to
 * agree with the suppression keys the editor wrote.
 */
function linkRuns(
  runs: Run[],
  options: MarkdownOptions,
  counters: Map<string, number>,
): Run[] {
  const { recognizer, suppressed } = options;
  if (!recognizer) return runs;

  const full = runs.map((r) => r.text).join("");
  if (!full.trim()) return runs;

  const matches = recognizer.findMatches(full);
  if (matches.length === 0) return runs;

  /** Every offset where a run or a match starts or ends. */
  const cuts = new Set<number>([0, full.length]);
  let offset = 0;
  for (const run of runs) {
    offset += run.text.length;
    cuts.add(offset);
  }

  const wanted: { start: number; end: number }[] = [];
  for (const match of matches) {
    const seen = counters.get(match.entityId) ?? 0;
    counters.set(match.entityId, seen + 1);
    if (suppressed?.has(suppressionKey(match.entityId, seen))) continue;
    wanted.push({ start: match.start, end: match.end });
    cuts.add(match.start);
    cuts.add(match.end);
  }

  if (wanted.length === 0) return runs;

  const bounds = [...cuts].sort((a, b) => a - b);

  const marksAt = (index: number): JSONContent["marks"] => {
    let cursor = 0;
    for (const run of runs) {
      if (index < cursor + run.text.length) return run.marks;
      cursor += run.text.length;
    }
    return runs[runs.length - 1]?.marks;
  };

  const out: Run[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (start === end) continue;

    if (wanted.some((m) => m.start === start)) {
      out.push({ text: "[[", marks: undefined });
    }
    out.push({ text: full.slice(start, end), marks: marksAt(start) });
    if (wanted.some((m) => m.end === end)) {
      out.push({ text: "]]", marks: undefined });
    }
  }
  return out;
}

/** Serialises a block's inline children. */
function inline(
  nodes: JSONContent[] | undefined,
  options: MarkdownOptions,
  counters: Map<string, number>,
): string {
  if (!nodes) return "";

  const runs: Run[] = [];
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      runs.push({ text: "\n", marks: undefined });
      continue;
    }
    if (node.type === "text" && node.text) {
      runs.push({ text: node.text, marks: node.marks });
    }
  }

  return linkRuns(runs, options, counters)
    .map((run) =>
      // The brackets are structure, not content, so they must not be escaped.
      run.text === "[[" || run.text === "]]"
        ? run.text
        : applyMarks(run.text, run.marks),
    )
    .join("");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line ? prefix + line : line))
    .join("\n");
}

function serialiseList(
  node: JSONContent,
  options: MarkdownOptions,
  counters: Map<string, number>,
): string {
  const ordered = node.type === "orderedList";
  const start = Number(node.attrs?.start ?? 1);

  return (node.content ?? [])
    .map((item, index) => {
      const marker =
        node.type === "taskList"
          ? `- [${item.attrs?.checked ? "x" : " "}] `
          : ordered
            ? `${start + index}. `
            : "- ";

      const body = blocks(item.content, options, counters);
      // Continuation lines align under the marker, which is what keeps a nested
      // list nested rather than restarting at the top level.
      const padded = indent(body, " ".repeat(marker.length)).slice(marker.length);
      return marker + padded;
    })
    .join("\n");
}

/** Cell text is already inline-serialised; only the pipe still needs escaping. */
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function serialiseTable(
  node: JSONContent,
  options: MarkdownOptions,
  counters: Map<string, number>,
): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";

  const cells = (row: JSONContent) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((child) => inline(child.content, options, counters))
        .join(" ")
        .replace(/\n/g, " "),
    );

  const [head, ...body] = rows;
  const headCells = cells(head).map(escapeCell);
  const line = (values: string[]) => `| ${values.join(" | ")} |`;

  return [
    line(headCells),
    line(headCells.map(() => "---")),
    ...body.map((row) => line(cells(row).map(escapeCell))),
  ].join("\n");
}

function block(
  node: JSONContent,
  options: MarkdownOptions,
  counters: Map<string, number>,
): string {
  switch (node.type) {
    case "paragraph":
      return guardBlockStart(inline(node.content, options, counters));

    case "heading": {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `${"#".repeat(level)} ${inline(node.content, options, counters)}`;
    }

    case "blockquote":
      return indent(blocks(node.content, options, counters), "> ");

    case "codeBlock": {
      const language = String(node.attrs?.language ?? "");
      const text = (node.content ?? []).map((c) => c.text ?? "").join("");
      // Trailing newlines are the fence's job. Keeping the node's own would
      // add one more on every export, growing the block a line at a time.
      return "```" + language + "\n" + text.replace(/\n+$/, "") + "\n```";
    }

    case "horizontalRule":
      return "---";

    case "bulletList":
    case "orderedList":
    case "taskList":
      return serialiseList(node, options, counters);

    case "table":
      return serialiseTable(node, options, counters);

    default: {
      // Unknown node: keep whatever it holds rather than dropping it. Text
      // children are inline content, so recursing as blocks would emit
      // nothing at all — silently losing writing, which is the one failure
      // an exporter must never have.
      if (!node.content) return node.text ? escapeText(node.text) : "";
      const inlineish = node.content.some((c) => c.type === "text");
      return inlineish
        ? inline(node.content, options, counters)
        : blocks(node.content, options, counters);
    }
  }
}

function blocks(
  nodes: JSONContent[] | undefined,
  options: MarkdownOptions,
  counters: Map<string, number>,
): string {
  return (nodes ?? [])
    .map((node) => block(node, options, counters))
    .filter((text) => text !== "")
    .join("\n\n");
}

/**
 * Serialises a TipTap document to Markdown.
 *
 * Occurrence counters are created per document, so numbering restarts with each
 * note — matching how suppressions are keyed.
 */
export function toMarkdown(doc: JSONContent, options: MarkdownOptions = {}): string {
  const body = blocks(doc.content, options, new Map());
  return body ? `${body}\n` : "";
}
