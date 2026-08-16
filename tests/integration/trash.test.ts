/**
 * Deleting notes (PRD §23).
 *
 * Deleting a note destroys writing, so the delete gesture is a soft one. The
 * properties worth protecting: a trashed note disappears from *everywhere* it
 * used to appear, restoring reproduces exactly what trashing removed, and
 * nothing brings a trashed note back by accident.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import { NOT_DELETED } from "@/lib/db/types";
import {
  createNote,
  deleteNote,
  emptyTrash,
  getBacklinks,
  getMentionCounts,
  listTrashedNotes,
  reindexCampaign,
  restoreNote,
  trashNote,
} from "@/lib/services";
import {
  createNoteWithText,
  createNpc,
  createTestCampaign,
  reopenDatabase,
  resetDatabase,
  writeNote,
  type TestCampaign,
  noteCountFor,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("moving a note to the trash", () => {
  it("keeps the note and its content", async () => {
    const note = await createNoteWithText(fixture.campaign.id, "S1", "The party rested.");

    await trashNote(note.id);

    const reloaded = await db.notes.get(note.id);
    expect(reloaded).toBeTruthy();
    expect(reloaded?.contentText).toBe("The party rested.");
    expect(reloaded?.deletedAt).toBeTypeOf("number");
  });

  it("lists it in the trash", async () => {
    const note = await createNoteWithText(fixture.campaign.id, "S1", "Text.");

    await trashNote(note.id);

    expect((await listTrashedNotes(fixture.campaign.id)).map((n) => n.id)).toEqual([
      note.id,
    ]);
  });

  it("removes it from an entity's backlinks", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");
    expect(await getBacklinks(marrow.id)).toHaveLength(1);

    await trashNote(note.id);

    expect(await getBacklinks(marrow.id)).toHaveLength(0);
  });

  it("removes it from mention counts", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    await trashNote(note.id);

    expect(noteCountFor(await getMentionCounts(campaign.id), marrow.id)).toBeUndefined();
  });

  it("removes its tasks from the task viewer", async () => {
    const { campaign } = fixture;
    const note = await createNote({ campaignId: campaign.id, title: "Prep" });
    await db.tasks.add({
      id: "t1",
      campaignId: campaign.id,
      noteId: note.id,
      text: "Stat the Ashen Knight",
      completed: false,
      dueDate: null,
      createdAt: 0,
    });

    await trashNote(note.id);

    expect(await db.tasks.count()).toBe(0);
  });

  it("leaves other notes untouched", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const trashed = await createNoteWithText(campaign.id, "A", "Marrow waits.");
    await createNoteWithText(campaign.id, "B", "Marrow again.");

    await trashNote(trashed.id);

    expect((await getBacklinks(marrow.id)).map((n) => n.title)).toEqual(["B"]);
  });

  it("survives a reload", async () => {
    const note = await createNoteWithText(fixture.campaign.id, "S1", "Text.");
    await trashNote(note.id);

    await reopenDatabase();

    expect((await listTrashedNotes(fixture.campaign.id)).map((n) => n.id)).toEqual([
      note.id,
    ]);
  });
});

describe("a trashed note stays out of the index", () => {
  it("is not re-indexed when the entity vocabulary changes", async () => {
    const { campaign, npcType } = fixture;
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");
    await trashNote(note.id);

    // Flagging a name later triggers a campaign-wide reindex. Without an
    // explicit exclusion this silently resurrects the trashed note's backlinks.
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await reindexCampaign(campaign.id);

    expect(await getBacklinks(marrow.id)).toHaveLength(0);
    expect(await db.entityMentions.where("noteId").equals(note.id).count()).toBe(0);
  });
});

describe("restoring", () => {
  it("brings the note back out of the trash", async () => {
    const note = await createNoteWithText(fixture.campaign.id, "S1", "Text.");
    await trashNote(note.id);

    await restoreNote(note.id);

    expect((await db.notes.get(note.id))?.deletedAt).toBe(NOT_DELETED);
    expect(await listTrashedNotes(fixture.campaign.id)).toHaveLength(0);
  });

  it("rebuilds its backlinks", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");
    await trashNote(note.id);

    await restoreNote(note.id);

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("recognises entities flagged while it sat in the trash", async () => {
    const { campaign, npcType } = fixture;
    const note = await createNoteWithText(campaign.id, "S1", "Greyhaven is quiet.");
    await trashNote(note.id);

    // The GM flags the name while the note is in the trash.
    const greyhaven = await createNpc(campaign.id, npcType.id, "Greyhaven");
    await restoreNote(note.id);

    expect((await getBacklinks(greyhaven.id)).map((n) => n.id)).toEqual([note.id]);
  });

  it("rebuilds its tasks from the stored document", async () => {
    const { campaign } = fixture;
    const note = await createNote({ campaignId: campaign.id,
      title: "Prep",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Name the inn" }] },
                ],
              },
            ],
          },
        ],
      }),
    });
    await trashNote(note.id);
    expect(await db.tasks.count()).toBe(0);

    await restoreNote(note.id);

    const tasks = await db.tasks.toArray();
    expect(tasks.map((t) => t.text)).toEqual(["Name the inn"]);
  });

  it("copes with a note that has no content", async () => {
    const note = await createNote({ campaignId: fixture.campaign.id, title: "Blank" });
    await trashNote(note.id);

    await restoreNote(note.id);

    expect((await db.notes.get(note.id))?.deletedAt).toBe(NOT_DELETED);
  });

  it("is a no-op for a note that no longer exists", async () => {
    await expect(restoreNote("missing")).resolves.toBeUndefined();
  });
});

describe("permanent deletion", () => {
  it("removes the note for good", async () => {
    const note = await createNoteWithText(fixture.campaign.id, "S1", "Text.");
    await trashNote(note.id);

    await deleteNote(note.id);

    expect(await db.notes.get(note.id)).toBeUndefined();
    expect(await listTrashedNotes(fixture.campaign.id)).toHaveLength(0);
  });

  it("empties the whole trash", async () => {
    const { campaign } = fixture;
    const a = await createNoteWithText(campaign.id, "A", "One.");
    const b = await createNoteWithText(campaign.id, "B", "Two.");
    const kept = await createNoteWithText(campaign.id, "C", "Three.");
    await trashNote(a.id);
    await trashNote(b.id);

    const removed = await emptyTrash(campaign.id);

    expect(removed).toBe(2);
    expect(await db.notes.count()).toBe(1);
    expect((await db.notes.get(kept.id))?.title).toBe("C");
  });

  it("leaves live notes alone when the trash is empty", async () => {
    await createNoteWithText(fixture.campaign.id, "A", "One.");

    expect(await emptyTrash(fixture.campaign.id)).toBe(0);
    expect(await db.notes.count()).toBe(1);
  });
});

describe("editing after a restore", () => {
  it("saves normally and re-indexes", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Nothing here.");
    await trashNote(note.id);
    await restoreNote(note.id);

    await writeNote(campaign.id, note.id, "Marrow returns.");

    expect((await getBacklinks(marrow.id)).map((n) => n.id)).toEqual([note.id]);
  });
});
