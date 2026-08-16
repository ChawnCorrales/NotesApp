/**
 * Turns raw string matches into entity mentions.
 *
 * The automaton in `aho-corasick.ts` answers "does this text contain this
 * string". This module answers the product question — "is this an actual
 * mention of the entity" — which needs two extra rules:
 *
 *  1. Word boundaries, so the entity "Marrow" is not found inside "Marrowbone".
 *  2. Overlap resolution, so "The Red Queen" wins over the nested "Queen"
 *     rather than both lighting up.
 */

import { AhoCorasick, type Pattern } from "./aho-corasick";
import type { Entity, EntityAlias, ID } from "../db/types";

export interface EntityMatch {
  start: number;
  end: number;
  entityId: ID;
  /** Literal text as it appears in the note, which may be an alias. */
  detectedText: string;
  /**
   * Zero-based index among this entity's matches in the same text, in document
   * order. This is what a per-occurrence suppression is keyed on.
   */
  occurrence: number;
}

/** Stable key for "this entity, this occurrence, in this note". */
export function suppressionKey(entityId: ID, occurrence: number): string {
  return `${entityId}:${occurrence}`;
}

/**
 * Drop occurrences the user has marked as "not this entity" (§32).
 *
 * Applied after matching rather than inside it, so that suppressing the third
 * "Ash" does not renumber the fourth — the ordinals stay anchored to what the
 * matcher found, not to what survived filtering.
 */
export function filterSuppressed(
  matches: EntityMatch[],
  suppressed: ReadonlySet<string>,
): EntityMatch[] {
  if (suppressed.size === 0) return matches;
  return matches.filter(
    (m) => !suppressed.has(suppressionKey(m.entityId, m.occurrence)),
  );
}

/**
 * Characters that count as "inside a word".
 *
 * Deliberately excludes the apostrophe so that "Marrow's shop" is recognised as
 * a mention of Marrow, and excludes the hyphen so that hyphenated constructions
 * still resolve to their parts.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * True when the span at [start, end) is not embedded in a longer word.
 *
 * Only applies the test at edges that are themselves word-like: an entity named
 * "[REDACTED]" or "#3" should still match when butted against a letter, since
 * there is no word for it to be buried inside.
 */
export function hasWordBoundaries(
  text: string,
  start: number,
  end: number,
): boolean {
  const firstChar = text[start];
  const lastChar = text[end - 1];

  if (isWordChar(firstChar) && isWordChar(text[start - 1])) return false;
  if (isWordChar(lastChar) && isWordChar(text[end])) return false;

  return true;
}

/**
 * Keep the leftmost, then longest, of any overlapping matches.
 *
 * Sorting by start ascending and length descending and then sweeping greedily
 * gives "leftmost-longest", the same rule lexers use. It is what makes a
 * multi-word alias beat a single-word one it contains.
 */
export function resolveOverlaps(matches: EntityMatch[]): EntityMatch[] {
  const sorted = [...matches].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );

  const kept: EntityMatch[] = [];
  let consumedUpTo = -1;

  for (const match of sorted) {
    if (match.start >= consumedUpTo) {
      kept.push(match);
      consumedUpTo = match.end;
    }
  }

  return kept;
}

/**
 * Builds the pattern list for a campaign: every auto-linkable entity's name
 * plus all of its aliases, each pointing back at the same entity id.
 */
export function buildPatterns(
  entities: Entity[],
  aliases: EntityAlias[],
): Pattern[] {
  const linkable = new Set(
    entities.filter((e) => e.autoLink).map((e) => e.id),
  );

  const patterns: Pattern[] = entities
    .filter((e) => linkable.has(e.id))
    .map((e) => ({ id: e.id, text: e.name }));

  for (const alias of aliases) {
    if (linkable.has(alias.entityId)) {
      patterns.push({ id: alias.entityId, text: alias.alias });
    }
  }

  return patterns;
}

/**
 * A compiled, reusable recogniser for one campaign's entity vocabulary.
 *
 * Construction is the expensive step, so callers hold onto an instance and only
 * rebuild it when entities or aliases change — never per keystroke.
 */
export class EntityRecognizer {
  private readonly automaton: AhoCorasick;

  readonly patternCount: number;

  constructor(patterns: Pattern[]) {
    this.automaton = new AhoCorasick(patterns);
    this.patternCount = patterns.length;
  }

  static fromCampaign(
    entities: Entity[],
    aliases: EntityAlias[],
  ): EntityRecognizer {
    return new EntityRecognizer(buildPatterns(entities, aliases));
  }

  /**
   * Every non-overlapping, word-bounded entity mention in `text`, in document
   * order, each numbered by its occurrence within its own entity.
   */
  findMatches(text: string): EntityMatch[] {
    if (this.automaton.isEmpty || text.length === 0) return [];

    const candidates: EntityMatch[] = [];

    for (const raw of this.automaton.search(text)) {
      if (!hasWordBoundaries(text, raw.start, raw.end)) continue;
      candidates.push({
        start: raw.start,
        end: raw.end,
        entityId: raw.id,
        detectedText: text.slice(raw.start, raw.end),
        // Assigned below, once overlaps have been resolved — numbering before
        // that would count matches that never survive.
        occurrence: 0,
      });
    }

    const resolved = resolveOverlaps(candidates);

    const seen = new Map<ID, number>();
    for (const match of resolved) {
      const next = seen.get(match.entityId) ?? 0;
      match.occurrence = next;
      seen.set(match.entityId, next + 1);
    }

    return resolved;
  }
}
