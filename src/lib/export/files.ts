/**
 * The file format this app reads and writes.
 *
 * One Markdown file per thing, with a YAML front matter block saying what the
 * thing is. The format is meant to be written by hand as readily as by the
 * exporter — importing a bestiary or an NPC roster from somewhere else should
 * be a matter of writing files like these, not of learning an export schema.
 *
 * ## A note
 *
 *     ---
 *     title: Session 12
 *     folder: Session Logs/Act One
 *     ---
 *
 *     The party meets [[Marrow]] at dusk.
 *
 * `title` and `folder` are both optional. Without a title the file name is
 * used; without a folder the note is unfiled. Missing folders are created.
 *
 * ## An entity
 *
 *     ---
 *     type: entity
 *     name: Marrow
 *     category: Characters
 *     aliases:
 *       - Old Marrow
 *       - the shopkeeper
 *     ---
 *
 *     A grizzled merchant who keeps a shop in [[Greyhaven]].
 *
 * `type: entity` is the only thing that distinguishes the two — a file without
 * it is a note, so every file that ever worked still works. `category` is
 * matched against the campaign's Canon sections by name, case-insensitively,
 * and a section that does not exist yet is created rather than the file being
 * rejected. The body becomes the entity's description.
 *
 * ## Wikilinks
 *
 * `[[Marrow]]` is written on export and stripped on import, leaving the plain
 * name behind. Recognition then re-links it, because that is how every mention
 * in this app works — the brackets are for other tools, not for this one.
 */

import type { JSONContent } from "@tiptap/core";
import type { Entity, EntityAlias, Note } from "../db/types";
import { renderFrontMatter } from "../markdown/front-matter";
import { toMarkdown, type MarkdownOptions } from "./markdown";

/** A file ready to be written, with the path it should take inside an export. */
export interface ExportedFile {
  /** Relative path, using `/`, e.g. `Session Logs/Act One/Session 12.md`. */
  path: string;
  content: string;
}

/** Where entity files live inside a campaign export. */
export const ENTITY_DIRECTORY = "Entities";

/**
 * Makes a string safe as a file name on every platform this might land on.
 *
 * Windows is the strictest, so its rules win: no `\/:*?"<>|`, no trailing dot
 * or space, and a handful of reserved device names that cannot be used even
 * with an extension.
 */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");

  if (!cleaned) return "Untitled";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) return `${cleaned}_`;
  return cleaned.slice(0, 120);
}

/** Serialises one note, front matter included. */
export function noteToMarkdown(
  note: Pick<Note, "title" | "content">,
  options: MarkdownOptions & { folderPath?: string } = {},
): string {
  const { folderPath, ...markdownOptions } = options;

  const doc: JSONContent = note.content
    ? (JSON.parse(note.content) as JSONContent)
    : { type: "doc", content: [] };

  const front = renderFrontMatter({
    title: note.title || undefined,
    folder: folderPath || undefined,
  });

  return front + toMarkdown(doc, markdownOptions);
}

/**
 * Serialises one entity.
 *
 * The description is written as plain prose rather than run through the
 * serialiser, because it is stored as text and never held a document.
 */
export function entityToMarkdown(
  entity: Pick<Entity, "name" | "description">,
  categoryName: string,
  aliases: Pick<EntityAlias, "alias">[],
): string {
  const front = renderFrontMatter({
    type: "entity",
    name: entity.name,
    category: categoryName,
    aliases: aliases.map((a) => a.alias),
  });

  const body = entity.description.trim();
  return body ? `${front}${body}\n` : front;
}

/**
 * Ensures no two files in an export collide.
 *
 * Two notes can legitimately share a title, and two entities in different
 * sections can share a name. Silently overwriting one with the other would lose
 * work in the one operation a user performs *because* they are afraid of losing
 * work, so the second gets a numeric suffix.
 */
export function uniquePath(taken: Set<string>, path: string): string {
  if (!taken.has(path.toLowerCase())) {
    taken.add(path.toLowerCase());
    return path;
  }

  const dot = path.lastIndexOf(".");
  const stem = dot === -1 ? path : path.slice(0, dot);
  const extension = dot === -1 ? "" : path.slice(dot);

  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }
}
