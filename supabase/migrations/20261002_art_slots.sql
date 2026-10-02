-- Home Dashboard — swappable art for the landing page.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice.
--
-- Every picture on Home sits in a named slot (`hero.background`, `tile.stats`,
-- `map.<uuid>`, …). A row here overrides that slot's default art; with no row the
-- slot falls back to the game API image, then the file bundled in `public/art/`,
-- then a CSS gradient. Two parts: the bucket with its access rules, then the
-- table.

-- ── 1. Storage bucket ─────────────────────────────────────────────────────
--
-- Public, like `round-screenshots`: the images are decoration and are served by
-- plain URL. Path convention: <user id>/<slot key>/<timestamp>.<ext> — the first
-- folder is the owner, which is what the policies below key on.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-art', 'site-art', true, 5242880, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Viewing goes through the public URL and needs no policy. This one exists
-- because Storage will not delete or replace a file its owner cannot select.
drop policy if exists "site-art: owner reads" on storage.objects;
create policy "site-art: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'site-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "site-art: owner uploads" on storage.objects;
create policy "site-art: owner uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "site-art: owner replaces" on storage.objects;
create policy "site-art: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-art' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'site-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "site-art: owner deletes" on storage.objects;
create policy "site-art: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-art' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── 2. art_slots ──────────────────────────────────────────────────────────
--
-- Several rows may share a slot_key. The one shown is the newest by
-- `active_from` among those whose window contains now, so a row dated in the
-- future is a scheduled change, and a row with `active_until` hands the slot
-- back to the one beneath it when it runs out.

create table if not exists public.art_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  slot_key text not null,
  image_url text not null,
  -- Null when image_url points at an external site rather than the bucket.
  storage_path text,
  -- object-position of the image, 0–1 on each axis.
  focal_x real not null default 0.5 check (focal_x between 0 and 1),
  focal_y real not null default 0.5 check (focal_y between 0 and 1),
  -- Strength of the scrim drawn between the image and the text on top of it.
  overlay real not null default 0.55 check (overlay between 0 and 1),
  -- Hero only: the video behind "Watch Overview".
  href text,
  label text,
  active_from timestamptz not null default now(),
  active_until timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists art_slots_user_slot_active_idx
  on public.art_slots (user_id, slot_key, active_from desc);

-- RLS ON, own rows only: this is user-owned content, so it follows `playbooks`
-- rather than the seeded reference tables.
alter table public.art_slots enable row level security;

drop policy if exists "art_slots: owner reads" on public.art_slots;
create policy "art_slots: owner reads" on public.art_slots
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "art_slots: owner inserts" on public.art_slots;
create policy "art_slots: owner inserts" on public.art_slots
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "art_slots: owner updates" on public.art_slots;
create policy "art_slots: owner updates" on public.art_slots
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "art_slots: owner deletes" on public.art_slots;
create policy "art_slots: owner deletes" on public.art_slots
  for delete to authenticated
  using (user_id = (select auth.uid()));

notify pgrst, 'reload schema';
