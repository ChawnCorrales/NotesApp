/**
 * Folders against real storage.
 *
 * The guarantee being protected: filing is reversible and never destructive.
 * Deleting a folder must not take notes with it, and no move may put a folder
 * somewhere it cannot be reached from.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  createFolder,
  createNote,
  deleteFolder,
  moveFolder,
  moveNoteToFolder,
  renameFolder,
} from "@/lib/services";
import { buildFolderTree } from "@/lib/folders/tree";
import {
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

async function nest() {
  const { campaign } = fixture;
  const lore = await createFolder(campaign.id, "Lore");
  const factions = await createFolder(campaign.id, "Factions", lore.id);
  const cults = await createFolder(campaign.id, "Cults", factions.id);
  const sessions = await createFolder(campaign.id, "Sessions");
  return { lore, factions, cults, sessions };
}

const allFolders = () => db.folders.toArray();

describe("creating folders", () => {
  it("creates one at the top level", async () => {
    const folder = await createFolder(fixture.campaign.id, "Lore");

    expect(folder.parentFolderId).toBeNull();
    expect((await db.folders.get(folder.id))?.name).toBe("Lore");
  });

  it("nests one inside another", async () => {
    const { lore, cults } = await nest();

    const tree = buildFolderTree(await allFolders());
    const loreNode = tree.find((n) => n.folder.id === lore.id);
    expect(loreNode?.children[0].children[0].folder.id).toBe(cults.id);
  });

  it("falls back to a usable name when given none", async () => {
    const folder = await createFolder(fixture.campaign.id, "   ");

    expect(folder.name).toBe("New folder");
  });

  it("survives a reload", async () => {
    const { cults } = await nest();
    await reopenDatabase();

    expect((await db.folders.get(cults.id))?.name).toBe("Cults");
  });
});

describe("renaming", () => {
  it("renames a folder", async () => {
    const { lore } = await nest();

    await renameFolder(lore.id, "  Worldbuilding  ");

    expect((await db.folders.get(lore.id))?.name).toBe("Worldbuilding");
  });

  it("ignores an empty name rather than blanking the folder", async () => {
    const { lore } = await nest();

    await renameFolder(lore.id, "   ");

    expect((await db.folders.get(lore.id))?.name).toBe("Lore");
  });
});

describe("moving folders", () => {
  it("reparents into another folder", async () => {
    const { cults, sessions } = await nest();

    const result = await moveFolder(cults.id, sessions.id);

    expect(result.moved).toBe(true);
    expect((await db.folders.get(cults.id))?.parentFolderId).toBe(sessions.id);
  });

  it("moves back to the top level", async () => {
    const { cults } = await nest();

    await moveFolder(cults.id, null);

    expect((await db.folders.get(cults.id))?.parentFolderId).toBeNull();
  });

  it("refuses to move a folder into itself", async () => {
    const { lore } = await nest();

    const result = await moveFolder(lore.id, lore.id);

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/cannot be moved inside itself/);
    expect((await db.folders.get(lore.id))?.parentFolderId).toBeNull();
  });

  it("refuses to move a folder into its own descendant", async () => {
    const { lore, cults } = await nest();

    const result = await moveFolder(lore.id, cults.id);

    // Allowing this would detach Lore, Factions and Cults from the tree at once.
    expect(result.moved).toBe(false);
    expect((await db.folders.get(lore.id))?.parentFolderId).toBeNull();
    expect(buildFolderTree(await allFolders()).map((n) => n.folder.name).sort()).toEqual([
      "Lore",
      "Sessions",
    ]);
  });

  it("treats a move to the current parent as a no-op success", async () => {
    const { factions, lore } = await nest();

    const result = await moveFolder(factions.id, lore.id);

    expect(result.moved).toBe(true);
    expect((await db.folders.get(factions.id))?.parentFolderId).toBe(lore.id);
  });

  it("reports a folder that no longer exists", async () => {
    const result = await moveFolder("missing", null);

    expect(result.moved).toBe(false);
    expect(result.reason).toMatch(/no longer exists/);
  });

  it("carries the subtree along", async () => {
    const { lore, sessions, factions, cults } = await nest();

    await moveFolder(lore.id, sessions.id);

    // Children reference their parent by id, so the shape is preserved.
    expect((await db.folders.get(factions.id))?.parentFolderId).toBe(lore.id);
    expect((await db.folders.get(cults.id))?.parentFolderId).toBe(factions.id);
  });
});

describe("filing notes", () => {
  it("moves a note into a folder", async () => {
    const { lore } = await nest();
    const note = await createNote(fixture.campaign.id, { title: "Session 1" });

    await moveNoteToFolder(note.id, lore.id);

    expect((await db.notes.get(note.id))?.folderId).toBe(lore.id);
  });

  it("moves a note back to the top level", async () => {
    const { lore } = await nest();
    const note = await createNote(fixture.campaign.id, { folderId: lore.id });

    await moveNoteToFolder(note.id, null);

    expect((await db.notes.get(note.id))?.folderId).toBeNull();
  });

  it("leaves the note's content untouched", async () => {
    const { lore } = await nest();
    const note = await createNote(fixture.campaign.id, {
      title: "Session 1",
      contentText: "The party arrived.",
    });

    await moveNoteToFolder(note.id, lore.id);

    const reloaded = await db.notes.get(note.id);
    expect(reloaded?.title).toBe("Session 1");
    expect(reloaded?.contentText).toBe("The party arrived.");
  });
});

describe("deleting a folder", () => {
  it("lifts child folders to the parent instead of deleting them", async () => {
    const { factions, cults, lore } = await nest();

    const result = await deleteFolder(factions.id);

    expect(result.foldersMoved).toBe(1);
    expect(await db.folders.get(factions.id)).toBeUndefined();
    expect((await db.folders.get(cults.id))?.parentFolderId).toBe(lore.id);
  });

  it("lifts notes to the parent instead of deleting them", async () => {
    const { factions, lore } = await nest();
    const note = await createNote(fixture.campaign.id, {
      title: "Cult notes",
      folderId: factions.id,
    });

    const result = await deleteFolder(factions.id);

    expect(result.notesMoved).toBe(1);
    // Deleting a filing decision must never delete the filed work.
    expect((await db.notes.get(note.id))?.folderId).toBe(lore.id);
  });

  it("moves contents to the top level when deleting a root folder", async () => {
    const { lore, factions } = await nest();
    const note = await createNote(fixture.campaign.id, { folderId: lore.id });

    await deleteFolder(lore.id);

    expect((await db.folders.get(factions.id))?.parentFolderId).toBeNull();
    expect((await db.notes.get(note.id))?.folderId).toBeNull();
  });

  it("is a no-op for a folder that is already gone", async () => {
    const result = await deleteFolder("missing");

    expect(result).toEqual({ notesMoved: 0, foldersMoved: 0 });
  });

  it("leaves the tree navigable afterwards", async () => {
    const { factions } = await nest();

    await deleteFolder(factions.id);

    const tree = buildFolderTree(await allFolders());
    const lore = tree.find((n) => n.folder.name === "Lore");
    expect(lore?.children.map((c) => c.folder.name)).toEqual(["Cults"]);
  });
});
