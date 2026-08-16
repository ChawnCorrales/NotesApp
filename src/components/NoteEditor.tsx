"use client";

/**
 * The writing surface.
 *
 * This component carries the product's core loop: you type, entities light up,
 * and selecting a phrase turns it into one. Everything that happens on save —
 * flattening text, rescanning for mentions, extracting tasks — is deliberately
 * invisible, because the PRD's central constraint is that organisation must
 * never interrupt writing (§3, §64).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContent,
  useEditor,
  type Editor,
  type JSONContent,
} from "@tiptap/react";
import { Placeholder } from "@tiptap/extensions";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getNote,
  listSuppressionsForNote,
  suppressMention,
  syncMentionsForNote,
  syncTasksForNote,
  updateNote,
} from "@/lib/services";
import type { MentionSuppression } from "@/lib/db/types";
import { suppressionKey } from "@/lib/entities/recognizer";
import { flattenDoc } from "@/lib/editor/doc-text";
import { createContentExtensions } from "@/lib/editor/extensions";
import { extractTasks } from "@/lib/editor/tasks";
import { setActiveEditor } from "@/lib/editor/active-editor";
import {
  EntityHighlight,
  SET_VOCABULARY_META,
} from "@/lib/editor/entity-highlight";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";
import { CreateEntityDialog } from "./CreateEntityDialog";

/** How long to wait after the last keystroke before persisting. */
const SAVE_DEBOUNCE_MS = 600;

interface MentionPopoverState {
  entityId: string;
  occurrence: number;
  x: number;
  y: number;
  text: string;
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const { campaign, recognizer, lookup } = useCampaign();
  const { navigate } = useNavigation();

  const note = useLiveQuery(() => getNote(noteId), [noteId]);

  const suppressions = useLiveQuery(
    () => listSuppressionsForNote(noteId),
    [noteId],
    [] as MentionSuppression[],
  );

  const suppressedKeys = useMemo(
    () =>
      new Set(suppressions.map((s) => suppressionKey(s.entityId, s.occurrenceIndex))),
    [suppressions],
  );

