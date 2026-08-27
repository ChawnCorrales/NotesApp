/**
 * Teaching a campaign its own vocabulary (PRD §8).
 *
 * The built-in word list cannot contain an invented world's nouns — "sanctum",
 * "wyrdhold", whatever this table calls things. So the app learns from what the
 * GM actually does: create an entity from a sentence that classified it, and
 * the noun in that sentence is bound to the category they chose.
 *
 * Two properties matter more than the happy path. It must learn from an
 * *override* as strongly as from an acceptance, because a correction is the
 * clearest signal there is. And it must stay campaign-scoped: one table's
 * sanctum is a Location, another's is a Faction, and there is no global truth
 * to discover.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/db";
import {
  createEntityType,
  forgetTypeHint,
  listTypeHints,
  recordTypeHint,
  suggestEntityType,
  updateEntityType,
} from "@/lib/services";
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

/** The category id suggested for a name in a sentence, or null. */
async function suggest(name: string, text: string) {
  return suggestEntityType(fixture.campaign.id, name, text);
}

describe("before it has been taught anything", () => {
  it("knows the built-in words", async () => {
    const result = await suggest("Ashgate", "Ashgate is a temple.");

    expect(result).toMatchObject({
      entityTypeId: fixture.locationType.id,
      noun: "temple",
      source: "builtin",
    });
  });

  it("finds an unknown noun but proposes no category for it", async () => {
    // The word that started this. Not in the built-in list and never taught
    // here — but the noun still comes back, because that is what the create
    // dialog needs in order to record whatever the user decides.
    expect(await suggest("Ashgate", "Ashgate is a sanctum.")).toMatchObject({
      noun: "sanctum",
      entityTypeId: null,
      source: "unknown",
      learnable: true,
    });
  });

  it("marks an epithet as found but not worth learning from", async () => {
    // "Marrow the Bold" yields "bold", which classifies nothing. Suggesting
    // nothing from it is right; teaching the campaign about it is not.
    const result = await suggest("Marrow", "Marrow the Bold rode ahead.");

    expect(result?.entityTypeId).toBeNull();
    expect(result?.learnable).toBe(false);
  });

  it("still says nothing when the sentence classifies nothing", async () => {
    expect(await suggest("Ashgate", "Ashgate stood in the rain.")).toBeNull();
  });
});

describe("learning a noun", () => {
  it("suggests the category it was taught", async () => {
    const { campaign, locationType } = fixture;

    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: locationType.id,
    });

    expect(await suggest("Wyrdhold", "Wyrdhold is a sanctum.")).toMatchObject({
      entityTypeId: locationType.id,
      noun: "sanctum",
      source: "learned",
    });
  });

  it("applies to a different name in a different sentence", async () => {
    const { campaign, locationType } = fixture;
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: locationType.id,
    });

    // The lesson is about the noun, not the entity that taught it.
    const other = await suggest("Duskhollow", "The sanctum of Duskhollow burned.");
    expect(other?.entityTypeId).toBe(locationType.id);
  });

  it("is case-insensitive about the noun", async () => {
    const { campaign, npcType } = fixture;
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "SANCTUM",
      entityTypeId: npcType.id,
    });

    expect((await suggest("Wyrdhold", "Wyrdhold is a Sanctum."))?.entityTypeId).toBe(
      npcType.id,
    );
  });

  it("counts repeats instead of stacking rows", async () => {
    const { campaign, locationType } = fixture;
    for (let i = 0; i < 3; i++) {
      await recordTypeHint({
        campaignId: campaign.id,
        noun: "sanctum",
        entityTypeId: locationType.id,
      });
    }

    const hints = await listTypeHints(campaign.id);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ noun: "sanctum", count: 3 });
  });

  it("ignores an empty noun", async () => {
    await recordTypeHint({
      campaignId: fixture.campaign.id,
      noun: "   ",
      entityTypeId: fixture.npcType.id,
    });

    expect(await listTypeHints(fixture.campaign.id)).toHaveLength(0);
  });
});

