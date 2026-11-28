-- Strat recall (docs/plays-editor-v2.md §2.31): the rounds a strat answers.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- One row per (strat, match, round): "Seen here" on a round of a review or a
-- report links one of the user's plays to that round, so a strat collects the
-- rounds where its pattern came up. `match_id` is the Riot match UUID as text,
-- the key `match_replays` and `match_rounds` use; there is no foreign key to
-- `matches`, as for those. Deleting the play deletes its links.

create table if not exists public.strat_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  play_id uuid not null references public.plays(id) on delete cascade,
  match_id text not null,
  round integer not null check (round >= 1),
  -- The replay time the round was on when it was linked, for the way back.
  replay_ms integer check (replay_ms >= 0),
  -- The page it was linked from, where the way back goes.
  page text not null default 'review' check (page in ('review', 'report')),
  created_at timestamptz not null default now(),
  unique (play_id, match_id, round)
);

create index if not exists strat_rounds_user_match_idx on public.strat_rounds (user_id, match_id);
create index if not exists strat_rounds_play_idx on public.strat_rounds (play_id);

-- RLS ON, own rows only, and only to one's own plays.
alter table public.strat_rounds enable row level security;

drop policy if exists "strat_rounds: owner reads" on public.strat_rounds;
create policy "strat_rounds: owner reads" on public.strat_rounds
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "strat_rounds: owner inserts" on public.strat_rounds;
create policy "strat_rounds: owner inserts" on public.strat_rounds
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.plays p where p.id = play_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "strat_rounds: owner deletes" on public.strat_rounds;
create policy "strat_rounds: owner deletes" on public.strat_rounds
  for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
