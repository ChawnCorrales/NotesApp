-- Row-level security (PRD §42).
--
-- Every table is deny-by-default and reachable only through campaign
-- membership. Written now, before any client talks to the server, because
-- retrofitting RLS onto a live schema means auditing every query that already
-- works — and a missed policy is a campaign readable by strangers.

alter table public.profiles          enable row level security;
alter table public.campaigns         enable row level security;
alter table public.campaign_members  enable row level security;
alter table public.folders           enable row level security;
alter table public.notes             enable row level security;
alter table public.tags              enable row level security;
alter table public.note_tags         enable row level security;
alter table public.entity_types      enable row level security;
alter table public.entities          enable row level security;
alter table public.entity_aliases    enable row level security;
alter table public.entity_mentions   enable row level security;
alter table public.relationships     enable row level security;
alter table public.tasks             enable row level security;
alter table public.favorites         enable row level security;
alter table public.share_permissions enable row level security;

-- ------------------------------------------------------------ helper checks

-- security definer so the function can consult campaign_members without the
-- caller needing its own select policy on that table — which would otherwise
-- recurse when campaign_members' own policy calls back into this check.
create or replace function public.is_campaign_member(target_campaign uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = target_campaign and c.owner_id = auth.uid()
  ) or exists (
    select 1 from public.campaign_members m
    where m.campaign_id = target_campaign and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_campaign_gm(target_campaign uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.campaigns c
    where c.id = target_campaign and c.owner_id = auth.uid()
  ) or exists (
    select 1 from public.campaign_members m
    where m.campaign_id = target_campaign
      and m.user_id = auth.uid()
      and m.role = 'gm'
  );
$$;

-- ------------------------------------------------------------------ profiles

create policy profiles_self_select on public.profiles
  for select using (id = auth.uid());

create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_self_insert on public.profiles
  for insert with check (id = auth.uid());

-- ----------------------------------------------------------------- campaigns

create policy campaigns_member_select on public.campaigns
  for select using (public.is_campaign_member(id));

create policy campaigns_owner_insert on public.campaigns
  for insert with check (owner_id = auth.uid());

create policy campaigns_owner_modify on public.campaigns
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy campaigns_owner_delete on public.campaigns
  for delete using (owner_id = auth.uid());

create policy members_select on public.campaign_members
  for select using (public.is_campaign_member(campaign_id));

create policy members_gm_manage on public.campaign_members
  for all using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

-- --------------------------------------------------------------------- notes

-- Visibility is enforced here rather than in the client, so a player cannot
-- read GM-only content by talking to the API directly (§39, §42).
create policy notes_select on public.notes
  for select using (
    public.is_campaign_gm(campaign_id)
    or (
      public.is_campaign_member(campaign_id)
      and (
        author_id = auth.uid()
        or visibility in ('players', 'revealed')
        or exists (
          select 1 from public.share_permissions p
          where p.note_id = notes.id and p.user_id = auth.uid()
        )
      )
    )
  );

create policy notes_insert on public.notes
  for insert with check (
    public.is_campaign_member(campaign_id) and author_id = auth.uid()
  );

create policy notes_update on public.notes
  for update using (
    public.is_campaign_gm(campaign_id) or author_id = auth.uid()
  );

create policy notes_delete on public.notes
  for delete using (
    public.is_campaign_gm(campaign_id) or author_id = auth.uid()
  );

-- ------------------------------------------- campaign-scoped supporting data

-- These tables carry campaign_id directly, so one policy shape covers each.
create policy folders_member_all on public.folders
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy tags_member_all on public.tags
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy entity_types_member_all on public.entity_types
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy entities_member_all on public.entities
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy entity_mentions_member_all on public.entity_mentions
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy relationships_member_all on public.relationships
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy tasks_member_all on public.tasks
  for all using (public.is_campaign_member(campaign_id))
  with check (public.is_campaign_member(campaign_id));

create policy share_permissions_gm_all on public.share_permissions
  for all using (public.is_campaign_gm(campaign_id))
  with check (public.is_campaign_gm(campaign_id));

-- ------------------------------------------ tables scoped through a parent

create policy note_tags_member_all on public.note_tags
  for all using (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and public.is_campaign_member(n.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.notes n
      where n.id = note_tags.note_id and public.is_campaign_member(n.campaign_id)
    )
  );

create policy entity_aliases_member_all on public.entity_aliases
  for all using (
    exists (
      select 1 from public.entities e
      where e.id = entity_aliases.entity_id
        and public.is_campaign_member(e.campaign_id)
    )
  )
  with check (
    exists (
      select 1 from public.entities e
      where e.id = entity_aliases.entity_id
        and public.is_campaign_member(e.campaign_id)
    )
  );

create policy favorites_self_all on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
