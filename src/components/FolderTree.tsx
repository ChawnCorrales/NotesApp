"use client";

/**
 * Nested folders in the sidebar.
 *
 * Folders are storage, not meaning — a note lives in exactly one, and filing is
 * always optional (§21, §64). Nothing here forces a decision: notes stay at the
 * top level until someone moves them.
 *
 * Every drag action has a button equivalent. Drag-and-drop is the fast path,
 * but it is unusable with a keyboard, and §48 puts accessibility ahead of
 * polish.
 */

import { useCallback, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import {
  createFolder,
  createNote,
  deleteFolder,
  moveFolder,
  moveNoteToFolder,
  renameFolder,
} from "@/lib/db/repositories";
import type { Folder, Note } from "@/lib/db/types";
import {
  allFolderTargets,
  buildFolderTree,
  validMoveTargets,
  type FolderNode,
} from "@/lib/folders/tree";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

/** What is currently being dragged. */
type Dragged =
  | { kind: "folder"; id: string }
  | { kind: "note"; id: string }
  | null;

/** Target of the "Move to…" dialog. */
type MoveRequest =
  | { kind: "folder"; id: string; name: string }
  | { kind: "note"; id: string; name: string }
  | null;

const DRAG_MIME = "application/x-notesapp";

export function FolderTree() {
  const { campaign } = useCampaign();
  const { current, navigate } = useNavigation();

  const campaignId = campaign?.id;

  const folders = useLiveQuery(
    () =>
      campaignId
        ? db.folders.where("campaignId").equals(campaignId).toArray()
        : Promise.resolve<Folder[]>([]),
    [campaignId],
    [] as Folder[],
  );

  const notes = useLiveQuery(
    () =>
      campaignId
        ? db.notes.where("campaignId").equals(campaignId).toArray()
        : Promise.resolve<Note[]>([]),
    [campaignId],
    [] as Note[],
  );

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragged, setDragged] = useState<Dragged>(null);
  const [dropTarget, setDropTarget] = useState<string | "root" | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moveRequest, setMoveRequest] = useState<MoveRequest>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  const notesByFolder = useMemo(() => {
    const map = new Map<string | null, Note[]>();
    for (const note of notes) {
      const key = note.folderId ?? null;
      const list = map.get(key) ?? [];
      list.push(note);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.title || "Untitled note").localeCompare(b.title || "Untitled note"));
    }
    return map;
  }, [notes]);

  const toggle = useCallback((folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }, []);

  /** Applies a drop, whichever way it was initiated. */
  const drop = useCallback(
    async (target: string | null) => {
      const item = dragged;
      setDragged(null);
      setDropTarget(null);
      if (!item) return;

      if (item.kind === "note") {
        await moveNoteToFolder(item.id, target);
        return;
      }

      const result = await moveFolder(item.id, target);
      if (!result.moved) setNotice(result.reason ?? "That move is not possible.");
    },
    [dragged],
  );

  const addFolder = useCallback(
    async (parentId: string | null) => {
      if (!campaignId) return;
      const folder = await createFolder(campaignId, "New folder", parentId);
      if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
      setRenaming(folder.id);
    },
    [campaignId],
  );

  const addNote = useCallback(
    async (folderId: string) => {
      if (!campaignId) return;
      const note = await createNote(campaignId, { folderId });
      setExpanded((prev) => new Set(prev).add(folderId));
      navigate({ kind: "note", noteId: note.id });
    },
    [campaignId, navigate],
  );

  const remove = useCallback(async (folder: Folder) => {
    const result = await deleteFolder(folder.id);
    const moved = result.notesMoved + result.foldersMoved;
    if (moved > 0) {
      setNotice(
        `Removed "${folder.name}". ${moved} ${moved === 1 ? "item" : "items"} moved up a level.`,
      );
    }
  }, []);

  const unfiled = notesByFolder.get(null) ?? [];

  return (
    <div>
      <div className="flex items-center gap-1 px-2 pb-1">
        <p className="flex-1 text-[0.68rem] uppercase tracking-wider text-ink-faint">
          Folders
        </p>
        <button
          type="button"
          aria-label="New folder"
          title="New folder"
          onClick={() => void addFolder(null)}
          className="rounded px-1.5 text-sm text-ink-faint transition-colors hover:text-candle"
        >
          ＋
        </button>
      </div>

      {notice && (
        <p
          role="status"
          className="mx-2 mb-1 rounded border border-hair px-2 py-1 text-[0.7rem] text-ink-muted"
        >
          {notice}{" "}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="underline hover:text-ink"
          >
            ok
          </button>
        </p>
      )}

      <ul>
        {tree.map((node) => (
          <FolderRow
            key={node.folder.id}
            node={node}
            notesByFolder={notesByFolder}
            expanded={expanded}
            dropTarget={dropTarget}
            renaming={renaming}
            currentNoteId={current.kind === "note" ? current.noteId : null}
            onToggle={toggle}
            onOpenNote={(noteId) => navigate({ kind: "note", noteId })}
            onDragStart={setDragged}
            onDragOverFolder={setDropTarget}
            onDrop={(target) => void drop(target)}
            onStartRename={setRenaming}
            onFinishRename={() => setRenaming(null)}
            onAddSubfolder={(parentId) => void addFolder(parentId)}
            onAddNote={(folderId) => void addNote(folderId)}
            onRequestMove={setMoveRequest}
            onRemove={(folder) => void remove(folder)}
          />
        ))}
      </ul>

      {/* The top level is itself a drop target, so filing can be undone. */}
      <div
        data-testid="unfiled-drop"
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget("root");
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          void drop(null);
        }}
        className={`mt-1 rounded px-2 py-1 text-[0.68rem] uppercase tracking-wider transition-colors ${
          dropTarget === "root" ? "bg-candle/15 text-candle" : "text-ink-faint"
        }`}
      >
        Unfiled ({unfiled.length})
      </div>

      <ul>
        {unfiled.map((note) => (
          <NoteRow
            key={note.id}
            note={note}
            depth={0}
            active={current.kind === "note" && current.noteId === note.id}
            onOpen={() => navigate({ kind: "note", noteId: note.id })}
            onDragStart={() => setDragged({ kind: "note", id: note.id })}
            onRequestMove={() =>
              setMoveRequest({
                kind: "note",
                id: note.id,
                name: note.title || "Untitled note",
              })
            }
          />
        ))}
      </ul>

      {moveRequest && (
        <MoveDialog
          request={moveRequest}
          folders={folders}
          onCancel={() => setMoveRequest(null)}
          onMove={async (targetId) => {
            const request = moveRequest;
            setMoveRequest(null);
            if (request.kind === "note") {
              await moveNoteToFolder(request.id, targetId);
              return;
            }
            const result = await moveFolder(request.id, targetId);
            if (!result.moved) setNotice(result.reason ?? "That move is not possible.");
          }}
        />
      )}
    </div>
  );
}

