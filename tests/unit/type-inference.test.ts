/**
 * Inferring what kind of thing a name refers to (PRD §8).
 *
 * A pure function over text, so it is tested as one — no editor, no database.
 *
 * The suggestions are the easy half. The half that decides whether this feature
 * is worth having is the abstentions: a wrong category that pre-selects itself
 * and gets confirmed by a user who was not really reading is a mis-filed entity
 * nobody notices. So most of what follows asserts that nothing is suggested.
 */

import { describe, expect, it } from "vitest";
import { inferEntityType } from "@/lib/entities/type-inference";

/** The themeKey suggested for `name`, or null. */
function guess(name: string, context: string): string | null {
  return inferEntityType(name, context)?.themeKey ?? null;
}

describe("reading a stated classification", () => {
  it("takes the PRD's example", () => {
    expect(guess("Ash", "Ash is a god of the deep roads.")).toBe("deity");
  });

  it("reads the past tense too", () => {
    expect(guess("Marrow", "Marrow was a merchant before the war.")).toBe("npc");
  });

  it("reads an appositive", () => {
    expect(guess("Marrow", "Marrow, a blacksmith, hammered on.")).toBe("npc");
  });

  it("reads the name-last frame", () => {
    expect(guess("Greyhaven", "They rode to the city of Greyhaven.")).toBe("location");
  });

  it("reads 'a merchant named Marrow'", () => {
    expect(guess("Marrow", "They met a merchant named Marrow.")).toBe("npc");
  });

  it("reads an epithet", () => {
    expect(guess("Marrow", "Marrow the Blacksmith shut the forge.")).toBe("npc");
  });

  it("looks past adjectives to the head noun", () => {
    expect(guess("Marrow", "Marrow is a grizzled old merchant.")).toBe("npc");
  });

  /**
   * English puts the head noun last, so a right-to-left scan is load-bearing.
   * Scanning forwards would call the Cult of Glass a creature.
   */
  it("takes the head noun, not the first noun it recognises", () => {
    expect(guess("Glass", "Glass is a dragon cult.")).toBe("faction");
  });

  it("handles a plural", () => {
    expect(guess("Ashfields", "The Ashfields are ruins now.")).toBe("location");
  });

  it("is case-insensitive about the classification", () => {
    expect(guess("Ash", "Ash is a GOD.")).toBe("deity");
  });

  it("reports the word it read, so the UI can say why", () => {
    expect(inferEntityType("Ash", "Ash is a god.")).toEqual({
      themeKey: "deity",
      evidence: "god",
    });
  });
});

describe("covering the categories a campaign starts with", () => {
  const cases: [string, string, string][] = [
    ["Duskwood", "Duskwood is a forest.", "location"],
    ["Vell", "Vell is a priestess.", "npc"],
    ["Ironhand", "Ironhand is a guild.", "faction"],
    ["Assembly", "The Assembly is a council.", "organization"],
    ["Nightfang", "Nightfang is a sword.", "item"],
    ["Skarn", "Skarn is a dragon.", "creature"],
    ["Reckoning", "The Reckoning was a war.", "event"],
    ["Errand", "The Errand is a contract.", "quest"],
    ["Whisper", "The Whisper is a prophecy.", "mystery"],
  ];

  for (const [name, context, expected] of cases) {
    it(`reads "${context}" as ${expected}`, () => {
      expect(guess(name, context)).toBe(expected);
    });
  }
});

describe("abstaining", () => {
  it("says nothing when the sentence classifies nothing", () => {
    expect(guess("Marrow", "Marrow walked into the room and sat down.")).toBeNull();
  });

  /**
   * The failure this module exists to avoid. A neighbouring sentence describing
   * somewhere else must not classify this name.
   */
  it("does not borrow a classification from another sentence", () => {
    expect(
      guess("Marrow", "Greyhaven is a city. Marrow closed the door behind him."),
    ).toBeNull();
  });

  it("does not classify a name from a noun merely nearby", () => {
    expect(guess("Marrow", "The merchant glared, and Marrow left.")).toBeNull();
  });

  it("says nothing for an epithet that is not a kind of thing", () => {
    // "Marrow the Bold" describes him without saying what he is.
    expect(guess("Marrow", "Marrow the Bold rode ahead.")).toBeNull();
  });

  it("says nothing for an unknown noun", () => {
    expect(guess("Zeth", "Zeth is a thaumaturge.")).toBeNull();
  });

  it("says nothing when the name is absent from the text", () => {
    expect(guess("Marrow", "Greyhaven is a city.")).toBeNull();
  });

  it("says nothing for empty input", () => {
    expect(guess("", "Ash is a god.")).toBeNull();
    expect(guess("Ash", "")).toBeNull();
  });

  it("treats a name with regex characters as literal text", () => {
    // A crash here would take the create dialog down with it.
    expect(() => guess("A. (the) *Star*", "A. (the) *Star* is a god.")).not.toThrow();
    expect(guess("A. (the) *Star*", "A. (the) *Star* is a god.")).toBe("deity");
  });
});

describe("picking the right sentence", () => {
  it("uses the sentence the name is in, not the first one", () => {
    const text = "The road was long. Ash is a god. Marrow is a merchant.";

    expect(guess("Ash", text)).toBe("deity");
    expect(guess("Marrow", text)).toBe("npc");
  });

  it("handles a name mentioned before it is classified", () => {
    const text = "Marrow waited by the gate.\nMarrow is a blacksmith.";

    expect(guess("Marrow", text)).toBe("npc");
  });

  it("treats a line break as a sentence boundary", () => {
    // Notes are full of headings and list items with no full stop.
    expect(guess("Marrow", "Greyhaven is a city\nMarrow shrugged")).toBeNull();
  });
});
