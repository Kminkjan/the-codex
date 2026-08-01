-- Challenge rating and an encounter tally on the Bestiary, for the Fist of
-- Ilmater import of the DM's ledger of enemies fought (0034).
--
-- DEVIATION, recorded on purpose: src/data.ts used to say MonsterThreat was
-- "deliberately not CR — the Bestiary is a glossary for artwork and notes, not a
-- statblock". That still holds for `threat`, which stays the coarse,
-- at-a-glance band a player reads off a plate. `cr` is added because the DM's
-- own tally records a real challenge rating for all 454 creatures the party has
-- fought, and throwing it away to keep only a band DERIVED from it would be
-- lossy. The relationship is one-directional and stays that way: cr is the
-- datum, threat is the reading (0-2 harmless, 3-7 risky, 8-16 deadly, 17+
-- legendary — crToThreat() in src/monsters.ts is the single spelling of the
-- table, shared by the app and the seed generator). Write one, write the other.
--
-- `encountered` counts individual creatures faced in total, summed across every
-- encounter — NOT the number of fights. The fight count is derivable from the
-- monster->session rows in `connections`, so it isn't stored.
--
-- Both nullable: a monster written up in the app has neither, and null has to
-- read as "unrecorded" rather than 0, because CR 0 is a real rating (Crawling
-- Claw, Stomping Foot). RLS and the realtime publication from 0024 already
-- cover this table; plain column adds need no policy work.

alter table public.monsters
  add column if not exists cr          numeric,
  add column if not exists encountered int;

-- Cheap insurance rather than trust: the detail sheet forwards whatever the
-- editor typed through toRow(), so a bad parse should surface in the existing
-- write-error toast instead of storing cr = 999. 40 clears Tarrasque (30) and
-- the epic-tier statblocks the party has met (Kas the Betrayer, 23).
alter table public.monsters
  drop constraint if exists monsters_cr_check;
alter table public.monsters
  add constraint monsters_cr_check
    check (cr is null or (cr >= 0 and cr <= 40));

alter table public.monsters
  drop constraint if exists monsters_encountered_check;
alter table public.monsters
  add constraint monsters_encountered_check
    check (encountered is null or encountered >= 0);
