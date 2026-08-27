/**
 * Exporting a campaign to files.
 *
 * The promise being tested is that an export is a faithful copy of what the
 * user believes their campaign to be — every live note, every entity, the
 * folder structure, and the connections. A backup that quietly omits something
 * is worse than no backup, because it is only discovered when it is needed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  addAlias,
  createFolder,
  createNote,
  exportCampaign,
  exportNote,
  moveNoteToFolder,
  trashNote,
} from "@/lib/services";
import { createZip } from "@/lib/export/zip";
import { safeFileName, uniquePath } from "@/lib/export/files";
import {
  createNoteWithText,
  createNpc,
  createTestCampaign,
  resetDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

/** Paths in an export, for asserting on structure rather than content. */
function paths(files: { path: string }[]): string[] {
  return files.map((f) => f.path).sort();
}

describe("exporting one note", () => {
  it("names the file after the note and writes its title", async () => {
    const note = await createNoteWithText(
      fixture.campaign.id,
      "Session 12",
      "They met at dusk.",
    );

    const file = await exportNote(note.id);

    expect(file?.path).toBe("Session 12.md");
    expect(file?.content).toContain("title: Session 12");
    expect(file?.content).toContain("They met at dusk.");
  });

  it("wikilinks the entities it mentions", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "S1", "Marrow waits.");

    const file = await exportNote(note.id);

    expect(file?.content).toContain("[[Marrow]] waits.");
  });

  it("does not link an occurrence the user rejected", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Ash");
    const note = await createNoteWithText(campaign.id, "S1", "Ash spoke. Ash left.");

    const { suppressMention } = await import("@/lib/services");
    await suppressMention({
      campaignId: campaign.id,
      noteId: note.id,
      entityId: marrow.id,
      occurrenceIndex: 1,
    });

    const file = await exportNote(note.id);

    expect(file?.content).toContain("[[Ash]] spoke.");
    expect(file?.content?.match(/\[\[/g)).toHaveLength(1);
  });

  it("returns nothing for a note that does not exist", async () => {
    expect(await exportNote("nope")).toBeNull();
  });
});

describe("exporting a campaign", () => {
  it("includes every live note and every entity", async () => {
    const { campaign, npcType } = fixture;
    await createNoteWithText(campaign.id, "Session 1", "One.");
    await createNoteWithText(campaign.id, "Session 2", "Two.");
    await createNpc(campaign.id, npcType.id, "Marrow");

    const files = await exportCampaign(campaign.id);

    expect(paths(files)).toEqual([
      "Entities/Marrow.md",
      "Session 1.md",
      "Session 2.md",
    ]);
  });

  it("mirrors the folder tree", async () => {
    const { campaign } = fixture;
    const logs = await createFolder(campaign.id, "Session Logs");
    const act = await createFolder(campaign.id, "Act One", logs.id);
    const note = await createNoteWithText(campaign.id, "Session 12", "Text.");
    await moveNoteToFolder(note.id, act.id);

    const files = await exportCampaign(campaign.id);

    expect(paths(files)).toEqual(["Session Logs/Act One/Session 12.md"]);
  });

  it("writes the folder into the front matter as well as the path", async () => {
    const { campaign } = fixture;
    const folder = await createFolder(campaign.id, "Lore");
    const note = await createNoteWithText(campaign.id, "Gods", "Text.");
    await moveNoteToFolder(note.id, folder.id);

    const [file] = await exportCampaign(campaign.id);

    // Both, so re-importing restores the tree even if the files get moved.
    expect(file.path).toBe("Lore/Gods.md");
    expect(file.content).toContain("folder: Lore");
  });

  it("leaves trashed notes out", async () => {
    const { campaign } = fixture;
    const kept = await createNoteWithText(campaign.id, "Kept", "One.");
    const gone = await createNoteWithText(campaign.id, "Gone", "Two.");
    await trashNote(gone.id);

    const files = await exportCampaign(campaign.id);

    // The user has already said this is not part of the campaign.
    expect(paths(files)).toEqual(["Kept.md"]);
    expect(kept.id).toBeTruthy();
  });

  it("writes an entity with its category and aliases", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await addAlias(marrow.id, "Old Marrow");

    const files = await exportCampaign(campaign.id);
    const entity = files.find((f) => f.path === "Entities/Marrow.md");

    expect(entity?.content).toContain("type: entity");
    expect(entity?.content).toContain("name: Marrow");
    expect(entity?.content).toContain("category: NPC");
    expect(entity?.content).toContain("- Old Marrow");
  });

  it("does not let two notes with one title overwrite each other", async () => {
    const { campaign } = fixture;
    await createNote({ campaignId: campaign.id, title: "Session 1" });
    await createNote({ campaignId: campaign.id, title: "Session 1" });

    const files = await exportCampaign(campaign.id);

    // Losing a note during the operation performed *because* you fear losing
    // notes would be the worst possible bug in this feature.
    expect(files).toHaveLength(2);
    expect(new Set(paths(files)).size).toBe(2);
  });

  it("exports an empty campaign as nothing", async () => {
    expect(await exportCampaign(fixture.campaign.id)).toEqual([]);
  });
});

