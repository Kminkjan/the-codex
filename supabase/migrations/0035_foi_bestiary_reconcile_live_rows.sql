-- Reconcile the Bestiary import (0034) with rows the DM had already created in
-- the APP, which the generator could not see.
--
-- The mistake, recorded because it generalises: generate-foi-bestiary.ts builds
-- its picture of what exists by grepping the seed migrations (0011/0012). That
-- is every session the *journal* imported — not every session that exists. The
-- DM has been using the app since those seeds landed, so anything he created
-- there was invisible to the generator, and 0034 duplicated it:
--
--   * Session 192 already existed as '45993809-14f8-47ff-a52f-465f9c8390ee'
--     ("Worm Storm", played 19 July 2026). 0034 added a placeholder 'foi-s192'
--     beside it — two rows with num 192 in the Chronicle — and attached the 8
--     creatures of that fight (the Star Spawn Larva Mage and its worm storm) to
--     the empty placeholder instead of the real session.
--   * Two plates were already written up by hand, with uploaded artwork and the
--     DM's own description: Aarakocra and Aberrant Cultist. 0034 added slug-id
--     twins carrying the ledger's cr/encountered/notes, so the wall showed each
--     of them twice — once with art and no rating, once with a rating and no art.
--
-- Fixed here by MERGING toward the row a human made, never the row the script
-- made: the DM's artwork and prose are irreplaceable, the ledger's numbers are
-- regenerable. So his rows absorb cr/encountered/notes (only where his own
-- fields are null — nothing he wrote is overwritten, including his creature-type
-- call of "Humanoid" for the Aberrant Cultist), every string and reveal is
-- repointed onto his ids, and the generated twins are dropped.
--
-- Every statement is guarded on the prod-only row actually being present, which
-- is what makes this safe to replay from scratch: on a preview branch (created
-- with_data = false) none of these app-made rows exist, the guards all fall
-- through, and 0034's own output is left exactly as it is. Without the guards a
-- from-scratch replay would delete the only Aarakocra plate and repoint reveals
-- at a session id that isn't there, tripping session_events' FK.
--
-- Ordering is load-bearing in the session block: session_events.session_id is
-- ON DELETE CASCADE, so dropping the placeholder before repointing would take
-- the six reveals with it.

-- ==========================================================================
-- Session 192: fold the placeholder into the real session
-- ==========================================================================

do $$
declare
  placeholder constant text := 'foi-s192';
  real_session constant text := '45993809-14f8-47ff-a52f-465f9c8390ee';
begin
  if not exists (select 1 from public.sessions where id = real_session) then
    -- Fresh replay: the placeholder is the only session 192 there is, and it is
    -- doing exactly the job 0034 wrote it for. Leave it alone.
    return;
  end if;

  update public.connections
     set to_id = real_session
   where campaign_id = 'fist-of-ilmater' and to_id = placeholder;

  update public.connections
     set from_id = real_session
   where campaign_id = 'fist-of-ilmater' and from_id = placeholder;

  update public.session_events
     set session_id = real_session
   where campaign_id = 'fist-of-ilmater' and session_id = placeholder;

  delete from public.sessions where id = placeholder;
end $$;

-- ==========================================================================
-- The two plates the DM had already drawn
-- ==========================================================================

do $$
declare
  pair record;
begin
  for pair in
    select *
    from (values
      -- generated twin            , the DM's hand-made row (with artwork)
      ('foi-m-aarakocra',        'e60602d4-1bc5-40a3-a222-479bfa65f103'),
      ('foi-m-aberrant-cultist', 'ffcad972-9e3f-4dc9-a054-0863e7c0f428')
    ) as v(generated, kept)
  loop
    -- Both must be present: on a fresh replay only the generated row exists, and
    -- it is then the real plate.
    if not exists (select 1 from public.monsters where id = pair.kept)
       or not exists (select 1 from public.monsters where id = pair.generated) then
      continue;
    end if;

    update public.monsters keep
       set cr          = coalesce(keep.cr, gen.cr),
           encountered = coalesce(keep.encountered, gen.encountered),
           notes       = coalesce(keep.notes, gen.notes),
           threat      = coalesce(keep.threat, gen.threat),
           kind        = coalesce(keep.kind, gen.kind),
           habitat     = coalesce(keep.habitat, gen.habitat)
      from public.monsters gen
     where keep.id = pair.kept and gen.id = pair.generated;

    update public.connections
       set from_id = pair.kept
     where campaign_id = 'fist-of-ilmater' and from_id = pair.generated;

    update public.connections
       set to_id = pair.kept
     where campaign_id = 'fist-of-ilmater' and to_id = pair.generated;

    -- Repointing these is what inks the kept plate: discovery is derived from
    -- reveal rows, and the DM's hand-made plates had none, so both were sitting
    -- un-inked despite the party having fought them.
    update public.session_events
       set entity_id = pair.kept
     where campaign_id = 'fist-of-ilmater' and entity_id = pair.generated;

    update public.board_positions
       set entity_id = pair.kept
     where campaign_id = 'fist-of-ilmater' and entity_id = pair.generated
       and not exists (
         select 1 from public.board_positions b
          where b.campaign_id = 'fist-of-ilmater' and b.entity_id = pair.kept
       );

    delete from public.board_positions
     where campaign_id = 'fist-of-ilmater' and entity_id = pair.generated;
    delete from public.session_staging
     where campaign_id = 'fist-of-ilmater' and entity_id = pair.generated;
    delete from public.monsters where id = pair.generated;
  end loop;
end $$;
