-- Match reports — the written half of `/report/:matchId`, and the trend's numbers.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- One row per match of a user. `notes` is what a person wrote about the match
-- (what works, what to work on, best paths and duels, the next session), in
-- the shape `src/lib/matchReportNotes.ts` reads. `summary` is a handful of
-- counts the report page works out from the replay and saves, so the trend
-- over recent games is one query instead of one replay download per game.
--
-- The page works without this table: it then shows only what the rules find,
-- and no trend. `match_id` is Riot's match id, as on `matches` and
-- `match_replays`; there is no foreign key because neither has it unique alone.

create table if not exists public.match_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  match_id text not null,
  notes jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

-- RLS ON, own rows only: user-owned content, like `plays`.
alter table public.match_reports enable row level security;

drop policy if exists "match_reports: owner reads" on public.match_reports;
create policy "match_reports: owner reads" on public.match_reports
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "match_reports: owner inserts" on public.match_reports;
create policy "match_reports: owner inserts" on public.match_reports
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "match_reports: owner updates" on public.match_reports;
create policy "match_reports: owner updates" on public.match_reports
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "match_reports: owner deletes" on public.match_reports;
create policy "match_reports: owner deletes" on public.match_reports
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- As every table since 20261115_security_lockdown: nothing for anon, and no
-- TRUNCATE, TRIGGER or REFERENCES for a signed-in user.
revoke all on public.match_reports from anon;
revoke truncate, trigger, references on public.match_reports from authenticated;
grant select, insert, update, delete on public.match_reports to authenticated;

notify pgrst, 'reload schema';
