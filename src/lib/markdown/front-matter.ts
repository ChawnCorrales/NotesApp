/**
 * The YAML front matter this app reads and writes.
 *
 * Deliberately a small, documented subset rather than real YAML. A parser
 * dependency would buy support for anchors, multi-line scalars and nested maps,
 * none of which the format uses — and every one of which would become something
 * a hand-written file could get subtly wrong.
 *
 * What is supported:
 *
 *     key: value
 *     key: "quoted value"
 *     key: [one, two]
 *     key:
 *       - one
 *       - two
 *
 * Anything else is ignored rather than rejected, so an unfamiliar key from
 * another tool cannot stop a file importing.
 */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parsed keys, plus whatever followed the block. */
export interface FrontMatter {
  fields: Record<string, string | string[]>;
  body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseInlineList(value: string): string[] {
  return value
    .slice(1, -1)
    .split(",")
    .map(unquote)
    .filter(Boolean);
}

/**
 * Splits off a leading front matter block and reads its keys.
 *
 * Returns empty fields when there is no block, so callers never branch on
 * whether one was present — only on whether the key they want is there.
 */
export function parseFrontMatter(source: string): FrontMatter {
  const match = source.match(FRONT_MATTER);
  if (!match) return { fields: {}, body: source };

  const fields: Record<string, string | string[]> = {};
  const lines = match[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyed = line.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (!keyed) continue;

    const key = keyed[1].toLowerCase();
    const rest = keyed[2].trim();

    if (rest.startsWith("[") && rest.endsWith("]")) {
      fields[key] = parseInlineList(rest);
      continue;
    }

    if (rest === "") {
      // A block list: consume the indented "- item" lines that follow.
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(unquote(lines[i + 1].replace(/^\s*-\s+/, "")));
        i++;
      }
      // An empty value with no list under it is a key set to nothing, which is
      // the same as absent — recording "" would defeat every `?? fallback`.
      if (items.length > 0) fields[key] = items.filter(Boolean);
      continue;
    }

    const value = unquote(rest);
    if (value) fields[key] = value;
  }

  return { fields, body: source.slice(match[0].length) };
}

/** Reads a key as a single value, taking the first entry if it is a list. */
export function field(fm: FrontMatter, key: string): string | undefined {
  const value = fm.fields[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Reads a key as a list, accepting a lone value as a list of one. */
export function fieldList(fm: FrontMatter, key: string): string[] {
  const value = fm.fields[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Renders a front matter block, or nothing when there is nothing to say.
 *
 * Values are quoted only when they would otherwise be ambiguous — a leading
 * bracket, a colon, or surrounding whitespace — which keeps hand-edited files
 * looking like something a person wrote.
 */
export function renderFrontMatter(
  fields: Record<string, string | string[] | undefined>,
): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quoteIfNeeded(item)}`);
      continue;
    }

    if (value === "") continue;
    lines.push(`${key}: ${quoteIfNeeded(value)}`);
  }

  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n\n`;
}

function quoteIfNeeded(value: string): string {
  const needsQuotes =
    /^[[\]{}>|*&!%#@`]/.test(value) ||
    /:\s/.test(value) ||
    value !== value.trim() ||
    value === "";
  return needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;
}
