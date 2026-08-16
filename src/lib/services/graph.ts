/**
 * Graph traversal (PRD §16–§17).
 *
 * The campaign graph is a domain object, not a drawing. Everything here is
 * about which entities are connected and how far apart they are; nothing knows
 * about nodes, pixels, or React Flow. That separation is what would let a
 * server answer "give me everything within two hops of Marrow" without the
 * client computing it, and lets the view change without touching the meaning.
 */

import type { ID, Relationship } from "../db/types";
import { getMentionPairs } from "./repository";
import { listRelationships } from "./reads";

/** Below this many shared notes, co-occurrence is noise rather than signal. */
export const CO_OCCURRENCE_THRESHOLD = 2;

export interface GraphEdge {
  sourceEntityId: ID;
  targetEntityId: ID;
  /** Stated by the user, or inferred from appearing together. */
  kind: "stated" | "inferred";
  /** The relationship's label; absent for inferred edges. */
  label?: string;
  /** How many notes the pair share; only meaningful when inferred. */
  sharedNotes?: number;
}

export interface CampaignGraph {
  edges: GraphEdge[];
}

function pairKey(a: ID, b: ID): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Entities that repeatedly appear in the same notes.
 *
 * This is the "connections reveal themselves" half of the product: the GM never
 * states these, they fall out of the writing. Kept separate from stated
 * relationships throughout, because §32 requires inference to stay visibly
 * distinct from campaign canon.
 */
export function inferCoOccurrence(
  pairs: { noteId: ID; entityId: ID }[],
  threshold = CO_OCCURRENCE_THRESHOLD,
): GraphEdge[] {
  const byNote = new Map<ID, Set<ID>>();
  for (const { noteId, entityId } of pairs) {
    let set = byNote.get(noteId);
    if (!set) {
      set = new Set();
      byNote.set(noteId, set);
    }
    set.add(entityId);
  }

  const counts = new Map<string, number>();
  for (const entities of byNote.values()) {
    const sorted = [...entities].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = pairKey(sorted[i], sorted[j]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  const edges: GraphEdge[] = [];
  for (const [key, sharedNotes] of counts) {
    if (sharedNotes < threshold) continue;
    const [sourceEntityId, targetEntityId] = key.split("|");
    edges.push({ sourceEntityId, targetEntityId, kind: "inferred", sharedNotes });
  }
  return edges;
}

/**
 * Combines stated relationships with inferred ones.
 *
 * A stated relationship always wins: if the GM has written the connection down,
 * showing an inferred edge underneath it is clutter that implies two facts
 * where there is one.
 */
export function combineEdges(
  relationships: Relationship[],
  inferred: GraphEdge[],
): GraphEdge[] {
  const stated: GraphEdge[] = relationships.map((r) => ({
    sourceEntityId: r.sourceEntityId,
    targetEntityId: r.targetEntityId,
    kind: "stated",
    label: r.relationshipType,
  }));

  const claimed = new Set(
    stated.map((e) => pairKey(e.sourceEntityId, e.targetEntityId)),
  );

  return [
    ...stated,
    ...inferred.filter((e) => !claimed.has(pairKey(e.sourceEntityId, e.targetEntityId))),
  ];
}

/** The whole campaign graph: stated relationships plus inferred connections. */
export async function getCampaignGraph(campaignId: ID): Promise<CampaignGraph> {
  const [relationships, pairs] = await Promise.all([
    listRelationships(campaignId),
    getMentionPairs(campaignId),
  ]);

  return { edges: combineEdges(relationships, inferCoOccurrence(pairs)) };
}

/**
 * Every entity within `hops` steps of a starting entity.
 *
 * The PRD's §17 example — "show only entities within two relationship hops of
 * Marrow" — and the natural shape of a future `GET /entities/:id/neighbourhood`.
 * Breadth-first, so `hops` means what a reader expects.
 */
export function traverse(
  edges: GraphEdge[],
  startEntityId: ID,
  hops: number,
): Set<ID> {
  const neighbours = new Map<ID, ID[]>();
  for (const edge of edges) {
    const a = neighbours.get(edge.sourceEntityId) ?? [];
    a.push(edge.targetEntityId);
    neighbours.set(edge.sourceEntityId, a);

    const b = neighbours.get(edge.targetEntityId) ?? [];
    b.push(edge.sourceEntityId);
    neighbours.set(edge.targetEntityId, b);
  }

  const reached = new Set<ID>([startEntityId]);
  let frontier: ID[] = [startEntityId];

  for (let depth = 0; depth < hops; depth++) {
    const next: ID[] = [];
    for (const id of frontier) {
      for (const neighbour of neighbours.get(id) ?? []) {
        // The visited check is what stops a cycle looping forever; campaign
        // graphs are full of them.
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        next.push(neighbour);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return reached;
}

/** Entities within `hops` of a start, using the campaign's current graph. */
export async function getNeighbourhood(
  campaignId: ID,
  startEntityId: ID,
  hops: number,
): Promise<Set<ID>> {
  const { edges } = await getCampaignGraph(campaignId);
  return traverse(edges, startEntityId, hops);
}