describe("changing its mind", () => {
  /**
   * The signal that matters most. A GM who overrides a suggestion is telling
   * the app it was wrong, and the correction has to take effect immediately
   * rather than after out-voting whatever came before.
   */
  it("takes the newest answer, not the most repeated one", async () => {
    const { campaign, locationType, npcType } = fixture;

    for (let i = 0; i < 5; i++) {
      await recordTypeHint({
        campaignId: campaign.id,
        noun: "sanctum",
        entityTypeId: locationType.id,
      });
    }
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: npcType.id,
    });

    expect((await suggest("Wyrdhold", "Wyrdhold is a sanctum."))?.entityTypeId).toBe(
      npcType.id,
    );
  });

  it("resets the count when the answer changes", async () => {
    const { campaign, locationType, npcType } = fixture;
    for (let i = 0; i < 4; i++) {
      await recordTypeHint({ campaignId: campaign.id, noun: "sanctum", entityTypeId: locationType.id });
    }
    await recordTypeHint({ campaignId: campaign.id, noun: "sanctum", entityTypeId: npcType.id });

    const [hint] = await listTypeHints(campaign.id);
    expect(hint).toMatchObject({ entityTypeId: npcType.id, count: 1 });
  });

  it("can be forgotten, falling back to the built-in answer", async () => {
    const { campaign, npcType } = fixture;
    await recordTypeHint({ campaignId: campaign.id, noun: "temple", entityTypeId: npcType.id });
    expect((await suggest("Ashgate", "Ashgate is a temple."))?.source).toBe("learned");

    const [hint] = await listTypeHints(campaign.id);
    await forgetTypeHint(hint.id);

    expect(await suggest("Ashgate", "Ashgate is a temple.")).toMatchObject({
      entityTypeId: fixture.locationType.id,
      source: "builtin",
    });
  });
});

describe("what it learns beats what shipped with it", () => {
  it("overrides a built-in word for this campaign", async () => {
    const { campaign, npcType } = fixture;

    // "smith" ships as a Character. A campaign where the Smiths are a faction
    // should be able to say so and be believed.
    expect((await suggest("Ashgate", "Ashgate is a smith."))?.entityTypeId).toBe(
      npcType.id,
    );

    await recordTypeHint({
      campaignId: campaign.id,
      noun: "smith",
      entityTypeId: fixture.locationType.id,
    });

    expect(await suggest("Ashgate", "Ashgate is a smith.")).toMatchObject({
      entityTypeId: fixture.locationType.id,
      source: "learned",
    });
  });
});

describe("staying inside its campaign", () => {
  it("does not leak a lesson into another campaign", async () => {
    const { campaign, locationType } = fixture;
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: locationType.id,
    });

    const other = await createTestCampaign();
    const leaked = await suggestEntityType(
      other.campaign.id,
      "Wyrdhold",
      "Wyrdhold is a sanctum.",
    );

    // The noun is still read — that is campaign-independent grammar — but no
    // category comes with it.
    expect(leaked?.entityTypeId).toBeNull();
    expect(await listTypeHints(other.campaign.id)).toHaveLength(0);
  });
});

describe("hints that point at nothing usable", () => {
  it("ignores a hint whose category was deleted", async () => {
    const { campaign } = fixture;
    const temp = await createEntityType({
      campaignId: campaign.id,
      name: "Sanctums",
      icon: "◇",
      themeKey: "concept",
    });
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: temp.id,
    });
    expect((await suggest("Wyrdhold", "Wyrdhold is a sanctum."))?.source).toBe("learned");

    await db.entityTypes.delete(temp.id);

    // Proposing a category that no longer exists would pre-select nothing and
    // look broken; falling back to no category is correct.
    expect((await suggest("Wyrdhold", "Wyrdhold is a sanctum."))?.entityTypeId)
      .toBeNull();
  });

  it("ignores a hint whose category is hidden", async () => {
    const { campaign, locationType } = fixture;
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: locationType.id,
    });

    await updateEntityType(locationType.id, { hidden: true });

    expect((await suggest("Wyrdhold", "Wyrdhold is a sanctum."))?.entityTypeId)
      .toBeNull();
  });
});

describe("persistence", () => {
  it("survives a reload", async () => {
    const { campaign, locationType } = fixture;
    await recordTypeHint({
      campaignId: campaign.id,
      noun: "sanctum",
      entityTypeId: locationType.id,
    });

    await reopenDatabase();

    expect((await suggest("Wyrdhold", "Wyrdhold is a sanctum."))?.entityTypeId).toBe(
      locationType.id,
    );
  });
});
