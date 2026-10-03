-- Saved drills — a drill from a guide's Practice tab, filed under a map, an
-- agent or a skill.
--
-- Its own table rather than the Sprint 7 `bookmarks` stub: a bookmark is a
-- link with a scope, a saved drill is six content fields and a source range.
-- The `scope_type` / `scope_value` vocabulary is shared so the two read alike.
-- `agent` is filled only on a map save, so the Map Hub's agent chip can narrow
-- the shelf. One save per drill (the partial unique index); changing where it
-- is filed updates the row.
--
-- The text columns are a copy of the drill at save time, because a drill's
-- identity is its row position in the note: reordering the table points the
-- id at a different drill, and the copy keeps the card honest. The foreign
-- keys are `set null` so a vanished guide costs the card its jump button, not
-- its text. The save carries no status: `practice_drills.status` and
-- `practice_logs` already hold that.
--
-- RLS off, matching practice_drills, practice_logs and guide_watches (pending
-- Phase 2 auth). A new table comes up with RLS enabled and no policy, which
-- reads as `200 []` and only fails on the first insert — so the last statement
-- is required.
--
-- Run this whole file in the Supabase SQL editor.

create table if not exists saved_drills (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid references practice_drills(id) on delete set null,
  reference_review_id uuid references reference_reviews(id) on delete set null,
  scope_type text not null check (scope_type in ('map', 'agent', 'concept')),
  scope_value text not null,
  agent text,
  title text not null,
  venue text,
  cue text,
  success_signal text,
  source_start_seconds int,
  source_end_seconds int,
  source_title text,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists saved_drills_drill_uniq
  on saved_drills (drill_id) where drill_id is not null;
create index if not exists saved_drills_scope_idx on saved_drills (scope_type, scope_value);

alter table saved_drills disable row level security;
