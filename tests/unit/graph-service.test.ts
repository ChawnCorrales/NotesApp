/**
 * Graph traversal as a domain operation.
 *
 * These are the rules a server endpoint would have to honour too, which is why
 * they are tested here rather than through the view: inference must stay
 * distinguishable from what the GM stated (§32), and traversal must terminate
 * on the cycles that campaign graphs are full of.
 */

import { describe, expect, it } from "vitest";
import {
  CO_OCCURRENCE_THRESHOLD,
  combineEdges,
  inferCoOccurrence,
  traverse,
  type GraphEdge,
} from "@/lib/services/graph";
import type { Relationship } from "@/lib/db/types";

function pair(noteId: string, entityId: string) {
  return { noteId, entityId };
}

function relationship(source: string, target: string, type = "knows"): Relationship {
  return {
    id: `${source}->${target}`,
    campaignId: "c1",
    sourceEntityId: source,
    targetEntityId: target,
    relationshipType: type,
    description: "",
    createdAt: 0,
  };
}

describe("inferring co-occurrence", () => {
  it("connects entities that share enough notes", () => {
    const edges = inferCoOccurrence([
      pair("n1", "marrow"),
      pair("n1", "greyhaven"),
      pair("n2", "marrow"),
      pair("n2", "greyhaven"),
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("inferred");
    expect(edges[0].sharedNotes).toBe(2);
  });

  it("ignores a single shared note as noise", () => {
    const edges = inferCoOccurrence([pair("n1", "marrow"), pair("n1", "greyhaven")]);

    expect(edges).toHaveLength(0);
    expect(CO_OCCURRENCE_THRESHOLD).toBe(2);
  });

  it("does not connect an entity to itself", () => {
    const edges = inferCoOccurrence([
      pair("n1", "marrow"),
      pair("n2", "marrow"),
      pair("n3", "marrow"),
    ]);

    expect(edges).toHaveLength(0);
  });

  it("treats a pair as the same connection in either direction", () => {
    const edges = inferCoOccurrence([
      pair("n1", "marrow"),
      pair("n1", "greyhaven"),
      pair("n2", "greyhaven"),
      pair("n2", "marrow"),
    ]);

    expect(edges).toHaveLength(1);
  });

  it("counts every pair in a note with several entities", () => {
    const notes = ["n1", "n2"].flatMap((n) => [
      pair(n, "a"),
      pair(n, "b"),
      pair(n, "c"),
    ]);

    // Three entities together in two notes: a-b, a-c, b-c.
    expect(inferCoOccurrence(notes)).toHaveLength(3);
  });

  it("returns nothing for an empty campaign", () => {
    expect(inferCoOccurrence([])).toEqual([]);
  });
});

describe("combining stated and inferred edges", () => {
  it("keeps a stated relationship with its label", () => {
    const edges = combineEdges([relationship("marrow", "greyhaven", "works in")], []);

    expect(edges).toEqual([
      {
        sourceEntityId: "marrow",
        targetEntityId: "greyhaven",
        kind: "stated",
        label: "works in",
      },
    ]);
  });

  it("drops an inferred edge the GM has already stated", () => {
    const inferred: GraphEdge[] = [
      {
        sourceEntityId: "marrow",
        targetEntityId: "greyhaven",
        kind: "inferred",
        sharedNotes: 4,
      },
    ];

    const edges = combineEdges([relationship("marrow", "greyhaven")], inferred);

    // Showing both implies two facts where the user asserted one.
    expect(edges).toHaveLength(1);
    expect(edges[0].kind).toBe("stated");
  });

  it("drops it regardless of which way the relationship was written", () => {
    const inferred: GraphEdge[] = [
      {
        sourceEntityId: "greyhaven",
        targetEntityId: "marrow",
        kind: "inferred",
        sharedNotes: 4,
      },
    ];

    expect(combineEdges([relationship("marrow", "greyhaven")], inferred)).toHaveLength(1);
  });

  it("keeps inferred edges that stand alone", () => {
    const inferred: GraphEdge[] = [
      { sourceEntityId: "a", targetEntityId: "b", kind: "inferred", sharedNotes: 2 },
    ];

    const edges = combineEdges([relationship("marrow", "greyhaven")], inferred);

    expect(edges).toHaveLength(2);
    expect(edges.filter((e) => e.kind === "inferred")).toHaveLength(1);
  });
});

describe("traversal", () => {
  /** marrow — greyhaven — cult — crown,  plus an unconnected island. */
  const edges: GraphEdge[] = [
    { sourceEntityId: "marrow", targetEntityId: "greyhaven", kind: "stated" },
    { sourceEntityId: "greyhaven", targetEntityId: "cult", kind: "stated" },
    { sourceEntityId: "cult", targetEntityId: "crown", kind: "stated" },
    { sourceEntityId: "island", targetEntityId: "islet", kind: "stated" },
  ];

  it("returns just the start at zero hops", () => {
    expect([...traverse(edges, "marrow", 0)]).toEqual(["marrow"]);
  });

  it("reaches direct neighbours at one hop", () => {
    expect([...traverse(edges, "marrow", 1)].sort()).toEqual(["greyhaven", "marrow"]);
  });

  it("reaches two hops, the PRD's example", () => {
    expect([...traverse(edges, "marrow", 2)].sort()).toEqual([
      "cult",
      "greyhaven",
      "marrow",
    ]);
  });

  it("follows edges in either direction", () => {
    // "crown" is only ever a target, but is still connected.
    expect([...traverse(edges, "crown", 1)].sort()).toEqual(["crown", "cult"]);
  });

  it("never crosses to an unconnected part of the graph", () => {
    const reached = traverse(edges, "marrow", 10);

    expect(reached.has("island")).toBe(false);
    expect(reached.has("islet")).toBe(false);
  });

  it("terminates on a cycle", () => {
    const cyclic: GraphEdge[] = [
      { sourceEntityId: "a", targetEntityId: "b", kind: "stated" },
      { sourceEntityId: "b", targetEntityId: "c", kind: "stated" },
      { sourceEntityId: "c", targetEntityId: "a", kind: "stated" },
    ];

    // Campaign graphs are full of cycles; a naive walk would not return.
    expect([...traverse(cyclic, "a", 10)].sort()).toEqual(["a", "b", "c"]);
  });

  it("handles a start with no edges at all", () => {
    expect([...traverse(edges, "unknown", 3)]).toEqual(["unknown"]);
  });
});
