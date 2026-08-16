/**
 * The indexed read paths.
 *
 * Indexes are invisible when they regress: a query that quietly goes back to
 * reading the whole table returns the same answers, just slower, and nothing
 * fails. These pin the *contract* of each indexed helper — what it includes,
 * what it excludes, and in what order — so a change that breaks the index also
 * breaks a test.
 *
 * The companion guard is `tests/unit/access-patterns-performance.test.ts`,
 * which fails if the cost of these starts scaling with the campaign.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  addAlias,
  createNote,
  getBacklinks,
  getMentionCounts,
  getMentionPairs,
  listAliases,
  listEntityTypes,
  listLiveNotes,
  listRecentNotes,
  listTrashedNotes,
  reorderEntityTypes,
  trashNote,
} from "@/lib/db/repositories";
import { NOT_DELETED } from "@/lib/db/types";
import {
  createNoteWithText,
  createNpc,
  createTestCampaign,
  reopenDatabase,
  resetDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("live notes", () => {
  it("excludes trashed notes", async () => {
    const { campaign } = fixture;
    const live = await createNoteWithText(campaign.id, "Live", "Here.");
    const gone = await createNoteWithText(campaign.id, "Gone", "There.");
    await trashNote(gone.id);

    expect((await listLiveNotes(campaign.id)).map((n) => n.id)).toEqual([live.id]);
  });

  it("is scoped to one campaign", async () => {
    const other = await createTestCampaign();
    await createNoteWithText(fixture.campaign.id, "Mine", "A.");
    await createNoteWithText(other.campaign.id, "Theirs", "B.");

    expect((await listLiveNotes(fixture.campaign.id)).map((n) => n.title)).toEqual([
      "Mine",
    ]);
  });

  it("includes a note with no content", async () => {
    const note = await createNote(fixture.campaign.id, { title: "Blank" });

    expect((await listLiveNotes(fixture.campaign.id)).map((n) => n.id)).toEqual([
      note.id,
    ]);
  });

  it("marks new notes as live", async () => {
    const note = await createNote(fixture.campaign.id, { title: "New" });

    expect((await db.notes.get(note.id))?.deletedAt).toBe(NOT_DELETED);
  });
});

describe("the deletedAt invariant", () => {
  /**
   * This is the trap that actually bit, so it is worth stating outright.
   *
   * IndexedDB silently skips records whose indexed key is null or undefined.
   * Once `deletedAt` became part of an index, any note still holding a
   * non-numeric value fell out of every list while remaining perfectly intact
   * in storage — invisible, not lost, which is harder to notice and scarier to
   * see. Every write path must therefore produce a number.
   */
  it("makes a note with a non-numeric deletedAt invisible to indexed reads", async () => {
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Ghost", "Here.");
    expect(await listLiveNotes(campaign.id)).toHaveLength(1);

    // Simulating what an unmigrated row looks like.
    await db.notes.update(note.id, {
      deletedAt: null as unknown as number,
    });

    expect(await listLiveNotes(campaign.id)).toHaveLength(0);
    // Still there, just unreachable through the index.
    expect(await db.notes.get(note.id)).toBeTruthy();
  });

  it("writes a number on every path that touches deletedAt", async () => {
    const { campaign } = fixture;
    const created = await createNote(campaign.id, { title: "A" });
    expect(typeof created.deletedAt).toBe("number");

    await trashNote(created.id);
    expect(typeof (await db.notes.get(created.id))?.deletedAt).toBe("number");

    const { restoreNote } = await import("@/lib/db/repositories");
    const { EntityRecognizer } = await import("@/lib/entities/recognizer");
    await restoreNote(created.id, new EntityRecognizer([]));
    expect((await db.notes.get(created.id))?.deletedAt).toBe(NOT_DELETED);
  });
});

