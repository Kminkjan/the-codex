-- ===========================================================================
-- Give the DM's desk an order of its own.
--
-- `session_staging` (0016) stores campaign_id, session_id, entity_id and
-- released_at — and nothing else. The client select carries no .order() either,
-- so without a client-side sort the rows arrive in whatever order Postgres
-- returns them. That is why the desk has always sorted alphabetically: an
-- alphabetical comparator was the only STABLE order the table could express,
-- not a judgement that the night runs A to Z.
--
-- It does not, and the alphabet actively hurts here. Sorting by name is exactly
-- what parks "Adult Red Dracolich" directly above "Adult Red Dragon" — the sort
-- clusters the lookalikes, which is the worst possible neighbouring for a row
-- whose RELEASE button is a one-way, public act. Prep order is not narrative
-- order either, but it is far closer, and it scatters those clusters for free.
--
-- NULLABLE ON PURPOSE, and the two-statement shape below is the whole point.
-- `add column ... default now()` would BACKFILL every existing row with the
-- migration's own clock (Postgres 11+ materialises the default for existing
-- rows), stamping the entire seeded back-catalogue as "staged at deploy time".
-- Adding the column bare and setting the default afterwards leaves existing
-- rows NULL and defaults only what is written from here on. So, exactly as with
-- `connections.created_at` in 0031: NULL means "staged before this column
-- existed", never "just now". The client sorts unknowns LAST, which is the same
-- rule listSort.ts documents for every other unknown value in this codebase.
--
-- No index: a session's queue is tens of rows, already fetched whole per
-- campaign and sorted in the client. An index here would cost writes and buy
-- nothing.
--
-- Not a reorder feature. True sequencing would be an integer order_num plus
-- drag handles and a reorder mutation; this is one column and one comparator.
-- What it does give away free: stageEntity() already upserts with a merge path,
-- so re-staging bumps staged_at and "re-stage it to move it to the end of the
-- queue" works with no new UI.
-- ===========================================================================

alter table public.session_staging
  add column if not exists staged_at timestamptz;

alter table public.session_staging
  alter column staged_at set default now();

comment on column public.session_staging.staged_at is
  'When the DM staged this row. NULL means the row predates this column (0045) — never "just now". New rows default to now(); re-staging via the stageEntity upsert bumps it, which is the queue''s only reordering gesture.';
