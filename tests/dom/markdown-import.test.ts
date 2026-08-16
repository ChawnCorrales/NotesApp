/**
 * Markdown import.
 *
 * A GM's existing notes are the realistic starting point for this app, so the
 * question these tests answer is: does an imported note behave like one that
 * was typed here? Structure has to survive, and recognition has to apply to it
 * exactly as it would to anything else.
 */

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import {
  parseMarkdownDocument,
  splitFrontMatter,
  titleFromFilename,
} from "@/lib/import/markdown";

/** Collects every node of a given type, at any depth. */
function nodesOfType(doc: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(visit);
  };
  visit(doc);
  return found;
}

function parse(markdown: string, filename = "note.md") {
  return parseMarkdownDocument(markdown, filename);
}

describe("titles", () => {
  it("prefers a title from front matter", () => {
    const result = parse("---\ntitle: The Black Crown\n---\n\n# Something else\n\nBody.");

    expect(result.title).toBe("The Black Crown");
    expect(result.titleSource).toBe("frontmatter");
  });

  it("strips front matter from the body", () => {
    const result = parse("---\ntitle: A\ntags: [x]\n---\n\nJust this.");

    expect(result.text).toBe("Just this.");
  });

  it("handles quoted front matter values", () => {
    expect(parse('---\ntitle: "Quoted Title"\n---\n\nBody.').title).toBe(
      "Quoted Title",
    );
  });

  it("falls back to a leading H1", () => {
    const result = parse("# Session 12\n\nThe party arrived.");

    expect(result.title).toBe("Session 12");
    expect(result.titleSource).toBe("heading");
  });

  it("removes the H1 it promoted, so the title is not repeated", () => {
    const result = parse("# Session 12\n\nThe party arrived.");

    expect(result.text).toBe("The party arrived.");
    expect(nodesOfType(result.doc, "heading")).toHaveLength(0);
  });

  it("keeps headings that are not the leading one", () => {
    const result = parse("# Session 12\n\n## Aftermath\n\nThey rested.");

    expect(result.title).toBe("Session 12");
    expect(nodesOfType(result.doc, "heading")).toHaveLength(1);
  });

  it("falls back to the file name", () => {
    const result = parse("No heading here.", "greyhaven-notes.md");

    expect(result.title).toBe("greyhaven-notes");
    expect(result.titleSource).toBe("filename");
  });

  it("derives a title from assorted extensions", () => {
    expect(titleFromFilename("session-01.md")).toBe("session-01");
    expect(titleFromFilename("lore.markdown")).toBe("lore");
    expect(titleFromFilename("scratch.txt")).toBe("scratch");
  });

  it("survives a file with no usable name", () => {
    expect(titleFromFilename(".md")).toBe("Untitled note");
  });
});

describe("front matter parsing", () => {
  it("returns the source untouched when there is none", () => {
    const result = splitFrontMatter("# Title\n\nBody.");

    expect(result.title).toBeUndefined();
    expect(result.body).toBe("# Title\n\nBody.");
  });

  it("ignores a delimiter that is not at the very start", () => {
    const source = "Some text.\n\n---\ntitle: Nope\n---\n";

    expect(splitFrontMatter(source).title).toBeUndefined();
  });
});