describe("file names", () => {
  it("strips characters that are illegal on Windows", () => {
    expect(safeFileName('Session: 1/2 <draft>?')).toBe("Session- 1-2 -draft--");
  });

  it("refuses to produce a reserved device name", () => {
    // "CON.md" cannot be created on Windows even with an extension.
    expect(safeFileName("CON")).toBe("CON_");
  });

  it("never produces an empty name", () => {
    expect(safeFileName("   ")).toBe("Untitled");
    expect(safeFileName("///")).toBe("Untitled");
  });

  it("suffixes a collision rather than replacing it", () => {
    const taken = new Set<string>();

    expect(uniquePath(taken, "A.md")).toBe("A.md");
    expect(uniquePath(taken, "A.md")).toBe("A (2).md");
    expect(uniquePath(taken, "A.md")).toBe("A (3).md");
  });

  it("treats names differing only in case as colliding", () => {
    const taken = new Set<string>();
    uniquePath(taken, "Marrow.md");

    // Windows and macOS would silently overwrite one with the other.
    expect(uniquePath(taken, "marrow.md")).toBe("marrow (2).md");
  });
});

describe("the zip container", () => {
  /** Reads the little-endian u32 at `offset`. */
  function u32(bytes: Uint8Array, offset: number): number {
    return (
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
      0
    );
  }

  async function bytesOf(blob: Blob): Promise<Uint8Array> {
    return new Uint8Array(await blob.arrayBuffer());
  }

  it("starts with a local file header", async () => {
    const bytes = await bytesOf(createZip([{ path: "a.md", content: "hello" }]));

    expect(u32(bytes, 0)).toBe(0x04034b50);
  });

  it("ends with an end-of-central-directory record", async () => {
    const bytes = await bytesOf(createZip([{ path: "a.md", content: "hello" }]));
    const start = bytes.length - 22;

    expect(u32(bytes, start)).toBe(0x06054b50);
  });

  it("records how many files it holds", async () => {
    const entries = [
      { path: "a.md", content: "one" },
      { path: "b/c.md", content: "two" },
      { path: "d.md", content: "three" },
    ];
    const bytes = await bytesOf(createZip(entries));
    const start = bytes.length - 22;
    const count = bytes[start + 10] | (bytes[start + 11] << 8);

    expect(count).toBe(3);
  });

  it("stores the content verbatim", async () => {
    const bytes = await bytesOf(createZip([{ path: "a.md", content: "hello" }]));
    const text = new TextDecoder().decode(bytes);

    // Stored, not deflated, so the bytes are simply in there.
    expect(text).toContain("hello");
    expect(text).toContain("a.md");
  });

  it("handles an empty archive", async () => {
    const bytes = await bytesOf(createZip([]));

    expect(u32(bytes, 0)).toBe(0x06054b50);
    expect(bytes.length).toBe(22);
  });

  it("survives non-ASCII names and content", async () => {
    const blob = createZip([{ path: "Wyrdhöld — notes.md", content: "æther ✦" }]);
    const bytes = await bytesOf(blob);
    const text = new TextDecoder().decode(bytes);

    expect(text).toContain("Wyrdhöld");
    expect(text).toContain("æther");
  });

  it("is byte-identical for identical content", async () => {
    const entries = [{ path: "a.md", content: "hello" }];
    const first = await bytesOf(createZip(entries));
    const second = await bytesOf(createZip(entries));

    // Timestamps are fixed rather than taken from the clock, so two backups of
    // unchanged notes diff as unchanged.
    expect([...first]).toEqual([...second]);
  });
});
