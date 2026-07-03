-- Issue #9: session bodies + in-game dates.
-- summary is markdown prose; in_game_date is free-form text (Faerûnian
-- calendar is not a standard date type). All nullable — existing sessions
-- render unchanged.
alter table public.sessions
  add column if not exists summary      text,
  add column if not exists image_url    text,
  add column if not exists in_game_date text;
