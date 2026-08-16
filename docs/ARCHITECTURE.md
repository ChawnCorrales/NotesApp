# Architecture

## Layers

```
src/components/        React. Rendering and interaction only.
        │
        ▼
src/lib/services/      Every operation the application can perform.
        │              The surface a server API would mirror.
        ▼
src/lib/db/            Dexie / IndexedDB. Storage detail.
```

Components import from `@/lib/services` and nowhere else in the data stack.
This is enforced by an ESLint rule, not by convention — `src/components/**` and
`src/app/**` may not import `@/lib/db/db` or `dexie` at all. Violations fail the
build with a message pointing at the fix.

Supporting modules sit beside the services and are imported by them, not by
components: `lib/entities` (recognition), `lib/editor` (document handling),
`lib/folders` (hierarchy rules), `lib/import` (Markdown), `lib/notes`
(derivation).

## Why the boundary exists

Three things get easier, and all of them are hard to retrofit:

**A server implementation.** `services/index.ts` is a list of operations; today
they are answered by `services/repository.ts` against IndexedDB. An HTTP
implementation is a second module behind the same names. Nothing in the UI has
to change shape.

**Permissions in one place.** Authorisation belongs inside the service layer.
A check in a component is a suggestion — some other component will forget it.
When notes gain player visibility, the read operations here are the *single*
place that must filter, and a missed filter is a leak of the GM's secrets rather
than a cosmetic bug.

**Storage that can change.** The heaviest table is already at the point where
index strategy matters. Confining that knowledge to `lib/db` means tuning it
does not ripple into views.

## The service surface

Grouped as a server API would expose them. See `src/lib/services/index.ts`.

| Group | Operations |
| --- | --- |
| Notes | create, update, delete, trash, restore, empty trash, list live / recent / trashed, move to folder |
| Folders | create, rename, move, delete, list |
| Entities | create, update, rename, delete, merge, aliases, list, list by section |
| Metadata | sections (create / update / reorder / delete / count), groups, tasks |
| Relationships | create, delete, per-entity (both directions), per-campaign |
| Mentions | sync, reindex, backlinks, counts, pairs, suppress / unsuppress |
| Search | `searchCampaign`, `searchNotes`, `searchEntities` |
| Graph | `getCampaignGraph`, `getNeighbourhood`, `traverse`, `inferCoOccurrence` |
| Import | `importMarkdownNotes` |

Two rules keep these portable:

1. **Plain serialisable data in and out.** Nothing returns a Dexie
   `Collection`, `Table`, or query builder — those cannot cross a network
   boundary, and exporting one would silently re-couple the UI to IndexedDB.
2. **Named for the user's intent, not the tables.** `getEntityRelationships`
   survives a schema change; `queryRelationshipsBySourceId` does not.

## What is deliberately not built yet

Nothing below is implemented. What matters is that no signature has to be
redesigned to add it.

**Actor / authentication.** Every operation is already scoped by `campaignId`.
A server implementation takes the caller as ambient request context; the local
implementation ignores it. API keys are a transport concern — they authenticate
a caller *into* an actor, which is the argument the operations already imply.

**Permissions.** The Postgres RLS policies in `supabase/migrations/0002` already
express the intended model — campaign membership, GM versus player, per-note
shares. The service layer and the database should agree by construction rather
than duplicating rules.

**GM / player visibility.** `Note.visibility` exists and is always `gm` today.
When players arrive, read operations filter on it in one place. This is the
strongest single reason components do not query notes directly.

## The one thing that will not survive unchanged

Components wrap service calls in Dexie's `useLiveQuery`, which re-runs them when
the underlying tables change. That reactivity is a property of local storage,
not of the operations themselves. Over HTTP it becomes polling, SSE, or
websockets.

This is a change to how results are *subscribed to*, not to what is asked for —
so it is contained at the component boundary rather than spread through the
service layer. Worth knowing before anyone assumes live updates come for free
once there is a server.

## Known compromises

- `services/repository.ts` is large (~880 lines) and holds most operations. It
  is cohesive and the split by domain currently lives in `index.ts` rather than
  in separate files. Splitting it is safe whenever it stops being comfortable.
- `campaign-context.tsx` loads all entities and aliases for the recogniser.
  That is inherent — matching needs the whole vocabulary — but it means entity
  count, not note count, is the scaling limit for that particular read.
