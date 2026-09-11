"use client";

/**
 * The campaign mind map (PRD §16–§18).
 *
 * The GM never builds this. Nodes are entities, solid edges are relationships
 * they stated explicitly, and dashed edges are co-occurrence — pairs that keep
 * turning up in the same notes. The dashed edges are the "emerged naturally
 * from writing" part of §61, and they are visually distinct because they are
 * inference, not canon (§32).
 */

import { useCallback, useMemo, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLiveQuery } from "dexie-react-hooks";
import { getCampaignGraph, traverse, type CampaignGraph } from "@/lib/services";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

/* Node sizing, estimated from the label at the graph's fixed 12px font. */
const NODE_PADDING_X = 28;
const NODE_CHAR_WIDTH = 7.1;
const NODE_HEIGHT = 32;

/** Breathing room between the graph's bounding box and the canvas edge. */
const GRAPH_MARGIN = 60;

/**
 * Lay entities out on concentric rings, grouped by category.
 *
 * Deterministic on purpose: a force simulation would rearrange the whole map
 * every time it is opened, and spatial memory is most of what makes a graph
 * navigable. Same campaign, same picture.
 */
function layout(
  ids: string[],
  ringIndex: number,
  ringCount: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const radius = 220 + ringIndex * 190;
  const offset = (ringIndex / Math.max(1, ringCount)) * Math.PI;

  ids.forEach((id, i) => {
    const angle = offset + (i / Math.max(1, ids.length)) * Math.PI * 2;
    positions.set(id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  });

  return positions;
}

export function GraphView() {
  const { campaign, entities, entityTypes, typeById } = useCampaign();
  const { navigate } = useNavigation();

  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showCoOccurrence, setShowCoOccurrence] = useState(true);
  /**
   * The entity the map is focused on, and how far out to follow it.
   *
   * The PRD's own example (§17) is "show only entities within two relationship
   * hops of Marrow", and two is the default for the reason it is the example:
   * one hop is usually too little to be interesting and three is usually most
   * of the campaign again.
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hops, setHops] = useState(2);

  const campaignId = campaign?.id;

  /**
   * The campaign graph as a domain object.
   *
   * Which entities are connected, and why, is decided by the graph service —
   * this component only decides how an edge looks. That split is what would let
   * a server answer the same question later without the view changing.
   */
  const graph = useLiveQuery(
    () =>
      campaignId
        ? getCampaignGraph(campaignId)
        : Promise.resolve<CampaignGraph>({ edges: [] }),
    [campaignId],
    { edges: [] } as CampaignGraph,
  );

  /**
   * Entities within `hops` of the focused one, or null when unfocused.
   *
   * Computed with `traverse` over the graph already in hand rather than
   * `getNeighbourhood`, which would ask the database the same question again.
   * The two are the same walk; the service version exists so a future HTTP
   * client can ask for a neighbourhood without downloading the whole graph.
   *
   * The walk runs over *all* edges, not the visible ones: hiding Locations
   * should not silently break the path between two Characters that runs
   * through one. Category filters apply to the result, not to the search.
   */
  const focusedIds = useMemo(() => {
    if (!focusId) return null;
    return new Set(traverse(graph.edges, focusId, hops));
  }, [graph.edges, focusId, hops]);

  const focusedEntity = useMemo(
    () => (focusId ? entities.find((e) => e.id === focusId) : undefined),
    [entities, focusId],
  );

  /**
   * Focusing on something that has since been deleted would show an empty map
   * with no way to tell why, so the focus is dropped instead.
   */
  const activeFocus = focusedEntity ? focusedIds : null;

  const visibleEntities = useMemo(
    () =>
      entities
        // The thing you focused on is always shown, even if its category is
        // hidden. Asking for Marrow and being shown everything around him
        // except Marrow reads as a bug, and the focus was the later and more
        // specific instruction.
        .filter((e) => e.id === focusId || !hiddenTypes.has(e.entityTypeId))
        .filter((e) => !activeFocus || activeFocus.has(e.id)),
    [entities, hiddenTypes, activeFocus, focusId],
  );
  const nodes = useMemo<Node[]>(() => {
    const byType = new Map<string, string[]>();
    for (const entity of visibleEntities) {
      const list = byType.get(entity.entityTypeId) ?? [];
      list.push(entity.id);
      byType.set(entity.entityTypeId, list);
    }

    const positions = new Map<string, { x: number; y: number }>();
    const typeIds = [...byType.keys()];
    typeIds.forEach((typeId, ringIndex) => {
      const ring = layout(byType.get(typeId) ?? [], ringIndex, typeIds.length);
      for (const [id, pos] of ring) positions.set(id, pos);
    });

    /**
     * Shift the whole layout into positive coordinates.
     *
     * Rings are generated around an origin, so roughly half of every graph has
     * negative coordinates and would sit off the top-left edge. React Flow's
     * `fitView` would normally absorb that, but it depends on the node
     * measurement pass that does not complete here — so the layout frames
     * itself instead, and the zoom controls handle graphs larger than the
     * canvas.
     */
    let minX = Infinity;
    let minY = Infinity;
    for (const pos of positions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
    }
    if (Number.isFinite(minX)) {
      for (const [id, pos] of positions) {
        positions.set(id, {
          x: pos.x - minX + GRAPH_MARGIN,
          y: pos.y - minY + GRAPH_MARGIN,
        });
      }
    }

    return visibleEntities.map((entity) => {
      const type = typeById.get(entity.entityTypeId);
      const color = `var(--entity-${type?.themeKey ?? "concept"})`;
      const label = `${type?.icon ?? "◇"}  ${entity.name}`;

      return {
        id: entity.id,
        position: positions.get(entity.id) ?? { x: 0, y: 0 },
        data: { label },
        // Declared rather than measured. React Flow keeps a node
        // `visibility: hidden` until its ResizeObserver reports a size, and
        // that pass does not complete here — so the graph would render an empty
        // canvas. The layout is deterministic and the font is fixed, so
        // estimating from label length is both sufficient and stable.
        width: Math.round(NODE_PADDING_X + label.length * NODE_CHAR_WIDTH),
        height: NODE_HEIGHT,
        style: {
          background: "var(--bg-raised)",
          border: `1px solid ${color}`,
          borderRadius: 6,
          color: "var(--ink)",
          fontSize: 12,
          padding: "6px 10px",
          // No explicit width: React Flow measures each node before revealing
          // it, and an "auto" width leaves it permanently hidden.
          whiteSpace: "nowrap",
        },
      } satisfies Node;
    });
  }, [visibleEntities, typeById]);

  /**
   * Styling for the edges the service produced.
   *
   * Inferred connections are dashed and unlabelled so they never read as
   * something the GM stated — §32 keeps suggestion visibly separate from canon.
   */
  const edges = useMemo<Edge[]>(() => {
    const visible = new Set(visibleEntities.map((e) => e.id));

    return graph.edges
      .filter(
        (edge) =>
          visible.has(edge.sourceEntityId) && visible.has(edge.targetEntityId),
      )
      .filter((edge) => showCoOccurrence || edge.kind === "stated")
      .map((edge) => ({
        id: `${edge.kind}-${edge.sourceEntityId}-${edge.targetEntityId}`,
        source: edge.sourceEntityId,
        target: edge.targetEntityId,
        ...(edge.kind === "stated"
          ? {
              label: edge.label,
              labelStyle: { fill: "var(--ink-muted)", fontSize: 10 },
              labelBgStyle: { fill: "var(--bg-surface)" },
              style: { stroke: "var(--accent-candle)" },
            }
          : {
              style: {
                stroke: "var(--border-strong)",
                strokeDasharray: "4 4",
              },
            }),
      }));
  }, [graph, visibleEntities, showCoOccurrence]);

  /** Changes whenever the rendered graph differs — including entity renames. */
  const graphKey = useMemo(
    () =>
      `${focusId ?? "all"}@${hops}#${nodes
        .map((n) => `${n.id}:${String(n.data.label)}`)
        .join("|")}#${edges.map((e) => e.id).join("|")}`,
    [nodes, edges, focusId, hops],
  );

  const toggleType = useCallback((typeId: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  }, []);

  if (entities.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-ink-faint">
        <p>The map is empty.</p>
        <p className="max-w-sm text-sm">
          Highlight a name while writing and create an entity from it. The graph
          builds itself from there.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-hair px-6 py-3">
        {entityTypes.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => toggleType(type.id)}
            aria-pressed={!hiddenTypes.has(type.id)}
            className={`rounded border px-2 py-0.5 text-xs transition-opacity ${
              hiddenTypes.has(type.id)
                ? "border-hair text-ink-faint opacity-50"
                : "border-strong text-ink-muted"
            }`}
          >
            {type.icon} {type.name}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={showCoOccurrence}
            onChange={(e) => setShowCoOccurrence(e.target.checked)}
          />
          Suggested connections
        </label>
      </div>

      {/*
        Focus is its own row rather than another chip among the category
        filters. Hiding a category subtracts from the map; focusing replaces
        what the map is *of*, and reading as the same kind of control would
        make that hard to notice.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-hair px-6 py-2 text-xs">
        <label className="flex items-center gap-2 text-ink-muted">
          Focus on
          <select
            value={focusId ?? ""}
            aria-label="Focus on an entity"
            onChange={(e) => setFocusId(e.target.value || null)}
            className="rounded border border-hair bg-surface px-2 py-1 text-xs text-ink-muted"
          >
            <option value="">the whole campaign</option>
            {entities
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
          </select>
        </label>

        {focusedEntity && (
          <>
            <span className="text-ink-faint">within</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  data-testid={`hops-${n}`}
                  aria-pressed={hops === n}
                  onClick={() => setHops(n)}
                  className={`rounded border px-2 py-0.5 transition-colors ${
                    hops === n
                      ? "border-candle text-candle"
                      : "border-hair text-ink-faint hover:text-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-ink-faint">
              {hops === 1 ? "hop" : "hops"}
            </span>

            {/* The count is the useful part: it says whether focusing
                actually narrowed anything. */}
            <span data-testid="focus-summary" className="text-ink-faint">
              · showing {visibleEntities.length} of {entities.length}
            </span>

            <button
              type="button"
              data-testid="clear-focus"
              onClick={() => setFocusId(null)}
              className="ml-auto rounded border border-hair px-2 py-0.5 text-ink-muted transition-colors hover:border-strong hover:text-ink"
            >
              Show the whole map
            </button>
          </>
        )}
      </div>

      <div className="flex-1">
        <ReactFlow
          /**
           * Uncontrolled, and remounted when the graph's contents change.
           *
           * React Flow measures each node and writes the result back through
           * `onNodesChange`; driving `nodes` as a controlled prop without that
           * handler means the measurement is discarded and every node stays
           * `visibility: hidden` forever. Letting React Flow own the node state
           * avoids that, and re-keying on content change also re-runs `fitView`
           * so a newly filtered graph arrives framed.
           */
          key={graphKey}
          defaultNodes={nodes}
          defaultEdges={edges}
          minZoom={0.1}
          proOptions={{ hideAttribution: false }}
          onNodeClick={(_event, node) =>
            navigate({ kind: "entity", entityId: node.id })
          }
        >
          <Background color="var(--border-hair)" gap={28} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
