/**
 * Moving an entity between Canon sections.
 *
 * Two routes to one operation. Dragging is the pleasant one, and the only one
 * unavailable to a keyboard, a screen reader, or a touch screen — so the card
 * also carries a section picker, and both have to end in the same place.
 *
 * The drag itself is exercised in Playwright, where a real DataTransfer
 * exists. What is worth pinning here is that the card is actually draggable and
 * announces the right payload, since a card that silently stopped being
 * draggable would look identical in every screenshot.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { SectionView } from "@/components/SectionView";
import { getEntity } from "@/lib/services";
import { DRAG_ENTITY } from "@/lib/dnd";
import {
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

function renderSection(entityTypeId: string) {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <SectionView entityTypeId={entityTypeId} />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

describe("the section picker on a card", () => {
  it("moves the entity to another section", async () => {
    const user = userEvent.setup();
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSection(npcType.id);
    const picker = await screen.findByLabelText("Move Marrow to another section");
    await user.selectOptions(picker, locationType.id);

    await waitFor(async () => {
      expect((await getEntity(marrow.id))?.entityTypeId).toBe(locationType.id);
    });
  });

  it("drops the entity out of the section it left", async () => {
    const user = userEvent.setup();
    const { campaign, npcType, locationType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    renderSection(npcType.id);
    await user.selectOptions(
      await screen.findByLabelText("Move Marrow to another section"),
      locationType.id,
    );

    // The view is derived from the campaign's entities, so the card leaves on
    // its own rather than being removed by hand.
    await waitFor(() =>
      expect(screen.queryByText("Marrow")).not.toBeInTheDocument(),
    );
  });

  it("starts on the section the entity is actually in", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    renderSection(npcType.id);

    expect(
      await screen.findByLabelText("Move Marrow to another section"),
    ).toHaveValue(npcType.id);
  });

  it("leaves the other entities where they are", async () => {
    const user = userEvent.setup();
    const { campaign, npcType, locationType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");
    const verena = await createNpc(campaign.id, npcType.id, "Verena");

    renderSection(npcType.id);
    await user.selectOptions(
      await screen.findByLabelText("Move Marrow to another section"),
      locationType.id,
    );

    await waitFor(() => expect(screen.getByText("Verena")).toBeInTheDocument());
    expect((await getEntity(verena.id))?.entityTypeId).toBe(npcType.id);
  });
});

describe("the card as a drag source", () => {
  it("is draggable", async () => {
    const { campaign, npcType } = fixture;
    await createNpc(campaign.id, npcType.id, "Marrow");

    renderSection(npcType.id);
    const card = await screen.findByTestId("section-entity");

    expect(card).toHaveAttribute("draggable", "true");
  });

  it("carries the entity id under the entity drag type", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSection(npcType.id);
    const card = await screen.findByTestId("section-entity");

    /**
     * A hand-built DataTransfer, because happy-dom does not run a real drag.
     * The assertion that matters is the *type*: a note dragged from the folder
     * tree carries a different one, which is what stops it being droppable on a
     * Canon section without either side inspecting the id.
     */
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? "",
      types: [] as string[],
      effectAllowed: "",
    };

    const event = new Event("dragstart", { bubbles: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    card.dispatchEvent(event);

    expect(store.get(DRAG_ENTITY)).toBe(marrow.id);
  });
});
