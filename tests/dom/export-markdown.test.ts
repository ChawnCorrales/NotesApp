/**
 * Markdown export, tested as a round trip.
 *
 * The claim worth proving is not "the output looks like Markdown" — it is that
 * a note leaves and comes back unchanged. So almost every test here writes a
 * document, exports it, imports the result, and compares the flattened text and
 * structure to the original. That is what a GM is actually relying on when they
 * export a campaign they care about.
 *
 * Lives in `tests/dom` because the importer parses HTML and needs a DOM.
 */

import { describe, expect, it } from "vitest";
import { generateJSON, type JSONContent } from "@tiptap/core";
import { toMarkdown } from "@/lib/export/markdown";
import { parseMarkdownDocument } from "@/lib/import/markdown";
import { createContentExtensions } from "@/lib/editor/extensions";
import { EntityRecognizer } from "@/lib/entities/recognizer";
import type { Entity, EntityAlias } from "@/lib/db/types";

/** Builds a TipTap document from Markdown, the way an import would. */
function docFrom(markdown: string): JSONContent {
  return parseMarkdownDocument(markdown, "note.md").doc;
}

/** Markdown in, Markdown out — the shape most of these tests assert on. */
function roundTrip(markdown: string): string {
  return toMarkdown(docFrom(markdown));
}

/** Compares structure rather than text, ignoring incidental attribute noise. */
function structure(doc: JSONContent): unknown {
  const walk = (node: JSONContent): unknown => ({
    type: node.type,
    text: node.text,
    marks: node.marks?.map((m) => m.type).sort(),
    checked: node.attrs?.checked,
    level: node.attrs?.level,
    content: node.content?.map(walk),
  });
  return walk(doc);
}

function expectStable(markdown: string) {
  const once = roundTrip(markdown);
  const twice = roundTrip(once);
  expect(twice, "export is not idempotent").toBe(once);
  return once;
}

describe("block constructs survive the round trip", () => {
  const cases: [string, string][] = [
    ["a paragraph", "Just some prose about the party."],
    ["headings", "# One\n\n## Two\n\n### Three"],
    ["a bullet list", "- alpha\n- beta\n- gamma"],
    ["an ordered list", "1. first\n2. second\n3. third"],
    ["a blockquote", "> The gate was already open."],
    ["a code block", "```js\nconst x = 1;\n```"],
    ["a horizontal rule", "Before\n\n---\n\nAfter"],
    ["a task list", "- [ ] Name the inn\n- [x] Stat the innkeeper"],
    ["a table", "| Name | Role |\n| --- | --- |\n| Marrow | Merchant |"],
  ];

  for (const [label, markdown] of cases) {
    it(`keeps ${label}`, () => {
      const exported = expectStable(markdown);
      expect(structure(docFrom(exported))).toEqual(structure(docFrom(markdown)));
    });
  }
});

describe("inline formatting survives", () => {
  const cases: [string, string][] = [
    ["bold", "The **Red Queen** waited."],
    ["italic", "The *Red Queen* waited."],
    ["strikethrough", "The ~~Red Queen~~ waited."],
    ["inline code", "Run `npm test` first."],
    ["a link", "See [the map](https://example.com/map)."],
    ["bold inside a list", "- a **bold** item"],
    ["mixed marks", "A ***bold italic*** phrase."],
  ];

  for (const [label, markdown] of cases) {
    it(`keeps ${label}`, () => {
      const exported = expectStable(markdown);
      expect(structure(docFrom(exported))).toEqual(structure(docFrom(markdown)));
    });
  }
});

describe("text that looks like Markdown", () => {
  /**
   * The quiet corruption this guards against: prose containing punctuation
   * Markdown treats as syntax must come back as the same prose, not as
   * formatting the user never asked for.
   */
  /**
   * Chosen so that removing the escaping actually breaks them.
   *
   * An earlier version of this list used "5 * 3" and "[draft]", both of which
   * survive unescaped — a lone asterisk is not emphasis and a bracket with no
   * following paren is not a link. They passed against a build with escaping
   * deleted, which makes them decoration rather than tests.
   */
  const cases: [string, string][] = [
    ["literal emphasis", "Write *this* exactly as shown."],
    ["literal bold", "Write **this** exactly as shown."],
    ["a literal link", "Type [text](url) to make a link."],
    ["surrounding underscores", "The flag is _debug_ in the config."],
    ["a backtick", "He said `hello` oddly."],
    ["a backslash", "Escape it with \\n for a newline."],
  ];

  for (const [label, source] of cases) {
    it(`does not turn ${label} into formatting`, () => {
      const doc = generateJSON(`<p>${source.replace(/&/g, "&amp;")}</p>`, createContentExtensions());
      const exported = toMarkdown(doc);
      const reimported = parseMarkdownDocument(exported, "n.md");

      expect(reimported.text.trim()).toBe(source);
    });
  }
});

