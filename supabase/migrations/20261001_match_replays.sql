-- Replay Engine — Phase 3: where a match's minimap bundle lives.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- A bundle is the 1–1.5 MB `minimap.v1.json.gz` that `scripts/replay` reduces
-- from a VALORANT `.vrf` replay. The file goes in Storage; this table is the
-- index the app reads to know a match has one. Two parts: the bucket with its
-- access rules, then the table.

-- ── 1. Storage bucket ─────────────────────────────────────────────────────
--
-- Private, unlike `round-screenshots`: a bundle carries the PUUIDs and movement
-- of the nine other players in the match, so it is never served by public URL.
-- Path convention: <user id>/<match id>/minimap.v<schema>.json.gz — the first
-- folder is the owner, which is what the policies below key on.

insert into storage.buckets (id, name, public)
values ('replays', 'replays', false)
on conflict (id) do nothing;

drop policy if exists "replays: owner reads" on storage.objects;
create policy "replays: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "replays: owner uploads" on storage.objects;
create policy "replays: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Re-attaching a bundle overwrites the file in place, which Storage treats as
-- an update.
drop policy if exists "replays: owner replaces" on storage.objects;
create policy "replays: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "replays: owner deletes" on storage.objects;
create policy "replays: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 2. match_replays ──────────────────────────────────────────────────────
--
-- One row per (user, match). `match_id` is the Riot match UUID as text, the
-- same key `match_rounds` and `match_pro_references` use; there is no foreign
-- key to `matches` for the same reason those have none.

create table if not exists public.match_replays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  match_id text not null,
  storage_path text not null,
  bundle_schema int not null default 1,
  -- Which vrfkit build decoded the replay, and which game build recorded it:
  -- when a patch breaks decoding, these say which rows to re-ingest.
  vrfkit_ref text,
  game_build text,
  map_uuid text,
  size_bytes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, match_id)
);

-- RLS ON here, unlike the reference tables: these rows are per-user and the
-- Storage policies above already depend on auth.uid(), so the table follows the
-- same rule rather than relying on every query remembering `.eq('user_id', …)`.
alter table public.match_replays enable row level security;

drop policy if exists "match_replays: owner all" on public.match_replays;
create policy "match_replays: owner all" on public.match_replays
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
