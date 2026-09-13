-- Sprint 6b — Playbook Library & Debrief Link.
--
-- 1. Playbooks get a user-chosen display name (identity stays with slug).
-- 2. map_fundamentals can point at a saved playbook instead of a URL.
-- 3. import_playbook() reads p_playbook.name.
--
-- Run the whole file in the Supabase SQL editor.

-- ── 1. playbooks.name ─────────────────────────────────────────────────────

alter table public.playbooks add column if not exists name text;
update public.playbooks set name = title where name is null;
alter table public.playbooks alter column name set not null;

alter table public.playbooks drop constraint if exists playbooks_name_length;
alter table public.playbooks add constraint playbooks_name_length
  check (char_length(btrim(name)) between 1 and 120);

-- ── 2. map_fundamentals: a URL or a playbook ──────────────────────────────

alter table public.map_fundamentals
  add column if not exists playbook_id uuid references public.playbooks(id) on delete cascade;

alter table public.map_fundamentals alter column url drop not null;

-- Existing rows all have a url and no playbook, so they satisfy this.
alter table public.map_fundamentals drop constraint if exists map_fundamentals_one_target;
alter table public.map_fundamentals add constraint map_fundamentals_one_target
  check ((url is null) <> (playbook_id is null));

-- ── 3. import_playbook() — name-aware ─────────────────────────────────────

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
  v_name text := nullif(btrim(p_playbook->>'name'), '');
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
    -- Content unchanged, but a rename in the save dialog still counts.
    if v_name is not null and v_name is distinct from v_existing.name then
      update playbooks set name = v_name, updated_at = now() where id = v_existing.id;
    end if;
    insert into playbook_import_log (playbook_id, user_id, source_path, action)
    values (v_existing.id, v_user, p_source_path, 'unchanged');
    return jsonb_build_object(
      'success', true, 'playbook_id', v_existing.id, 'slug', v_existing.slug,
      'name', coalesce(v_name, v_existing.name), 'action', 'unchanged',
      'chapters_added', 0, 'chapters_updated', 0, 'chapters_removed', 0
    );
  end if;

  if found then
    v_playbook_id := v_existing.id;
    v_action := 'updated';
    update playbooks set
      name = coalesce(v_name, name),
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
      user_id, name, title, slug, map, agent, side, video_url, video_duration_seconds,
      description, source, source_path, source_last_synced_at, content_hash
    ) values (
      v_user,
      coalesce(v_name, p_playbook->>'title'),
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

  with gone as (
    delete from playbook_chapters
     where playbook_id = v_playbook_id
       and chapter_number not in (
         select (c->>'chapter_number')::int from jsonb_array_elements(p_chapters) c
       )
    returning 1
  )
  select count(*) into v_removed from gone;

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
    'success', true, 'playbook_id', v_playbook_id, 'slug', p_playbook->>'slug',
    'name', (select name from playbooks where id = v_playbook_id), 'action', v_action,
    'chapters_added', v_added, 'chapters_updated', v_updated, 'chapters_removed', v_removed
  );
end;
$$;

grant execute on function import_playbook(jsonb, jsonb, text, text) to authenticated;

-- PostgREST caches function signatures; the signature is unchanged, but reload anyway.
notify pgrst, 'reload schema';
