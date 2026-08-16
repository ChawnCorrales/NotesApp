/**
 * The entity page (PRD §11).
 *
 * Almost nothing here was typed by the user — the mentions list and backlinks
 * are derived from notes. These tests assert what a GM actually sees: the notes
 * an entity appears in, and that acting on the page does not lose them.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { EntityPage } from "@/components/EntityPage";
import { db } from "@/lib/db/db";
import { createRelationship, getBacklinks } from "@/lib/services";
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

function renderEntityPage(entityId: string) {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <EntityPage entityId={entityId} />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

describe("entity page", () => {
  it("shows the notes the entity appears in", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 12", "Marrow writes.");
    await createNoteWithText(campaign.id, "Greyhaven Merchants", "Marrow again.");
    await createNoteWithText(campaign.id, "Unrelated", "Nothing here.");

    renderEntityPage(marrow.id);

    expect(await screen.findByText("Session 12")).toBeInTheDocument();
    expect(screen.getByText("Greyhaven Merchants")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  });

  it("reports how many notes mention the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "A", "Marrow. Marrow. Marrow.");
    await createNoteWithText(campaign.id, "B", "Marrow.");

    renderEntityPage(marrow.id);

    // Two notes, not four occurrences.
    expect(await screen.findByText(/Mentioned in 2 notes/)).toBeInTheDocument();
  });

  it("lists a note once however many times it names the entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 12", "Marrow. Marrow. Marrow.");

    renderEntityPage(marrow.id);

    expect(await screen.findAllByText("Session 12")).toHaveLength(1);
  });

  it("says so when nothing mentions the entity yet", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderEntityPage(marrow.id);

    expect(
      await screen.findByText(/No notes mention this entity yet/),
    ).toBeInTheDocument();
  });

  it("shows the entity's name and lets it be renamed", async () => {
    const user = userEvent.setup();
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createNoteWithText(campaign.id, "Session 12", "Marrow writes.");

    renderEntityPage(marrow.id);

    const nameField = await screen.findByLabelText("Entity name");
    expect(nameField).toHaveValue("Marrow");

    await user.type(nameField, " the Elder");

    await waitFor(async () => {
      expect((await db.entities.get(marrow.id))?.name).toBe("Marrow the Elder");
    });
  });

  it("keeps relationships and backlinks through a rename", async () => {
    const user = userEvent.setup();
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const greyhaven = await createNpc(campaign.id, locationType.id, "Greyhaven");
    await createRelationship({ campaignId: campaign.id, sourceEntityId: marrow.id, targetEntityId: greyhaven.id, relationshipType: "works in" });
    await createNoteWithText(campaign.id, "Session 12", "Marrow writes.");

    renderEntityPage(marrow.id);

    const nameField = await screen.findByLabelText("Entity name");
    await user.type(nameField, "!");

    await waitFor(async () => {
      expect((await db.entities.get(marrow.id))?.name).toBe("Marrow!");
    });
    // §62: renaming preserves relationships. Backlinks derive from the current
    // vocabulary, so the note still resolves via the reindex the app performs.
    const relationships = await db.relationships
      .where("sourceEntityId")
      .equals(marrow.id)
      .toArray();
    expect(relationships).toHaveLength(1);
  });

  it("adds an alias from the page", async () => {
    const user = userEvent.setup();
    const { campaign, npcType } = fixture;
    const queen = await createNpc(campaign.id, npcType.id, "The Red Queen");

    renderEntityPage(queen.id);

    const aliasField = await screen.findByPlaceholderText("Add alias…");
    await user.type(aliasField, "Verena{Enter}");

    await waitFor(async () => {
      const aliases = await db.entityAliases
        .where("entityId")
        .equals(queen.id)
        .toArray();
      expect(aliases.map((a) => a.alias)).toEqual(["Verena"]);
    });
  });

  it("offers a control to stop auto-linking without deleting the entity", async () => {
    const user = userEvent.setup();
    const { campaign, npcType } = fixture;
    const ash = await createNpc(campaign.id, npcType.id, "Ash");
    await createNoteWithText(campaign.id, "S1", "Ash waits.");

    renderEntityPage(ash.id);

    const toggle = await screen.findByLabelText(/Auto-link mentions/);
    expect(toggle).toBeChecked();

    await user.click(toggle);

    await waitFor(async () => {
      expect((await db.entities.get(ash.id))?.autoLink).toBe(false);
    });
    // The entity survives; only recognition changed.
    expect(await db.entities.get(ash.id)).toBeTruthy();
    expect(await getBacklinks(ash.id)).toHaveLength(1);
  });
});
