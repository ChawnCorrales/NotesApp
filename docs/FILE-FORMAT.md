# The Markdown file format

NotesApp reads and writes ordinary Markdown files with a YAML front matter
block. The format is meant to be **hand-written**: bringing in a bestiary, an
NPC roster, or a pile of notes from another tool should be a matter of writing
files, not of learning an export schema.

Everything below round-trips. Export a campaign, re-import the files, and you
get the same campaign back — the tests in `tests/dom/import-export-round-trip.test.ts`
assert exactly that.

## A note

```markdown
---
title: Session 12
folder: Session Logs/Act One
---

The party meets [[Marrow]] at dusk.
```

| Key | Meaning |
| --- | --- |
| `title` | The note's title. Optional. |
| `folder` | Slash-separated path. Optional. Missing folders are created. |

Without `title`, the note takes its name from a leading `# heading`, and failing
that from the file name — most explicit signal first. Without `folder`, the note
is unfiled.

## An entity

```markdown
---
type: entity
name: Marrow
category: Characters
aliases:
  - Old Marrow
  - the shopkeeper
---

A grizzled merchant who keeps a shop in [[Greyhaven]].
```

| Key | Meaning |
| --- | --- |
| `type` | Must be `entity`. This is the only thing that makes a file an entity. |
| `name` | The entity's name. `title` works too. Falls back to the file name. |
| `category` | A Canon section name, matched case-insensitively. Optional. |
| `aliases` | Other names that should be recognised as this entity. Optional. |

The body becomes the entity's description.

**A file without `type: entity` is a note.** That is what keeps every file that
ever imported working, and it means you can start from a note and add two lines
to promote it.

**An unknown category creates a section.** Import a bestiary full of
`category: Monsters` and the Monsters section appears rather than the files
being rejected. Created sections are reported back, so it is never silent.

**An unfamiliar key is ignored, not rejected.** Files come from other tools;
`cssclass`, `publish`, `tags` and the rest are skipped rather than failing the
import.

## Lists

Both spellings work, wherever a list is accepted:

```markdown
aliases: [Old Marrow, the shopkeeper]
```

```markdown
aliases:
  - Old Marrow
  - the shopkeeper
```

## Wikilinks

`[[Marrow]]` is written on export and **stripped on import**, leaving the plain
name. `[[Marrow|the shopkeeper]]` keeps the display text, matching how Obsidian
renders it.

This is deliberate. NotesApp does not store links — it recognises names, on
every keystroke, from the entity list. Keeping the brackets would put
punctuation into your prose that you never typed, and recognition would then
fail to match `[[Marrow]]` against the entity `Marrow` anyway. Strip them and
the connection comes back on its own.

The practical consequence: **your links survive a trip through Obsidian in both
directions**, because each tool gets the form it understands.

## What an export looks like

`File ▸ Export campaign…` produces a `.zip`:

```
Untitled Campaign.zip
├── Session Logs/
│   └── Act One/
│       └── Session 12.md
├── Greyhaven Cast.md
└── Entities/
    ├── Marrow.md
    └── Greyhaven.md
```

Notes keep their folder structure; entities go in `Entities/`, since they have
no folder of their own. Each note's `folder` key is written into its front
matter as well as being implied by its path, so re-importing restores the tree
even if the files get moved around in between.

Trashed notes are not included. Two notes sharing a title get a numeric suffix
rather than overwriting each other.

## Known limits

- **Underline is lost.** Markdown has no spelling for it. The text survives; the
  underline does not. Emitting `<u>` would be worse, since the importer runs
  with raw HTML disabled and would bring the tags back as literal text.
- **Relationships are not exported.** They live between entities rather than in
  either one, and the format has nowhere to put them yet. Re-importing an export
  rebuilds mentions and backlinks, but not relationships you drew by hand.
- **Collections are not exported** either, for the same reason.
