/**
 * Campaign Canon sections.
 *
 * Sections are the campaign's entity categories, so these tests also protect
 * the consequence of that decision: editing a section must never orphan the
 * entities filed under it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  createEntityType,
  deleteEntityType,
  getEntityCountsByType,
  reorderEntityTypes,
  updateEntityType,
} from "@/lib/db/repositories";
import {
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

describe("editing a section", () => {
  it("renames it without touching its entities", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    await updateEntityType(npcType.id, { name: "Dramatis Personae" });

    expect((await db.entityTypes.get(npcType.id))?.name).toBe("Dramatis Personae");
    // The entity still points at the same section, which now has a new label.
    expect((await db.entities.get(marrow.id))?.entityTypeId).toBe(npcType.id);
  });

  it("trims whitespace from the name", async () => {
    await updateEntityType(fixture.npcType.id, { name: "  Cast  " });

    expect((await db.entityTypes.get(fixture.npcType.id))?.name).toBe("Cast");
  });

  it("changes icon and colour independently of the name", async () => {
    const { npcType } = fixture;

    await updateEntityType(npcType.id, { icon: "♆", themeKey: "deity" });

    const reloaded = await db.entityTypes.get(npcType.id);
    expect(reloaded?.icon).toBe("♆");
    expect(reloaded?.themeKey).toBe("deity");
    expect(reloaded?.name).toBe("NPC");
  });

  it("hides a section without deleting it or its entities", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    await updateEntityType(npcType.id, { hidden: true });

    expect((await db.entityTypes.get(npcType.id))?.hidden).toBe(true);
    expect(await db.entities.get(marrow.id)).toBeTruthy();
  });

  it("survives a reload", async () => {
    await updateEntityType(fixture.npcType.id, { name: "Cast", hidden: true });
    await reopenDatabase();

    const reloaded = await db.entityTypes.get(fixture.npcType.id);
    expect(reloaded?.name).toBe("Cast");
    expect(reloaded?.hidden).toBe(true);
  });
});

describe("reordering sections", () => {
  it("writes the given order as sortOrder", async () => {
    const { npcType, locationType } = fixture;

    await reorderEntityTypes([locationType.id, npcType.id]);

    expect((await db.entityTypes.get(locationType.id))?.sortOrder).toBe(0);
    expect((await db.entityTypes.get(npcType.id))?.sortOrder).toBe(1);
  });

  it("keeps a new section at the end until moved", async () => {
    const { campaign } = fixture;

    const created = await createEntityType(campaign.id, "Ships", "⚓", "item");

    expect(created.sortOrder).toBe(2);
    expect(created.hidden).toBe(false);
  });

  it("survives a reload", async () => {
    const { npcType, locationType } = fixture;
    await reorderEntityTypes([locationType.id, npcType.id]);

    await reopenDatabase();

    const ordered = await db.entityTypes.orderBy("sortOrder").toArray();
    expect(ordered.map((t) => t.id)).toEqual([locationType.id, npcType.id]);
  });
});

describe("removing a section", () => {
  it("deletes one that is empty", async () => {
    const { campaign } = fixture;
    const spare = await createEntityType(campaign.id, "Ships", "⚓", "item");

    const result = await deleteEntityType(spare.id);

    expect(result.deleted).toBe(true);
    expect(await db.entityTypes.get(spare.id)).toBeUndefined();
  });

  it("refuses while entities still belong to it", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    const result = await deleteEntityType(npcType.id);

    // Cascading would delete the GM's characters; silently reassigning would
    // move them somewhere they never chose. Refusing says so out loud.
    expect(result.deleted).toBe(false);
    expect(result.entityCount).toBe(1);
    expect(result.reason).toMatch(/still in this section/);
    expect(await db.entityTypes.get(npcType.id)).toBeTruthy();
  });

  it("counts correctly when several entities are in the way", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNpc(campaign.id, npcType.id, "Verena");

    const result = await deleteEntityType(npcType.id);

    expect(result.entityCount).toBe(2);
    expect(result.reason).toMatch(/entities are/);
  });

  it("succeeds once the entities are gone", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    const { deleteEntity } = await import("@/lib/db/repositories");
    await deleteEntity(marrow.id);

    expect((await deleteEntityType(npcType.id)).deleted).toBe(true);
  });
});

describe("section counts", () => {
  it("reports how many entities each section holds", async () => {
    const { campaign, npcType, locationType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    await createNpc(campaign.id, npcType.id, "Verena");
    await createNpc(campaign.id, locationType.id, "Greyhaven");

    const counts = await getEntityCountsByType(campaign.id);

    expect(counts.get(npcType.id)).toBe(2);
    expect(counts.get(locationType.id)).toBe(1);
  });

  it("omits sections with nothing in them", async () => {
    const counts = await getEntityCountsByType(fixture.campaign.id);

    expect(counts.get(fixture.npcType.id)).toBeUndefined();
  });
});
