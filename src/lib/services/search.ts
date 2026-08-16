/**
 * Campaign search (PRD §26).
 *
 * Lives in the service layer rather than the view because it is a domain
 * operation, not a rendering concern: the same query, over the same fields,
 * with the same alias resolution, is exactly what a server endpoint would
 * expose. The component's job is to display the result.
 *
 * The current implementation scans note text in memory. That is correct and
 * fast for realistic campaigns, and it is deliberately behind this function so
 * that swapping in an index — or a server-side query — changes nothing above.
 */

import type { Entity, EntityAlias, ID, Note } from "../db/types";
import { listLiveNotes } from "./repository";

/** Characters of surrounding text to show around a hit. */
const SNIPPET_RADIUS = 90;

export interface NoteHit {
  note: Note;
  /** Surrounding text, or empty when the match was in the title only. */
  snippet: string;
}

export interface EntityHit {
  entity: Entity;
  /** The alias that matched, when the entity's own name did not. */
  via: string | null;
}

export interface SearchResults {
  notes: NoteHit[];
  entities: EntityHit[];
}

function buildSnippet(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + queryLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/**
 * Matches notes by title and body.
 *
 * Trashed notes are excluded by `listLiveNotes`, so a deleted note cannot
 * surface in results — which would be a small privacy surprise as well as a
 * usability one.
 */
export function searchNotes(notes: Note[], query: string): NoteHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: NoteHit[] = [];
  for (const note of notes) {
    const haystack = `${note.title}\n${note.contentText}`.toLowerCase();
    if (!haystack.includes(needle)) continue;

    const contentIndex = note.contentText.toLowerCase().indexOf(needle);
    hits.push({
      note,
      snippet:
        contentIndex >= 0
          ? buildSnippet(note.contentText, contentIndex, needle.length)
          : "",
    });
  }

  return hits.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
}

/**
 * Matches entities by name, falling back to their aliases.
 *
 * Searching "Verena" has to find the Red Queen, or the alias system is invisible
 * exactly where it would be most useful.
 */
export function searchEntities(
  entities: Entity[],
  aliases: EntityAlias[],
  query: string,
): EntityHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const aliasesByEntity = new Map<ID, string[]>();
  for (const alias of aliases) {
    const list = aliasesByEntity.get(alias.entityId) ?? [];
    list.push(alias.alias);
    aliasesByEntity.set(alias.entityId, list);
  }

  const hits: EntityHit[] = [];
  for (const entity of entities) {
    if (entity.name.toLowerCase().includes(needle)) {
      hits.push({ entity, via: null });
      continue;
    }
    const matched = (aliasesByEntity.get(entity.id) ?? []).find((a) =>
      a.toLowerCase().includes(needle),
    );
    if (matched) hits.push({ entity, via: matched });
  }

  return hits;
}

/**
 * The whole search, as one call.
 *
 * Entities and aliases are passed in because the campaign context already holds
 * them for the recogniser; re-reading them here would duplicate work on every
 * keystroke. A server implementation would load them itself.
 */
export async function searchCampaign(
  campaignId: ID,
  query: string,
  vocabulary: { entities: Entity[]; aliases: EntityAlias[] },
): Promise<SearchResults> {
  if (!query.trim()) return { notes: [], entities: [] };

  const notes = await listLiveNotes(campaignId);
  return {
    notes: searchNotes(notes, query),
    entities: searchEntities(vocabulary.entities, vocabulary.aliases, query),
  };
}
