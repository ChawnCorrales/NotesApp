/**
 * Guessing what kind of thing a phrase names, from the sentence around it.
 *
 * "Marrow is a merchant in Greyhaven" says what Marrow is, in the writing the GM
 * was already doing. Reading that saves them classifying it by hand — the one
 * moment the app asks for structure (§8).
 *
 * Two rules keep it honest.
 *
 * It never decides, it only proposes. The result pre-selects a category in the
 * create dialog and shows the word it came from, so a wrong guess is visible and
 * one click from corrected. Silently filing Marrow as a Location because a
 * sentence mentioned a city is far worse than asking.
 *
 * It abstains when unsure. No suggestion costs one click; a confident wrong one
 * costs a mis-filed entity the user may never notice. Every rule here is scoped
 * to the sentence containing the name and to an explicit grammatical frame,
 * rather than scanning nearby words and taking the best hit.
 *
 * The output is a `themeKey`, not a category id or name, because a campaign's
 * sections can be renamed and added to. "Deity" the concept survives the user
 * renaming that section to "Gods & Powers"; the string "Deity" does not.
 */

export interface TypeSuggestion {
  /** Matches `EntityType.themeKey`, so it survives a section being renamed. */
  themeKey: string;
  /** The noun that produced this, so the UI can say why. */
  evidence: string;
}

/**
 * What the sentence called the thing, and what the built-in list makes of it.
 *
 * `themeKey` is null for a noun the list has never heard of — which is not a
 * failure but the interesting case: it is the word this campaign can teach
 * the app. `learnable` is false for frames that produce a word without
 * asserting it is a classification, so "Marrow the Bold" never teaches
 * anything about "bold".
 */
export interface Classifier {
  noun: string;
  themeKey: string | null;
  learnable: boolean;
}

/**
 * Nouns that identify a kind of thing.
 *
 * Deliberately a closed list of unambiguous words. Adding "master" or "keeper"
 * would catch more sentences and also start misreading "the master key" and
 * "the keeper of records", which is the trade this module refuses.
 */
const LEXICON: Record<string, string> = {};

function define(themeKey: string, words: string[]) {
  for (const word of words) LEXICON[word] = themeKey;
}

define("deity", [
  "god", "goddess", "deity", "demigod", "archangel", "titan",
]);
define("location", [
  "city", "town", "village", "hamlet", "capital", "port", "harbour", "harbor",
  "keep", "castle", "fortress", "citadel", "tower", "temple", "shrine",
  "tavern", "inn", "forest", "wood", "swamp", "marsh", "mountain", "peak",
  "valley", "river", "lake", "island", "isle", "desert", "cavern", "cave",
  "dungeon", "ruin", "ruins", "kingdom", "realm", "region", "province",
  "district", "quarter", "road", "bridge", "gate", "market", "library",
]);
define("npc", [
  "merchant", "trader", "blacksmith", "smith", "innkeeper", "barkeep",
  "guard", "soldier", "knight", "captain", "sergeant", "king", "queen",
  "prince", "princess", "lord", "lady", "duke", "duchess", "baron",
  "priest", "priestess", "cleric", "monk", "wizard", "sorcerer", "witch",
  "thief", "rogue", "assassin", "bard", "sailor", "farmer", "hunter",
  "scholar", "scribe", "healer", "alchemist", "mayor", "steward", "envoy",
]);
define("faction", [
  "guild", "cult", "clan", "tribe", "order", "brotherhood", "sisterhood",
  "syndicate", "faction", "coven", "conclave", "company", "warband",
]);
define("organization", [
  "council", "senate", "court", "academy", "university", "institute",
  "ministry", "bureau", "consortium",
]);
define("item", [
  "sword", "blade", "dagger", "axe", "spear", "bow", "staff", "wand",
  "shield", "armour", "armor", "helm", "ring", "amulet", "talisman",
  "crown", "tome", "grimoire", "scroll", "potion", "elixir", "relic",
  "artifact", "artefact", "gem", "jewel", "key", "map",
]);
define("creature", [
  "dragon", "wyvern", "wolf", "bear", "troll", "goblin", "orc", "ogre",
  "giant", "beast", "demon", "devil", "spirit", "ghost", "wraith", "lich",
  "vampire", "werewolf", "golem", "elemental", "serpent", "hydra",
]);
define("event", [
  "war", "battle", "siege", "festival", "feast", "ritual", "ceremony",
  "plague", "famine", "rebellion", "uprising", "massacre", "coronation",
  "tournament", "eclipse",
]);
define("quest", [
  "quest", "mission", "contract", "hunt", "errand", "job", "bounty",
]);
define("mystery", [
  "mystery", "riddle", "prophecy", "omen", "secret", "curse", "legend",
]);

/** Splits into sentences, so a fact about one name cannot describe another. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/g);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Words that end the noun phrase being classified.
 *
 * Without this, a right-to-left scan runs off the end of the phrase and into
 * whatever follows: "Ash is a god of the deep roads" read as a *road*, and
 * "Marrow was a merchant before the war" as an *event*. Both are exactly the
 * confident-and-wrong answer this module is supposed to refuse.
 */
const CLAUSE_BOUNDARY = new Set([
  "of", "in", "from", "at", "on", "with", "without", "for", "to", "by",
  "before", "after", "during", "near", "beneath", "under", "over", "against",
  "who", "whom", "which", "that", "and", "but", "or", "while", "until",
]);

/**
 * The first lexicon hit in a run of words.
 *
 * Scans right to left because English puts the head noun last: "a grizzled old
 * merchant" is a merchant, and "a dragon cult" is a cult, not a dragon. The
 * phrase is cut at the first clause boundary before scanning, so "last word"
 * means the last word of *this* noun phrase.
 */
