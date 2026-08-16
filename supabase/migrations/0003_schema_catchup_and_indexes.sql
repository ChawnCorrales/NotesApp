-- Brings the Postgres schema level with the local model, and indexes it for the
-- queries the UI actually runs.
--
-- Two jobs in one migration because they are the same job: the columns added
-- here (deleted_at, hidden, occurrence) are precisely the ones the new indexes
-- are built on.
--
-- Still not applied to any project. Run after 0001 and 0002.

-- ------------------------------------------------------ catching up columns

-- Soft delete. NULL means live.
--
-- Note the deliberate divergence from the local model, where the same field is
-- 0 for a live note: IndexedDB cannot index NULL at all, so a nullable column
-- there would force every "live notes" query to read the whole table. Postgres
-- has partial indexes, which express "live notes" directly and keep the index
-- smaller than the table. Each side uses what its engine can actually do.
alter table public.notes
  add column if not exists deleted_at timestamptz;

-- Sections a campaign does not use are hidden rather than deleted, so the
-- entities filed under them are never orphaned.
alter table public.entity_types
  add column if not exists hidden boolean not null default false;

-- Ordinal of a mention within its note, per entity. This is what a
-- "not this entity" correction is keyed on.
alter table public.entity_mentions
  add column if not exists occurrence integer not null default 0;

-- Denormalised from the owning entity so a campaign's aliases are one indexed
-- read rather than "every entity id, then an IN over that list".
alter table public.entity_aliases
  add column if not exists campaign_id uuid references public.campaigns (id) on delete cascade;

update public.entity_aliases a
set campaign_id = e.campaign_id
from public.entities e
where a.entity_id = e.id and a.campaign_id is null;

alter table public.entity_aliases
  alter column campaign_id set not null;

-- ------------------------------------------------------- catching up tables

-- One occurrence the user marked as "not this entity" (PRD §32).
create table if not exists public.mention_suppressions (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.campaigns (id) on delete cascade,
  note_id          uuid not null references public.notes (id) on delete cascade,
  entity_id        uuid not null references public.entities (id) on delete cascade,
  occurrence_index integer not null,
  created_at       timestamptz not null default now(),
  unique (note_id, entity_id, occurrence_index)
);

-- User-defined groupings of entities. Distinct from entity_type: an entity has
-- exactly one type but may belong to any number of groups.
create table if not exists public.entity_groups (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  name        text not null,
  -- Presentation only. Membership is keyed on the group id, so recolouring can
  -- never change who is in a group.
  color_key   text not null default 'concept',
  created_at  timestamptz not null default now()
);

create table if not exists public.entity_group_members (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.entity_groups (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  unique (group_id, entity_id)
);

-- ------------------------------------------------------------------ indexes

-- Recent notes, and every "live notes" list. Partial, so the index holds only
-- live rows and stays smaller than the table.
create index if not exists notes_live_recent_idx
  on public.notes (campaign_id, updated_at desc)
  where deleted_at is null;

-- The trash: the complement of the above, and normally tiny.
create index if not exists notes_trashed_idx
  on public.notes (campaign_id, deleted_at desc)
  where deleted_at is not null;

-- Listing one folder's notes.
create index if not exists notes_folder_idx
  on public.notes (folder_id)
  where deleted_at is null;

create index if not exists folders_parent_idx
  on public.folders (parent_folder_id);

-- Canon section order.
create index if not exists entity_types_order_idx
  on public.entity_types (campaign_id, sort_order);

-- Entities within one Canon section.
create index if not exists entities_type_idx
  on public.entities (campaign_id, entity_type_id);

create index if not exists entity_aliases_campaign_idx
  on public.entity_aliases (campaign_id);

-- Alias matching is case-insensitive, so the index has to be too or it will
-- not be used.
create index if not exists entity_aliases_lower_idx
  on public.entity_aliases (lower(alias));

create index if not exists entities_lower_name_idx
  on public.entities (campaign_id, lower(name));

-- Mention counts are "how many distinct notes name this entity". Covering the
-- three columns lets Postgres answer from the index alone. This is the largest
-- table by far at the PRD's 100,000-mention target (§63).
create index if not exists entity_mentions_counting_idx
  on public.entity_mentions (campaign_id, entity_id, note_id);

-- Relationships were only indexed by campaign, yet every entity page queries
-- them by endpoint — both directions.
create index if not exists relationships_source_idx
  on public.relationships (source_entity_id);

create index if not exists relationships_target_idx
  on public.relationships (target_entity_id);

-- The task viewer groups by completion; the note link is followed per task.
create index if not exists tasks_note_idx
  on public.tasks (note_id);

create index if not exists tasks_open_idx
  on public.tasks (campaign_id, due_date)
  where completed = false;

create index if not exists note_tags_tag_idx
  on public.note_tags (tag_id);

create index if not exists favorites_note_idx
  on public.favorites (note_id);

create index if not exists share_permissions_user_idx
  on public.share_permissions (user_id);

create index if not exists share_permissions_note_idx
  on public.share_permissions (note_id);

create index if not exists mention_suppressions_note_idx
  on public.mention_suppressions (note_id);

create index if not exists mention_suppressions_campaign_idx
  on public.mention_suppressions (campaign_id);

create index if not exists entity_groups_campaign_idx
  on public.entity_groups (campaign_id);

create index if not exists entity_group_members_entity_idx
  on public.entity_group_members (entity_id);

-- ------------------------------------------- row-level security, as before

alter table public.mention_suppressions enable row level security;
alter table public.entity_groups        enable row level security;
alter table public.entity_group_members enable row level security;

create policy mention_suppressions_member_all on public.mention_suppressions
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy entity_groups_member_all on public.entity_groups
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy entity_group_members_member_all on public.entity_group_members
  for all using (
    exists (
      select 1 from public.entity_groups g
      where g.id = entity_group_members.group_id
        and public.is_campaign_member(g.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.entity_groups g
      where g.id = entity_group_members.group_id
        and public.is_campaign_member(g.campaign_id)
    )
  );

-- Trashed notes stay readable to whoever could already read them; the client
-- filters them out of ordinary lists. Restoring is a user action, not an
-- administrative one, so nothing here needs elevated rights.
