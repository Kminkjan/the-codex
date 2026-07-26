-- ===========================================================================
-- Fendwick board curation after session 8 (follow-up to 0026).
--
-- 0026 recorded the session but left every new row off the notice board, since
-- board membership is a board_positions row and nothing auto-assigns one
-- (src/boardLayout.ts findFreeSpot is only called from the app's "Pin new" and
-- the detail sheet's ON BOARD toggle). This migration puts the session-8 cast
-- and its live threads on the board, then does the archive/triage pass.
--
-- Why the pins matter: "Tidy the Codex" (src/cleanupPanel.tsx) seeds its
-- "kept alive by association" set ONLY from people whose last_seen is in the
-- recent session window and quests whose session is in it. Sessions 1-7 are
-- empty placeholders, so only session 8's rows seed it and anything more than
-- one hop away looks abandoned — today the panel proposes archiving 22 rows,
-- including The Conspiracy, the missing commander, and the demon's diary.
-- `pinned` is the documented exemption (cleanupPanel.tsx: skip = isArchived ||
-- isPinned), so pinning the party and the campaign's spine is what stops that,
-- not archiving. The whole party would otherwise become archive-suggestable the
-- moment session 8 drops out of the window.
--
-- Deliberately NOT here: a board_positions row for fw-s8. `sessions` is a
-- KindKey and a legitimate connections endpoint, but CardBody's switch
-- (src/components.tsx) has no sessions case and falls through to
-- `default: return null`, so a session pin renders as a blank thumbtack. The
-- session gets connections (relations rail) and no board card.
--
-- Idempotent: board_positions is upserted on its primary key, flags are
-- straight assignments, connection inserts are NOT EXISTS-guarded and the
-- deletes are naturally repeatable.
-- ===========================================================================

-- ==========================================================================
-- 1. Board: the session-8 cast and its live threads
--
-- Coordinates were computed against the 38 existing cards using the repo's own
-- CARD_SIZE table and findFreeSpot's overlap rule (24px pad), laid out as a
-- 5-wide block anchored at (2540, 260). Verified 0 overlaps across all 55
-- cards. Run "Tidy board" afterwards to recluster — Louvain will pull the
-- party into its own sphere off the shared faction/location edges.
-- ==========================================================================

insert into public.board_positions (campaign_id, entity_id, kind, x, y, rot) values
  -- The party
  ('fendwick', 'p18', 'people',    2540,  260, -3),  -- Melvin
  ('fendwick', 'p19', 'people',    2800,  260,  2),  -- Berend
  ('fendwick', 'p20', 'people',    3060,  260, -1),  -- Faye
  ('fendwick', 'p21', 'people',    3320,  260,  3),  -- Rosie
  ('fendwick', 'p22', 'people',    3580,  260, -2),  -- Jo
  ('fendwick', 'p23', 'people',    2540,  620,  1),  -- Montague
  ('fendwick', 'p24', 'people',    2800,  620, -3),  -- Mono
  ('fendwick', 'p25', 'people',    3060,  620,  2),  -- Faithbreaker
  -- New supporting cast
  ('fendwick', 'p17', 'people',    3320,  620,  0),  -- Ezra
  ('fendwick', 'f4',  'factions',  2540,  980,  1),  -- 7th Windriders
  ('fendwick', 'l10', 'locations', 2760,  980, -2),  -- Fendwick Barracks
  ('fendwick', 'i3',  'items',     3010,  980,  3),  -- Melvin's Cape
  ('fendwick', 'lo5', 'lore',      3220,  980, -1),  -- What's Inside a Demon
  -- Live threads
  ('fendwick', 'q7',  'quests',    2540, 1240,  2),  -- Alivar's binary choice
  ('fendwick', 'q9',  'quests',    2820, 1240, -3),  -- Who is Ezra's employer?
  ('fendwick', 'q11', 'quests',    3100, 1240,  1),  -- Mr. Orin's "shipment"
  ('fendwick', 'q12', 'quests',    3380, 1240,  0)   -- Has Orin heard everything?
on conflict (campaign_id, entity_id) do update
  set kind = excluded.kind, x = excluded.x, y = excluded.y, rot = excluded.rot;

-- ==========================================================================
-- 2. Pins: the party, and the spine Tidy keeps mis-flagging
-- ==========================================================================

-- The whole party. Never an archive candidate.
update public.people set pinned = true
where campaign_id = 'fendwick' and id in ('p18','p19','p20','p21','p22','p23','p24','p25');

-- The missing commander — an open mystery, and Alivar just took his office.
update public.people set pinned = true
where campaign_id = 'fendwick' and id = 'p10';

update public.factions set pinned = true where campaign_id = 'fendwick' and id = 'f1';  -- The Conspiracy
update public.items    set pinned = true where campaign_id = 'fendwick' and id = 'i2';  -- The Demon's Diary
update public.locations set pinned = true where campaign_id = 'fendwick' and id = 'l3'; -- Spireholm
update public.lore     set pinned = true where campaign_id = 'fendwick' and id = 'lo3'; -- The Conspiracy

-- ==========================================================================
-- 3. Life status for the confirmed dead
--
-- Only the three the codex actually records as dead: p7 "Deceased", p8
-- "Murdered by the fake Chainguard", p15 "Killed by the Fendwick
-- Legionnaires". p16 Jailguard BaldRick is left alone on purpose — nothing in
-- the record says the demon died, and guessing would invent a fact.
--
-- They stay unarchived: p7 anchors open quest q5 and p15 anchors q6.
-- ==========================================================================

update public.people set status = 'dead'
where campaign_id = 'fendwick' and id in ('p7','p8','p15');

-- ==========================================================================
-- 4. Colour, not cast — demote instead of archiving
--
-- `background` tier drops a person from Tidy's suggestions and from the default
-- view of BOTH browse surfaces: the board (board.tsx `visible()`) and the People
-- page (KindList, board.tsx — `if (!showBackground) visible = visible.filter(...)`,
-- bypassed by picking the tier facet explicitly). Each sits behind its own
-- reveal — "Show background people" on the board, "show N background folk" on
-- the page — and the two toggles are separate local state, so revealing one does
-- not reveal the other. They stay fully searchable in ⌘K, which applies no tier
-- filter at all.
-- ==========================================================================

update public.people set tier = 'background'
where campaign_id = 'fendwick' and id in ('p9','p12');  -- Donald & Turnip, Ol' Man Ol' Fellar

-- ==========================================================================
-- 5. Archive the two genuinely closed threads
--
-- Perenia is dead, the cellar was found, and nothing open points at either.
-- Archiving is declutter only: both stay searchable and linkable, and their
-- board_positions rows deliberately survive so unarchiving restores the card.
-- ==========================================================================

update public.items     set archived = true where campaign_id = 'fendwick' and id = 'i1';  -- Halfling Weed
update public.locations set archived = true where campaign_id = 'fendwick' and id = 'l7';  -- Florareum

-- ==========================================================================
-- 6. Drop the redundant party-faction strings
--
-- Each PC carries faction_id = 'f3', which deriveRelations already turns into a
-- weight-3 "member of" edge (FACTION_WEIGHT). A manual connection on the same
-- pair suppresses that FK edge (relations.ts: `if (manualPairs.has(pk)) return`)
-- and replaces it with a weight-2 manual edge — so these five hand-written
-- "member of" strings actively downgrade the party's strongest link while
-- saying nothing the FK doesn't.
--
-- Melvin's "interim commander of" and Berend's/Faye's "contracted to" are KEPT:
-- those labels carry information the FK cannot express.
-- ==========================================================================

delete from public.connections
where campaign_id = 'fendwick' and to_id = 'f3' and label = 'member of'
  and from_id in ('p21','p22','p23','p24','p25');

-- ==========================================================================
-- 7. Session 8's connections
--
-- Sessions are a supported connections endpoint: findEntity falls through to
-- campaign.sessions, and the detail sheet's relations rail renders a "Sessions"
-- group of clickable chips. This gives fw-s8 a proper web instead of a session
-- row nothing points at.
--
-- The three monsters are deliberately left out: they already carry `reveal`
-- rows in session_events, which the detail sheet mines for its "revealed in"
-- chips, so a connection would duplicate that link.
-- ==========================================================================

insert into public.connections (campaign_id, from_id, to_id, label)
select v.campaign_id, v.from_id, v.to_id, v.label
from (values
  ('fendwick', 'fw-s8', 'l1',  'takes place at'),
  ('fendwick', 'fw-s8', 'l4',  'takes place at'),
  ('fendwick', 'fw-s8', 'p17', 'introduced'),
  ('fendwick', 'fw-s8', 'p5',  'introduced'),
  ('fendwick', 'fw-s8', 'f4',  'introduced'),
  ('fendwick', 'fw-s8', 'i3',  'introduced'),
  ('fendwick', 'fw-s8', 'l9',  'introduced'),
  ('fendwick', 'fw-s8', 'l10', 'introduced'),
  ('fendwick', 'fw-s8', 'p19', 'recruited'),
  ('fendwick', 'fw-s8', 'p20', 'recruited'),
  ('fendwick', 'fw-s8', 'q7',  'opened'),
  ('fendwick', 'fw-s8', 'q8',  'opened'),
  ('fendwick', 'fw-s8', 'q9',  'opened'),
  ('fendwick', 'fw-s8', 'q10', 'opened'),
  ('fendwick', 'fw-s8', 'q11', 'opened'),
  ('fendwick', 'fw-s8', 'q12', 'opened'),
  ('fendwick', 'fw-s8', 'lo4', 'recorded'),
  ('fendwick', 'fw-s8', 'lo5', 'recorded'),
  ('fendwick', 'fw-s8', 'lo6', 'recorded'),
  -- Who established each piece of lore. These also give lo5/lo6 a direct edge
  -- to a person last seen in session 8, which is what keeps them out of Tidy's
  -- suggestions (a session edge does not confer that — sessions never seed
  -- touchedByRecent).
  ('fendwick', 'lo5',   'p24', 'worked out by'),
  ('fendwick', 'lo6',   'p25', 'recalled by')
) as v(campaign_id, from_id, to_id, label)
where not exists (
  select 1 from public.connections c
  where c.campaign_id = v.campaign_id
    and c.from_id     = v.from_id
    and c.to_id       = v.to_id
    and c.label       = v.label
);
