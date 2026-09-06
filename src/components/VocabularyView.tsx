"use client";

/**
 * What this campaign has taught the app (PRD §8).
 *
 * The app records the category you pick for a noun and reuses it — classify one
 * "sanctum" as a Location and the next one is guessed. That is useful right up
 * until it learns something wrong, at which point it becomes a small machine
 * quietly repeating your mistake. This is where you see what it has picked up
 * and change your mind.
 *
 * Corrections are made in place rather than by deleting and re-teaching:
 * changing the category here is the same operation as overriding a suggestion
 * in the create dialog, so there is one rule for how the app learns rather than
 * two paths that could drift apart.
 */

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  forgetTypeHint,
  listTypeHints,
  recordTypeHint,
} from "@/lib/services";
import type { EntityTypeHint } from "@/lib/db/types";
import { accentVar } from "@/lib/theme/palette";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function VocabularyView() {
  const { campaign, entityTypes, typeById } = useCampaign();
  const { navigate } = useNavigation();

  const [filter, setFilter] = useState("");

  const campaignId = campaign?.id;

  const hints = useLiveQuery(
    () =>
      campaignId ? listTypeHints(campaignId) : Promise.resolve<EntityTypeHint[]>([]),
    [campaignId],
    [] as EntityTypeHint[],
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return hints;
    return hints.filter((h) => h.noun.includes(needle));
  }, [hints, filter]);

  return (
    <div className="h-full overflow-y-auto px-8 py-7">
      <header className="mb-6 flex flex-wrap items-end gap-3 border-b border-hair pb-5">
        <div className="max-w-prose">
          <h1 className="text-2xl font-semibold text-ink">
            What this campaign has learned
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            When you create an entity from a sentence that says what it is —
            “Ashgate is a sanctum” — the app remembers that noun and suggests the
            same category next time. Nothing here is shared between campaigns,
            and nothing is guessed: every line is a choice you made.
          </p>
        </div>

        {hints.length > 0 && (
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter learned words"
            className="ml-auto rounded border border-hair bg-surface px-2.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
          />
        )}
      </header>

      {hints.length === 0 ? (
        <p className="max-w-prose text-sm text-ink-faint">
          Nothing yet. Write a sentence like “Ashgate is a sanctum”, select the
          name, and choose a category — the app will remember what a sanctum is
          the next time you write one.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-ink-faint">Nothing matches that filter.</p>
      ) : (
        <ul className="space-y-1">
          {shown.map((hint) => {
            const type = typeById.get(hint.entityTypeId);

            return (
              <li
                key={hint.id}
                data-testid="learned-word"
                data-noun={hint.noun}
                className="flex flex-wrap items-center gap-3 rounded border border-hair px-3 py-2"
              >
                <span className="min-w-32 text-sm text-ink">“{hint.noun}”</span>

                <span className="text-xs text-ink-faint">means</span>

                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: accentVar(type?.themeKey ?? "concept") }}
                />

                {/*
                  A select rather than a link to the section: the useful action
                  here is correcting the lesson, and re-teaching through the same
                  operation the dialog uses keeps one rule for how it learns.
                */}
                <select
                  value={hint.entityTypeId}
                  aria-label={`Category for ${hint.noun}`}
                  onChange={(e) => {
                    if (!campaignId) return;
                    void recordTypeHint({
                      campaignId,
                      noun: hint.noun,
                      entityTypeId: e.target.value,
                    });
                  }}
                  className="rounded border border-hair bg-surface px-2 py-1 text-sm text-ink-muted"
                >
                  {entityTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                {/* The count is evidence, not decoration: a word confirmed nine
                    times is one you can trust, and one confirmed once may well
                    be the misclick you came here to undo. */}
                <span className="text-xs text-ink-faint">
                  {hint.count === 1 ? "used once" : `used ${hint.count} times`}
                </span>

                <button
                  type="button"
                  aria-label={`Forget ${hint.noun}`}
                  onClick={() => void forgetTypeHint(hint.id)}
                  className="ml-auto shrink-0 rounded px-2 py-1 text-xs text-ink-faint transition-colors hover:text-blood"
                >
                  Forget
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hints.length > 0 && (
        <p className="mt-6 max-w-prose text-xs text-ink-faint">
          Forgetting a word does not change any entity you have already created —
          it only stops the app suggesting that category next time. Built-in
          words like “temple” and “god” come back when a learned one is forgotten.
        </p>
      )}

      <button
        type="button"
        onClick={() => navigate({ kind: "canon" })}
        className="mt-8 text-xs text-ink-faint hover:text-candle hover:underline"
      >
        ← Back to the Canon
      </button>
    </div>
  );
}
