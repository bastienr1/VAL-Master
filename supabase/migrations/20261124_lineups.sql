-- Line-ups — one throw of one ability: where to stand, where to aim, what it
-- does, with its pictures and its clip (`/plays/lineups`).
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- Its own table rather than a kind of play: a play has a side, a comp and
-- steps; a line-up has a stand point, a landing and a recipe, and is meant to
-- be asked back one field at a time later (flashcards). Two parts: the bucket
-- for its pictures, then the table.

-- ── 1. Storage bucket ─────────────────────────────────────────────────────
--
-- Public, like `site-art` and `round-screenshots`: screenshots of the game,
-- served by plain URL. Path convention:
-- <user id>/<line-up id>/<slot>-<timestamp>.<ext> — the first folder is the
-- owner, which is what the policies below key on.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lineup-media', 'lineup-media', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Viewing goes through the public URL and needs no policy. This one exists
-- because Storage will not delete or replace a file its owner cannot select.
drop policy if exists "lineup-media: owner reads" on storage.objects;
create policy "lineup-media: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'lineup-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "lineup-media: owner uploads" on storage.objects;
create policy "lineup-media: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lineup-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "lineup-media: owner replaces" on storage.objects;
create policy "lineup-media: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'lineup-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'lineup-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "lineup-media: owner deletes" on storage.objects;
create policy "lineup-media: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lineup-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 2. lineups ────────────────────────────────────────────────────────────

create table if not exists public.lineups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  -- Display name, as `plays.map`; Riot UUID when the registry resolved it.
  map text not null,
  map_uuid text,
  side text not null check (side in ('attack', 'defense')),
  -- Agent display name and the ability's slot, as a play's ability element.
  agent text not null,
  slot text not null check (slot in ('Grenade', 'Ability1', 'Ability2', 'Ultimate')),
  -- Where to stand and where it lands: minimap image units, {"u": 0..1, "v": 0..1}.
  stand jsonb not null,
  land jsonb not null,
  -- The nearest callout to each when it was last moved: for lists and questions.
  stand_callout text,
  land_callout text,
  -- What it is for.
  purpose text check (purpose in ('execute', 'post-plant', 'retake', 'deny', 'info', 'other')),
  -- The recipe, one field each so a flashcard can ask for one.
  stance text check (stance in ('standing', 'crouched')),
  movement text check (movement in ('still', 'walking', 'running', 'jump', 'run-jump')),
  click text check (click in ('left', 'right', 'both')),
  bounces smallint check (bounces between 0 and 3),
  -- Charge bars (Sova's bolts); null when the ability has none.
  charge smallint check (charge between 0 and 3),
  note text not null default '',
  -- Three pictures in fixed slots, each a path in `lineup-media`; null when empty.
  stand_image text,
  aim_image text,
  result_image text,
  -- A clip by reference: a YouTube link and the seconds it runs between.
  video_url text,
  video_start integer check (video_start >= 0),
  video_end integer check (video_end >= 0),
  -- Line-ups break when a map changes: the patch it was checked on, and when.
  patch text,
  verified_on date,
  -- Where it came from (a replay's match and time, a guide's timestamp); free-form for now.
  source jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lineups_user_map_idx on public.lineups (user_id, map);

-- RLS ON, own rows only: user-owned content, like `plays`.
alter table public.lineups enable row level security;

drop policy if exists "lineups: owner reads" on public.lineups;
create policy "lineups: owner reads" on public.lineups
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "lineups: owner inserts" on public.lineups;
create policy "lineups: owner inserts" on public.lineups
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "lineups: owner updates" on public.lineups;
create policy "lineups: owner updates" on public.lineups
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "lineups: owner deletes" on public.lineups;
create policy "lineups: owner deletes" on public.lineups
  for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
