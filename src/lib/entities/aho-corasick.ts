/**
 * Aho-Corasick multi-pattern string matching.
 *
 * Entity recognition has to find any of N entity names or aliases inside a note
 * on every keystroke. Running N separate searches is O(N × text); Aho-Corasick
 * is O(text + matches) regardless of how many patterns there are, which is what
 * keeps typing responsive at the PRD's target of 10,000 entities (§63).
 *
 * The automaton is built once per campaign and rebuilt only when the set of
 * entity names or aliases changes, not on every edit.
 */

export interface Pattern {
  /** Caller-defined identity; the recogniser uses the entity id. */
  id: string;
  /** The literal text to match, e.g. "Marrow" or "The Crimson Monarch". */
  text: string;
}

export interface RawMatch {
  /** Index of the first character of the match, in the searched string. */
  start: number;
  /** Index one past the last character of the match. */
  end: number;
  id: string;
  /** The pattern text that matched, in its original casing. */
  pattern: string;
}

interface TrieNode {
  next: Map<number, TrieNode>;
  fail: TrieNode | null;
  /** Patterns ending at this node, including those inherited via fail links. */
  outputs: Pattern[];
  depth: number;
}

function createNode(depth: number): TrieNode {
  return { next: new Map(), fail: null, outputs: [], depth };
}

/**
 * Lowercase `input` without changing its length.
 *
 * Matching is case-insensitive, but every match index is used to position a
 * decoration in the original text, so the normalised string must stay in
 * 1:1 correspondence with it. A handful of code points (ẞ, İ, and the Turkish
 * dotted forms) lowercase to a different number of UTF-16 units, which would
 * silently shift every subsequent offset. Those are rare enough that the fast
 * path handles the whole string at once and only falls back when the length
 * actually changed.
 */
export function toLowerPreservingLength(input: string): string {
  const lowered = input.toLowerCase();
  if (lowered.length === input.length) return lowered;

  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const lower = ch.toLowerCase();
    // Keep the original unit when lowercasing would change the width.
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}

export class AhoCorasick {
  private readonly root: TrieNode = createNode(0);

  /** True when no patterns were supplied, letting callers skip the scan. */
  readonly isEmpty: boolean;

  constructor(patterns: Pattern[]) {
    const usable = patterns.filter((p) => p.text.trim().length > 0);
    this.isEmpty = usable.length === 0;

    for (const pattern of usable) {
      this.insert(pattern);
    }
    this.buildFailureLinks();
  }

  private insert(pattern: Pattern): void {
    const text = toLowerPreservingLength(pattern.text);
    let node = this.root;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      let child = node.next.get(code);
      if (!child) {
        child = createNode(node.depth + 1);
        node.next.set(code, child);
      }
      node = child;
    }
    node.outputs.push(pattern);
  }

  /**
   * Wire up failure links breadth-first.
   *
   * Each node's fail link points at the longest proper suffix of its path that
   * is also a prefix of some pattern. Outputs are merged along the way so a
   * match check is a single array read rather than a walk up the fail chain.
   */
  private buildFailureLinks(): void {
    const queue: TrieNode[] = [];

    for (const child of this.root.next.values()) {
      child.fail = this.root;
      queue.push(child);
    }

    for (let head = 0; head < queue.length; head++) {
      const node = queue[head];

      for (const [code, child] of node.next) {
        let fallback = node.fail;
        while (fallback && !fallback.next.has(code)) {
          fallback = fallback.fail;
        }
        child.fail = fallback?.next.get(code) ?? this.root;
        child.outputs = child.outputs.concat(child.fail.outputs);
        queue.push(child);
      }
    }
  }

  /**
   * Find every pattern occurrence in `haystack`, including overlaps.
   *
   * Results come back in order of end position. Callers are expected to filter
   * for word boundaries and resolve overlaps themselves — see `recognizer.ts` —
   * because those rules are about what counts as a *mention*, not about string
   * matching.
   */
  search(haystack: string): RawMatch[] {
    if (this.isEmpty) return [];

    const text = toLowerPreservingLength(haystack);
    const matches: RawMatch[] = [];
    let node: TrieNode = this.root;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      while (node !== this.root && !node.next.has(code)) {
        node = node.fail ?? this.root;
      }
      node = node.next.get(code) ?? this.root;

      for (const pattern of node.outputs) {
        const end = i + 1;
        matches.push({
          start: end - pattern.text.length,
          end,
          id: pattern.id,
          pattern: pattern.text,
        });
      }
    }

    return matches;
  }
}
