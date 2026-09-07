/**
 * Dropping notes and entities onto collections.
 *
 * The distinction this pins down: dropping on a Canon section *moves* an
 * entity, dropping on a collection *adds* it. A collection is a membership, so
 * a note keeps its folder and an entity keeps its section — and the cursor says
 * copy rather than move to promise exactly that.
 *
 * What a target refuses matters as much as what it takes. A collection holds
 * notes and entities; a folder dragged out of the tree is neither, and the card
 * must not offer to accept it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { CollectionsView } from "@/components/CollectionsView";
import {
  createCollection,
  getCollectionContents,
  getEntity,
  getNote,
} from "@/lib/services";
import { DRAG_ENTITY, DRAG_FOLDER, DRAG_NOTE } from "@/lib/dnd";
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

function renderCollections() {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <CollectionsView />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

/** A DataTransfer carrying one type, which is all a drop target inspects. */
function dragCarrying(type: string, value: string) {
  const store = new Map<string, string>([[type, value]]);
  return {
    types: [type],
    getData: (wanted: string) => store.get(wanted) ?? "",
    setData: (wanted: string, v: string) => store.set(wanted, v),
    dropEffect: "",
    effectAllowed: "",
  };
}

async function card(name: string) {
  const cards = await screen.findAllByTestId("collection-card");
  return cards.find((c) => c.getAttribute("data-collection-name") === name)!;
}

function isOffering(el: HTMLElement): boolean {
  return el.className.includes("ring-candle");
}

describe("what a collection card accepts", () => {
  it("adds a dropped entity", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const arc = await createCollection(campaign.id, "Red Queen");

    renderCollections();
    fireEvent.drop(await card("Red Queen"), {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(async () => {
      const contents = await getCollectionContents(arc.id);
      expect(contents.entities.map((e) => e.id)).toEqual([marrow.id]);
    });
  });

  it("adds a dropped note", async () => {
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");
    const arc = await createCollection(campaign.id, "Red Queen");

    renderCollections();
    fireEvent.drop(await card("Red Queen"), {
      dataTransfer: dragCarrying(DRAG_NOTE, note.id),
    });

    await waitFor(async () => {
      const contents = await getCollectionContents(arc.id);
      expect(contents.notes.map((n) => n.id)).toEqual([note.id]);
    });
  });

  it("refuses a folder", async () => {
    const { campaign } = fixture;
    const arc = await createCollection(campaign.id, "Red Queen");

    renderCollections();
    const target = await card("Red Queen");

    fireEvent.dragOver(target, {
      dataTransfer: dragCarrying(DRAG_FOLDER, "some-folder-id"),
    });
    expect(isOffering(target)).toBe(false);

    fireEvent.drop(target, {
      dataTransfer: dragCarrying(DRAG_FOLDER, "some-folder-id"),
    });

    const contents = await getCollectionContents(arc.id);
    expect(contents.notes).toHaveLength(0);
    expect(contents.entities).toHaveLength(0);
  });

  it("lights up for something it can take", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createCollection(campaign.id, "Red Queen");

    renderCollections();
    const target = await card("Red Queen");

    fireEvent.dragOver(target, {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(() => expect(isOffering(target)).toBe(true));
  });

  it("stops lighting up once the drag leaves", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createCollection(campaign.id, "Red Queen");

    renderCollections();
    const target = await card("Red Queen");

    fireEvent.dragOver(target, { dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id) });
    await waitFor(() => expect(isOffering(target)).toBe(true));

    fireEvent.dragLeave(target);
    await waitFor(() => expect(isOffering(target)).toBe(false));
  });
});

describe("adding is not moving", () => {
  it("leaves the entity in its Canon section", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    await createCollection(campaign.id, "Red Queen");

    renderCollections();
    fireEvent.drop(await card("Red Queen"), {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(async () => {
      expect((await getEntity(marrow.id))?.entityTypeId).toBe(npcType.id);
    });
  });

  it("leaves the note in its folder", async () => {
    const { campaign } = fixture;
    const { createFolder, moveNoteToFolder } = await import("@/lib/services");
    const folder = await createFolder(campaign.id, "Session Logs");
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");
    await moveNoteToFolder(note.id, folder.id);
    await createCollection(campaign.id, "Red Queen");

    renderCollections();
    fireEvent.drop(await card("Red Queen"), {
      dataTransfer: dragCarrying(DRAG_NOTE, note.id),
    });

    await waitFor(async () => {
      expect((await getNote(note.id))?.folderId).toBe(folder.id);
    });
  });

  it("can put one thing in two collections", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const arc = await createCollection(campaign.id, "Red Queen");
    const cast = await createCollection(campaign.id, "Greyhaven Cast");

    renderCollections();
    fireEvent.drop(await card("Red Queen"), {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });
    fireEvent.drop(await card("Greyhaven Cast"), {
      dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id),
    });

    await waitFor(async () => {
      expect((await getCollectionContents(arc.id)).entities).toHaveLength(1);
      expect((await getCollectionContents(cast.id)).entities).toHaveLength(1);
    });
  });

  it("dropping the same thing twice does not duplicate it", async () => {
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const arc = await createCollection(campaign.id, "Red Queen");

    renderCollections();
    const target = await card("Red Queen");

    fireEvent.drop(target, { dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id) });
    await waitFor(async () => {
      expect((await getCollectionContents(arc.id)).entities).toHaveLength(1);
    });

    fireEvent.drop(target, { dataTransfer: dragCarrying(DRAG_ENTITY, marrow.id) });

    // Membership is idempotent, so a second drop is a no-op rather than a
    // second row the collection view would then show twice.
    await waitFor(async () => {
      expect((await getCollectionContents(arc.id)).entities).toHaveLength(1);
    });
  });
});
