/**
 * Entity groups — the foundation for colour coding, ahead of any group UI.
 *
 * The invariant worth locking down now, while it is still cheap to change: a
 * group's colour is presentation. Membership is keyed on the group's id, so
 * recolouring can never silently re-group anything. Getting this backwards —
 * treating colour as the identifier — is the kind of mistake that is invisible
 * until two groups share a colour and merge themselves.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  addEntityToGroup,
  createEntityGroup,
  getEntitiesInGroup,
  getGroupsForEntity,
  removeEntityFromGroup,
  setEntityGroupColor,
} from "@/lib/services";
import {
  createNpc,
  createTestCampaign,
  resetDatabase,
  reopenDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

describe("group membership", () => {
  it("lets an entity belong to several groups at once", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const traitors = await createEntityGroup(campaign.id, "The Traitors", "faction");
    const merchants = await createEntityGroup(campaign.id, "Merchants", "item");

    await addEntityToGroup(traitors.id, marrow.id);
    await addEntityToGroup(merchants.id, marrow.id);

    const groups = await getGroupsForEntity(marrow.id);
    expect(groups.map((g) => g.name).sort()).toEqual(["Merchants", "The Traitors"]);
  });

  it("lets a group hold several entities", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const verena = await createNpc(campaign.id, npcType.id, "Verena");
    const group = await createEntityGroup(campaign.id, "The Traitors");

    await addEntityToGroup(group.id, marrow.id);
    await addEntityToGroup(group.id, verena.id);

    expect((await getEntitiesInGroup(group.id)).map((e) => e.name).sort()).toEqual([
      "Marrow",
      "Verena",
    ]);
  });

  it("does not duplicate a membership that already exists", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors");

    await addEntityToGroup(group.id, marrow.id);
    await addEntityToGroup(group.id, marrow.id);

    expect(await db.entityGroupMembers.count()).toBe(1);
  });

  it("removes membership without touching the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors");
    await addEntityToGroup(group.id, marrow.id);

    const before = await db.entities.get(marrow.id);
    await removeEntityFromGroup(group.id, marrow.id);
    const after = await db.entities.get(marrow.id);

    expect(await getGroupsForEntity(marrow.id)).toHaveLength(0);
    expect(after).toEqual(before);
  });

  it("leaves the entity's own category alone", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors", "faction");

    await addEntityToGroup(group.id, marrow.id);

    // Groups are orthogonal to type: Marrow is still an NPC.
    expect((await db.entities.get(marrow.id))?.entityTypeId).toBe(npcType.id);
  });

  it("removing an entity from one group leaves its other groups intact", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const a = await createEntityGroup(campaign.id, "A");
    const b = await createEntityGroup(campaign.id, "B");
    await addEntityToGroup(a.id, marrow.id);
    await addEntityToGroup(b.id, marrow.id);

    await removeEntityFromGroup(a.id, marrow.id);

    expect((await getGroupsForEntity(marrow.id)).map((g) => g.name)).toEqual(["B"]);
  });
});

describe("group colour is presentation only", () => {
  it("recolouring a group does not change its membership", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors", "faction");
    await addEntityToGroup(group.id, marrow.id);

    await setEntityGroupColor(group.id, "deity");

    const members = await getEntitiesInGroup(group.id);
    expect(members.map((e) => e.id)).toEqual([marrow.id]);
    expect((await db.entityGroups.get(group.id))?.colorKey).toBe("deity");
  });

  it("recolouring a group does not modify the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors", "faction");
    await addEntityToGroup(group.id, marrow.id);

    const before = await db.entities.get(marrow.id);
    await setEntityGroupColor(group.id, "creature");

    expect(await db.entities.get(marrow.id)).toEqual(before);
  });

  it("two groups sharing a colour stay distinct", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const verena = await createNpc(campaign.id, npcType.id, "Verena");
    const a = await createEntityGroup(campaign.id, "A", "faction");
    const b = await createEntityGroup(campaign.id, "B", "faction");

    await addEntityToGroup(a.id, marrow.id);
    await addEntityToGroup(b.id, verena.id);

    expect((await getEntitiesInGroup(a.id)).map((e) => e.id)).toEqual([marrow.id]);
    expect((await getEntitiesInGroup(b.id)).map((e) => e.id)).toEqual([verena.id]);
  });
});

describe("groups and recognition", () => {
  it("group membership has no effect on how text is matched", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors");

    const { buildRecognizer } = await import("../helpers/campaign");
    const before = (await buildRecognizer(campaign.id)).findMatches("Marrow waits.");
    await addEntityToGroup(group.id, marrow.id);
    const after = (await buildRecognizer(campaign.id)).findMatches("Marrow waits.");

    expect(after).toEqual(before);
  });

  it("membership survives a reload", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors");
    await addEntityToGroup(group.id, marrow.id);

    await reopenDatabase();

    expect((await getGroupsForEntity(marrow.id)).map((g) => g.name)).toEqual([
      "The Traitors",
    ]);
  });

  it("deleting an entity clears its group memberships", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const group = await createEntityGroup(campaign.id, "The Traitors");
    await addEntityToGroup(group.id, marrow.id);

    const { deleteEntity } = await import("@/lib/services");
    await deleteEntity(marrow.id);

    expect(await getEntitiesInGroup(group.id)).toHaveLength(0);
    expect(await db.entityGroupMembers.count()).toBe(0);
  });
});
