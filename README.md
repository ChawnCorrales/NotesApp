# NotesApp

Offline-first, interconnected note-taking for tabletop RPG Game Masters.

> Write your world. Let the connections reveal themselves.

## What this is

A note-taking app that recognises the people, places, factions, and objects in your
campaign as you write about them. You flag a concept once; every later mention of it
is detected automatically, and a campaign knowledge graph accumulates as a by-product
of writing rather than as a chore alongside it.

The guiding constraint: **capture first, structure second**. Organisation is never a
prerequisite for typing.

## Status

This is the vertical slice — the parts that test whether the core idea works. It runs
entirely on your machine; there is no account, no server, and nothing leaves the
browser.

**Working**

- **Campaign Canon as the home view** — a card per section, counts generated from
  your notes; sections can be renamed, re-iconed, recoloured, reordered, hidden
  and created. Sections *are* the entity categories, so an edit applies everywhere
- **Nested folders** with drag-and-drop filing, plus a keyboard-reachable
  "Move to…" for every drag action. Deleting a folder lifts its contents up a
  level rather than deleting them
- **Deleting notes** moves them to a **Trash** you can restore from; permanent
  deletion is a separate, confirmed step
- **Tabs** with independent Back/Forward history per tab
- **Menu bar** (File / Edit / View / Insert), a global **+** button, focus mode,
  and a switch for whether the app starts on the Canon or the Mind Map

- Note authoring: rich text, Markdown input rules, tables, task checkboxes, links
- **Markdown import** — bring in existing `.md` files; headings, tables, task lists
  and links survive, and imported notes are recognised and backlinked immediately
- Create an entity from selected text, with custom categories and aliases
- Automatic recognition of every later mention, including aliases
- Per-occurrence **"Not this entity"** correction, which never disables the entity
  elsewhere
- Entity pages with descriptions, relationships, mentions and backlinks
- Campaign-wide re-indexing, so flagging a name backlinks the notes you already wrote
- Mind map with category filters and inferred co-occurrence edges
- Search across note text, titles, entity names and aliases
- Command palette (`Ctrl`/`Cmd` + `K`) and Back/Forward history (`Alt` + `←`/`→`)
- Local persistence in IndexedDB; occult default theme
- Collections: bundles that hold notes *and* entities, added from the note or
  entity you are already looking at, browsable and listed in the sidebar

**Not built yet**

- Authentication and sync. The Postgres schema and RLS policies live in
  `supabase/migrations/`, but nothing in the app talks to them — see below.
- Tags and favourites exist in the data model but have no UI.
- Collection membership is manual only — nothing joins a collection by rule.
- Conflict resolution, locked notes, and local-only notes: columns only.
- Everything the PRD defers to Phase 2+ (AI, semantic search, players, sharing).

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000. A campaign and the twelve default entity categories are
created on first launch — there is no setup step.

To try the core loop: write a sentence naming a place, select that name, choose
**Create entity → Location**, then write a new note mentioning it again.

Already have notes? **Import Markdown** in the sidebar takes any number of `.md`
files. Titles come from YAML front matter (`title:`), else a leading `# heading`,
else the file name. Import never creates entities on its own — it only recognises
the ones you have already flagged.

## How recognition works

Entity mentions are **not** stored in the document. An Aho-Corasick automaton built
from every entity name and alias scans the note on each change, and ProseMirror
decorations paint the matches.

This is what makes the behaviour in PRD §62 fall out for free:

- Delete the text and the mention disappears — nothing was stored to clean up.
- Rename an entity and every occurrence updates at once, with relationships intact.
- Add an alias and notes written months ago light up retroactively.

Matching is case-insensitive and word-bounded, so `Marrow` does not match inside
`Marrowbone`, and overlapping names resolve leftmost-longest, so `The Red Queen` wins
over the `Queen` nested inside it.

The persisted `entityMentions` table is a queryable index of that scan — used for
backlinks and counts — rebuilt whenever a note is saved or the entity vocabulary
changes. It is derived data and can be discarded and regenerated safely.

## Testing

```bash
npm test           # unit, integration and component tests
npm run test:e2e   # Playwright end-to-end
```

Vitest covers matching rules, repository behaviour against a real IndexedDB, and
component behaviour; Playwright covers the whole loop in a browser. The editor is
deliberately not tested in a DOM shim. See [docs/TESTING.md](docs/TESTING.md) for
what is covered and why.

## Database

`supabase/migrations/` contains the Postgres translation of the local schema and a
deny-by-default RLS policy set. **These have not been run against any project.** To
apply them, create a Supabase project and either `supabase db push` or paste the two
files into the SQL editor in order.

They are deliberately ahead of the client: campaign membership, note visibility
states, and per-note share permissions are all modelled now so that adding players
later is not a schema rewrite.

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · TipTap 3 · Dexie · React Flow

## Known limitations

- Search is a linear scan over note text. Correct and fast for realistic campaigns,
  but the PRD's 10,000-note target is where it needs an index.
- Re-indexing rewrites every mention row for the campaign. Fine at current scale;
  worth making incremental before large campaigns exist.
- Editing a task's text resets its completion state, since tasks are matched by text.
- Graph nodes carry declared rather than measured sizes, and the layout frames itself
  instead of using React Flow's `fitView` — its measurement pass does not complete in
  this setup, which otherwise leaves every node invisible. Node widths are therefore
  estimated from label length. Worth revisiting on the next React Flow upgrade.
