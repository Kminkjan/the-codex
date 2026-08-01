-- 0037: a zoom axis on the image focal point
--
-- Direct follow-up to 0036, which gave every entity image a focal point so
-- `object-fit: cover` stops cropping through faces. A point fixes WHERE the
-- crop sits but not HOW MUCH of the artwork it takes, and for full-body
-- character illustrations that is the remaining half of the problem: the face
-- lands in frame and is still a tenth of a 16:10 card.
--
-- This is the established second tier, not an invention — imgix pairs fp-x/fp-y
-- with fp-z, Sanity's hotspot carries a size rather than a bare point, and
-- Cloudinary pairs g_custom with z_. Point-only (Contentful, Storyblok) is the
-- common floor; point-plus-zoom is the ceiling worth having.
--
-- NO NEW COLUMN. The zoom rides in image_focus as an optional THIRD token —
-- '50 20' or '50 20 1.8'. Same reasoning 0036 recorded for keeping one text
-- column instead of two numerics: this value is never filtered, sorted,
-- aggregated or joined in SQL, it is read once and handed to a style attribute,
-- and a separate image_zoom column would create an invalid partial state (zoom
-- set on a row with no focal point) for every mapper in campaignContext.tsx to
-- adjudicate. One column keeps "how this image is framed" a single atomic fact,
-- and keeps NULL meaning exactly what it meant yesterday.
--
-- BACKWARD COMPATIBLE BY CONSTRUCTION. Every two-token value already stored
-- stays valid and keeps rendering identically, because an absent third token
-- means 1x. The canonical form OMITS the token at 1x rather than writing
-- '50 20 1', so there is exactly one spelling of "not zoomed" and the values
-- 0036 wrote are already in it — nothing to backfill, nothing to migrate.
--
-- ZOOM ONLY GOES IN. `cover` already fills the well, so a factor below 1 would
-- expose empty space rather than showing more artwork; there is no zoom-out to
-- express and the constraint refuses to store one. The ceiling is 2.5x, which
-- is a resolution judgement rather than a taste one: src/upload.ts stores the
-- original file untouched and there is no image service in front of it, so zoom
-- is a straight upscale and past ~2.5x a modest upload visibly softens. The
-- range therefore lives in exactly two places that must agree — this regex and
-- clampFocus() in src/imageFocus.ts — and scripts/focus-check.ts asserts the
-- module half.

-- ==========================================================================
-- Widen the format constraint on all six image-bearing tables
-- ==========================================================================

-- Third token, when present: strictly greater than 1 and at most 2.5, at most
-- one decimal. '1' and '1.0' are deliberately REJECTED rather than tolerated —
-- they are a second spelling of the two-token form, and admitting them would
-- mean two stored values that render identically, which is how a column starts
-- drifting away from having one canonical form. serializeFocus() never emits
-- them, so nothing legitimate can hit this.
--
-- Same loop-and-drop-by-name shape as 0036, and idempotent for the same
-- reason: constraints have no `if not exists`, so each is dropped first. The
-- constraint NAME is unchanged, so this replaces 0036's narrower version in
-- place rather than accumulating a second one beside it.
do $$
declare
  t text;
begin
  foreach t in array array['people', 'locations', 'factions', 'items', 'monsters', 'sessions']
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I', t, t || '_image_focus_fmt');
    execute format(
      'alter table public.%I add constraint %I check (image_focus is null or image_focus ~ %L)',
      t, t || '_image_focus_fmt',
      '^(100|[0-9]{1,2}) (100|[0-9]{1,2})( (1\.[1-9]|2(\.[0-5])?))?$');
  end loop;
end $$;

-- No column, RLS, realtime or entity_hidden() work — 0036 already covers all
-- four, and widening a CHECK touches none of them. Nothing is rewritten either:
-- adding a constraint validates existing rows but does not modify them, and
-- every row 0036 could have written already satisfies the wider pattern.
