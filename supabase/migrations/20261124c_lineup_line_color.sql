-- Line-ups — the colour of a line-up's line on the map.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice. Needs `20261124_lineups.sql`.
--
-- `#RRGGBB`, or null for the colour of the ability itself.

alter table public.lineups
  add column if not exists line_color text check (line_color ~ '^#[0-9A-Fa-f]{6}$');

notify pgrst, 'reload schema';
