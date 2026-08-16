"use client";

/**
 * An entity's own page (PRD §11).
 *
 * Most of what appears here was never typed by the user: the mentions list, the
 * backlinks and the connection counts are all derived from notes. That is the
 * point of §30 — the GM's notes *are* the wiki, so this page should feel
 * discovered rather than maintained.
 */

import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  addAlias,
  createRelationship,
  deleteRelationship,
  getBacklinks,
  getEntity,
  getEntityRelationships,
  listAliasesForEntity,
  listMentionsForEntity,
  removeAlias,
  renameEntity,
  updateEntity,
} from "@/lib/services";
import type {
  EntityAlias,
  EntityMention,
  Note,
  Relationship,
} from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function EntityPage({ entityId }: { entityId: string }) {
  const { entities, entityTypes, entityById, typeById } = useCampaign();
  const { navigate } = useNavigation();

  const entity = useLiveQuery(() => getEntity(entityId), [entityId]);

  const aliases = useLiveQuery(
    () => listAliasesForEntity(entityId),
    [entityId],
    [] as EntityAlias[],
  );

  const mentions = useLiveQuery(
    () => listMentionsForEntity(entityId),
    [entityId],
    [] as EntityMention[],
  );

  const relationships = useLiveQuery(
    () => getEntityRelationships(entityId),
    [entityId],
    { outgoing: [] as Relationship[], incoming: [] as Relationship[] },
  );

  /** Notes mentioning this entity, newest first — the §13 backlinks list. */
  const mentioningNotes = useLiveQuery(
    () => getBacklinks(entityId),
    [entityId, mentions],
    [] as Note[],
  );

  const [aliasDraft, setAliasDraft] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState("");

  /**
   * Local drafts for the free-text fields.
   *
   * These inputs cannot be driven straight from the live query: every keystroke
   * writes to IndexedDB and the value only comes back on the next round trip,
   * so typing faster than that round trip drops and reorders characters. The
   * draft owns the value while the user is typing and the database catches up
   * behind it. `null` means "nothing typed yet — show what is stored".
   *
   * Resetting on entity change is handled by the caller keying this component
   * on the entity id, which remounts it.
   */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);

  const type = entity ? typeById.get(entity.entityTypeId) : undefined;

  const otherEntities = useMemo(
    () => entities.filter((e) => e.id !== entityId),
    [entities, entityId],
  );

  const handleAddAlias = useCallback(async () => {
    if (!aliasDraft.trim()) return;
    await addAlias(entityId, aliasDraft);
    setAliasDraft("");
  }, [aliasDraft, entityId]);

  const handleAddRelationship = useCallback(async () => {
    if (!entity || !relationTarget) return;
    await createRelationship({
      campaignId: entity.campaignId,
      sourceEntityId: entityId,
      targetEntityId: relationTarget,
      relationshipType: relationType,
    });
    setRelationTarget("");
    setRelationType("");
  }, [entity, entityId, relationTarget, relationType]);

  if (!entity) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        This entity no longer exists.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <header className="border-b border-hair pb-5">
        <div className="flex items-baseline gap-3">
          <span aria-hidden="true" className="text-2xl">
            {type?.icon ?? "◇"}
          </span>
          <input
            value={nameDraft ?? entity.name}
            onChange={(e) => {
              setNameDraft(e.target.value);
              void renameEntity(entityId, e.target.value);
            }}
            aria-label="Entity name"
            className="flex-1 bg-transparent text-2xl font-semibold text-ink focus:outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={entity.entityTypeId}
            onChange={(e) => void updateEntity(entityId, { entityTypeId: e.target.value })}
            aria-label="Category"
            className="rounded border border-hair bg-surface px-2 py-1 text-sm text-ink-muted"
          >
            {entityTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <span className="text-xs text-ink-faint">
            Mentioned in {mentioningNotes.length}{" "}
            {mentioningNotes.length === 1 ? "note" : "notes"}
          </span>

          {/* PRD §10: let the user opt a noisy entity out of recognition
              without deleting it and losing its relationships. */}
          <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={entity.autoLink}
              onChange={(e) => void updateEntity(entityId, { autoLink: e.target.checked })}
            />
            Auto-link mentions
          </label>
        </div>
      </header>

      <section className="mt-6">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
          Description
        </h2>
        <textarea
          value={descriptionDraft ?? entity.description}
          onChange={(e) => {
            setDescriptionDraft(e.target.value);
            void updateEntity(entityId, { description: e.target.value });
          }}
          placeholder="What do you know about them?"
          rows={4}
          className="w-full resize-y rounded border border-hair bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
          Aliases
        </h2>
        <p className="mb-2 text-xs text-ink-faint">
          Any alias is recognised as this entity, in notes old and new.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {aliases.map((alias) => (
            <span
              key={alias.id}
              className="flex items-center gap-1.5 rounded border border-hair px-2 py-0.5 text-sm text-ink-muted"
            >
              {alias.alias}
              <button
                type="button"
                onClick={() => void removeAlias(alias.id)}
                aria-label={`Remove alias ${alias.alias}`}
                className="text-ink-faint hover:text-blood"
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddAlias();
              }
            }}
            placeholder="Add alias…"
            className="rounded border border-hair bg-surface px-2 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
          Relationships
        </h2>

        <ul className="space-y-1.5">
          {relationships.outgoing.map((rel) => {
            const target = entityById.get(rel.targetEntityId);
            return (
              <li key={rel.id} className="flex items-center gap-2 text-sm">
                <span className="text-ink-muted">{rel.relationshipType}</span>
                <span aria-hidden="true" className="text-ink-faint">
                  →
                </span>
                <button
                  type="button"
                  onClick={() => navigate({ kind: "entity", entityId: rel.targetEntityId })}
                  className="text-candle hover:underline"
                >
                  {target?.name ?? "Unknown"}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRelationship(rel.id)}
                  aria-label="Remove relationship"
                  className="text-ink-faint hover:text-blood"
                >
                  ×
                </button>
              </li>
            );
          })}

          {relationships.incoming.map((rel) => {
            const source = entityById.get(rel.sourceEntityId);
            return (
              <li key={rel.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => navigate({ kind: "entity", entityId: rel.sourceEntityId })}
                  className="text-candle hover:underline"
                >
                  {source?.name ?? "Unknown"}
                </button>
                <span className="text-ink-muted">{rel.relationshipType}</span>
                <span aria-hidden="true" className="text-ink-faint">
                  → this
                </span>
              </li>
            );
          })}

          {relationships.outgoing.length === 0 &&
            relationships.incoming.length === 0 && (
              <li className="text-sm text-ink-faint">No relationships yet.</li>
            )}
        </ul>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={relationType}
            onChange={(e) => setRelationType(e.target.value)}
            placeholder="works in, knows, controls…"
            className="rounded border border-hair bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:border-strong focus:outline-none"
          />
          <select
            value={relationTarget}
            onChange={(e) => setRelationTarget(e.target.value)}
            aria-label="Related entity"
            className="rounded border border-hair bg-surface px-2 py-1 text-sm text-ink-muted"
          >
            <option value="">Select entity…</option>
            {otherEntities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleAddRelationship()}
            disabled={!relationTarget}
            className="rounded bg-candle/20 px-2.5 py-1 text-sm text-candle hover:bg-candle/30 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </section>

      <section className="mt-6 pb-10">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
          Mentions &amp; backlinks
        </h2>
        <ul className="space-y-1">
          {mentioningNotes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => navigate({ kind: "note", noteId: note.id })}
                className="w-full rounded px-2 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {note.title || "Untitled note"}
              </button>
            </li>
          ))}
          {mentioningNotes.length === 0 && (
            <li className="text-sm text-ink-faint">
              No notes mention this entity yet.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
