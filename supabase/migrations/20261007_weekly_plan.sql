-- Weekly Plan — a routine of blocks, one goal per block per week, and the
-- sessions ticked against them.
--
-- Three tables because they change at three speeds: a block (`routine_blocks`)
-- lives for months, a goal (`weekly_goals`) for one week, a check-in
-- (`block_logs`) for one day. Keeping the goal apart from the block is what
-- lets a past week still show the focus it had.
--
-- User content, kept apart from synced data: nothing here touches `matches`
-- or the importer, and a guide re-import cannot rewrite a goal — the focus
-- text is a copy taken when the drill was picked, and the drill columns on
-- `weekly_goals` are `set null` so a vanished save or guide costs the goal its
-- "open in guide" link, not its text.
--
-- One session per block per day (the unique on `block_logs`): "DM x5" counts
-- days, so a second deathmatch on the same day is the same tick.
--
-- Archive instead of delete: a block removed from the routine gets
-- `archived_at` and its past weeks still read true. A real delete (the
-- editor's "Delete with history") cascades to its goals and check-ins.
--
-- RLS ON, own rows only, following `art_slots` — unlike `saved_drills`, these
-- tables carry a `user_id`.
--
-- Run this whole file in the Supabase SQL editor. Safe to run twice.

create table if not exists routine_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  weekly_target int not null default 3 check (weekly_target between 1 and 7),
  position int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists weekly_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  block_id uuid not null references routine_blocks(id) on delete cascade,
  week_start date not null,
  focus_text text not null,
  saved_drill_id uuid references saved_drills(id) on delete set null,
  drill_id uuid references practice_drills(id) on delete set null,
  source_review_id uuid references reference_reviews(id) on delete set null,
  source_start_seconds int,
  created_at timestamptz not null default now(),
  unique (block_id, week_start)
);

create table if not exists block_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  block_id uuid not null references routine_blocks(id) on delete cascade,
  logged_on date not null,
  rating int check (rating between 1 and 5),
  note text,
  practice_log_id uuid references practice_logs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (block_id, logged_on)
);

create index if not exists weekly_goals_week_start_idx on weekly_goals (week_start);
create index if not exists block_logs_logged_on_idx on block_logs (logged_on);

-- ------------------------------------------------------------------------ RLS

alter table routine_blocks enable row level security;

drop policy if exists "routine_blocks: owner reads" on routine_blocks;
create policy "routine_blocks: owner reads" on routine_blocks
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "routine_blocks: owner inserts" on routine_blocks;
create policy "routine_blocks: owner inserts" on routine_blocks
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "routine_blocks: owner updates" on routine_blocks;
create policy "routine_blocks: owner updates" on routine_blocks
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "routine_blocks: owner deletes" on routine_blocks;
create policy "routine_blocks: owner deletes" on routine_blocks
  for delete to authenticated
  using (user_id = (select auth.uid()));

alter table weekly_goals enable row level security;

drop policy if exists "weekly_goals: owner reads" on weekly_goals;
create policy "weekly_goals: owner reads" on weekly_goals
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "weekly_goals: owner inserts" on weekly_goals;
create policy "weekly_goals: owner inserts" on weekly_goals
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "weekly_goals: owner updates" on weekly_goals;
create policy "weekly_goals: owner updates" on weekly_goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "weekly_goals: owner deletes" on weekly_goals;
create policy "weekly_goals: owner deletes" on weekly_goals
  for delete to authenticated
  using (user_id = (select auth.uid()));

alter table block_logs enable row level security;

drop policy if exists "block_logs: owner reads" on block_logs;
create policy "block_logs: owner reads" on block_logs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "block_logs: owner inserts" on block_logs;
create policy "block_logs: owner inserts" on block_logs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "block_logs: owner updates" on block_logs;
create policy "block_logs: owner updates" on block_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "block_logs: owner deletes" on block_logs;
create policy "block_logs: owner deletes" on block_logs
  for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
