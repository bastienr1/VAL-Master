-- Line-ups — the line a throw follows: its bounces and bends.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice. Needs `20261124_lineups.sql`.
--
-- `via` is where the throw bounces or bends between `stand` and `land`, in
-- order: a list of minimap image points, [{"u": 0..1, "v": 0..1}, …], empty
-- for a throw that goes straight there. `curved` says how the line through
-- them is drawn: one smooth curve, or straight from point to point (a bounce
-- is a corner).

alter table public.lineups
  add column if not exists via jsonb not null default '[]'::jsonb,
  add column if not exists curved boolean not null default false;

notify pgrst, 'reload schema';