describe("prose that starts like a block", () => {
  /**
   * A paragraph beginning "- but only just" is a sentence, not a list. These
   * characters only mean anything at the start of a line, which is why they
   * are escaped there rather than everywhere.
   */
  const cases: [string, string][] = [
    ["a dash", "- but only just, and not as a list"],
    ["a hash", "# 3 was the room number"],
    ["an angle bracket", "> was how he wrote it"],
    ["a number", "1. was the first thing he said"],
    ["a plus", "+ signs everywhere in the ledger"],
  ];

  for (const [label, source] of cases) {
    it(`does not turn a leading ${label} into a block`, () => {
      const doc = generateJSON(`<p>${source}</p>`, createContentExtensions());
      const exported = toMarkdown(doc);
      const reimported = parseMarkdownDocument(exported, "n.md");

      expect(reimported.doc.content?.[0]?.type).toBe("paragraph");
      expect(reimported.text.trim()).toBe(source);
    });
  }
});

describe("wikilinks", () => {
  function recognizerFor(names: string[]): EntityRecognizer {
    const entities = names.map((name, i) => ({
      id: `e${i}`,
      campaignId: "c1",
      name,
      entityTypeId: "t1",
      description: "",
      autoLink: true,
      createdAt: 0,
      updatedAt: 0,
    })) as Entity[];
    return EntityRecognizer.fromCampaign(entities, [] as EntityAlias[]);
  }

  it("wraps a recognised name", () => {
    const doc = docFrom("Marrow keeps a shop in Greyhaven.");
    const out = toMarkdown(doc, { recognizer: recognizerFor(["Marrow", "Greyhaven"]) });

    expect(out.trim()).toBe("[[Marrow]] keeps a shop in [[Greyhaven]].");
  });

  it("leaves text alone without a recogniser", () => {
    const doc = docFrom("Marrow keeps a shop.");

    expect(toMarkdown(doc).trim()).toBe("Marrow keeps a shop.");
  });

  it("does not link a name inside a longer word", () => {
    const doc = docFrom("The marrowbone was cracked.");
    const out = toMarkdown(doc, { recognizer: recognizerFor(["Marrow"]) });

    expect(out).not.toContain("[[");
  });

  /**
   * The editor treats "Mar**row**" as one mention because it matches on the
   * block's text, not per styled run. An export that missed it would drop a
   * link the user can see on screen.
   */
  it("links a name split across formatting", () => {
    const doc = generateJSON("<p>Mar<strong>row</strong> waited.</p>", createContentExtensions());
    const out = toMarkdown(doc, { recognizer: recognizerFor(["Marrow"]) });

    expect(out).toContain("[[");
    expect(out).toContain("]]");
  });

  it("skips an occurrence the user rejected", () => {
    const doc = docFrom("Ash spoke. Later Ash left.");
    const out = toMarkdown(doc, {
      recognizer: recognizerFor(["Ash"]),
      // The second occurrence only.
      suppressed: new Set(["e0:1"]),
    });

    expect(out).toContain("[[Ash]] spoke.");
    expect(out).toContain("Later Ash left.");
    expect(out.match(/\[\[/g)).toHaveLength(1);
  });

  it("links inside a table cell", () => {
    const doc = docFrom("| Name |\n| --- |\n| Marrow |");
    const out = toMarkdown(doc, { recognizer: recognizerFor(["Marrow"]) });

    expect(out).toContain("[[Marrow]]");
  });
});

describe("edge cases", () => {
  it("exports an empty document as nothing", () => {
    expect(toMarkdown({ type: "doc", content: [] })).toBe("");
  });

  it("survives a document with an unknown block", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        { type: "somethingElse", content: [{ type: "text", text: "kept" }] },
      ],
    };

    // Dropping content silently is the one thing an exporter must never do.
    expect(toMarkdown(doc)).toContain("kept");
  });

  it("keeps a nested list nested", () => {
    const markdown = "- outer\n  - inner";
    const exported = roundTrip(markdown);

    const reimported = docFrom(exported);
    const outerList = reimported.content?.[0];
    const firstItem = outerList?.content?.[0];
    const nested = firstItem?.content?.some((c) => c.type === "bulletList");

    expect(nested).toBe(true);
  });

  it("keeps a hard break", () => {
    const doc = generateJSON("<p>one<br>two</p>", createContentExtensions());

    expect(toMarkdown(doc)).toContain("\n");
  });
});
