"use client";

/**
 * Promoting a selected phrase into an entity (PRD §8).
 *
 * This is the one moment where the app asks the user to classify something, so
 * it is kept to a single keystroke where possible: the name is pre-filled from
 * the selection, categories are one click (not a dropdown to open and scan), and
 * Enter commits. §48 warns specifically against modal-heavy classification
 * workflows, so nothing here is required except the category.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createEntity, addAlias } from "@/lib/services";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

interface Props {
  campaignId: string;
  initialName: string;
  /** Preselects a category, e.g. when creating from within a Canon section. */
  defaultTypeId?: string;
  onClose: () => void;
}

export function CreateEntityDialog({
  campaignId,
  initialName,
  defaultTypeId,
  onClose,
}: Props) {
  const { entityTypes, entities } = useCampaign();
  const { navigate } = useNavigation();

  const [name, setName] = useState(initialName);
  const [typeId, setTypeId] = useState<string>(defaultTypeId ?? "");
  const [busy, setBusy] = useState(false);

  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInput.current?.focus();
    nameInput.current?.select();
  }, []);

  /**
   * Warn when the name already exists.
   *
   * Duplicate entities are the main way this data model degrades — two
   * "Marrow" records split his mentions in half and neither page tells the
   * whole story. Catching it at creation is far cheaper than merging later.
   */
  const duplicate = useMemo(() => {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return null;
    return entities.find((e) => e.name.toLowerCase() === trimmed) ?? null;
  }, [entities, name]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !typeId || busy) return;

    setBusy(true);
    try {
      const entity = await createEntity(campaignId, trimmed, typeId);
      // The selected text becomes an alias when it differs from the final name,
      // so the phrase that prompted this still resolves in the note it came
      // from — e.g. selecting "Old Marrow" but naming the entity "Marrow".
      if (initialName.trim() && initialName.trim() !== trimmed) {
        await addAlias(entity.id, initialName.trim());
      }
      onClose();
      navigate({ kind: "entity", entityId: entity.id });
    } finally {
      setBusy(false);
    }
  }, [name, typeId, busy, campaignId, initialName, onClose, navigate]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[18vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create entity"
        className="w-full max-w-lg rounded-lg border border-strong bg-raised shadow-2xl"
      >
        <div className="border-b border-hair px-5 py-4">
          <label
            htmlFor="entity-name"
            className="mb-1 block text-xs uppercase tracking-wider text-ink-faint"
          >
            Name
          </label>
          <input
            id="entity-name"
            ref={nameInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            className="w-full bg-transparent text-lg text-ink focus:outline-none"
          />
          {duplicate && (
            <p className="mt-2 text-xs text-blood">
              An entity named “{duplicate.name}” already exists. Creating another
              will split its mentions between the two.
            </p>
          )}
        </div>

        <div className="px-5 py-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
            Category
          </p>
          <div className="flex flex-wrap gap-2">
            {entityTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setTypeId(type.id)}
                className={`rounded border px-2.5 py-1 text-sm transition-colors ${
                  typeId === type.id
                    ? "border-candle bg-candle/15 text-candle"
                    : "border-hair text-ink-muted hover:border-strong hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className="mr-1.5">
                  {type.icon}
                </span>
                {type.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-hair px-5 py-3">
          <span className="text-xs text-ink-faint">
            Esc to cancel · Enter to create
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || !typeId || busy}
              className="rounded bg-candle/20 px-3 py-1.5 text-sm text-candle transition-colors hover:bg-candle/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create entity
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