  /**
   * Local draft for the title.
   *
   * The note arrives asynchronously, so seeding this from an effect would race
   * the user: type a title straight after creating a note and the load effect
   * lands afterwards with the stale empty value and wipes it. `null` means
   * "nothing typed yet — show what is stored". The editor is keyed on the note
   * id by its caller, so switching notes remounts and clears the draft.
   */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingEntityName, setPendingEntityName] = useState<string | null>(null);
  /** Text the user has highlighted, and could promote to an entity. */
  const [selectedText, setSelectedText] = useState("");
  const [popover, setPopover] = useState<MentionPopoverState | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest editor instance, readable from cleanup functions. */
  const editorRef = useRef<Editor | null>(null);
  /**
   * Tracks which note the editor currently holds, so that content is only
   * pushed into it when actually switching notes. Without this, every live
   * query update would reset the document under the cursor.
   */
  const loadedNoteId = useRef<string | null>(null);

  const extensions = useMemo(
    () => [
      ...createContentExtensions(),
      Placeholder.configure({
        placeholder: "Write your world…",
      }),
      EntityHighlight,
    ],
    // Intentionally stable: the entity vocabulary arrives by transaction, so
    // creating an entity must not tear down the editor and lose the cursor.
    [],
  );

  const persist = useCallback(
    async (editor: Editor) => {
      if (!campaign) return;
      setSaving(true);
      try {
        const flat = flattenDoc(editor.state.doc);
        const matches = recognizer.findMatches(flat.text);

        await updateNote(noteId, {
          content: JSON.stringify(editor.getJSON()),
          contentText: flat.text,
        });
        await syncMentionsForNote(noteId, campaign.id, matches);
        await syncTasksForNote(noteId, campaign.id, extractTasks(editor.state.doc));
      } finally {
        setSaving(false);
      }
    },
    [campaign, noteId, recognizer],
  );

  const editor = useEditor(
    {
      extensions,
      // Editors render on the client only; this app has no server-rendered
      // note content to hydrate against.
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "focus:outline-none",
          spellcheck: "true",
        },
      },
      onUpdate({ editor: instance }) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          void persist(instance);
        }, SAVE_DEBOUNCE_MS);
      },
    },
    [extensions],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  /* Publish this editor so the toolbar can act on it. */
  useEffect(() => {
    setActiveEditor(editor);
    return () => setActiveEditor(null);
  }, [editor]);

  /* Load note content when the selected note changes. */
  useEffect(() => {
    if (!editor || !note) return;
    if (loadedNoteId.current === note.id) return;

    loadedNoteId.current = note.id;

    const content: JSONContent | string = note.content
      ? (JSON.parse(note.content) as JSONContent)
      : "";
    // `emitUpdate: false` keeps loading a note from looking like an edit, which
    // would schedule a save and bump updatedAt on every note you merely open.
    editor.commands.setContent(content, { emitUpdate: false });
    editor.commands.focus("end");
  }, [editor, note]);

  /**
   * Push the vocabulary into the editor, and repaint when it changes.
   *
   * A layout effect so the first paint of a freshly opened note already shows
   * its entities, rather than flashing undecorated text for a frame.
   */
  useLayoutEffect(() => {
    if (!editor) return;
    editor.view.dispatch(
      editor.state.tr.setMeta(SET_VOCABULARY_META, {
        recognizer,
        lookup,
        suppressed: suppressedKeys,
      }),
    );
  }, [editor, recognizer, lookup, suppressedKeys]);

  /**
   * Flush any pending save when unmounting or switching notes.
   *
   * Clearing the timer alone would silently discard everything typed in the
   * last debounce window — the exact keystrokes a user loses by clicking away
   * mid-sentence, and the kind of loss that destroys trust in a notes app.
   */
  useEffect(() => {
    const editorAtMount = editorRef;
    return () => {
      if (!saveTimer.current) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const instance = editorAtMount.current;
      if (instance) void persist(instance);
    };
  }, [noteId, persist]);

  /**
   * Selection state, tracked explicitly.
   *
   * TipTap v3 no longer re-renders the component on every transaction, so
   * reading `editor.state.selection` during render would show a stale value and
   * the "create entity" affordance would never appear.
   */
  useEffect(() => {
    if (!editor) return;

    const update = () => {
      const { from, to, empty } = editor.state.selection;
      setSelectedText(
        empty ? "" : editor.state.doc.textBetween(from, to, " ").trim(),
      );
    };

    update();
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitleDraft(value);
      void updateNote(noteId, { title: value });
    },
    [noteId],
  );

  /**
   * Opens the actions popover for a recognised mention.
   *
   * Decorations are not nodes, so there is no node view to attach a handler to;
   * a delegated listener on the container is both simpler and cheaper than one
   * listener per mention in a note with hundreds of them.
   */
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest(".entity-mention");
    if (!target) return;

    const entityId = target.getAttribute("data-entity-id");
    const occurrence = Number(target.getAttribute("data-entity-occurrence"));
    if (!entityId || Number.isNaN(occurrence)) return;

    event.preventDefault();
    const rect = target.getBoundingClientRect();
    setPopover({
      entityId,
      occurrence,
      x: rect.left,
      y: rect.bottom + 6,
      text: target.textContent ?? "",
    });
  }, []);

  const dismissPopover = useCallback(() => setPopover(null), []);

  /**
   * Records a correction, then re-saves so the note's mentions — and therefore
   * the entity's backlinks — reflect it immediately rather than at the next
   * keystroke.
   */
  const handleSuppress = useCallback(async () => {
    if (!popover || !campaign) return;
    await suppressMention({
      campaignId: campaign.id,
      noteId,
      entityId: popover.entityId,
      occurrenceIndex: popover.occurrence,
    });
    setPopover(null);
    const instance = editorRef.current;
    if (instance) await persist(instance);
  }, [popover, campaign, noteId, persist]);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        This note no longer exists.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-hair px-8 py-5">
        <input
          value={titleDraft ?? note.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled note"
          aria-label="Note title"
          className="w-full bg-transparent text-2xl font-semibold text-ink placeholder:text-ink-faint focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3 text-xs text-ink-faint">
          <span>{saving ? "Saving…" : "Saved locally"}</span>
          {selectedText && (
            <button
              type="button"
              onClick={() => setPendingEntityName(selectedText)}
              className="rounded border border-candle/50 px-2 py-0.5 text-candle transition-colors hover:bg-candle/10"
            >
              Create entity from “{truncate(selectedText, 32)}”
            </button>
          )}
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-8 py-6"
        onClick={handleClick}
        role="presentation"
      >
        <EditorContent editor={editor} />
      </div>

      {popover && (
        <MentionPopover
          state={popover}
          entityName={lookup(popover.entityId)?.name ?? popover.text}
          onOpenEntity={() => {
            setPopover(null);
            navigate({ kind: "entity", entityId: popover.entityId });
          }}
          onSuppress={() => void handleSuppress()}
          onDismiss={dismissPopover}
        />
      )}

      {pendingEntityName && campaign && (
        <CreateEntityDialog
          campaignId={campaign.id}
          initialName={pendingEntityName}
          onClose={() => setPendingEntityName(null)}
        />
      )}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Actions for a single recognised mention (PRD §10).
 *
 * "Not this entity" is scoped to this occurrence deliberately. The alternative —
 * turning the entity off everywhere — punishes the user for one bad match, and
 * §64 warns against making the app cost more to maintain than it gives back.
 */
function MentionPopover({
  state,
  entityName,
  onOpenEntity,
  onSuppress,
  onDismiss,
}: {
  state: MentionPopoverState;
  entityName: string;
  onOpenEntity: () => void;
  onSuppress: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <>
      {/* Click-away layer; transparent so it does not dim the note. */}
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onDismiss}
        role="presentation"
      />
      <div
        data-testid="mention-popover"
        role="dialog"
        aria-label={`Actions for ${entityName}`}
        style={{ left: state.x, top: state.y }}
        className="fixed z-50 w-56 overflow-hidden rounded-md border border-strong bg-raised shadow-xl"
      >
        <p className="border-b border-hair px-3 py-2 text-sm text-ink">
          {entityName}
        </p>
        <button
          type="button"
          data-testid="popover-open-entity"
          onClick={onOpenEntity}
          className="block w-full px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          Open entity
        </button>
        <button
          type="button"
          data-testid="popover-not-this-entity"
          onClick={onSuppress}
          className="block w-full px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-surface hover:text-blood"
        >
          Not this entity
        </button>
      </div>
    </>
  );
}
