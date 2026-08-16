/**
 * Performance safeguard for entity recognition (PRD §63).
 *
 * The point is not to enforce a millisecond budget — that would make the suite
 * flaky on a loaded CI box. The point is to catch an *algorithmic* regression:
 * if someone replaces the automaton with a loop over entities, scan time starts
 * scaling with the entity count and these assertions fail loudly.
 *
 * Recognition runs on every keystroke, so a regression here is felt directly as
 * typing lag — the one thing §64 says the app must never cost the user.
 */

import { describe, expect, it } from "vitest";
import { EntityRecognizer } from "@/lib/entities/recognizer";
import type { Entity } from "@/lib/db/types";

const ENTITY_COUNT = 1_000;

function makeEntities(count: number, prefix = "Entity"): Entity[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    campaignId: "c1",
    name: `${prefix}${i}`,
    entityTypeId: "t1",
    description: "",
    autoLink: true,
    createdAt: 0,
    updatedAt: 0,
  }));
}

/** A note of roughly 40k characters — a long session write-up. */
function makeLongNote(entities: Entity[]): string {
  const filler =
    "The party made camp and argued about the road ahead, while rain worked " +
    "its way through the canvas and nobody volunteered for the first watch. ";

  const paragraphs: string[] = [];
  for (let i = 0; i < 200; i++) {
    // Sprinkle real mentions through the text so the matcher does real work
    // rather than failing fast at the root of the trie.
    const name = entities[(i * 7) % entities.length].name;
    paragraphs.push(`${filler}Then ${name} spoke up. ${filler}`);
  }
  return paragraphs.join("\n");
}

function timeMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

describe("recognition performance", () => {
  const entities = makeEntities(ENTITY_COUNT);
  const recognizer = EntityRecognizer.fromCampaign(entities, []);
  const note = makeLongNote(entities);

  it("builds an automaton over 1,000 entities quickly", () => {
    const elapsed = timeMs(() => EntityRecognizer.fromCampaign(entities, []));

    // Rebuilt only when the vocabulary changes, so this is generous on purpose.
    expect(elapsed).toBeLessThan(1_000);
  });

  it("scans a long note against 1,000 entities without stalling", () => {
    expect(note.length).toBeGreaterThan(40_000);

    const elapsed = timeMs(() => recognizer.findMatches(note));

    expect(elapsed).toBeLessThan(500);
  });

  it("actually finds the mentions it is scanning for", () => {
    // Guards against the performance numbers looking great because the matcher
    // silently stopped working.
    const matches = recognizer.findMatches(note);

    expect(matches.length).toBeGreaterThan(100);
  });

  it("scan time is driven by note length, not entity count", () => {
    const small = EntityRecognizer.fromCampaign(makeEntities(10), []);
    const large = EntityRecognizer.fromCampaign(makeEntities(ENTITY_COUNT), []);

    // Warm both so the comparison is not measuring first-call JIT.
    small.findMatches(note);
    large.findMatches(note);

    const smallTime = Math.max(timeMs(() => small.findMatches(note)), 0.1);
    const largeTime = timeMs(() => large.findMatches(note));

    // Aho-Corasick is O(text) regardless of pattern count. A per-entity loop
    // would make this ratio roughly 100x; the generous ceiling keeps the test
    // honest without making it a timing benchmark.
    expect(largeTime / smallTime).toBeLessThan(20);
  });

  it("handles a pathological note of repeated near-matches", () => {
    // Repeated prefixes are the worst case for a trie walk: every character
    // advances a node without ever completing a pattern.
    const recognizerForAsh = EntityRecognizer.fromCampaign(
      makeEntities(ENTITY_COUNT, "Ashen"),
      [],
    );
    const adversarial = "Ashen".repeat(20_000);

    const elapsed = timeMs(() => recognizerForAsh.findMatches(adversarial));

    expect(elapsed).toBeLessThan(1_000);
  });
});
