/**
 * Opening the app must find the user's campaign — every time.
 *
 * These exist because of a real incident: a check-then-act race in
 * `ensureCampaign` provisioned two campaigns two milliseconds apart on first
 * launch, and the app then opened whichever had the higher `updatedAt`. Landing
 * on the empty one showed a completely empty application while every note was
 * still on disk.
 *
 * That is the worst failure this app can have short of deleting something, and
 * it is invisible to every other test in the suite, because they all create
 * their campaign by hand. So it gets its own file.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db, ensureCampaign, newId } from "@/lib/db/db";
import { createNote, createEntity } from "@/lib/services";
import { resetDatabase } from "../helpers/campaign";
import type { Campaign } from "@/lib/db/types";

beforeEach(async () => {
  await resetDatabase();
});

/** A campaign row written straight in, bypassing provisioning. */
async function seedCampaign(updatedAt: number): Promise<Campaign> {
  const campaign: Campaign = {
    id: newId(),
    name: "Untitled Campaign",
    description: "",
    themeId: "grimoire",
    createdAt: updatedAt,
    updatedAt,
  };
  await db.campaigns.add(campaign);
  return campaign;
}

describe("first launch", () => {
  it("provisions one campaign with its built-in sections", async () => {
    const campaign = await ensureCampaign();

    expect(await db.campaigns.count()).toBe(1);
    expect(
      await db.entityTypes.where("campaignId").equals(campaign.id).count(),
    ).toBe(12);
  });

  it("returns the same campaign on the next launch", async () => {
    const first = await ensureCampaign();
    const second = await ensureCampaign();

    expect(second.id).toBe(first.id);
    expect(await db.campaigns.count()).toBe(1);
  });
});

describe("concurrent provisioning", () => {
  /**
   * The actual incident. Two callers starting together — a double-invoked
   * effect is enough — each awaited the "is there a campaign?" read before
   * either had written, so both created one.
   */
  it("creates exactly one campaign when two callers start together", async () => {
    const [a, b] = await Promise.all([ensureCampaign(), ensureCampaign()]);

    expect(await db.campaigns.count()).toBe(1);
    expect(a.id).toBe(b.id);
  });

  it("does not duplicate the built-in sections either", async () => {
    await Promise.all([ensureCampaign(), ensureCampaign()]);

    // 24 sections was the visible symptom: every category listed twice.
    expect(await db.entityTypes.count()).toBe(12);
  });

  it("survives a burst of callers", async () => {
    await Promise.all(Array.from({ length: 8 }, () => ensureCampaign()));

    expect(await db.campaigns.count()).toBe(1);
    expect(await db.entityTypes.count()).toBe(12);
  });
});

describe("recovering a database that already has duplicates", () => {
  it("opens the campaign holding the notes, not the newer empty one", async () => {
    const withWork = await seedCampaign(1_000);
    const empty = await seedCampaign(2_000);
    await createNote({ campaignId: withWork.id, title: "Session 12" });

    // Recency alone would pick `empty`, and the user would open an app with
    // nothing in it while Session 12 sat safely on disk.
    expect((await ensureCampaign()).id).toBe(withWork.id);
    expect(empty.updatedAt).toBeGreaterThan(withWork.updatedAt);
  });

  it("counts entities as content too, not just notes", async () => {
    const withWork = await seedCampaign(1_000);
    await seedCampaign(2_000);
    await createEntity({
      campaignId: withWork.id,
      name: "Marrow",
      entityTypeId: "some-type",
    });

    expect((await ensureCampaign()).id).toBe(withWork.id);
  });

  it("prefers the fuller campaign when both hold something", async () => {
    const fuller = await seedCampaign(1_000);
    const sparser = await seedCampaign(2_000);
    await createNote({ campaignId: fuller.id, title: "A" });
    await createNote({ campaignId: fuller.id, title: "B" });
    await createNote({ campaignId: sparser.id, title: "C" });

    expect((await ensureCampaign()).id).toBe(fuller.id);
  });

  it("falls back to the most recent when both are empty", async () => {
    await seedCampaign(1_000);
    const newer = await seedCampaign(2_000);

    // Nothing to lose either way, so the tie-break is recency — which is what
    // makes a genuinely fresh install behave predictably.
    expect((await ensureCampaign()).id).toBe(newer.id);
  });

  it("never creates a third campaign while recovering", async () => {
    const withWork = await seedCampaign(1_000);
    await seedCampaign(2_000);
    await createNote({ campaignId: withWork.id, title: "Session 12" });

    await ensureCampaign();
    await ensureCampaign();

    // Recovery must not become its own source of duplicates.
    expect(await db.campaigns.count()).toBe(2);
  });

  it("keeps opening the same campaign across launches", async () => {
    const withWork = await seedCampaign(1_000);
    await seedCampaign(2_000);
    await createNote({ campaignId: withWork.id, title: "Session 12" });

    const opens = [
      await ensureCampaign(),
      await ensureCampaign(),
      await ensureCampaign(),
    ];

    // The original bug was not that it chose wrong once, but that the choice
    // was a coin flip: work appeared and disappeared between reloads.
    expect(new Set(opens.map((c) => c.id)).size).toBe(1);
    expect(opens[0].id).toBe(withWork.id);
  });

  it("leaves the stray campaign alone rather than deleting it", async () => {
    const withWork = await seedCampaign(1_000);
    const stray = await seedCampaign(2_000);
    await createNote({ campaignId: withWork.id, title: "Session 12" });

    await ensureCampaign();

    // Choosing correctly is the fix. Deciding on the user's behalf that a
    // campaign is disposable is a different, destructive call.
    expect(await db.campaigns.get(stray.id)).toBeTruthy();
  });
});
