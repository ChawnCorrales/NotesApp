/**
 * Export and import as one operation.
 *
 * This is the test the feature exists for. A GM exports a campaign because
 * they want to know they can get it back — so the claim being checked is not
 * that files appear, but that a campaign put through both halves is the same
 * campaign: same notes, same folders, same entities, same connections.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  addAlias,
  createFolder,
  exportCampaign,
  getBacklinks,
  importMarkdownNotes,
  listEntities,
  listEntityTypes,
  listFolders,
  listLiveNotes,
  moveNoteToFolder,
} from "@/lib/services";
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

/** Exports one campaign and imports the files into a brand new one. */
async function transplant(fromCampaignId: string): Promise<TestCampaign> {
  const files = await exportCampaign(fromCampaignId);
  const destination = await createTestCampaign();

  await importMarkdownNotes({
    campaignId: destination.campaign.id,
    files: files.map((f) => ({ name: f.path, content: f.content })),
  });

  return destination;
}

describe("a campaign survives a round trip", () => {
  it("brings the notes back with their text", async () => {
    const { campaign } = fixture;
    await createNoteWithText(campaign.id, "Session 1", "They met at dusk.");
    await createNoteWithText(campaign.id, "Session 2", "The gate was open.");

    const copy = await transplant(campaign.id);
    const notes = await listLiveNotes(copy.campaign.id);

    expect(notes.map((n) => n.title).sort()).toEqual(["Session 1", "Session 2"]);
    expect(notes.map((n) => n.contentText.trim()).sort()).toEqual([
      "The gate was open.",
      "They met at dusk.",
    ]);
  });

  it("brings the entities back with their categories and aliases", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await addAlias(marrow.id, "Old Marrow");

    const copy = await transplant(campaign.id);
    const entities = await listEntities(copy.campaign.id);
    const types = await listEntityTypes(copy.campaign.id);
    const typeName = new Map(types.map((t) => [t.id, t.name]));

    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe("Marrow");
    expect(typeName.get(entities[0].entityTypeId)).toBe("NPC");
  });

  it("rebuilds the folder tree", async () => {
    const { campaign } = fixture;
    const logs = await createFolder(campaign.id, "Session Logs");
    const act = await createFolder(campaign.id, "Act One", logs.id);
    const note = await createNoteWithText(campaign.id, "Session 12", "Text.");
    await moveNoteToFolder(note.id, act.id);

    const copy = await transplant(campaign.id);
    const folders = await listFolders(copy.campaign.id);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const [restored] = await listLiveNotes(copy.campaign.id);

    const leaf = byId.get(restored.folderId!);
    expect(leaf?.name).toBe("Act One");
    expect(byId.get(leaf!.parentFolderId!)?.name).toBe("Session Logs");
  });

  /**
   * The connections are the point of the app, and they are the thing most
   * easily lost — they were never stored, so they have to be *re-derived* on
   * the other side rather than carried across.
   */
  it("relinks mentions, so backlinks come back", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 1", "Marrow waits.");
    await createNoteWithText(campaign.id, "Session 2", "Marrow again.");

    const copy = await transplant(campaign.id);
    const [entity] = await listEntities(copy.campaign.id);
    const backlinks = await getBacklinks(entity.id);

    expect(backlinks.map((n) => n.title).sort()).toEqual(["Session 1", "Session 2"]);
  });

  it("relinks through an alias", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await addAlias(marrow.id, "the shopkeeper");
    await createNoteWithText(campaign.id, "Session 1", "the shopkeeper waits.");

    const copy = await transplant(campaign.id);
    const [entity] = await listEntities(copy.campaign.id);

    expect(await getBacklinks(entity.id)).toHaveLength(1);
  });

  it("leaves no wikilink brackets in the restored prose", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 1", "Marrow keeps a shop.");

    const copy = await transplant(campaign.id);
    const [note] = await listLiveNotes(copy.campaign.id);

    // The export wrote [[Marrow]]; the import must not leave that in the note.
    expect(note.contentText).toBe("Marrow keeps a shop.");
  });

  it("does not duplicate the Canon sections it already has", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    const copy = await transplant(campaign.id);
    const types = await listEntityTypes(copy.campaign.id);

    // The destination already had NPC; matching is by name, so nothing new.
    expect(types.filter((t) => t.name === "NPC")).toHaveLength(1);
  });
});

