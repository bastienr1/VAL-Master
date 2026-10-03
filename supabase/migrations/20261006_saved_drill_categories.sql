-- Saved drill categories — a user-set label on a saved drill (Routing,
-- Peeking, Utility…), the first axis the saved-drills page reads by.
--
-- On the save, not on the drill or in the note (Bastien, 2026-10-03: "the
-- category sits on the save. Editable by user."): no retrofit of the 500
-- imported drills, and the vocabulary grows out of what is actually saved.
-- Free text rather than a lookup table or a check constraint for the same
-- reason; the app offers a seed list and every category already in use, and
-- matches a typed name to an existing one ignoring case. Null means
-- uncategorised — the app never writes an empty string. A move keeps the
-- category; a removal takes it with the row.
--
-- Run this whole file in the Supabase SQL editor.

alter table saved_drills
  add column if not exists category text;
