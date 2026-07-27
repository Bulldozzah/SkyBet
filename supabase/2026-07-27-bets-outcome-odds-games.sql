-- Saved bets keep each event's individual W/D/L odds and its match-ups, so
-- reopening a bet from My Bets restores the odds grid the same way a Scanner
-- pick does. Nullable, so rows saved before this migration keep working.
--
-- Run in the Supabase SQL editor (project shared with the Android app).

alter table public.bets
  add column if not exists outcome_odds jsonb,
  add column if not exists games jsonb;
