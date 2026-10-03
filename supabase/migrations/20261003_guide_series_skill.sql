-- Guide series and skill — Pro Study library shelves.
--
-- The vault's coaching MOCs group notes by series and by the one skill each
-- video trains. The importer dropped both, so the library could only sort by
-- date. Six nullable columns on the review row: the note is the source of
-- truth and every import overwrites them. Null on Notion rows.
--
-- `skill_group` is derived at import from `src/lib/skillTaxonomy.ts` rather
-- than written in the note, so a skill can move between groups without a
-- vault edit. `published` is the video's upload date, which orders a series
-- chronologically; `played_at` stays the note's own date.
--
-- Run this whole file in the Supabase SQL editor, then `npm run import:guides`.
-- The importer refuses to write until these columns exist.

alter table reference_reviews
  add column if not exists series text,
  add column if not exists skill text,
  add column if not exists skill_group text
    check (skill_group in ('mechanics', 'game-sense')),
  add column if not exists playlist_index int,
  add column if not exists difficulty text
    check (difficulty in ('beginner', 'intermediate', 'advanced')),
  add column if not exists published date;

-- No index: the table is a few hundred rows and the library loads it whole.
