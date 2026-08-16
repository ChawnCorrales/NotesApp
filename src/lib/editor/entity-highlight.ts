/**
 * The TipTap extension that makes recognised entities visible.
 *
 * This is the mechanism behind the product's central promise: flag a concept
 * once, and every later mention lights up on its own (PRD §8, §9).
 *
 * Crucially, nothing is written into the document. Mentions are *decorations*
 * recomputed from the text on each change, which is what gives §62 its
 * behaviour for free — delete the word and the mention vanishes, rename the
 * entity and every occurrence updates at once, add an alias and old notes light
 * up retroactively. Storing marks in the document would require migrating every
 * note on each of those operations.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import { filterSuppressed, type EntityRecognizer } from "../entities/recognizer";
import { flattenDoc, textRangeToDocRange } from "./doc-text";

/** Metadata the decoration needs in order to colour and label itself. */
export interface EntityDisplayInfo {
  name: string;
  /** Theme palette key from the entity's category. */
  themeKey: string;
  icon: string;
}

/**
 * The campaign's current entity vocabulary, as the editor sees it.
 *
 * Delivered by transaction rather than as a configuration option, because the
 * vocabulary changes far more often than an editor should be torn down and
 * rebuilt — recreating the extension on every new entity would cost the user
 * their cursor and undo history.
 */
export interface EntityVocabulary {
  recognizer: EntityRecognizer | null;
  lookup: (entityId: string) => EntityDisplayInfo | undefined;
  /**
   * Occurrences in *this note* the user has rejected, as `entityId:occurrence`
   * keys. Per-note because a correction is about one piece of text.
   */
  suppressed: ReadonlySet<string>;
}

interface HighlightState extends EntityVocabulary {
  decorations: DecorationSet;
}

export const entityHighlightKey = new PluginKey<HighlightState>("entityHighlight");

/** Dispatch a transaction carrying this meta to install a new vocabulary. */
export const SET_VOCABULARY_META = "setEntityVocabulary";

const EMPTY_LOOKUP = () => undefined;
const EMPTY_SUPPRESSED: ReadonlySet<string> = new Set();

function buildDecorations(
  state: EditorState,
  vocabulary: EntityVocabulary,
): DecorationSet {
  const { recognizer } = vocabulary;
  if (!recognizer) return DecorationSet.empty;

  const flat = flattenDoc(state.doc);
  const matches = filterSuppressed(
    recognizer.findMatches(flat.text),
    vocabulary.suppressed,
  );
  if (matches.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];

  for (const match of matches) {
    const range = textRangeToDocRange(flat, match.start, match.end);
    if (!range) continue;

    const info = vocabulary.lookup(match.entityId);

    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: "entity-mention",
        "data-entity-id": match.entityId,
        "data-entity-theme": info?.themeKey ?? "concept",
        // Carried into the DOM so a click can identify *which* occurrence was
        // acted on, which is what a per-occurrence correction needs.
        "data-entity-occurrence": String(match.occurrence),
        title: info ? `${info.name} — ${info.themeKey}` : undefined,
      }),
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

export const EntityHighlight = Extension.create({
  name: "entityHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: entityHighlightKey,

        state: {
          init() {
            // Starts empty; the host dispatches the vocabulary on mount.
            return {
              decorations: DecorationSet.empty,
              recognizer: null,
              lookup: EMPTY_LOOKUP,
              suppressed: EMPTY_SUPPRESSED,
            };
          },

          /**
           * Recompute on any content change, or when the vocabulary is replaced.
           *
           * A full rescan per keystroke is deliberate. Aho-Corasick is linear in
           * document length and independent of entity count, so a long note
           * costs tens of microseconds — cheaper than reasoning about which
           * decorations a transaction invalidated, and immune to the drift that
           * incremental mapping introduces around edit boundaries (§63).
           */
          apply(tr, current, _oldState, newState) {
            const incoming = tr.getMeta(SET_VOCABULARY_META) as
              | EntityVocabulary
              | undefined;

            if (incoming) {
              const next: EntityVocabulary = {
                recognizer: incoming.recognizer,
                lookup: incoming.lookup,
                suppressed: incoming.suppressed ?? EMPTY_SUPPRESSED,
              };
              return { ...next, decorations: buildDecorations(newState, next) };
            }

            if (!tr.docChanged) return current;

            return {
              ...current,
              decorations: buildDecorations(newState, current),
            };
          },
        },

        props: {
          decorations(state) {
            return entityHighlightKey.getState(state)?.decorations;
          },
        },
      }),
    ];
  },
});
