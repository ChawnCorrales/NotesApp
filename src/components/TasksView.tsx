"use client";

/**
 * The global task viewer (PRD §28–§29).
 *
 * Tasks are extracted from note content rather than authored here, so this view
 * is read-mostly: the link back to the originating note is the important
 * affordance, because that is where the task can actually be resolved.
 */

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/db";
import type { Task } from "@/lib/db/types";
import { useCampaign } from "./campaign-context";
import { useNavigation } from "./navigation-context";

export function TasksView() {
  const { campaign } = useCampaign();
  const { navigate } = useNavigation();

  const campaignId = campaign?.id;

  const tasks = useLiveQuery(
    () =>
      campaignId
        ? db.tasks.where("campaignId").equals(campaignId).toArray()
        : Promise.resolve<Task[]>([]),
    [campaignId],
    [] as Task[],
  );

  const noteTitles = useLiveQuery(async () => {
    if (!campaignId) return new Map<string, string>();
    const notes = await db.notes.where("campaignId").equals(campaignId).toArray();
    return new Map(notes.map((n) => [n.id, n.title || "Untitled note"]));
  }, [campaignId, tasks], new Map<string, string>());

  const { open, done } = useMemo(() => {
    return {
      open: tasks.filter((t) => !t.completed),
      done: tasks.filter((t) => t.completed),
    };
  }, [tasks]);

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <h1 className="text-2xl font-semibold text-ink">Tasks</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Checkboxes written anywhere in your notes appear here.
      </p>

      <TaskGroup
        title={`Open (${open.length})`}
        tasks={open}
        noteTitles={noteTitles}
        onOpenNote={(noteId) => navigate({ kind: "note", noteId })}
      />

      {done.length > 0 && (
        <TaskGroup
          title={`Completed (${done.length})`}
          tasks={done}
          noteTitles={noteTitles}
          onOpenNote={(noteId) => navigate({ kind: "note", noteId })}
          muted
        />
      )}

      {tasks.length === 0 && (
        <p className="mt-8 text-sm text-ink-faint">
          No tasks yet. Type <code className="text-ink-muted">[ ]</code> at the
          start of a line in any note to make one.
        </p>
      )}
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  noteTitles,
  onOpenNote,
  muted,
}: {
  title: string;
  tasks: Task[];
  noteTitles: Map<string, string>;
  onOpenNote: (noteId: string) => void;
  muted?: boolean;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-xs uppercase tracking-wider text-ink-faint">
        {title}
      </h2>
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className={`flex items-baseline gap-3 rounded px-2 py-1.5 ${
              muted ? "text-ink-faint line-through" : "text-ink"
            }`}
          >
            <span className="flex-1 text-sm">{task.text}</span>
            {task.noteId && (
              <button
                type="button"
                onClick={() => onOpenNote(task.noteId as string)}
                className="shrink-0 text-xs text-ink-faint hover:text-candle hover:underline"
              >
                {noteTitles.get(task.noteId) ?? "note"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
