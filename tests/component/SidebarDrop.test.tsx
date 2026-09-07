/**
 * Canon sections as drop targets.
 *
 * Written after a sabotage went unnoticed. Removing the type guard from the
 * sidebar's `onDrop` broke nothing the browser tests could see: with the guard
 * gone, a note dragged onto a section still does nothing, because `getData`
 * returns an empty string for a type the drag is not carrying and the handler
 * bails on that instead.
 *
 * So the guard is not what stops a note being filed as an entity. What it
 * actually buys is the *offer*: without it the section calls preventDefault on
 * any drag at all, lights up, and shows a move cursor — promising a drop that
 * will then silently do nothing. That is the thing worth pinning, and it is a
 * hover state rather than a stored value, which is why it is tested here.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { Sidebar } from "@/components/Sidebar";
import { getEntity } from "@/lib/services";
import { DRAG_ENTITY, DRAG_FILE } from "@/lib/dnd";
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

function renderSidebar() {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <Sidebar />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

/** A DataTransfer carrying one type, which is all a drop target inspects. */
function dragCarrying(type: string, value = "") {
  const store = new Map<string, string>([[type, value]]);
  return {
    types: [type],
    getData: (wanted: string) => store.get(wanted) ?? "",
    setData: (wanted: string, v: string) => store.set(wanted, v),
    dropEffect: "",
    effectAllowed: "",
  };
}

/** The Locations section button in the sidebar. */
async function locations() {
  return (await screen.findAllByTestId("sidebar-section")).find(
    (b) => b.getAttribute("data-section-name") === "Location",
  )!;
}

/** Whether the button is showing the "you can drop here" treatment. */
function isOffering(el: HTMLElement): boolean {
  return el.className.includes("ring-candle");
}

describe("what a section offers to accept", () => {
  it("lights up for an entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSidebar();
    const target = await locations();

    fireEvent.dragOver(target, {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(() => expect(isOffering(target)).toBe(true));
  });

  it("does not light up for a note", async () => {
    renderSidebar();
    const target = await locations();

    // A note dragged out of the folder tree is not something a Canon section
    // can hold. Offering to take it and then doing nothing is worse than
    // refusing plainly.
    fireEvent.dragOver(target, {
      dataTransfer: dragCarrying(DRAG_FILE, "some-note-id"),
    });

    expect(isOffering(target)).toBe(false);
  });

  it("stops lighting up once the drag leaves", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSidebar();
    const target = await locations();

    fireEvent.dragOver(target, {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });
    await waitFor(() => expect(isOffering(target)).toBe(true));

    fireEvent.dragLeave(target);

    await waitFor(() => expect(isOffering(target)).toBe(false));
  });
});

describe("what a section actually accepts", () => {
  it("recategorises an entity dropped on it", async () => {
    const { campaign, npcType, locationType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSidebar();
    fireEvent.drop(await locations(), {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(async () => {
      expect((await getEntity(marrow.id))?.entityTypeId).toBe(locationType.id);
    });
  });

  it("ignores a dropped note", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");

    renderSidebar();
    fireEvent.drop(await locations(), {
      dataTransfer: dragCarrying(DRAG_FILE, "some-note-id"),
    });

    // Nothing moved, and nothing threw trying.
    expect((await getEntity(marrow.id))?.entityTypeId).toBe(npcType.id);
  });
});
