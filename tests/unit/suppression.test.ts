/**
 * False-positive correction (PRD §32).
 *
 * The rule being protected: a correction is a statement about one piece of
 * text. Marking one "Ash" wrong must never turn the entity off elsewhere —
 * that would punish the user for helping.
 */

import { describe, expect, it } from "vitest";
import {
  EntityRecognizer,
  filterSuppressed,
  suppressionKey,
} from "@/lib/entities/recognizer";
import type { Entity } from "@/lib/db/types";

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

const recognizer = EntityRecognizer.fromCampaign(
  [entity("ash", "Ash"), entity("marrow", "Marrow")],
  [],
);

const TEXT = "Ash spoke to Marrow. Ash left. Ash returned with Marrow.";

describe("suppressing a single occurrence", () => {
  it("removes only the occurrence that was marked", () => {
    const all = recognizer.findMatches(TEXT);
    const suppressed = new Set([suppressionKey("ash", 1)]);

    const kept = filterSuppressed(all, suppressed);

    const ashOccurrences = kept
      .filter((m) => m.entityId === "ash")
      .map((m) => m.occurrence);
    expect(ashOccurrences).toEqual([0, 2]);
  });

  it("leaves other entities untouched", () => {
    const all = recognizer.findMatches(TEXT);

    const kept = filterSuppressed(all, new Set([suppressionKey("ash", 0)]));

    expect(kept.filter((m) => m.entityId === "marrow")).toHaveLength(2);
  });

  it("does not renumber the surviving occurrences", () => {
    // The ordinals must stay anchored to what the matcher found. If filtering
    // renumbered them, suppressing occurrence 1 would silently shift the
    // suppression onto occurrence 2 on the next pass.
    const all = recognizer.findMatches(TEXT);

    const kept = filterSuppressed(all, new Set([suppressionKey("ash", 0)]));

    expect(kept.filter((m) => m.entityId === "ash").map((m) => m.occurrence)).toEqual(
      [1, 2],
    );
  });

  it("can suppress every occurrence independently", () => {
    const all = recognizer.findMatches(TEXT);

    const kept = filterSuppressed(
      all,
      new Set([
        suppressionKey("ash", 0),
        suppressionKey("ash", 1),
        suppressionKey("ash", 2),
      ]),
    );

    expect(kept.filter((m) => m.entityId === "ash")).toHaveLength(0);
    expect(kept.filter((m) => m.entityId === "marrow")).toHaveLength(2);
  });

  it("is a no-op when nothing is suppressed", () => {
    const all = recognizer.findMatches(TEXT);

    expect(filterSuppressed(all, new Set())).toEqual(all);
  });

  it("ignores a suppression for an occurrence that no longer exists", () => {
    // The user deletes a sentence; a suppression for occurrence 5 is now stale.
    // It must not throw or drop unrelated matches.
    const all = recognizer.findMatches("Ash waits.");

    const kept = filterSuppressed(all, new Set([suppressionKey("ash", 5)]));

    expect(kept).toHaveLength(1);
  });
});
