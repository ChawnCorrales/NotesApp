/**
 * Flattens a ProseMirror document to plain text while keeping a map back to
 * document positions.
 *
 * The recogniser works on a plain string; the editor needs document positions
 * to paint decorations. This module is the bridge, and it is the only place
 * that knows how the two coordinate systems line up.
 */

import type { Node as PMNode } from "@tiptap/pm/model";

export interface TextSegment {
  /** Position of the text node's first character in the document. */
  docFrom: number;
  /** Index of that same character in the flattened string. */
  textStart: number;
  length: number;
}

export interface FlatDoc {
  text: string;
  segments: TextSegment[];
}

/**
 * Flatten `doc`, inserting a newline between block nodes.
 *
 * The separator matters: without it, the last word of one paragraph and the
 * first of the next would concatenate, and an entity named "Marrow Greyhaven"
 * would match across a paragraph break that no reader would consider a mention.
 * Newlines occupy an index that maps to no document position, which is fine —
 * entity names never contain one, so no match can straddle the gap.
 */
export function flattenDoc(doc: PMNode): FlatDoc {
  let text = "";
  const segments: TextSegment[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      segments.push({
        docFrom: pos,
        textStart: text.length,
        length: node.text.length,
      });
      text += node.text;
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
    }
    return true;
  });

  return { text, segments };
}

/**
 * Map an index in the flattened string back to a document position.
 *
 * Returns null for indices that fall on an inserted block separator, since
 * those correspond to no character in the document.
 */
export function textIndexToDocPos(flat: FlatDoc, index: number): number | null {
  let low = 0;
  let high = flat.segments.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = flat.segments[mid];

    if (index < segment.textStart) {
      high = mid - 1;
    } else if (index >= segment.textStart + segment.length) {
      low = mid + 1;
    } else {
      return segment.docFrom + (index - segment.textStart);
    }
  }

  return null;
}

/**
 * Map a half-open text range to a document range.
 *
 * The end index is mapped via its last character rather than directly, because
 * an exclusive end sits one past the segment and would miss the lookup whenever
 * a match finishes exactly at a text node boundary.
 */
export function textRangeToDocRange(
  flat: FlatDoc,
  start: number,
  end: number,
): { from: number; to: number } | null {
  const from = textIndexToDocPos(flat, start);
  const lastCharPos = textIndexToDocPos(flat, end - 1);

  if (from === null || lastCharPos === null) return null;

  return { from, to: lastCharPos + 1 };
}
