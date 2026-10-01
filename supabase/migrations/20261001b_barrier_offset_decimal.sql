-- Replay Engine — Phases 4–5: let the sync anchor hold fractions of a second.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- `vod_reviews.barrier_drop_offset` is the video time at which round 1's
-- barriers drop: the one anchor every round, kill and minimap frame is placed
-- from. As a whole number of seconds it carries up to half a second of error,
-- which the timeline hides and a moving minimap does not. numeric(8,3) stores
-- milliseconds. Existing whole-second values are kept as they are.
--
-- The app works before this runs: the first sync still saves (rounded), and
-- only the 0.1 s nudge on the Map tab reports that it needs this migration.

alter table public.vod_reviews
  alter column barrier_drop_offset type numeric(8, 3);

notify pgrst, 'reload schema';
