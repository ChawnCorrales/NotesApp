/**
 * Importing Markdown files into a campaign.
 *
 * The point of the feature is not that files parse - it is that imported notes
 * join the knowledge base. A note brought in from disk must be recognised,
 * backlinked, and searchable exactly like one typed in the app.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import { getBacklinks, importMarkdownNotes } from "@/lib/services";
import {
  buildRecognizer,
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

async function importFiles(files: { name: string; content: string }[]) {
  const recognizer = await buildRecognizer(fixture.campaign.id);
  return importMarkdownNotes(fixture.campaign.id, files, recognizer);
}

describe("importing files", () => {
  it("creates a note per file", async () => {
    const result = await importFiles([
      { name: "session-1.md", content: "# Session 1\n\nThe party arrived." },
      { name: "session-2.md", content: "# Session 2\n\nThey left." },
    ]);

    expect(result.imported).toHaveLength(2);
    expect(result.failed).toHaveLength(0);

    const titles = (await db.notes.toArray()).map((n) => n.title).sort();
    expect(titles).toEqual(["Session 1", "Session 2"]);
  });

  it("stores content the editor can load back", async () => {
    const result = await importFiles([
      { name: "a.md", content: "# A\n\nSome **bold** text." },
    ]);

    const note = await db.notes.get(result.imported[0].id);
    const parsed = JSON.parse(note!.content) as { type: string };
    expect(parsed.type).toBe("doc");
    expect(note!.contentText).toBe("Some bold text.");
  });

  it("attaches imported notes to the campaign", async () => {
    const result = await importFiles([{ name: "a.md", content: "Body." }]);

    expect(result.imported[0].campaignId).toBe(fixture.campaign.id);
  });

  it("imports tasks into the global task viewer", async () => {
    await importFiles([
      {
        name: "prep.md",
        content: "# Prep\n\n- [ ] Stat the Ashen Knight\n- [x] Name the inn",
      },
    ]);

    const tasks = await db.tasks.toArray();
    expect(tasks.map((t) => t.text).sort()).toEqual([
      "Name the inn",
      "Stat the Ashen Knight",
    ]);
    expect(tasks.find((t) => t.text === "Name the inn")?.completed).toBe(true);
  });
});

describe("recognition of imported content", () => {
  it("recognises entities that already exist", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    const result = await importFiles([
      { name: "session-12.md", content: "# Session 12\n\nMarrow sends a letter." },
    ]);

    const backlinks = await getBacklinks(marrow.id);
    expect(backlinks.map((n) => n.id)).toEqual([result.imported[0].id]);
  });

  it("backlinks one imported note from several entities", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");

    await importFiles([
      { name: "s.md", content: "Marrow keeps a shop in Greyhaven." },
    ]);

    expect(await getBacklinks(marrow.id)).toHaveLength(1);
    expect(await getBacklinks(greyhaven.id)).toHaveLength(1);
  });

  it("respects word boundaries in imported text", async () => {
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");

    await importFiles([
      { name: "s.md", content: "The Ashen Crown lay in ashes near Ashford." },
    ]);

    expect(await getBacklinks(ash.id)).toHaveLength(0);
  });

  it("recognises entities inside imported tables", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    await importFiles([
      {
        name: "cast.md",
        content: ["| Name | Role |", "| --- | --- |", "| Marrow | Merchant |"].join(
          "\n",
        ),
      },
    ]);

    expect(await getBacklinks(marrow.id)).toHaveLength(1);
  });

  it("does not invent entities from imported text", async () => {
    await importFiles([
      { name: "s.md", content: "Marrow and Greyhaven and the Red Queen." },
    ]);

    // Import must never add to campaign canon on its own (PRD section 32).
    expect(await db.entities.count()).toBe(0);
  });

  it("does not match an entity across a paragraph break", async () => {
    const { campaign, locationType } = fixture;
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");

    await importFiles([{ name: "s.md", content: "...in Grey\n\nhaven they rested." }]);

    expect(await getBacklinks(greyhaven.id)).toHaveLength(0);
  });
});

describe("resilience", () => {
  it("imports an empty file as an empty note rather than failing", async () => {
    const result = await importFiles([{ name: "blank.md", content: "" }]);

    expect(result.failed).toHaveLength(0);
    expect(result.imported[0].title).toBe("blank");
    expect(result.imported[0].contentText).toBe("");
  });

  it("keeps going when one file in a batch cannot be parsed", async () => {
    const exploding = {
      name: "bad.md",
      // A getter that throws stands in for an unreadable file; the batch must
      // survive it rather than losing the other nine files with it.
      get content(): string {
        throw new Error("unreadable");
      },
    };

    const recognizer = await buildRecognizer(fixture.campaign.id);
    const result = await importMarkdownNotes(
      fixture.campaign.id,
      [{ name: "good.md", content: "# Good\n\nFine." }, exploding],
      recognizer,
    );

    expect(result.imported).toHaveLength(1);
    expect(result.failed).toEqual([{ name: "bad.md", reason: "unreadable" }]);
  });

  it("imports files with the same title as separate notes", async () => {
    const result = await importFiles([
      { name: "a.md", content: "# Session\n\nOne." },
      { name: "b.md", content: "# Session\n\nTwo." },
    ]);

    expect(result.imported).toHaveLength(2);
    expect(result.imported[0].id).not.toBe(result.imported[1].id);
  });
});
