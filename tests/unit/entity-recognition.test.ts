/**
 * Entity recognition — the behaviour the whole product rests on.
 *
 * These are pure-function tests over the matcher. They are the cheapest place
 * to pin down the rules about *what counts as a mention*, which is a product
 * question, not a rendering one.
 */

import { describe, expect, it } from "vitest";
import { EntityRecognizer } from "@/lib/entities/recognizer";
import type { Entity, EntityAlias } from "@/lib/db/types";

function entity(id: string, name: string, autoLink = true): Entity {
  return {
    id,
    campaignId: "c1",
    name,
    entityTypeId: "t1",
    description: "",
    autoLink,
    createdAt: 0,
    updatedAt: 0,
  };
}

function alias(entityId: string, text: string): EntityAlias {
  return { id: `${entityId}-${text}`, entityId, alias: text };
}

function recognizerFor(entities: Entity[], aliases: EntityAlias[] = []) {
  return EntityRecognizer.fromCampaign(entities, aliases);
}

describe("recognising a known entity", () => {
  it("recognises text written after the entity was created", () => {
    const recognizer = recognizerFor([entity("marrow", "Marrow")]);

    const matches = recognizer.findMatches("Marrow enters the tavern.");

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      entityId: "marrow",
      detectedText: "Marrow",
      start: 0,
      end: 6,
    });
  });

  it("recognises an entity regardless of the case it is written in", () => {
    const recognizer = recognizerFor([entity("marrow", "Marrow")]);

    const matches = recognizer.findMatches("the party asked MARROW about it");

    expect(matches).toHaveLength(1);
    // The original casing is preserved so the note is never rewritten.
    expect(matches[0].detectedText).toBe("MARROW");
  });

  it("finds an entity anywhere in the text, not only at the start", () => {
    const recognizer = recognizerFor([entity("grey", "Greyhaven")]);

    const matches = recognizer.findMatches("They travelled south to Greyhaven.");

    expect(matches).toHaveLength(1);
    expect(matches[0].start).toBe(24);
  });

  it("ignores entities the user has excluded from auto-linking", () => {
    const recognizer = recognizerFor([entity("ash", "Ash", false)]);

    expect(recognizer.findMatches("Ash waits at the gate.")).toHaveLength(0);
  });
});

describe("aliases", () => {
  const redQueen = entity("queen", "The Red Queen");
  const aliases = [
    alias("queen", "Red Queen"),
    alias("queen", "Queen Verena"),
    alias("queen", "Verena"),
  ];

  it.each([
    ["The Red Queen", "The Red Queen"],
    ["Red Queen", "Red Queen"],
    ["Queen Verena", "Queen Verena"],
    ["Verena", "Verena"],
  ])("resolves %s to the same entity", (text, expected) => {
    const recognizer = recognizerFor([redQueen], aliases);

    const matches = recognizer.findMatches(`They spoke of ${text} at length.`);

    expect(matches).toHaveLength(1);
    expect(matches[0].entityId).toBe("queen");
    expect(matches[0].detectedText).toBe(expected);
  });

  it("prefers the longest alias when one contains another", () => {
    const recognizer = recognizerFor([redQueen], aliases);

    const matches = recognizer.findMatches("Queen Verena spoke.");

    // "Verena" is also an alias, but the longer "Queen Verena" is the real
    // mention — otherwise the same words would light up twice.
    expect(matches).toHaveLength(1);
    expect(matches[0].detectedText).toBe("Queen Verena");
  });
});

describe("word boundaries", () => {
  const ash = entity("ash", "Ash");

  it.each([
    "The Ashen Crown was lost.",
    "A flash of light.",
    "They ate the ashes.",
    "Ashford is north of here.",
  ])("does not match Ash inside %s", (text) => {
    const recognizer = recognizerFor([ash]);

    expect(recognizer.findMatches(text)).toHaveLength(0);
  });

  it.each([
    "Ash waits.",
    "They greeted Ash.",
    "Ash, of all people, agreed.",
    "It belongs to Ash's brother.",
    "(Ash)",
  ])("does match the standalone Ash in %s", (text) => {
    const recognizer = recognizerFor([ash]);

    expect(recognizer.findMatches(text)).toHaveLength(1);
  });

  it("still matches a multi-word entity bounded by punctuation", () => {
    const recognizer = recognizerFor([entity("hollow", "Battle of Hollowbridge")]);

    const matches = recognizer.findMatches("Survivors of the Battle of Hollowbridge—few.");

    expect(matches).toHaveLength(1);
  });
});

describe("editing around a mention", () => {
  const recognizer = recognizerFor([entity("marrow", "Marrow")]);

  it("keeps recognising after text is inserted before the mention", () => {
    const before = recognizer.findMatches("Marrow waits.");
    const after = recognizer.findMatches("In the shuttered shop, Marrow waits.");

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0].entityId).toBe("marrow");
    // The offset moves with the text, which is exactly what should happen.
    expect(after[0].start).toBeGreaterThan(before[0].start);
  });

  it("keeps recognising after text is appended following the mention", () => {
    const matches = recognizer.findMatches(
      "Marrow waits, and will keep waiting until the party returns.",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].start).toBe(0);
  });

  it("keeps recognising when the surrounding sentence is rewritten entirely", () => {
    const matches = recognizer.findMatches(
      "Nobody in Greyhaven will say why Marrow closed the shop.",
    );

    expect(matches.map((m) => m.detectedText)).toEqual(["Marrow"]);
  });

  it("stops recognising once the name itself is altered", () => {
    expect(recognizer.findMatches("Marrowx waits.")).toHaveLength(0);
  });
});

describe("multiple mentions of the same entity", () => {
  it("returns every occurrence, numbered in document order", () => {
    const recognizer = recognizerFor([entity("marrow", "Marrow")]);

    const matches = recognizer.findMatches(
      "Marrow lied. Later, Marrow admitted it. Marrow left.",
    );

    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.occurrence)).toEqual([0, 1, 2]);
    expect(matches.map((m) => m.start)).toEqual([0, 20, 40]);
  });

  it("numbers each entity's occurrences independently", () => {
    const recognizer = recognizerFor([
      entity("marrow", "Marrow"),
      entity("grey", "Greyhaven"),
    ]);

    const matches = recognizer.findMatches(
      "Marrow left Greyhaven. Marrow returned to Greyhaven later.",
    );

    const byEntity = (id: string) =>
      matches.filter((m) => m.entityId === id).map((m) => m.occurrence);

    expect(byEntity("marrow")).toEqual([0, 1]);
    expect(byEntity("grey")).toEqual([0, 1]);
  });

  it("counts occurrences reached through different aliases as the same entity", () => {
    const recognizer = recognizerFor(
      [entity("queen", "The Red Queen")],
      [alias("queen", "Verena")],
    );

    const matches = recognizer.findMatches("The Red Queen spoke. Verena lied.");

    expect(matches).toHaveLength(2);
    expect(matches.every((m) => m.entityId === "queen")).toBe(true);
    expect(matches.map((m) => m.occurrence)).toEqual([0, 1]);
  });
});
