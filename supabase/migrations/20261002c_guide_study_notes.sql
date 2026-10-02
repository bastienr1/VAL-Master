-- Guide study notes — the frame around a study guide's chapters.
--
-- A vault note opens with an Essence callout and Key Takeaways and closes with
-- habit cues and Action Items. Until now the importer read only the chapters
-- and the drill table, so the review page had nothing to say about what a video
-- argues or what to do after watching it.
--
-- Four markdown columns on the review row rather than a table: the note is the
-- source of truth, nothing the user does in the app lives on this text, and
-- every import overwrites it. Null on Notion-seeded rows and on a guide whose
-- note has no such section.
--
-- Run this whole file in the Supabase SQL editor, then `npm run import:guides`
-- to fill the columns. The importer refuses to write until they exist.

alter table reference_reviews
  add column if not exists essence_md text,
  add column if not exists takeaways_md text,
  add column if not exists habit_cues_md text,
  add column if not exists action_items_md text;
