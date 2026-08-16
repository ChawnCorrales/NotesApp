"use client";

/**
 * Full-text search across notes, entities and aliases (PRD §26).
 *
 * This is a linear scan over the campaign's notes, which is honest about what
 * it is: correct, dependency-free, and fast enough for the campaigns anyone has
 * today. It is also the first thing that will need replacing — see the note on
 * `scoreNote` — and the PRD's 10,000-note target (§63) is where that line sits.
 */

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Entity, Note } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

/** Characters of surrounding text to show around a hit. */
const SNIPPET_RADIUS = 90;

interface NoteHit {
  note: Note;
  snippet: string;
}

function buildSnippet(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + queryLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

export function SearchView({ query }: { query: string }) {
  const { campaign, entities, aliases, typeById } = useCampaign();
  const { navigate } = useNavigation();

  const [liveQuery, setLiveQuery] = useState(query);
  const needle = liveQuery.trim().toLowerCase();

  const notes = useLiveQuery(
    async () => {
      if (!campaign) return [] as Note[];
      const all = await db.notes.where("campaignId").equals(campaign.id).toArray();
      return all.filter((note) => note.deletedAt === null);
    },
    [campaign?.id],
    [] as Note[],
  );

  const noteHits = useMemo<NoteHit[]>(() => {
    if (!needle) return [];

    const hits: NoteHit[] = [];
    for (const note of notes) {
      const haystack = `${note.title}\n${note.contentText}`.toLowerCase();
      const index = haystack.indexOf(needle);
      if (index === -1) continue;

      const contentIndex = note.contentText.toLowerCase().indexOf(needle);
      hits.push({
        note,
        snippet:
          contentIndex >= 0
            ? buildSnippet(note.contentText, contentIndex, needle.length)
            : "",
      });
    }

    return hits.sort((a, b) => b.note.updatedAt - a.note.updatedAt);
  }, [notes, needle]);

  /** Entity matches, including via alias — searching "Verena" must find the Red Queen. */
  const entityHits = useMemo<{ entity: Entity; via: string | null }[]>(() => {
    if (!needle) return [];

    const aliasesByEntity = new Map<string, string[]>();
    for (const alias of aliases) {
      const list = aliasesByEntity.get(alias.entityId) ?? [];
      list.push(alias.alias);
      aliasesByEntity.set(alias.entityId, list);
    }

    const hits: { entity: Entity; via: string | null }[] = [];
    for (const entity of entities) {
      if (entity.name.toLowerCase().includes(needle)) {
        hits.push({ entity, via: null });
        continue;
      }
      const matchedAlias = (aliasesByEntity.get(entity.id) ?? []).find((a) =>
        a.toLowerCase().includes(needle),
      );
      if (matchedAlias) hits.push({ entity, via: matchedAlias });
    }

    return hits;
  }, [entities, aliases, needle]);

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <input
        value={liveQuery}
        onChange={(e) => setLiveQuery(e.target.value)}
        aria-label="Search query"
        placeholder="Search notes, entities, aliases…"
        className="w-full border-b border-hair bg-transparent pb-3 text-xl text-ink placeholder:text-ink-faint focus:outline-none"
      />

      {!needle && (
        <p className="mt-6 text-sm text-ink-faint">
          Search titles, note text, entity names and aliases.
        </p>
      )}

      {needle && entityHits.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Entities
          </h2>
          <ul className="space-y-1">
            {entityHits.map(({ entity, via }) => {
              const type = typeById.get(entity.entityTypeId);
              return (
                <li key={entity.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ kind: "entity", entityId: entity.id })}
                    className="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-raised"
                  >
                    <span aria-hidden="true">{type?.icon ?? "◇"}</span>
                    <span className="text-ink">{entity.name}</span>
                    <span className="text-xs text-ink-faint">{type?.name}</span>
                    {via && (
                      <span className="text-xs text-ink-faint">matched “{via}”</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {needle && (
        <section className="mt-6 pb-10">
          <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Notes
          </h2>
          {noteHits.length === 0 ? (
            <p className="text-sm text-ink-faint">No notes match.</p>
          ) : (
            <ul className="space-y-1">
              {noteHits.map(({ note, snippet }) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ kind: "note", noteId: note.id })}
                    className="w-full rounded px-2 py-2 text-left transition-colors hover:bg-raised"
                  >
                    <span className="block text-ink">
                      {note.title || "Untitled note"}
                    </span>
                    {snippet && (
                      <span className="mt-0.5 block text-xs text-ink-faint">
                        {snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
