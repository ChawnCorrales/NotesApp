/**
 * Importing files that describe entities, and files containing wikilinks.
 *
 * The format is meant to be hand-written — someone bringing in a bestiary
 * should be able to write files, not learn an export schema — so these are
 * mostly about being forgiving: an unknown key, a missing category, either
 * spelling of a list, and a `type` that is not `entity` all have to behave
 * sensibly rather than reject the file.
 */

import { describe, expect, it } from "vitest";
import { parseMarkdownFile, stripWikilinks } from "@/lib/import/markdown";

/** Asserts the file parsed as an entity and returns it. */
function entityFrom(source: string, filename = "file.md") {
  const parsed = parseMarkdownFile(source, filename);
  if (parsed.kind !== "entity") throw new Error("expected an entity");
  return parsed.entity;
}

function noteFrom(source: string, filename = "file.md") {
  const parsed = parseMarkdownFile(source, filename);
  if (parsed.kind !== "note") throw new Error("expected a note");
  return parsed.note;
}

describe("stripping wikilinks", () => {
  it("keeps the name and drops the brackets", () => {
    expect(stripWikilinks("[[Marrow]] keeps a shop.")).toBe("Marrow keeps a shop.");
  });

  it("keeps the display text of an aliased link", () => {
    // Obsidian renders the right-hand side, so that is what the reader saw.
    expect(stripWikilinks("[[Marrow|the shopkeeper]] waited.")).toBe(
      "the shopkeeper waited.",
    );
  });

  it("handles several on one line", () => {
    expect(stripWikilinks("[[Marrow]] met [[Ash]].")).toBe("Marrow met Ash.");
  });

  it("leaves ordinary brackets alone", () => {
    expect(stripWikilinks("Marked [draft] in the margin.")).toBe(
      "Marked [draft] in the margin.",
    );
  });

  it("leaves an unclosed bracket alone", () => {
    expect(stripWikilinks("[[unfinished")).toBe("[[unfinished");
  });

  it("does nothing to text without any", () => {
    expect(stripWikilinks("Nothing to see.")).toBe("Nothing to see.");
  });
});

describe("a note containing wikilinks", () => {
  it("imports the plain name, not the brackets", () => {
    const note = noteFrom("[[Marrow]] keeps a shop in [[Greyhaven]].");

    // Recognition re-links these; the brackets were only ever for other tools.
    expect(note.text).toBe("Marrow keeps a shop in Greyhaven.");
    expect(note.text).not.toContain("[");
  });

  it("strips them inside formatting", () => {
    const note = noteFrom("The **[[Red Queen]]** waited.");

    expect(note.text).toBe("The Red Queen waited.");
  });

  it("strips them inside a table", () => {
    const note = noteFrom("| Name |\n| --- |\n| [[Marrow]] |");

    expect(note.text).toContain("Marrow");
    expect(note.text).not.toContain("[[");
  });
});

describe("a file that says it is an entity", () => {
  const full = [
    "---",
    "type: entity",
    "name: Marrow",
    "category: Characters",
    "aliases:",
    "  - Old Marrow",
    "  - the shopkeeper",
    "---",
    "",
    "A grizzled merchant who keeps a shop in [[Greyhaven]].",
  ].join("\n");

  it("reads name, category and aliases", () => {
    expect(entityFrom(full)).toEqual({
      name: "Marrow",
      category: "Characters",
      aliases: ["Old Marrow", "the shopkeeper"],
      description: "A grizzled merchant who keeps a shop in Greyhaven.",
    });
  });

  it("accepts the inline list spelling", () => {
    const source = [
      "---",
      "type: entity",
      "name: Marrow",
      "aliases: [Old Marrow, the shopkeeper]",
      "---",
      "",
      "Body.",
    ].join("\n");

    expect(entityFrom(source).aliases).toEqual(["Old Marrow", "the shopkeeper"]);
  });

  it("falls back to the file name when no name is given", () => {
    const source = ["---", "type: entity", "---", "", "Body."].join("\n");

    expect(entityFrom(source, "Dremnoth.md").name).toBe("Dremnoth");
  });

  it("accepts title as a synonym for name", () => {
    const source = ["---", "type: entity", "title: Marrow", "---"].join("\n");

    expect(entityFrom(source).name).toBe("Marrow");
  });

  it("has no category when the file does not say", () => {
    const source = ["---", "type: entity", "name: Marrow", "---"].join("\n");

    expect(entityFrom(source).category).toBeUndefined();
  });

  it("has an empty description when there is no body", () => {
    const source = ["---", "type: entity", "name: Marrow", "---", ""].join("\n");

    expect(entityFrom(source).description).toBe("");
  });

  it("ignores an unfamiliar key rather than failing", () => {
    const source = [
      "---",
      "type: entity",
      "name: Marrow",
      "cssclass: obsidian-thing",
      "publish: true",
      "---",
      "",
      "Body.",
    ].join("\n");

    // Files come from other tools. An unknown key must never stop an import.
    expect(entityFrom(source).name).toBe("Marrow");
  });

  it("is case-insensitive about the type", () => {
    const source = ["---", "type: Entity", "name: Marrow", "---"].join("\n");

    expect(parseMarkdownFile(source, "f.md").kind).toBe("entity");
  });
});

describe("a file that is not an entity", () => {
  it("is a note when there is no type key", () => {
    expect(parseMarkdownFile("# Session 12\n\nText.", "f.md").kind).toBe("note");
  });

  it("is a note when the type says something else", () => {
    const source = ["---", "type: session", "title: S12", "---", "", "Text."].join("\n");

    // Every file that imported before this feature existed must still import.
    expect(parseMarkdownFile(source, "f.md").kind).toBe("note");
  });

  it("reads a folder path from the front matter", () => {
    const source = [
      "---",
      "title: Session 12",
      "folder: Session Logs/Act One",
      "---",
      "",
      "Text.",
    ].join("\n");

    expect(noteFrom(source).folderPath).toBe("Session Logs/Act One");
  });

  it("has no folder when the file does not say", () => {
    expect(noteFrom("# S12\n\nText.").folderPath).toBeUndefined();
  });
});
