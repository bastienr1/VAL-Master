-- Plays — the user's own set plays, drawn on the minimap (`/plays`).
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- One row per play: the map, the side, the comp, the user's brief in their own
-- words, and the composed play document (`play`, a PlayDoc — see
-- `src/lib/playDoc.ts`). `play` stays null until the play is composed or the
-- user starts one by hand. Not to be confused with `playbooks`, which are the
-- chaptered video guides imported from the vault.

create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  -- Display name, as `playbooks.map`.
  map text not null,
  -- Riot UUID when the registry resolved it.
  map_uuid text,
  side text not null check (side in ('attack', 'defense')),
  -- Agent display names, up to 5.
  comp text[] not null default '{}',
  -- The user's own words.
  brief text not null default '',
  -- PlayDoc; null until composed.
  play jsonb,
  -- Model id of the last compose; null when the play was made by hand.
  composed_with text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plays_user_map_idx on public.plays (user_id, map);

-- RLS ON, own rows only: user-owned content, like `playbooks` and `art_slots`.
alter table public.plays enable row level security;

drop policy if exists "plays: owner reads" on public.plays;
create policy "plays: owner reads" on public.plays
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "plays: owner inserts" on public.plays;
create policy "plays: owner inserts" on public.plays
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "plays: owner updates" on public.plays;
create policy "plays: owner updates" on public.plays
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "plays: owner deletes" on public.plays;
create policy "plays: owner deletes" on public.plays
  for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
