/**
 * Mapping between the flattened text the matcher sees and the document
 * positions the editor needs.
 *
 * Off-by-one errors here are invisible in the data but wildly visible on
 * screen — a decoration that highlights "arrow" instead of "Marrow".
 */

import { describe, expect, it } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { flattenDoc, textIndexToDocPos, textRangeToDocRange } from "@/lib/editor/doc-text";
import { EntityRecognizer } from "@/lib/entities/recognizer";
import type { Entity } from "@/lib/db/types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
  marks: {
    bold: { toDOM: () => ["strong", 0] },
  },
});

function docOf(...paragraphs: string[]): PMNode {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) =>
      schema.node("paragraph", null, text ? [schema.text(text)] : []),
    ),
  );
}

function entity(id: string, name: string): Entity {
  return {
    id,
    campaignId: "c1",
    name,
    entityTypeId: "t1",
    description: "",
    autoLink: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("flattening a document", () => {
  it("joins block content with newlines", () => {
    const flat = flattenDoc(docOf("The party met Marrow.", "Marrow smiled."));

    expect(flat.text).toBe("The party met Marrow.\nMarrow smiled.");
  });

  it("does not put a separator before the first block", () => {
    const flat = flattenDoc(docOf("First."));

    expect(flat.text).toBe("First.");
  });

  it("concatenates text split across marks within a paragraph", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Mar"),
        schema.text("row", [schema.mark("bold")]),
        schema.text(" waits."),
      ]),
    ]);

    const flat = flattenDoc(doc);

    // A bolded half of a name is still that name; the matcher must see it whole.
    expect(flat.text).toBe("Marrow waits.");
  });
});

describe("mapping text offsets back to document positions", () => {
  it("maps the start of the first paragraph", () => {
    const flat = flattenDoc(docOf("Marrow waits."));

    // ProseMirror positions are 1-based inside the opening paragraph token.
    expect(textIndexToDocPos(flat, 0)).toBe(1);
  });

  it("maps a range to the exact span of the matched word", () => {
    const doc = docOf("The party met Marrow.");
    const flat = flattenDoc(doc);
    const recognizer = EntityRecognizer.fromCampaign([entity("m", "Marrow")], []);

    const [match] = recognizer.findMatches(flat.text);
    const range = textRangeToDocRange(flat, match.start, match.end);

    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe("Marrow");
  });

  it("maps a match in a later block, past the inserted separator", () => {
    const doc = docOf("The party arrived.", "Then Marrow spoke.");
    const flat = flattenDoc(doc);
    const recognizer = EntityRecognizer.fromCampaign([entity("m", "Marrow")], []);

    const [match] = recognizer.findMatches(flat.text);
    const range = textRangeToDocRange(flat, match.start, match.end);

    expect(doc.textBetween(range!.from, range!.to)).toBe("Marrow");
  });

  it("maps a match ending exactly at a text-node boundary", () => {
    // The end index is exclusive, so a naive lookup misses the final character
    // whenever a match finishes flush against the end of a text node.
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Ask Marrow"),
        schema.text(" about it", [schema.mark("bold")]),
      ]),
    ]);
    const flat = flattenDoc(doc);
    const recognizer = EntityRecognizer.fromCampaign([entity("m", "Marrow")], []);

    const [match] = recognizer.findMatches(flat.text);
    const range = textRangeToDocRange(flat, match.start, match.end);

    expect(doc.textBetween(range!.from, range!.to)).toBe("Marrow");
  });

  it("returns null for an index that falls on a block separator", () => {
    const flat = flattenDoc(docOf("One", "Two"));

    // Index 3 is the synthetic "\n"; it corresponds to no real character.
    expect(textIndexToDocPos(flat, 3)).toBeNull();
  });
});

describe("block separation", () => {
  it("prevents a match from spanning two paragraphs", () => {
    const flat = flattenDoc(docOf("...in Grey", "haven the party rested."));
    const recognizer = EntityRecognizer.fromCampaign(
      [entity("grey", "Greyhaven")],
      [],
    );

    // Without the separator these would concatenate into "Greyhaven" and
    // produce a mention no reader would recognise as one.
    expect(recognizer.findMatches(flat.text)).toHaveLength(0);
  });
});
