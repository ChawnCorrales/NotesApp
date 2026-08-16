# Testing strategy

The product's value is one loop:

> write → a name is recognised → it becomes a mention → the note becomes a
> backlink → the entity page and graph fill themselves in

Everything here protects that loop. Coverage is not a goal, and there is no
coverage threshold: a suite that guards the loop and nothing else is more useful
than one that touches every line and still lets a backlink quietly disappear.

## Layers

| Layer | Runner | Environment | What it is for |
| --- | --- | --- | --- |
| `tests/unit` | Vitest | node | Pure logic: matching rules, word boundaries, suppression filtering, text↔document position mapping, performance |
| `tests/integration` | Vitest | node + `fake-indexeddb` | Repository behaviour against a real IndexedDB: mention lifecycle, backlinks, aliases, renaming, persistence, groups |
| `tests/dom` | Vitest | happy-dom + `fake-indexeddb` | Logic that needs a DOM but is not a component: Markdown parsing and import |
| `tests/component` | Vitest | happy-dom + React Testing Library | Component behaviour a user can observe: navigation history, entity page |
| `tests/e2e` | Playwright | Chromium | The whole loop in a real browser: contenteditable, selection, decorations, reload |

```bash
npm test               # all three Vitest projects
npm run test:unit      # fastest feedback while changing matching rules
npm run test:e2e       # Playwright; starts the dev server if not already running
npm run test:types     # typechecks tests (they are excluded from the app build)
```

### Why the editor is not tested in jsdom

There are no React Testing Library tests of `NoteEditor`. ProseMirror depends on
real layout, selection, and `contenteditable`; simulated in a DOM shim, a test
mostly asserts that the shim behaves the way the test author imagined. Every
editor behaviour — recognition while typing, deleting a mention, the "not this
entity" popover — is covered by Playwright instead, where it is real.

The tradeoff is that those tests are slower and need a browser. That is the
right price for the one part of the app that cannot be faked convincingly.

### Why mention rules are tested as pure functions

`EntityRecognizer` takes text and returns matches. That makes the product's
trickiest rules — `Ash` must not match inside `Ashen`, `The Red Queen` beats the
`Queen` nested inside it, an alias resolves to its entity — cheap to state and
instant to run. These are product decisions, and they read like product
decisions in `tests/unit/entity-recognition.test.ts`.

## What is covered

**Recognition.** Creating an entity makes later text match. Aliases resolve to
the same entity. Word boundaries hold in both directions: `Ash` is found in
`Ash waits`, `Ash's brother` and `(Ash)`, and not in `Ashen`, `ashes`, `flash`
or `Ashford`. Recognition survives edits before, after, and around a mention.

**Mention lifecycle.** Typing a name creates a mention; deleting the text
removes it; editing so it no longer matches removes it; retyping recreates it.
Multiple mentions in one note are tracked and numbered independently per entity.
Repeated saves replace rather than accumulate.

**Backlinks.** A mention lists the note on the entity's page. Removing the last
mention removes the backlink; removing one of several does not. A note that
names an entity six times appears once — the count is notes, not occurrences.

**Aliases and renaming.** Adding an alias matches new text, and matches text
written earlier once the campaign reindexes. Renaming preserves the entity's
identity, its relationships, and its backlinks. Removing an alias stops
recognition through it without touching the entity or the note. Merging folds
mentions, aliases, and relationships into the surviving entity.

**False-positive correction.** Marking one occurrence "not this entity" removes
only that occurrence, leaves the entity matching everywhere else including
elsewhere in the same note, leaves the note text untouched, and survives
re-saving, a full reindex, and a page reload.

**Persistence.** Notes, entities, aliases, relationships, suppressions, and
backlinks all survive a reload — asserted by closing and reopening the database
so the reads come from storage. The mention index can be discarded and rebuilt
from notes alone, and rebuilding is idempotent and honours suppressions.

**Markdown import.** Headings, lists, links, blockquotes, code blocks, tables and
GFM task lists all survive the round trip. Titles resolve front matter → leading
H1 → file name, and a promoted H1 is removed so it is not repeated. Raw HTML in a
`.md` file is never passed through as markup. Imported notes are recognised and
backlinked against existing entities — including inside tables — but import never
creates entities on its own. One unreadable file does not abort a batch.

**The workspace shell.** The app opens on the Campaign Canon with a card per
section and counts drawn from entities. Sections rename, recolour, reorder, hide
and create; deleting one that still holds entities is refused rather than
cascading. Tabs keep independent histories — going Back in one tab cannot move
another — and closing a tab never leaves the window empty.

**Folders.** Creating, renaming, nesting, and filing notes by drag or by the
"Move to…" picker. Two rules are pinned hard because breaking either looks like
data loss: a folder can never be moved inside its own subtree, and deleting a
folder lifts its notes and subfolders to the parent instead of cascading. A
folder whose parent is missing surfaces as a root rather than vanishing, and the
tree walk terminates even on data that already contains a cycle.

**Graph.** Entities become nodes, stated relationships become edges, clicking a
node opens that entity, and three aliases of one entity still produce one node.

**Groups.** An entity can belong to many groups; membership changes never modify
the entity; group colour is presentation and can be changed without affecting
membership, and two groups sharing a colour stay distinct.

## Performance

`tests/unit/recognition-performance.test.ts` runs 1,000 entities against a
~40,000 character note. The thresholds are deliberately loose — a timing
assertion tight enough to be meaningful is also tight enough to fail on a busy
machine. What it actually guards is the *algorithm*: one test compares scan time
with 10 entities against 1,000, and fails if the ratio explodes. Replace
Aho-Corasick with a per-entity loop and that ratio goes from ~1 to ~100.

A companion test asserts the matcher still finds mentions, so the timings can
never look good because recognition silently stopped working.

## Notes for future contributors

- **Timing.** Saving is debounced (600ms) and reindexing after that (400ms). In
  Playwright, prefer a web-first assertion over a sleep; `settle()` exists for
  the cases where the thing being waited on is a database write with no visible
  signal.
- **Titles appear twice.** Note titles show in both the sidebar and the entity
  page's backlinks. Backlink assertions use the `backlink()` helper, which scopes
  to the content area — an unscoped query can pass on a sidebar entry while the
  entity page is empty.
- **Selection in Playwright** is made by placing a DOM Range, not by driving
  Shift+ArrowLeft. Keyboard selection was systematically off by one and produced
  entities named `sh` and `eyhaven`. ProseMirror still syncs from the DOM
  selection, so the code path under test is unchanged.
- **Two workers, not more.** All Playwright workers share one dev server; higher
  parallelism slows renders enough that debounced recognition starts racing the
  assertions.

## Known gaps

- No test asserts the *visual* treatment of a mention beyond its category
  attribute. Entity styling is deliberately subtle and would make for brittle
  assertions.
- Task extraction and the global task viewer have no coverage yet.
- Sync and conflict resolution are untested because they do not exist.
- Suppressions are keyed on an occurrence ordinal, so inserting an *earlier*
  occurrence of the same entity shifts which one is suppressed. This is a
  deliberate tradeoff over character offsets, which drift on every edit; there
  is no test pinning the shifted-ordinal behaviour because it is not yet decided
  what the right answer is.
