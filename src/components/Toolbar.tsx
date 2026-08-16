"use client";

/**
 * The application menu bar.
 *
 * Familiar shape — File / Edit / View / Insert — but deliberately shallow. §48
 * warns against cluttered toolbars, and §64 against the app costing more
 * attention than it gives back, so this only lists actions that actually do
 * something. Items that would sit greyed out forever are not here yet.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createEntityType, createNote } from "@/lib/db/repositories";
import { useActiveEditor } from "@/lib/editor/active-editor";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CreateEntityDialog } from "./CreateEntityDialog";

interface ToolbarProps {
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  focusMode: boolean;
  onToggleFocus: () => void;
  onImportMarkdown: () => void;
}

export function Toolbar({
  sidebarVisible,
  onToggleSidebar,
  focusMode,
  onToggleFocus,
  onImportMarkdown,
}: ToolbarProps) {
  const { campaign } = useCampaign();
  const { navigate, homeView, setHomeView } = useNavigation();
  const editor = useActiveEditor();

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [creatingEntity, setCreatingEntity] = useState(false);
  const [linkPrompt, setLinkPrompt] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;

    function onPointerDown(event: MouseEvent) {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const run = useCallback((action: () => void) => {
    setOpenMenu(null);
    action();
  }, []);

  const newNote = useCallback(async () => {
    if (!campaign) return;
    const note = await createNote(campaign.id);
    navigate({ kind: "note", noteId: note.id });
  }, [campaign, navigate]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }, []);

  return (
    <>
      <div
        ref={barRef}
        role="menubar"
        aria-label="Main menu"
        className="relative z-30 flex items-center gap-0.5 border-b border-hair bg-surface px-2 py-1"
      >
        <Menu
          label="File"
          open={openMenu === "File"}
          onToggle={() => setOpenMenu(openMenu === "File" ? null : "File")}
        >
          <Item onClick={() => run(() => void newNote())}>New note</Item>
          <Item onClick={() => run(() => setCreatingEntity(true))}>New entity</Item>
          <Item
            onClick={() =>
              run(() => {
                if (!campaign) return;
                void createEntityType(campaign.id, "New section", "◇", "concept").then(
                  () => navigate({ kind: "canon" }),
                );
              })
            }
          >
            New Canon section
          </Item>
          <Divider />
          <Item onClick={() => run(onImportMarkdown)}>Import Markdown…</Item>
        </Menu>

        <Menu
          label="Edit"
          open={openMenu === "Edit"}
          onToggle={() => setOpenMenu(openMenu === "Edit" ? null : "Edit")}
        >
          {/* Editor-scoped, so they are only offered while a note is open. */}
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().undo().run())}
          >
            Undo
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().redo().run())}
          >
            Redo
          </Item>
          <Divider />
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().toggleBold().run())}
          >
            Bold
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().toggleItalic().run())}
          >
            Italic
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().toggleStrike().run())}
          >
            Strikethrough
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().toggleCode().run())}
          >
            Inline code
          </Item>
          <Divider />
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().selectAll().run())}
          >
            Select all
          </Item>
        </Menu>

        <Menu
          label="View"
          open={openMenu === "View"}
          onToggle={() => setOpenMenu(openMenu === "View" ? null : "View")}
        >
          <Item onClick={() => run(() => navigate({ kind: "canon" }))}>
            Campaign canon
          </Item>
          <Item onClick={() => run(() => navigate({ kind: "graph" }))}>Mind map</Item>
          <Item onClick={() => run(() => navigate({ kind: "tasks" }))}>Tasks</Item>
          <Divider />
          <Item onClick={() => run(onToggleSidebar)}>
            {sidebarVisible ? "Hide sidebar" : "Show sidebar"}
          </Item>
          <Item onClick={() => run(onToggleFocus)}>
            {focusMode ? "Leave focus mode" : "Focus mode"}
          </Item>
          <Item onClick={() => run(toggleFullscreen)}>Fullscreen</Item>
          <Divider />
          <p className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-wider text-ink-faint">
            Start on
          </p>
          <Item checked={homeView === "canon"} onClick={() => run(() => setHomeView("canon"))}>
            Campaign canon
          </Item>
          <Item checked={homeView === "graph"} onClick={() => run(() => setHomeView("graph"))}>
            Mind map
          </Item>
        </Menu>

        <Menu
          label="Insert"
          open={openMenu === "Insert"}
          onToggle={() => setOpenMenu(openMenu === "Insert" ? null : "Insert")}
        >
          <Item disabled={!editor} onClick={() => run(() => setLinkPrompt(true))}>
            Link…
          </Item>
          <Item
            disabled={!editor}
            onClick={() =>
              run(() =>
                editor
                  ?.chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run(),
              )
            }
          >
            Table
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().toggleTaskList().run())}
          >
            Task list
          </Item>
          <Item
            disabled={!editor}
            onClick={() => run(() => editor?.chain().focus().setHorizontalRule().run())}
          >
            Divider
          </Item>
          <Divider />
          <Item onClick={() => run(onImportMarkdown)}>Markdown file…</Item>
        </Menu>
      </div>

      {creatingEntity && campaign && (
        <CreateEntityDialog
          campaignId={campaign.id}
          initialName={
            editor
              ? editor.state.doc
                  .textBetween(editor.state.selection.from, editor.state.selection.to, " ")
                  .trim()
              : ""
          }
          onClose={() => setCreatingEntity(false)}
        />
      )}

      {linkPrompt && editor && (
        <LinkPrompt
          initial={editor.getAttributes("link").href ?? ""}
          onCancel={() => setLinkPrompt(false)}
          onSubmit={(href) => {
            setLinkPrompt(false);
            if (!href) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            editor.chain().focus().setLink({ href }).run();
          }}
        />
      )}
    </>
  );
}

function Menu({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        className={`rounded px-2.5 py-1 text-sm transition-colors ${
          open ? "bg-raised text-ink" : "text-ink-muted hover:bg-raised hover:text-ink"
        }`}
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full mt-1 w-56 overflow-hidden rounded-md border border-strong bg-raised py-1 shadow-2xl"
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Item({
  children,
  onClick,
  disabled,
  checked,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span aria-hidden="true" className="w-3 text-candle">
        {checked ? "•" : ""}
      </span>
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-hair" />;
}

function LinkPrompt({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (href: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Insert link"
        className="w-full max-w-md rounded-lg border border-strong bg-raised p-4 shadow-2xl"
      >
        <label htmlFor="link-href" className="mb-1 block text-xs uppercase tracking-wider text-ink-faint">
          Link address
        </label>
        <input
          id="link-href"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit(value.trim());
            if (e.key === "Escape") onCancel();
          }}
          placeholder="https://…"
          className="w-full rounded border border-hair bg-surface px-2 py-1.5 text-sm text-ink focus:border-strong focus:outline-none"
        />
        <p className="mt-2 text-xs text-ink-faint">
          Leave empty to remove an existing link.
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value.trim())}
            className="rounded bg-candle/20 px-3 py-1.5 text-sm text-candle hover:bg-candle/30"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
