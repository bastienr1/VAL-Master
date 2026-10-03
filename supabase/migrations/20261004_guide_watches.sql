-- Watched state for Pro Study guides — one row per watched review.
--
-- A separate table rather than a column on reference_reviews: the review row
-- is overwritten by every import and carries nothing the user does, which is
-- the rule the drills and logs already follow. Explicit by design (decision 5
-- of 2026-10-03): a logged drill session does not mark a guide watched; the
-- user does, from the review page.
--
-- Run this whole file in the Supabase SQL editor.

create table if not exists guide_watches (
  reference_review_id uuid primary key references reference_reviews(id) on delete cascade,
  watched_at timestamptz not null default now()
);

-- RLS off, matching the other Pro Study tables (pending Phase 2 auth). A new
-- table comes up with RLS enabled and no policy, which reads as `200 []` and
-- only fails on the first insert — so this statement is required.
alter table guide_watches disable row level security;