describe("recent notes", () => {
  it("returns the most recently edited first", async () => {
    const { campaign } = fixture;
    const first = await createNoteWithText(campaign.id, "First", "A.");
    await createNoteWithText(campaign.id, "Second", "B.");
    // Touch the older one so it becomes the most recent.
    await db.notes.update(first.id, { updatedAt: Date.now() + 1000 });

    expect((await listRecentNotes(campaign.id, 5)).map((n) => n.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("respects the limit", async () => {
    const { campaign } = fixture;
    for (let i = 0; i < 6; i++) {
      await createNoteWithText(campaign.id, `Note ${i}`, "Body.");
    }

    expect(await listRecentNotes(campaign.id, 3)).toHaveLength(3);
  });

  it("never surfaces a trashed note", async () => {
    const { campaign } = fixture;
    const gone = await createNoteWithText(campaign.id, "Gone", "A.");
    await trashNote(gone.id);

    expect(await listRecentNotes(campaign.id, 10)).toHaveLength(0);
  });
});

describe("trashed notes", () => {
  it("returns only trashed notes, newest deletion first", async () => {
    const { campaign } = fixture;
    const a = await createNoteWithText(campaign.id, "A", "1.");
    const b = await createNoteWithText(campaign.id, "B", "2.");
    await createNoteWithText(campaign.id, "Live", "3.");

    await trashNote(a.id);
    await db.notes.update(a.id, { deletedAt: 1_000 });
    await trashNote(b.id);
    await db.notes.update(b.id, { deletedAt: 2_000 });

    expect((await listTrashedNotes(campaign.id)).map((n) => n.title)).toEqual(["B", "A"]);
  });

  it("is empty when nothing has been deleted", async () => {
    await createNoteWithText(fixture.campaign.id, "Live", "A.");

    expect(await listTrashedNotes(fixture.campaign.id)).toHaveLength(0);
  });
});

describe("mention counts and pairs", () => {
  it("counts distinct notes, not occurrences", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow. Marrow. Marrow.");
    await createNoteWithText(campaign.id, "B", "Marrow.");

    expect((await getMentionCounts(campaign.id)).get(marrow.id)).toBe(2);
  });

  it("omits entities with no mentions", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    expect((await getMentionCounts(campaign.id)).get(marrow.id)).toBeUndefined();
  });

  it("is scoped to one campaign", async () => {
    const { campaign, npcType } = fixture;
    const other = await createTestCampaign();
    const mine = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow.");
    await createNpc(other.campaign.id, other.npcType.id, "Marrow");
    await createNoteWithText(other.campaign.id, "B", "Marrow.");

    const counts = await getMentionCounts(campaign.id);
    expect(counts.size).toBe(1);
    expect(counts.get(mine.id)).toBe(1);
  });

  it("returns one pair per entity per note", async () => {
    const { campaign, npcType, locationType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createNoteWithText(campaign.id, "A", "Marrow. Marrow. Greyhaven.");

    const pairs = await getMentionPairs(campaign.id);
    expect(pairs).toHaveLength(2);
  });
});

describe("backlinks", () => {
  it("lists a note once however many times it is named", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "A", "Marrow. Marrow. Marrow.");

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("orders by most recently edited", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const older = await createNoteWithText(campaign.id, "Older", "Marrow.");
    await createNoteWithText(campaign.id, "Newer", "Marrow.");
    await db.notes.update(older.id, { updatedAt: Date.now() + 5000 });

    expect((await getBacklinks(marrow.id)).map((n) => n.title)).toEqual([
      "Older",
      "Newer",
    ]);
  });
});

describe("aliases carry their campaign", () => {
  it("stamps the campaign when an alias is added", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");

    await addAlias(queen.id, "Verena");

    expect((await listAliases(campaign.id)).map((a) => a.alias)).toEqual(["Verena"]);
  });

  it("does not leak aliases across campaigns", async () => {
    const other = await createTestCampaign();
    const mine = await createNpc(fixture.campaign.id, fixture.npcType.id, "A");
    const theirs = await createNpc(other.campaign.id, other.npcType.id, "B");
    await addAlias(mine.id, "Mine");
    await addAlias(theirs.id, "Theirs");

    expect((await listAliases(fixture.campaign.id)).map((a) => a.alias)).toEqual(["Mine"]);
  });

  it("survives a reload", async () => {
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");
    await addAlias(queen.id, "Verena");

    await reopenDatabase();

    expect(await listAliases(campaign.id)).toHaveLength(1);
  });
});

describe("entity types come back in display order", () => {
  it("orders by sortOrder from the index", async () => {
    const { campaign, npcType, locationType } = fixture;

    await reorderEntityTypes([locationType.id, npcType.id]);

    expect((await listEntityTypes(campaign.id)).map((t) => t.id)).toEqual([
      locationType.id,
      npcType.id,
    ]);
  });

  it("is scoped to one campaign", async () => {
    const other = await createTestCampaign();

    const mine = await listEntityTypes(fixture.campaign.id);
    const theirs = await listEntityTypes(other.campaign.id);

    expect(mine).toHaveLength(2);
    expect(theirs).toHaveLength(2);
    expect(mine.map((t) => t.id)).not.toEqual(theirs.map((t) => t.id));
  });
});
