-- Sprint 6 — Playbook Foundation.
--
-- Playbooks are chaptered, video-anchored map/agent guides imported from the
-- Obsidian vault. The schema is multi-author (user_id + visibility) even though
-- the UI only shows the signed-in user's own playbooks for now.
--
-- Import runs in the browser: the .md is parsed client-side and saved through
-- import_playbook() below, which replaces a playbook and its chapters in one
-- transaction. There is no Edge Function to deploy.
--
-- Run this in the Supabase SQL editor.

create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  title text not null,
  slug text not null,
  map text not null,
  agent text,
  side text check (side is null or side in ('attack', 'defense', 'both')),
  video_url text,
  video_duration_seconds int,
  description text,
  source text not null default 'obsidian_import'
    check (source in ('obsidian_import', 'manual', 'coach_import')),
  source_path text,
  source_last_synced_at timestamptz,
  content_hash text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists playbooks_user_map_idx on playbooks(user_id, map);
create unique index if not exists playbooks_user_slug_idx on playbooks(user_id, slug);

create table if not exists playbook_chapters (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks(id) on delete cascade,
  chapter_number int not null,
  title text not null,
  subtitle text,
  start_seconds int not null,
  end_seconds int not null,
  notes_markdown text,
  key_takeaways text[],
  transcript_excerpt text,
  related_clip_urls text[],
  role_context text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists playbook_chapters_playbook_idx on playbook_chapters(playbook_id, chapter_number);

create table if not exists playbook_import_log (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid references playbooks(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade,
  source_path text not null,
  action text not null
    check (action in ('created', 'updated', 'unchanged', 'failed')),
  chapters_added int default 0,
  chapters_updated int default 0,
  chapters_removed int default 0,
  error_message text,
  synced_at timestamptz default now()
);

-- ──────────────────────────────────────────────────────────────────────────
-- RLS — users see only their own rows. Public visibility extends these later.
-- ──────────────────────────────────────────────────────────────────────────

alter table playbooks enable row level security;
create policy "Users can view own playbooks"
  on playbooks for select using (auth.uid() = user_id);
create policy "Users can insert own playbooks"
  on playbooks for insert with check (auth.uid() = user_id);
create policy "Users can update own playbooks"
  on playbooks for update using (auth.uid() = user_id);
create policy "Users can delete own playbooks"
  on playbooks for delete using (auth.uid() = user_id);

alter table playbook_chapters enable row level security;
create policy "Users can view chapters of own playbooks"
  on playbook_chapters for select
  using (exists (select 1 from playbooks p where p.id = playbook_id and p.user_id = auth.uid()));
create policy "Users can insert chapters into own playbooks"
  on playbook_chapters for insert
  with check (exists (select 1 from playbooks p where p.id = playbook_id and p.user_id = auth.uid()));
create policy "Users can update chapters of own playbooks"
  on playbook_chapters for update
  using (exists (select 1 from playbooks p where p.id = playbook_id and p.user_id = auth.uid()));
create policy "Users can delete chapters of own playbooks"
  on playbook_chapters for delete
  using (exists (select 1 from playbooks p where p.id = playbook_id and p.user_id = auth.uid()));

alter table playbook_import_log enable row level security;
create policy "Users can view own import logs"
  on playbook_import_log for select using (auth.uid() = user_id);
create policy "Users can insert own import logs"
  on playbook_import_log for insert with check (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────
-- import_playbook — atomic create / update / no-op for one parsed note.
--
-- security invoker: every statement runs as the caller, so the RLS policies
-- above still decide what it may touch. Chapters are matched by chapter_number:
-- matching rows are updated in place (ids preserved), new numbers inserted,
-- numbers no longer in the note deleted.
--
-- p_playbook: { title, slug, map, agent, side, video_url,
--               video_duration_seconds, description }
-- p_chapters: [{ chapter_number, title, subtitle, start_seconds, end_seconds,
--                notes_markdown, key_takeaways[], transcript_excerpt,
--                role_context }]
-- ──────────────────────────────────────────────────────────────────────────

create or replace function import_playbook(
  p_playbook jsonb,
  p_chapters jsonb,
  p_source_path text,
  p_content_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_existing playbooks%rowtype;
  v_playbook_id uuid;
  v_action text;
  v_added int := 0;
  v_updated int := 0;
  v_removed int := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  if jsonb_typeof(p_chapters) is distinct from 'array' or jsonb_array_length(p_chapters) = 0 then
    raise exception 'A playbook needs at least one chapter';
  end if;

  select * into v_existing
    from playbooks
   where user_id = v_user and slug = p_playbook->>'slug'
   for update;

  if found and v_existing.content_hash = p_content_hash then
    insert into playbook_import_log (playbook_id, user_id, source_path, action)
    values (v_existing.id, v_user, p_source_path, 'unchanged');
    return jsonb_build_object(
      'success', true, 'playbook_id', v_existing.id, 'slug', v_existing.slug, 'action', 'unchanged',
      'chapters_added', 0, 'chapters_updated', 0, 'chapters_removed', 0
    );
  end if;

  if found then
    v_playbook_id := v_existing.id;
    v_action := 'updated';
    update playbooks set
      title = p_playbook->>'title',
      map = p_playbook->>'map',
      agent = p_playbook->>'agent',
      side = p_playbook->>'side',
      video_url = p_playbook->>'video_url',
      video_duration_seconds = (p_playbook->>'video_duration_seconds')::int,
      description = p_playbook->>'description',
      source_path = p_source_path,
      source_last_synced_at = now(),
      content_hash = p_content_hash,
      updated_at = now()
    where id = v_playbook_id;
  else
    v_action := 'created';
    insert into playbooks (
      user_id, title, slug, map, agent, side, video_url, video_duration_seconds,
      description, source, source_path, source_last_synced_at, content_hash
    ) values (
      v_user,
      p_playbook->>'title',
      p_playbook->>'slug',
      p_playbook->>'map',
      p_playbook->>'agent',
      p_playbook->>'side',
      p_playbook->>'video_url',
      (p_playbook->>'video_duration_seconds')::int,
      p_playbook->>'description',
      'obsidian_import',
      p_source_path,
      now(),
      p_content_hash
    )
    returning id into v_playbook_id;
  end if;

  -- Chapters that disappeared from the note.
  with gone as (
    delete from playbook_chapters
     where playbook_id = v_playbook_id
       and chapter_number not in (
         select (c->>'chapter_number')::int from jsonb_array_elements(p_chapters) c
       )
    returning 1
  )
  select count(*) into v_removed from gone;

  -- Chapters that still exist — update in place.
  with changed as (
    update playbook_chapters pc set
      title = c->>'title',
      subtitle = c->>'subtitle',
      start_seconds = (c->>'start_seconds')::int,
      end_seconds = (c->>'end_seconds')::int,
      notes_markdown = c->>'notes_markdown',
      key_takeaways = array(select jsonb_array_elements_text(coalesce(c->'key_takeaways', '[]'::jsonb))),
      transcript_excerpt = c->>'transcript_excerpt',
      role_context = c->>'role_context',
      updated_at = now()
    from jsonb_array_elements(p_chapters) c
    where pc.playbook_id = v_playbook_id
      and pc.chapter_number = (c->>'chapter_number')::int
    returning 1
  )
  select count(*) into v_updated from changed;

  -- Chapters that are new.
  with fresh as (
    insert into playbook_chapters (
      playbook_id, chapter_number, title, subtitle, start_seconds, end_seconds,
      notes_markdown, key_takeaways, transcript_excerpt, role_context
    )
    select
      v_playbook_id,
      (c->>'chapter_number')::int,
      c->>'title',
      c->>'subtitle',
      (c->>'start_seconds')::int,
      (c->>'end_seconds')::int,
      c->>'notes_markdown',
      array(select jsonb_array_elements_text(coalesce(c->'key_takeaways', '[]'::jsonb))),
      c->>'transcript_excerpt',
      c->>'role_context'
    from jsonb_array_elements(p_chapters) c
    where not exists (
      select 1 from playbook_chapters pc
       where pc.playbook_id = v_playbook_id
         and pc.chapter_number = (c->>'chapter_number')::int
    )
    returning 1
  )
  select count(*) into v_added from fresh;

  insert into playbook_import_log (
    playbook_id, user_id, source_path, action, chapters_added, chapters_updated, chapters_removed
  ) values (
    v_playbook_id, v_user, p_source_path, v_action, v_added, v_updated, v_removed
  );

  return jsonb_build_object(
    'success', true, 'playbook_id', v_playbook_id, 'slug', p_playbook->>'slug', 'action', v_action,
    'chapters_added', v_added, 'chapters_updated', v_updated, 'chapters_removed', v_removed
  );
end;
$$;

grant execute on function import_playbook(jsonb, jsonb, text, text) to authenticated;
