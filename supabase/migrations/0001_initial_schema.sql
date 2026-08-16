-- NotesApp initial schema (PRD §54).
--
-- Not yet wired into the running application: the app is local-first and reads
-- exclusively from IndexedDB today. This migration exists so the server side is
-- a translation of the shape already in use rather than a redesign later.
--
-- Run against a fresh Supabase project:
--   supabase db push
-- or paste into the SQL editor.

-- ---------------------------------------------------------------- extensions

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------------ profiles

-- Supabase owns auth.users; this holds the application-visible fields (§54 User).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  created_at   timestamptz not null default now()
);

-- ----------------------------------------------------------------- campaigns

create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  description text not null default '',
  theme_id    text not null default 'grimoire',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index campaigns_owner_idx on public.campaigns (owner_id);

-- Membership is modelled from the start even though the MVP is single-user,
-- because §4 warns explicitly against assuming permanent single-user operation
-- and retrofitting it would mean rewriting every policy below.
create type public.campaign_role as enum ('gm', 'player');

create table public.campaign_members (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        public.campaign_role not null default 'player',
  created_at  timestamptz not null default now(),
  primary key (campaign_id, user_id)
);

-- ------------------------------------------------------------------- folders

create table public.folders (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  parent_folder_id uuid references public.folders (id) on delete cascade,
  name             text not null,
  created_at       timestamptz not null default now()
);

create index folders_campaign_idx on public.folders (campaign_id);

-- --------------------------------------------------------------------- notes

-- Visibility states from §39. Only 'gm' is reachable in the current client.
create type public.visibility as enum ('gm', 'players', 'selected', 'revealed');

create table public.notes (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  author_id      uuid not null references public.profiles (id) on delete cascade,
  title          text not null default '',
  -- ProseMirror document as JSON.
  content        jsonb not null default '{}'::jsonb,
  -- Flattened plain text, maintained by the client. Denormalised so that
  -- full-text search does not have to walk the JSON document (§26).
  content_text   text not null default '',
  content_format text not null default 'tiptap',
  folder_id      uuid references public.folders (id) on delete set null,
  visibility     public.visibility not null default 'gm',
  is_locked      boolean not null default false,
  -- §44: notes the user marked "Do Not Sync" never reach this table at all.
  -- The column exists so a client can round-trip the flag without losing it.
  local_only     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Incremented on every server-side write; the client compares against its own
  -- copy to detect the divergent-edit case in §35.
  sync_version   bigint not null default 0
);

create index notes_campaign_idx on public.notes (campaign_id);
create index notes_updated_idx on public.notes (campaign_id, updated_at desc);
create index notes_search_idx on public.notes
  using gin (to_tsvector('english', title || ' ' || content_text));

-- ---------------------------------------------------------------------- tags

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name        text not null,
  unique (campaign_id, name)
);

create table public.note_tags (
  note_id uuid not null references public.notes (id) on delete cascade,
  tag_id  uuid not null references public.tags (id) on delete cascade,
  primary key (note_id, tag_id)
);

-- ------------------------------------------------------------------ entities

create table public.entity_types (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name        text not null,
  icon        text not null default '◇',
  theme_key   text not null default 'concept',
  is_built_in boolean not null default false,
  sort_order  integer not null default 0,
  unique (campaign_id, name)
);

create table public.entities (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  name           text not null,
  entity_type_id uuid not null references public.entity_types (id) on delete restrict,
  description    text not null default '',
  -- §10 "Stop Auto-Linking": excluded from recognition without losing the
  -- entity or any of its relationships.
  auto_link      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index entities_campaign_idx on public.entities (campaign_id);

create table public.entity_aliases (
  id        uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  alias     text not null,
  unique (entity_id, alias)
);

-- Derived data, rebuilt by the client whenever a note is saved or the entity
-- vocabulary changes. Safe to truncate and regenerate; nothing here is authored.
create table public.entity_mentions (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities (id) on delete cascade,
  note_id           uuid not null references public.notes (id) on delete cascade,
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  text_offset_start integer not null,
  text_offset_end   integer not null,
  detected_text     text not null
);

create index entity_mentions_entity_idx on public.entity_mentions (entity_id);
create index entity_mentions_note_idx on public.entity_mentions (note_id);

-- ------------------------------------------------------------- relationships

create table public.relationships (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  source_entity_id  uuid not null references public.entities (id) on delete cascade,
  target_entity_id  uuid not null references public.entities (id) on delete cascade,
  relationship_type text not null default 'related to',
  description       text not null default '',
  created_at        timestamptz not null default now(),
  -- Guards the self-loop that otherwise appears after merging two entities
  -- that were already related to each other.
  constraint relationships_no_self_loop check (source_entity_id <> target_entity_id)
);

create index relationships_campaign_idx on public.relationships (campaign_id);

-- --------------------------------------------------------------------- tasks

create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  note_id     uuid references public.notes (id) on delete cascade,
  text        text not null,
  completed   boolean not null default false,
  due_date    timestamptz,
  created_at  timestamptz not null default now()
);

create index tasks_campaign_idx on public.tasks (campaign_id);

-- ----------------------------------------------------------------- favorites

create table public.favorites (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  note_id    uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, note_id)
);

-- --------------------------------------------------------------- permissions

create type public.permission_level as enum ('read', 'comment', 'write');

create table public.share_permissions (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  note_id          uuid references public.notes (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  permission_level public.permission_level not null default 'read',
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------- updated_at triggers

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

create trigger entities_touch before update on public.entities
  for each row execute function public.touch_updated_at();

-- Notes also carry a sync counter, so their trigger does double duty. The
-- counter is what makes §35's conflict detection possible: a client that
-- uploads against a stale sync_version is told rather than silently winning.
create or replace function public.touch_note()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.sync_version = old.sync_version + 1;
  return new;
end;
$$;

create trigger notes_touch before update on public.notes
  for each row execute function public.touch_note();
