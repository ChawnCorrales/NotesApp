/**
 * Putting the thing you are reading into a collection (PRD §31).
 *
 * The interaction these protect is the whole point of Phase 2: a collection is
 * only useful if adding to one costs nothing mid-session. So these test what a
 * GM does — tick a box, type a name — rather than the membership rows
 * underneath, which the integration suite already covers.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { AddToCollection } from "@/components/AddToCollection";
import {
  addToCollection,
  createCollection,
  getCollectionContents,
  getCollectionsForMember,
  listCollections,
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

function renderControl(memberType: "note" | "entity", memberId: string) {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <AddToCollection memberType={memberType} memberId={memberId} />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

async function openPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("add-to-collection"));
}

describe("adding a note to a collection", () => {
  it("puts the note in a collection the user ticks", async () => {
    const user = userEvent.setup();
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");

    renderControl("note", note.id);
    await openPopover(user);
    await user.click(await screen.findByLabelText("Red Queen Investigation"));

    await waitFor(async () => {
      const contents = await getCollectionContents(collection.id);
      expect(contents.notes.map((n) => n.id)).toEqual([note.id]);
    });
  });

  it("takes it back out when the user unticks it", async () => {
    const user = userEvent.setup();
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");
    await addToCollection({
      collectionId: collection.id,
      memberType: "note",
      memberId: note.id,
    });

    renderControl("note", note.id);
    await openPopover(user);

    // The box arrives already ticked, which is how the control doubles as an
    // answer to "what is this filed under".
    const box = await screen.findByLabelText("Red Queen Investigation");
    await waitFor(() => expect(box).toBeChecked());
    await user.click(box);

    await waitFor(async () => {
      expect((await getCollectionContents(collection.id)).notes).toHaveLength(0);
    });
  });

  it("shows current memberships without opening anything", async () => {
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");
    await addToCollection({
      collectionId: collection.id,
      memberType: "note",
      memberId: note.id,
    });

    renderControl("note", note.id);

    const chips = await screen.findAllByTestId("member-collection");
    expect(chips.map((c) => c.textContent)).toEqual(["Red Queen Investigation"]);
  });

  it("creates a collection and adds the note in one step", async () => {
    const user = userEvent.setup();
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "They met.");

    renderControl("note", note.id);
    await openPopover(user);

    // §3: being sent to a management screen to make a collection is exactly the
    // interruption that stops a GM using the feature mid-session.
    await user.type(
      await screen.findByLabelText("New collection name"),
      "Red Queen Investigation{Enter}",
    );

    await waitFor(async () => {
      const collections = await listCollections(campaign.id);
      expect(collections.map((c) => c.name)).toEqual(["Red Queen Investigation"]);
    });

    const [created] = await listCollections(campaign.id);
    expect((await getCollectionContents(created.id)).notes.map((n) => n.id)).toEqual([
      note.id,
    ]);
  });
});

describe("adding an entity to a collection", () => {
  it("files an entity through the same control", async () => {
    const user = userEvent.setup();
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");

    renderControl("entity", marrow.id);
    await openPopover(user);
    await user.click(await screen.findByLabelText("Red Queen Investigation"));

    await waitFor(async () => {
      const contents = await getCollectionContents(collection.id);
      expect(contents.entities.map((e) => e.id)).toEqual([marrow.id]);
    });
  });

  it("keeps a note's and an entity's memberships apart", async () => {
    const user = userEvent.setup();
    const { campaign, npcType } = fixture;
    const marrow = await createNpc(campaign.id, npcType.id, "Marrow");
    const note = await createNoteWithText(campaign.id, "Session 12", "Marrow met them.");
    const collection = await createCollection(campaign.id, "Red Queen Investigation");

    renderControl("entity", marrow.id);
    await openPopover(user);
    await user.click(await screen.findByLabelText("Red Queen Investigation"));

    await waitFor(async () => {
      expect((await getCollectionContents(collection.id)).entities).toHaveLength(1);
    });

    // Adding the entity must not drag the note in with it: they are separate
    // memberships that happen to share a compound index.
    expect((await getCollectionContents(collection.id)).notes).toHaveLength(0);
    expect(await getCollectionsForMember("note", note.id)).toHaveLength(0);
  });
});

describe("the popover itself", () => {
  it("says so when there is nothing to add to yet", async () => {
    const user = userEvent.setup();
    const note = await createNoteWithText(fixture.campaign.id, "Session 12", "Text.");

    renderControl("note", note.id);
    await openPopover(user);

    expect(await screen.findByText("No collections yet.")).toBeInTheDocument();
  });

  it("lists every collection in the campaign, not just the ones joined", async () => {
    const user = userEvent.setup();
    const { campaign } = fixture;
    const note = await createNoteWithText(campaign.id, "Session 12", "Text.");
    await createCollection(campaign.id, "Arc One");
    await createCollection(campaign.id, "Arc Two");

    renderControl("note", note.id);
    await openPopover(user);

    expect(await screen.findByLabelText("Arc One")).toBeInTheDocument();
    expect(screen.getByLabelText("Arc Two")).toBeInTheDocument();
  });
});