function FolderRow({
  node,
  notesByFolder,
  expanded,
  dropTarget,
  renaming,
  currentNoteId,
  onToggle,
  onOpenNote,
  onDragStart,
  onDragOverFolder,
  onDrop,
  onStartRename,
  onFinishRename,
  onAddSubfolder,
  onAddNote,
  onRequestMove,
  onRemove,
}: {
  node: FolderNode;
  notesByFolder: Map<string | null, Note[]>;
  expanded: Set<string>;
  dropTarget: string | "root" | null;
  renaming: string | null;
  currentNoteId: string | null;
  onToggle: (id: string) => void;
  onOpenNote: (id: string) => void;
  onDragStart: (dragged: Dragged) => void;
  onDragOverFolder: (id: string | null) => void;
  onDrop: (target: string | null) => void;
  onStartRename: (id: string) => void;
  onFinishRename: () => void;
  onAddSubfolder: (parentId: string) => void;
  onAddNote: (folderId: string) => void;
  onRequestMove: (request: MoveRequest) => void;
  onRemove: (folder: Folder) => void;
}) {
  const { folder, children, depth } = node;
  const isOpen = expanded.has(folder.id);
  const notes = notesByFolder.get(folder.id) ?? [];
  const isDropTarget = dropTarget === folder.id;
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <li>
      <div
        draggable
        data-testid="folder-row"
        data-folder-name={folder.name}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, folder.id);
          onDragStart({ kind: "folder", id: folder.id });
        }}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOverFolder(folder.id);
        }}
        onDragLeave={() => onDragOverFolder(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDrop(folder.id);
        }}
        style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
        className={`group flex items-center gap-1 rounded py-1 pr-1 text-sm transition-colors ${
          isDropTarget ? "bg-candle/20 text-candle" : "text-ink-muted hover:bg-raised"
        }`}
      >
        <button
          type="button"
          aria-label={isOpen ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={isOpen}
          onClick={() => onToggle(folder.id)}
          className="w-4 shrink-0 text-xs text-ink-faint"
        >
          {isOpen ? "▾" : "▸"}
        </button>

        {renaming === folder.id ? (
          <input
            autoFocus
            aria-label="Folder name"
            value={draft ?? folder.name}
            onChange={(e) => {
              setDraft(e.target.value);
              void renameFolder(folder.id, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setDraft(null);
                onFinishRename();
              }
            }}
            onBlur={() => {
              setDraft(null);
              onFinishRename();
            }}
            className="min-w-0 flex-1 rounded border border-hair bg-surface px-1 text-sm text-ink focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => onToggle(folder.id)}
            className="min-w-0 flex-1 truncate text-left"
          >
            <span aria-hidden="true" className="mr-1 opacity-70">
              {isOpen ? "▤" : "▥"}
            </span>
            {folder.name}
          </button>
        )}

        <span className="shrink-0 text-[0.65rem] text-ink-faint">
          {notes.length || ""}
        </span>

        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <RowButton label={`New note in ${folder.name}`} onClick={() => onAddNote(folder.id)}>
            ✎
          </RowButton>
          <RowButton
            label={`New subfolder in ${folder.name}`}
            onClick={() => onAddSubfolder(folder.id)}
          >
            ＋
          </RowButton>
          <RowButton label={`Rename ${folder.name}`} onClick={() => onStartRename(folder.id)}>
            ✐
          </RowButton>
          <RowButton
            label={`Move ${folder.name}`}
            onClick={() =>
              onRequestMove({ kind: "folder", id: folder.id, name: folder.name })
            }
          >
            ⇄
          </RowButton>
          <RowButton label={`Delete ${folder.name}`} onClick={() => onRemove(folder)}>
            ✕
          </RowButton>
        </span>
      </div>

      {isOpen && (
        <>
          <ul>
            {children.map((child) => (
              <FolderRow
                key={child.folder.id}
                node={child}
                notesByFolder={notesByFolder}
                expanded={expanded}
                dropTarget={dropTarget}
                renaming={renaming}
                currentNoteId={currentNoteId}
                onToggle={onToggle}
                onOpenNote={onOpenNote}
                onDragStart={onDragStart}
                onDragOverFolder={onDragOverFolder}
                onDrop={onDrop}
                onStartRename={onStartRename}
                onFinishRename={onFinishRename}
                onAddSubfolder={onAddSubfolder}
                onAddNote={onAddNote}
                onRequestMove={onRequestMove}
                onRemove={onRemove}
              />
            ))}
          </ul>

          <ul>
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                depth={depth + 1}
                active={currentNoteId === note.id}
                onOpen={() => onOpenNote(note.id)}
                onDragStart={() => onDragStart({ kind: "note", id: note.id })}
                onRequestMove={() =>
                  onRequestMove({
                    kind: "note",
                    id: note.id,
                    name: note.title || "Untitled note",
                  })
                }
              />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

function NoteRow({
  note,
  depth,
  active,
  onOpen,
  onDragStart,
  onRequestMove,
}: {
  note: Note;
  depth: number;
  active: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onRequestMove: () => void;
}) {
  const title = note.title || "Untitled note";

  return (
    <li>
      <div
        draggable
        data-testid="folder-note"
        data-note-title={title}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, note.id);
          onDragStart();
        }}
        style={{ paddingLeft: `${1.6 + depth * 0.75}rem` }}
        className={`group flex items-center gap-1 rounded py-1 pr-1 text-sm transition-colors ${
          active ? "bg-raised text-candle" : "text-ink-muted hover:bg-raised hover:text-ink"
        }`}
      >
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left">
          {title}
        </button>
        <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <RowButton label={`Move ${title}`} onClick={onRequestMove}>
            ⇄
          </RowButton>
        </span>
      </div>
    </li>
  );
}

function RowButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded px-1 text-xs text-ink-faint transition-colors hover:text-candle"
    >
      {children}
    </button>
  );
}

/**
 * The keyboard-reachable equivalent of dragging.
 *
 * Only valid destinations are listed — a folder cannot be offered its own
 * descendants — so an impossible move is never presented as a choice.
 */
function MoveDialog({
  request,
  folders,
  onMove,
  onCancel,
}: {
  request: NonNullable<MoveRequest>;
  folders: Folder[];
  onMove: (targetId: string | null) => void | Promise<void>;
  onCancel: () => void;
}) {
  // A note has no descendants, so every folder is a valid home for it.
  const targets = useMemo(
    () =>
      request.kind === "folder"
        ? validMoveTargets(folders, request.id)
        : allFolderTargets(folders),
    [folders, request],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[18vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${request.name}`}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-strong bg-raised shadow-2xl"
      >
        <p className="border-b border-hair px-4 py-3 text-sm text-ink">
          Move “{request.name}” to…
        </p>

        <ul className="max-h-72 overflow-y-auto py-1">
          <li>
            <button
              type="button"
              onClick={() => void onMove(null)}
              className="block w-full px-4 py-2 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
            >
              Top level
            </button>
          </li>
          {targets.map((target) => (
            <li key={target.id}>
              <button
                type="button"
                onClick={() => void onMove(target.id)}
                className="block w-full px-4 py-2 text-left text-sm text-ink-muted hover:bg-surface hover:text-ink"
              >
                {target.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex justify-end border-t border-hair px-4 py-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-sm text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