function headNoun(
  phrase: string,
  anchor: "start" | "end",
): Omit<Classifier, "learnable"> | null {
  const all = phrase.toLowerCase().match(/[a-z']+/g) ?? [];

  /**
   * Which side of the capture the noun phrase sits on.
   *
   * "a merchant before the war" is anchored at the start, so everything from
   * the first boundary word on is someone else's clause. "They rode to the
   * city" — the capture before "of Greyhaven" — is anchored at the end, so the
   * noun phrase is what follows the *last* boundary word. Trimming the wrong
   * end throws away the noun instead of the noise.
   */
  let words: string[];
  if (anchor === "start") {
    const stop = all.findIndex((w) => CLAUSE_BOUNDARY.has(w));
    words = stop === -1 ? all : all.slice(0, stop);
  } else {
    let last = -1;
    for (let i = 0; i < all.length; i++) if (CLAUSE_BOUNDARY.has(all[i])) last = i;
    words = all.slice(last + 1);
  }

  if (words.length === 0) return null;

  /**
   * Two answers, not one.
   *
   * `themeKey` is the built-in guess and exists only for words in the lexicon.
   * `noun` is what the sentence actually called the thing, lexicon or not — and
   * that is the part worth remembering, because an unrecognised noun is exactly
   * the case where the campaign can teach the app something the built-in list
   * never knew.
   */
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    const themeKey = LEXICON[word] ?? LEXICON[singular(word)];
    if (themeKey) return { noun: word, themeKey };
  }
  return { noun: words[words.length - 1], themeKey: null };
}

/** Crude de-pluralisation; only used as a fallback after an exact miss. */
function singular(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("es") && word.length > 3) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** How many characters after the frame to read while looking for the noun. */
const WINDOW = 40;

/**
 * Finds the noun the sentence uses to classify `name`.
 *
 * `context` should be the note's text; only the sentence containing the name
 * is consulted. Returns null whenever no frame matches — which is most
 * sentences, and is the point.
 *
 * The noun comes back whether or not the built-in list recognises it. An
 * unknown noun is not a miss; it is the word a campaign can teach.
 */
export function extractClassifier(name: string, context: string): Classifier | null {
  const trimmed = name.trim();
  if (!trimmed || !context) return null;

  const escaped = escapeRegExp(trimmed);
  const nameRe = new RegExp(escaped, "i");

  /**
   * Sentence splitting can cut a name in half — "St. Alaric" splits at the
   * full stop — leaving no sentence that contains it. Falling back to the whole
   * text keeps those names working rather than silently never classifying them.
   */
  const candidates = sentences(context).filter((s) => nameRe.test(s));
  const scopes = candidates.length > 0 ? candidates : [context];

  for (const sentence of scopes) {
    if (!nameRe.test(sentence)) continue;

    /**
     * Frames, in order of how strongly they assert a classification.
     *
     * Each captures the run of words expected to contain the head noun. The
     * copula frames come first because "X is a god" is an outright statement;
     * the epithet frame is last because "Marrow the Bold" is common and yields
     * nothing, which is the correct outcome.
     */
    const frames: {
      re: RegExp;
      anchor: "start" | "end";
      /** Whether this frame asserts a classification worth remembering. */
      learnable: boolean;
    }[] = [
      // "the city of Greyhaven", "the Kingdom of Ash"
      {
        re: new RegExp(`\\b([a-z' ]{0,${WINDOW}}?)\\s+of\\s+${escaped}\\b`, "i"),
        anchor: "end",
        learnable: true,
      },
      // "Marrow is a grizzled merchant", "Ash was the high priest"
      {
        re: new RegExp(`${escaped}\\s+(?:is|was|are|were)\\s+(?:a|an|the)?\\s*([a-z' ]{0,${WINDOW}})`, "i"),
        anchor: "start",
        learnable: true,
      },
      // "Marrow, a merchant, waited"
      {
        re: new RegExp(`${escaped}\\s*,\\s*(?:a|an|the)\\s+([a-z' ]{0,${WINDOW}})`, "i"),
        anchor: "start",
        learnable: true,
      },
      // "a merchant named Marrow", "the god called Ash"
      {
        re: new RegExp(`\\b(?:a|an|the)\\s+([a-z' ]{0,${WINDOW}}?)\\s+(?:named|called)\\s+${escaped}\\b`, "i"),
        anchor: "end",
        learnable: true,
      },
      // "Marrow the Blacksmith"
      {
        re: new RegExp(`${escaped}\\s+the\\s+([a-z' ]{0,${WINDOW}})`, "i"),
        anchor: "start",
        // "Marrow the Bold" yields "bold", which classifies nothing. Fine
        // to shrug at, but never something to learn a rule from.
        learnable: false,
      },
    ];

    for (const { re, anchor, learnable } of frames) {
      const match = sentence.match(re);
      if (!match?.[1]) continue;
      const found = headNoun(match[1], anchor);
      if (found) return { ...found, learnable };
    }
  }

  return null;
}

/**
 * The built-in guess alone, with no campaign knowledge behind it.
 *
 * Kept as its own function because it is pure and total: same text in, same
 * answer out, no database. That is what makes the rules cheap enough to test
 * exhaustively, and it is where four real bugs surfaced before any of this ran
 * in a browser. The learned layer sits on top in the service, never in here.
 */
export function inferEntityType(name: string, context: string): TypeSuggestion | null {
  const found = extractClassifier(name, context);
  return found?.themeKey ? { themeKey: found.themeKey, evidence: found.noun } : null;
}
