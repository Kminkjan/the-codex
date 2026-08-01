-- 0033: image focal point
--
-- Every entity image renders `object-fit: cover` with no `object-position`, so
-- all six cropping surfaces crop from the dead centre and tall character art
-- gets sliced through the torso. This stores the one fact needed to fix that:
-- where in the artwork the subject actually is.
--
-- ONE POINT PER ENTITY, NOT ONE CROP PER SURFACE. Under `cover`,
-- `object-position: X% Y%` means "align this fraction of the IMAGE with this
-- fraction of the BOX", which makes a normalized point box-independent by
-- construction. The same stored value is correct in the 1:1 parchment portrait
-- well, the 16:10 Atlas well, the 4:3 bestiary plate and the 56px live
-- spotlight thumb. This is the model every CMS converged on (Sanity hotspot,
-- Contentful focus point, Cloudinary g_custom). Per-surface crop rectangles
-- would be four times the data and no more correct.
--
-- ONE text COLUMN, NOT TWO numerics. The value is never filtered, sorted,
-- aggregated or joined in SQL — it is read once and handed to a style
-- attribute. Two `real` columns would mean twelve nullable columns across six
-- tables plus an invalid partial state (x = 30, y = null) that every mapper in
-- campaignContext.tsx would have to adjudicate. One column makes
-- "null = centred" a single atomic fact.
--
-- NULL MEANS CENTRED, so nothing is backfilled and an untouched row renders
-- byte-identically to before this migration. Same reading as
-- connections.created_at in 0031: absent is a fact, not missing data.
--
-- THE STORED VALUE CARRIES NO CSS. It is '50 22', never '50% 22%'. This column
-- is client-written text — RLS gates who writes, not what — and its destination
-- is an inline style attribute, so keeping percent signs and every other CSS
-- token out of the column means no future code path can interpolate raw column
-- text into CSS and have it mean anything. src/imageFocus.ts owns the '%', and
-- scripts/focus-check.ts asserts that a value like '50 20; background:url(x)'
-- parses to undefined rather than to a style.

-- ==========================================================================
-- 1. image_focus on every image-bearing entity table
-- ==========================================================================

-- Six tables, one shape. The loop rather than six copy-pasted blocks so the
-- format regex has exactly one definition — six hand-maintained copies of a
-- regex is six chances for one of them to drift and start accepting something
-- the client can't parse.
--
-- Integers only, 0..100 inclusive, single space, nothing else. Sub-percent
-- precision is meaningless here (in the tightest surface, the 170px detail
-- portrait, 1% is under two pixels), and forbidding decimals keeps the
-- constraint a plain anchored regex instead of a parse-and-compare.
--
-- The constraint is what makes a malformed write fail LOUDLY: a rejected write
-- surfaces through the onWriteError toast wired in src/mutations.ts, where a
-- permissive column would silently store text the client then ignores, leaving
-- an editor staring at an image that didn't move and no explanation.
--
-- Constraints, unlike columns, have no `if not exists`, so each is dropped by
-- name first. Re-running this migration is safe.
--
-- The campaigns table is deliberately NOT here. Its crest renders as a
-- circular 1:1 at 96-116px, which is where a focal point matters least, and it
-- rides a bespoke write path (updateCampaign, plus the hand-picked realtime
-- patcher in campaignContext.tsx) rather than the generic per-kind fieldAlias
-- these six share. It is a clean follow-up, not an omission.
do $$
declare
  t text;
begin
  foreach t in array array['people', 'locations', 'factions', 'items', 'monsters', 'sessions']
  loop
    execute format(
      'alter table public.%I add column if not exists image_focus text', t);
    execute format(
      'alter table public.%I drop constraint if exists %I', t, t || '_image_focus_fmt');
    execute format(
      'alter table public.%I add constraint %I check (image_focus is null or image_focus ~ %L)',
      t, t || '_image_focus_fmt', '^(100|[0-9]{1,2}) (100|[0-9]{1,2})$');
  end loop;
end $$;

-- No RLS work. image_focus is an ordinary column on tables whose write
-- policies are already row-level (0023's is_campaign_member, 0006's
-- is_anonymous claim check) — a policy that admits an UPDATE to a row admits
-- an UPDATE to any column of it, and there is nothing here worth a
-- column-level grant that the image_url beside it doesn't already have.
--
-- No entity_hidden() work either, and that is a decision rather than an
-- omission: 0018's entity_hidden() is a per-row predicate over a table's
-- `hidden` flag. Adding a kind teaches it a new table; adding a column to a
-- table it already knows teaches it nothing.
--
-- No realtime work: all six tables already belong to the supabase_realtime
-- publication and the client loads them with select('*'), so the new column
-- rides both the initial load and every UPDATE payload with no query change.
