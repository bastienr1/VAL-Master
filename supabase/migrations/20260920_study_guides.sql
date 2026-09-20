-- Study Guides — Pro Study step 1.
--
-- Vault notes from the `valorant-vod-library` skill become a second content
-- source beside the Notion-seeded pro VODs. Run this whole file in the Supabase
-- SQL editor (this project has no CLI link — migrations are applied by hand and
-- kept here as the record of what was run).
--
-- Three tables rather than JSONB on the review row because there are three
-- lifecycles: sections are replaced wholesale on every import, drills are
-- re-imported but must preserve user status, logs are pure user data.

-- ---------------------------------------------------------------- the review row

alter table reference_reviews
  add column if not exists source text not null default 'notion'
    check (source in ('notion', 'vault')),
  add column if not exists content_type text
    check (content_type in ('map-guide', 'pro-review', 'agent-guide', 'mechanics', 'mindset')),
  add column if not exists creator text,
  add column if not exists vault_path text unique,
  add column if not exists series_order int,
  add column if not exists duration_seconds int,
  add column if not exists focus text[],
  add column if not exists maps text[],
  add column if not exists agents text[];

-- A vault note may have no video yet (the link is pasted into the note later),
-- so the two YouTube columns stop being required and uniqueness moves to a
-- partial index that ignores the nulls.
alter table reference_reviews alter column video_id drop not null;
alter table reference_reviews alter column youtube_url drop not null;
alter table reference_reviews drop constraint if exists reference_reviews_video_id_key;
create unique index if not exists reference_reviews_video_id_uniq
  on reference_reviews (video_id) where video_id is not null;

-- ------------------------------------------------------------------- chapters

create table if not exists reference_sections (
  id uuid primary key default gen_random_uuid(),
  reference_review_id uuid not null references reference_reviews(id) on delete cascade,
  position int not null,
  heading text not null,
  start_seconds int,
  end_seconds int,
  map text,
  agent text,
  body_md text not null,
  created_at timestamptz default now(),
  unique (reference_review_id, position)
);

-- --------------------------------------------------------------------- drills

create table if not exists practice_drills (
  id uuid primary key default gen_random_uuid(),
  reference_review_id uuid not null references reference_reviews(id) on delete cascade,
  position int not null,
  title text not null,
  venue text,
  cue text,
  success_signal text,
  source_start_seconds int,
  source_end_seconds int,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'done', 'dropped')),
  target_sessions int,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (reference_review_id, position)
);

create table if not exists practice_logs (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null references practice_drills(id) on delete cascade,
  logged_at date not null default current_date,
  outcome text check (outcome in ('hit', 'partial', 'miss')),
  note text,
  linked_match_id uuid references matches(id),
  created_at timestamptz default now()
);

create index if not exists practice_logs_drill_idx on practice_logs (drill_id);
create index if not exists reference_sections_review_idx on reference_sections (reference_review_id);
create index if not exists practice_drills_review_idx on practice_drills (reference_review_id);

-- ------------------------------------------------------------------------ RLS
--
-- New tables come up with RLS *enabled and no policy*, which returns `200 []`
-- on every read rather than an error — a table that looks healthy until the
-- first insert fails with "new row violates row-level security policy". Matches
-- the other content tables, which carry no RLS pending Phase 2 auth.

alter table reference_sections disable row level security;
alter table practice_drills    disable row level security;
alter table practice_logs      disable row level security;