describe("structure", () => {
  it("preserves headings at their level", () => {
    const result = parse("Intro.\n\n## Second\n\n### Third");

    const levels = nodesOfType(result.doc, "heading").map((h) => h.attrs?.level);
    expect(levels).toEqual([2, 3]);
  });

  it("preserves bold and italic", () => {
    const result = parse("A **bold** and *italic* line.");

    const marks = nodesOfType(result.doc, "text").flatMap((t) =>
      (t.marks ?? []).map((m) => m.type),
    );
    expect(marks).toContain("bold");
    expect(marks).toContain("italic");
  });

  it("preserves bullet lists", () => {
    const result = parse("- one\n- two\n- three");

    expect(nodesOfType(result.doc, "bulletList")).toHaveLength(1);
    expect(nodesOfType(result.doc, "listItem")).toHaveLength(3);
  });

  it("preserves ordered lists", () => {
    const result = parse("1. first\n2. second");

    expect(nodesOfType(result.doc, "orderedList")).toHaveLength(1);
    expect(nodesOfType(result.doc, "listItem")).toHaveLength(2);
  });

  it("preserves links with their href", () => {
    const result = parse("See [the map](https://example.com/map).");

    const link = nodesOfType(result.doc, "text")
      .flatMap((t) => t.marks ?? [])
      .find((m) => m.type === "link");
    expect(link?.attrs?.href).toBe("https://example.com/map");
  });

  it("preserves blockquotes", () => {
    const result = parse("> They never came back.");

    expect(nodesOfType(result.doc, "blockquote")).toHaveLength(1);
  });

  it("preserves code blocks", () => {
    const result = parse("```\nconst a = 1;\n```");

    expect(nodesOfType(result.doc, "codeBlock")).toHaveLength(1);
  });

  it("preserves tables", () => {
    const result = parse(
      ["| Name | Role |", "| --- | --- |", "| Marrow | Merchant |"].join("\n"),
    );

    expect(nodesOfType(result.doc, "table")).toHaveLength(1);
    expect(nodesOfType(result.doc, "tableRow")).toHaveLength(2);
  });

  it("preserves horizontal rules", () => {
    const result = parse("Above.\n\n---\n\nBelow.");

    expect(nodesOfType(result.doc, "horizontalRule")).toHaveLength(1);
  });
});

describe("task lists", () => {
  it("converts unchecked GFM checkboxes into task items", () => {
    const result = parse("- [ ] Decide who killed Marrow");

    const items = nodesOfType(result.doc, "taskItem");
    expect(items).toHaveLength(1);
    expect(items[0].attrs?.checked).toBe(false);
  });

  it("converts checked checkboxes", () => {
    const result = parse("- [x] Reveal the Greyhaven secret");

    expect(nodesOfType(result.doc, "taskItem")[0].attrs?.checked).toBe(true);
  });

  it("accepts an uppercase X", () => {
    const result = parse("- [X] Done");

    expect(nodesOfType(result.doc, "taskItem")[0].attrs?.checked).toBe(true);
  });

  it("strips the checkbox marker from the text", () => {
    const result = parse("- [ ] Decide who killed Marrow");

    expect(result.text).toBe("Decide who killed Marrow");
    expect(result.text).not.toContain("[ ]");
  });

  it("reports the tasks it found", () => {
    const result = parse("- [ ] Stat the Ashen Knight\n- [x] Name the inn");

    expect(result.tasks).toEqual([
      { text: "Stat the Ashen Knight", completed: false },
      { text: "Name the inn", completed: true },
    ]);
  });

  it("leaves ordinary bullet lists alone", () => {
    const result = parse("- just a bullet\n- another");

    expect(nodesOfType(result.doc, "taskItem")).toHaveLength(0);
    expect(nodesOfType(result.doc, "bulletList")).toHaveLength(1);
  });
});

describe("flattened text", () => {
  it("separates blocks with a single newline, matching the editor", () => {
    const result = parse("First paragraph.\n\nSecond paragraph.");

    // The editor's flattenDoc joins blocks with "\n"; import must agree or
    // entity offsets would differ between typed and imported notes.
    expect(result.text).toBe("First paragraph.\nSecond paragraph.");
  });

  it("includes text from every block type", () => {
    const result = parse("# T\n\nBody.\n\n- item\n\n> quote");

    expect(result.text).toContain("Body.");
    expect(result.text).toContain("item");
    expect(result.text).toContain("quote");
  });

  it("handles an empty document", () => {
    const result = parse("", "empty.md");

    expect(result.title).toBe("empty");
    expect(result.text).toBe("");
  });
});

describe("untrusted input", () => {
  it("does not pass raw HTML through into the note", () => {
    const result = parse("Before\n\n<script>alert('x')</script>\n\nAfter");

    // `html: false` means the tag is treated as literal text, never markup.
    const scripts = nodesOfType(result.doc, "script");
    expect(scripts).toHaveLength(0);
    expect(result.text).toContain("Before");
    expect(result.text).toContain("After");
  });

  it("does not turn an inline HTML tag into a node", () => {
    const result = parse("A <b>bold-ish</b> attempt.");

    const marks = nodesOfType(result.doc, "text").flatMap((t) =>
      (t.marks ?? []).map((m) => m.type),
    );
    expect(marks).not.toContain("bold");
  });
});
