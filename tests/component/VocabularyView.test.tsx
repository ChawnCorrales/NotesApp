/**
 * The learned-vocabulary panel (PRD §8).
 *
 * This exists because the app learns from you, and anything that learns can
 * learn something wrong. The tests are therefore mostly about *undoing*: seeing
 * what was picked up, correcting it, and forgetting it — and confirming that
 * doing so changes what the app suggests next time rather than only changing
 * what the list displays.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CampaignProvider } from "@/components/campaign-context";
import { NavigationProvider } from "@/components/navigation-context";
import { VocabularyView } from "@/components/VocabularyView";
import { listTypeHints, recordTypeHint, suggestEntityType } from "@/lib/services";
import {
  createTestCampaign,
  resetDatabase,
  type TestCampaign,
} from "../helpers/campaign";

let fixture: TestCampaign;

beforeEach(async () => {
  await resetDatabase();
  fixture = await createTestCampaign();
});

function renderPanel() {
  return render(
    <CampaignProvider>
      <NavigationProvider>
        <VocabularyView />
      </NavigationProvider>
    </CampaignProvider>,
  );
}

/** Teaches the campaign a noun, the way the create dialog would. */
async function teach(noun: string, entityTypeId: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await recordTypeHint({ campaignId: fixture.campaign.id, noun, entityTypeId });
  }
}

describe("seeing what was learned", () => {
  it("says nothing has been learned yet", async () => {
    renderPanel();

    expect(
      await screen.findByText(/Nothing yet/),
    ).toBeInTheDocument();
  });

  it("lists a learned word with its category", async () => {
    await teach("sanctum", fixture.locationType.id);

    renderPanel();

    expect(await screen.findByText("“sanctum”")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByLabelText("Category for sanctum")).toHaveValue(
        fixture.locationType.id,
      ),
    );
  });

  it("shows how many times a word was confirmed", async () => {
    await teach("sanctum", fixture.locationType.id, 3);

    renderPanel();

    // The count is evidence: a word confirmed once may be the misclick you came
    // here to undo, and one confirmed nine times probably is not.
    expect(await screen.findByText("used 3 times")).toBeInTheDocument();
  });

  it("says 'used once' rather than 'used 1 times'", async () => {
    await teach("sanctum", fixture.locationType.id);

    renderPanel();

    expect(await screen.findByText("used once")).toBeInTheDocument();
  });

  it("filters the list", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.locationType.id);
    await teach("wyrmhold", fixture.npcType.id);

    renderPanel();
    await screen.findByText("“sanctum”");

    await user.type(screen.getByLabelText("Filter learned words"), "wyrm");

    expect(screen.queryByText("“sanctum”")).not.toBeInTheDocument();
    expect(screen.getByText("“wyrmhold”")).toBeInTheDocument();
  });
});

describe("correcting a wrong lesson", () => {
  it("changes what the app suggests next time", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.npcType.id);

    renderPanel();
    const select = await screen.findByLabelText("Category for sanctum");
    await user.selectOptions(select, fixture.locationType.id);

    // The panel's whole purpose: not that the row changed, but that the app
    // now guesses differently.
    await waitFor(async () => {
      const suggestion = await suggestEntityType(
        fixture.campaign.id,
        "Ashgate",
        "Ashgate is a sanctum.",
      );
      expect(suggestion?.entityTypeId).toBe(fixture.locationType.id);
    });
  });

  it("does not add a second row for the same word", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.npcType.id);

    renderPanel();
    await user.selectOptions(
      await screen.findByLabelText("Category for sanctum"),
      fixture.locationType.id,
    );

    await waitFor(async () => {
      expect(await listTypeHints(fixture.campaign.id)).toHaveLength(1);
    });
  });
});

describe("forgetting a word", () => {
  it("removes it from the list", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.locationType.id);

    renderPanel();
    await user.click(await screen.findByLabelText("Forget sanctum"));

    await waitFor(() =>
      expect(screen.queryByText("“sanctum”")).not.toBeInTheDocument(),
    );
  });

  it("stops the app suggesting that category", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.locationType.id);

    renderPanel();
    await user.click(await screen.findByLabelText("Forget sanctum"));

    await waitFor(async () => {
      const suggestion = await suggestEntityType(
        fixture.campaign.id,
        "Ashgate",
        "Ashgate is a sanctum.",
      );
      // "sanctum" is not a built-in word, so with the lesson gone there is
      // nothing left to propose.
      expect(suggestion?.entityTypeId).toBeNull();
    });
  });

  it("falls back to the built-in answer for a word that has one", async () => {
    const user = userEvent.setup();
    // "temple" ships as a Location; this campaign had overridden it.
    await teach("temple", fixture.npcType.id);

    renderPanel();
    await user.click(await screen.findByLabelText("Forget temple"));

    await waitFor(async () => {
      const suggestion = await suggestEntityType(
        fixture.campaign.id,
        "Ashgate",
        "Ashgate is a temple.",
      );
      expect(suggestion?.entityTypeId).toBe(fixture.locationType.id);
      expect(suggestion?.source).toBe("builtin");
    });
  });

  it("leaves the other words alone", async () => {
    const user = userEvent.setup();
    await teach("sanctum", fixture.locationType.id);
    await teach("wyrmhold", fixture.npcType.id);

    renderPanel();
    await user.click(await screen.findByLabelText("Forget sanctum"));

    await waitFor(() =>
      expect(screen.queryByText("“sanctum”")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("“wyrmhold”")).toBeInTheDocument();
  });
});
