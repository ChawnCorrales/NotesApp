/**
 * The colour palette Canon sections and collections share.
 *
 * These keys are not decoration — they name the `--entity-*` custom properties
 * in `globals.css`, so a key that has no matching variable renders as an
 * inherited colour rather than failing visibly. Kept in one module because two
 * separate lists drift, and the drift only shows up as a swatch that does
 * nothing when clicked.
 */

export const THEME_KEYS = [
  "npc",
  "pc",
  "location",
  "faction",
  "item",
  "event",
  "quest",
  "deity",
  "creature",
  "organization",
  "mystery",
  "concept",
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

/** The CSS colour for a palette key, falling back to the neutral one. */
export function accentVar(key: string): string {
  return (THEME_KEYS as readonly string[]).includes(key)
    ? `var(--entity-${key})`
    : "var(--entity-concept)";
}