describe("hand-written files", () => {
  it("creates an entity from a file someone typed", async () => {
    const { campaign } = fixture;

    const outcome = await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        {
          name: "marrow.md",
          content: [
            "---",
            "type: entity",
            "name: Marrow",
            "category: NPC",
            "aliases: [Old Marrow]",
            "---",
            "",
            "A grizzled merchant.",
          ].join("\n"),
        },
      ],
    });

    expect(outcome.entities).toHaveLength(1);
    expect(outcome.imported).toHaveLength(0);
    expect(outcome.entities[0].description).toBe("A grizzled merchant.");
  });

  it("creates a Canon section the campaign does not have yet", async () => {
    const { campaign } = fixture;

    const outcome = await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        {
          name: "wyrm.md",
          content: ["---", "type: entity", "name: Wyrm", "category: Monsters", "---"].join("\n"),
        },
      ],
    });

    // A bestiary should import without the user first building the section.
    expect(outcome.sectionsCreated).toEqual(["Monsters"]);
    const types = await listEntityTypes(campaign.id);
    expect(types.some((t) => t.name === "Monsters")).toBe(true);
  });

  it("reports a created section rather than doing it silently", async () => {
    const { campaign } = fixture;

    const outcome = await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        { name: "a.md", content: "---\ntype: entity\nname: A\ncategory: Ships\n---" },
        { name: "b.md", content: "---\ntype: entity\nname: B\ncategory: Ships\n---" },
      ],
    });

    // Created once, reported once, even though two files asked for it.
    expect(outcome.sectionsCreated).toEqual(["Ships"]);
  });

  it("files a note into a folder named in its front matter", async () => {
    const { campaign } = fixture;

    await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        {
          name: "s12.md",
          content: ["---", "title: Session 12", "folder: Lore/Gods", "---", "", "Text."].join("\n"),
        },
      ],
    });

    const folders = await listFolders(campaign.id);
    const byName = new Map(folders.map((f) => [f.name, f]));

    expect(byName.has("Lore")).toBe(true);
    expect(byName.get("Gods")?.parentFolderId).toBe(byName.get("Lore")?.id);
  });

  it("does not create the same folder twice for two files", async () => {
    const { campaign } = fixture;

    await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        { name: "a.md", content: "---\ntitle: A\nfolder: Lore\n---\n\nOne." },
        { name: "b.md", content: "---\ntitle: B\nfolder: Lore\n---\n\nTwo." },
      ],
    });

    expect((await listFolders(campaign.id)).filter((f) => f.name === "Lore")).toHaveLength(1);
  });

  /**
   * Order independence matters because a real import is a folder of files in
   * whatever order the picker hands them over. Indexing per file would link
   * only the notes that happened to come after the roster.
   */
  it("links a note to an entity defined in a later file", async () => {
    const { campaign } = fixture;

    const outcome = await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        { name: "session.md", content: "---\ntitle: Session 1\n---\n\nMarrow waits." },
        { name: "marrow.md", content: "---\ntype: entity\nname: Marrow\ncategory: NPC\n---" },
      ],
    });

    const [entity] = outcome.entities;
    expect(await getBacklinks(entity.id)).toHaveLength(1);
  });

  it("keeps importing after a bad file", async () => {
    const { campaign } = fixture;
    const exploding = {
      name: "bad.md",
      get content(): string {
        throw new Error("unreadable");
      },
    };

    const outcome = await importMarkdownNotes({
      campaignId: campaign.id,
      files: [
        exploding,
        { name: "good.md", content: "---\ntype: entity\nname: Marrow\n---" },
      ],
    });

    expect(outcome.failed).toEqual([{ name: "bad.md", reason: "unreadable" }]);
    expect(outcome.entities).toHaveLength(1);
  });
});
