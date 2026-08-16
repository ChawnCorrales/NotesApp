"use client";

/**
 * The persistent create button.
 *
 * One always-visible way to make something, from anywhere in the app. §24 is
 * explicit that capture must never depend on first navigating to the right
 * place, and a floating control is the cheapest way to honour that.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createEntityType, createFolder, createNote } from "@/lib/db/repositories";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CreateEntityDialog } from "./CreateEntityDialog";

export function GlobalCreate() {
  const { campaign } = useCampaign();
  const { navigate } = useNavigation();

  const [open, setOpen] = useState(false);
  const [creatingEntity, setCreatingEntity] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const newNote = useCallback(async () => {
    if (!campaign) return;
    setOpen(false);
    const note = await createNote(campaign.id);
    navigate({ kind: "note", noteId: note.id });
  }, [campaign, navigate]);

  const newFolder = useCallback(async () => {
    if (!campaign) return;
    setOpen(false);
    await createFolder(campaign.id, "New folder", null);
  }, [campaign]);

  const newSection = useCallback(async () => {
    if (!campaign) return;
    setOpen(false);
    await createEntityType(campaign.id, "New section", "◇", "concept");
    navigate({ kind: "canon" });
  }, [campaign, navigate]);

  return (
    <>
      <div ref={containerRef} className="fixed bottom-6 right-6 z-40">
        {open && (
          <div
            role="menu"
            aria-label="Create"
            className="mb-2 w-52 overflow-hidden rounded-lg border border-strong bg-raised shadow-2xl"
          >
            <MenuItem label="New note" hint="blank note" onClick={() => void newNote()} />
            <MenuItem
              label="New folder"
              hint="at the top level"
              onClick={() => void newFolder()}
            />
            <MenuItem
              label="New entity"
              hint="person, place, thing"
              onClick={() => {
                setOpen(false);
                setCreatingEntity(true);
              }}
            />
            <MenuItem
              label="New Canon section"
              hint="a category"
              onClick={() => void newSection()}
            />
          </div>
        )}

        <button
          type="button"
          aria-label="Create"
          aria-expanded={open}
          data-testid="global-create"
          onClick={() => setOpen((v) => !v)}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-candle/50 bg-raised text-2xl leading-none text-candle shadow-xl transition-all hover:scale-105 hover:bg-candle/15"
        >
          <span aria-hidden="true" className={open ? "rotate-45 transition-transform" : "transition-transform"}>
            +
          </span>
        </button>
      </div>

      {creatingEntity && campaign && (
        <CreateEntityDialog
          campaignId={campaign.id}
          initialName=""
          onClose={() => setCreatingEntity(false)}
        />
      )}
    </>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left transition-colors hover:bg-surface"
    >
      <span className="block text-sm text-ink">{label}</span>
      <span className="block text-xs text-ink-faint">{hint}</span>
    </button>
  );
}
