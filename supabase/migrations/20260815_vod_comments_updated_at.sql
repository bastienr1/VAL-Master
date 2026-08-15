-- VOD Note Editor: edit-after-save support.
--
-- The existing vod_comments table already carries everything the note editor
-- needs (free_text as the body, timestamp_seconds, tags[]). The only thing
-- missing is a way to tell an edited note from an untouched one.
--
-- Run this in the Supabase SQL editor before using the Edit button.

alter table vod_comments
  add column if not exists updated_at timestamptz;

-- Backfill so existing rows sort predictably; new edits set this explicitly.
update vod_comments
   set updated_at = created_at
 where updated_at is null;
