/**
 * Guards against the indexed read paths silently reverting to full scans.
 *
 * A query that stops using its index returns exactly the same answers, just
 * slower — so correctness tests cannot catch it. What these compare is *shape*:
 * a bounded read against a whole-table read over the same data. If Recent goes
 * back to "load every note, sort, slice twelve", the ratio collapses and this
 * fails.
 *
 * Deliberately relative, never absolute. A millisecond budget tight enough to
 * mean something is also tight enough to fail on a busy machine.
 *
 * Scope note: the mention-count path is *not* timed here. `fake-indexeddb`
 * iterates a compound-index cursor pathologically slowly — 12,000 keys did not
 * finish in three minutes — while the same cursor takes 152ms in Chromium
 * against 277ms to load the equivalent rows. Timing it against the fake backend
 * would therefore measure the backend, and would have pushed the code towards
 * the slower option in production. Its correctness is covered in
 * `access-patterns.test.ts`.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { db, newId } from "@/lib/db/db";
import { listLiveNotes, listRecentNotes, listTrashedNotes } from "@/lib/services";
import { NOT_DELETED, type Note } from "@/lib/db/types";
import { createTestCampaign, resetDatabase } from "../helpers/campaign";

const NOTE_COUNT = 1_500;
const TRASHED_COUNT = 25;

let campaignId: string;

/** Best of several runs, to blunt scheduler noise. */
function fastest(fn: () => Promise<unknown>, runs = 3): Promise<number> {
  return (async () => {
    let best = Infinity;
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await fn();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  })();
}

beforeAll(async () => {
  await resetDatabase();
  const fixture = await createTestCampaign();
  campaignId = fixture.campaign.id;

  // Seeded in bulk rather than through the repositories: this is about read
  // shape, and 1,500 individual writes would dominate the runtime.
  const now = Date.now();
  const notes: Note[] = Array.from({ length: NOTE_COUNT }, (_, i) => ({
    id: newId(),
    campaignId,
    title: `Session ${i}`,
    content: "",
    contentText: `The party travelled for ${i} days.`,
    folderId: null,
    visibility: "gm",
    isLocked: false,
    localOnly: false,
    createdAt: now - i,
    updatedAt: now - i,
    syncVersion: 0,
    deletedAt: i < TRASHED_COUNT ? now - i : NOT_DELETED,
  }));
  await db.notes.bulkAdd(notes);
});

describe("recent notes", () => {
  it("returns the right rows", async () => {
    const recent = await listRecentNotes(campaignId, 12);

    expect(recent).toHaveLength(12);
    expect(recent.every((n) => n.deletedAt === NOT_DELETED)).toBe(true);
  });

  it("costs far less than reading the campaign", async () => {
    // Warm both paths so the comparison is not measuring first-call overhead.
    await listRecentNotes(campaignId, 12);
    await listLiveNotes(campaignId);

    const recent = await fastest(() => listRecentNotes(campaignId, 12));
    const everything = await fastest(() => listLiveNotes(campaignId));

    // Twelve rows off an ordered index versus ~1,475 rows. Reverting Recent to
    // load-sort-slice would bring these level.
    expect(recent).toBeLessThan(everything / 2);
  });
});

describe("trashed notes", () => {
  it("returns only the trashed ones", async () => {
    const trashed = await listTrashedNotes(campaignId);

    expect(trashed).toHaveLength(TRASHED_COUNT);
    expect(trashed.every((n) => n.deletedAt !== NOT_DELETED)).toBe(true);
  });

  it("costs far less than reading the campaign", async () => {
    await listTrashedNotes(campaignId);
    await listLiveNotes(campaignId);

    const trash = await fastest(() => listTrashedNotes(campaignId));
    const everything = await fastest(() => listLiveNotes(campaignId));

    expect(trash).toBeLessThan(everything / 2);
  });
});

