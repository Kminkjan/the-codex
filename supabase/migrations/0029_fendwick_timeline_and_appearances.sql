-- ===========================================================================
-- Fendwick: the DM's Events section as an actual timeline, and appearances
-- backed by the junction the schema derives them from.
--
-- 0028 restructured the campaign against the DM's notes but mapped only three
-- of that document's four sections onto the tables built for them:
--
--     Locations  -> public.locations   (done in 0028)
--     People     -> public.people      (done in 0028)
--     Plans      -> public.goals       (done in 0028)
--     Events     -> session summary prose   <- WRONG TABLE
--
-- `events` (0009) is "events as a first-class timeline primitive", and
-- src/events.tsx groups its rows by in_game_date — which is exactly the shape
-- of the DM's three dated blocks (Sel/Emberlain 23, Meldae/26, Xuna/27). The
-- Events page is a routed view (App.tsx), and Fendwick had zero rows in it
-- while Fist of Ilmater has 20 events and 77 event_participants. This migration
-- fills that in: 18 events with their cast.
--
-- Chronology comes from order_num, not the date string (0009's own note:
-- in_game_date is free-form text). Rows are numbered 1..18 in story order so
-- consecutive same-date events group correctly in the UI.
--
-- SECOND FIX: people.last_seen_session_id is DERIVED. 0013 feeds it from the
-- session_participants junction via the recompute_last_seen trigger, and
-- Fendwick had zero junction rows — so every pointer 0026 and 0028 wrote by
-- hand was unbacked, and the first "mark seen" tap in the app would have
-- recomputed that person's value from a junction containing only the row just
-- created, silently rewriting their history.
--
-- Note this is the repo-wide seed convention, not a Fendwick invention: the
-- Fist of Ilmater seeds hand-write 33 of 41 pointers and also leave the
-- junction empty. Only Fendwick is corrected here, deliberately — see the
-- README note this migration adds.
--
-- The junction rows below are chosen so the trigger recomputes every existing
-- pointer to the value it already had (highest-num session per person), so
-- nothing visible changes for those 16 people — the values simply become real.
-- Four people gain a pointer they should always have had: Ash Lemore and
-- Perennia Vine died in chapter 1, the False Warden and BaldRick in chapter 2.
--
-- WHO WAS AT THE TABLE FOR CHAPTERS 1-3 IS AN INFERENCE. Chapter 4's own notes
-- say "joined mid-session by Berend and Faye", and the DM's notes say Rosie, Jo
-- and Faye were *met* on the return to the Kellin Estate — so the on-screen
-- party for chapters 1-3 is taken to be Melvin, Mono, Montague and Faithbreaker.
-- If that is wrong it is four DELETEs and four INSERTs on session_participants,
-- and the trigger fixes last_seen itself. Nothing else depends on it.
--
-- Deliberately NOT here: board_positions rows for events. `events` is not one of
-- the nine KindKeys and has no CARD_SIZE entry, so an events pin would be the
-- blank-thumbtack bug 0027 documents for sessions.
--
-- Also deliberately NOT here: sessions.date. That column is the real-world play
-- date, and the charter's LAST PLAYED tile and chronicle epigraph read it — so
-- its absence is a visible hole, and leaving it is a decision rather than an
-- oversight. Fendwick's four chapters are distillations of three in-game DAYS
-- taken from the DM's notes, not transcripts of four evenings at a table; there
-- is no single play date that honestly belongs to any of them. Do not backfill
-- this by inference. If the DM later supplies real dates for real sessions, that
-- is the moment for it.
--
-- Idempotent: id'd inserts use ON CONFLICT DO NOTHING and both junctions have
-- composite primary keys, so replaying inserts nothing and re-fires no trigger.
-- ===========================================================================

-- ==========================================================================
-- 1. Events — the DM's Events section, in story order
-- ==========================================================================

insert into public.events (id, campaign_id, title, summary, in_game_date, session_id, location_id, order_num) values
  -- Sel, Emberlain 23 — chapter 1
  ('fw-e1',  'fendwick', 'The Florareum Attacked',
   'Mercenaries hit Perennia Vine''s flower shop in Fendwick. The first blood of the campaign, and the first thing that made anyone look twice at this town.',
   'Sel, Emberlain 23', 'fw-s1', 'l7', 1),

  ('fw-e2',  'fendwick', 'The Mercenaries'' Base Found',
   'The party ran the band to ground and killed them, their leader Ash Lemore included. One mercenary was kept alive and imprisoned. There was evidence of deeply unpleasant experiments at the camp.',
   'Sel, Emberlain 23', 'fw-s1', 'l6', 2),

  ('fw-e3',  'fendwick', 'Perennia Vine Killed Behind Closed Doors',
   'Perennia had hired the mercenaries herself, while being blackmailed over the illegal Halfling Weed growing beneath her shop by someone powerful and still unnamed. She was brought to Warden Chainguard, who killed her behind closed doors. Ayrton Fitzgerald''s name was dropped here for the first time.',
   'Sel, Emberlain 23', 'fw-s1', 'l1', 3),

  -- Meldae, Emberlain 26 — chapter 2
  ('fw-e4',  'fendwick', 'The Flower Fields Saved',
   'The fields around Fendwick — the town''s living — were being ruined by some sort of poison or toxin, and the party stopped it. Nobody has been placed at it. Ash Lemore had been dead three days.',
   'Meldae, Emberlain 26', 'fw-s2', 'l17', 4),

  ('fw-e5',  'fendwick', 'The False Warden Falls',
   'The thing wearing Warden Chainguard''s face was fought and killed, along with two Legionnaires who also turned out to be demons.',
   'Meldae, Emberlain 26', 'fw-s2', 'l1', 5),

  ('fw-e6',  'fendwick', 'Chainguard''s Investigation Found',
   'The party searched the Warden''s house and found her own private investigation — into Grand Warden Ayrton Fitzgerald. His name, for the second time.',
   'Meldae, Emberlain 26', 'fw-s2', 'l16', 6),

  ('fw-e7',  'fendwick', 'The Kellin Estate Investigation Begins',
   'Attention turned to the abandoned mansion outside town.',
   'Meldae, Emberlain 26', 'fw-s2', 'l4', 7),

  -- Xuna, Emberlain 27 — chapter 3
  ('fw-e8',  'fendwick', 'The Kellin Estate Cleared',
   'Very early morning. The party cleared the mansion and found a teleportation circle hidden in the basement.',
   'Xuna, Emberlain 27', 'fw-s3', 'l4', 8),

  ('fw-e9',  'fendwick', 'The Impersonator''s Journal Recovered',
   'A journal written by the impersonator demon, and it named Fitzgerald. Three implications, on three consecutive days, and never once direct.',
   'Xuna, Emberlain 27', 'fw-s3', 'l4', 9),

  ('fw-e10', 'fendwick', 'The Real Warden Found Alive',
   'Warden Hadoline Chainguard was found in the Estate — badly injured and unconscious, after being abducted and impersonated by demons.',
   'Xuna, Emberlain 27', 'fw-s3', 'l4', 10),

  ('fw-e11', 'fendwick', 'Chainguard Delivered to Dr. Ivory',
   'She was carried to the barracks to be treated. She has not woken since. Everything she knows is still inside her.',
   'Xuna, Emberlain 27', 'fw-s3', 'l10', 11),

  ('fw-e12', 'fendwick', 'Marduke Writes to the Council of Toringale',
   'The party told the Mayor everything. He sent letters by magical bird — Aeralis — to the Council of Toringale, and gave the party a copy to carry personally in case the originals are intercepted.',
   'Xuna, Emberlain 27', 'fw-s3', 'l1', 12),

  ('fw-e13', 'fendwick', 'A Long Rest',
   'From early morning to early afternoon. The hinge between chapters three and four.',
   'Xuna, Emberlain 27', 'fw-s3', 'l1', 13),

  -- Xuna, Emberlain 27 — chapter 4
  ('fw-e14', 'fendwick', 'Berend and Ezra Part Ways',
   'Ezra judged herself too hurt to take an active part and sent Berend to join the party instead, believing their cause would benefit her employer — whom Berend knows nothing about. She left for Toringale.',
   'Xuna, Emberlain 27', 'fw-s8', 'l1', 14),

  ('fw-e15', 'fendwick', 'The Return to the Kellin Estate',
   'The party went back to bury the bodies and set a trap. The big demon died as Faye and Berend arrived — Melvin tore strips off his own cape to contract them both on the spot. The helmed beast was unhelmed and proved buffalo-headed, and Mono opened up two of the lesser demons.',
   'Xuna, Emberlain 27', 'fw-s8', 'l4', 15),

  ('fw-e16', 'fendwick', 'Derin Zepper Found in the Circle',
   'A young half-orc boy with a broken leg, sent from a Toringale warehouse to check whether the coast was clear. A spell on him let a scary masked man hear everything he said. The party watched the circle for four hours and nothing came through.',
   'Xuna, Emberlain 27', 'fw-s8', 'l4', 16),

  ('fw-e17', 'fendwick', 'The Windriders Drop Out of the Sky',
   'Six flying, panther-like mounts came down outside Fendwick — Section Commander Alivar Thalin and five Legionnaires of the 7th Windriders, Lightning Section, magically informed to aid Fendwick while on patrol further south. Melvin told them everything, Fitzgerald included; Alivar reacted slightly to the name.',
   'Xuna, Emberlain 27', 'fw-s8', 'l1', 17),

  ('fw-e18', 'fendwick', 'Thalin''s Offer',
   'Early evening, in the missing commander''s office. Thalin offered to bury the party''s names under piles of bureaucratic bullshit so they could go off-record and investigate Fitzgerald. Melvin counter-offered faking all of their deaths at the mansion. Thalin gave them the night to sleep on it.',
   'Xuna, Emberlain 27', 'fw-s8', 'l10', 18)
on conflict (id) do nothing;

-- ==========================================================================
-- 2. Event participants — who was present
--
-- The party for the beats they were at, plus the NPCs the notes place in the
-- room. Deliberately excludes people who were the *subject* of an event without
-- being present at it (the Masked Man heard fw-e16 through Derin but was not
-- there; Fitzgerald is named at fw-e3/e6/e9 and present at none of them).
-- ==========================================================================

insert into public.event_participants (campaign_id, event_id, person_id)
select 'fendwick', v.event_id, v.person_id
from (values
  -- Chapter 1: the on-screen party is Melvin, Mono, Montague, Faithbreaker
  ('fw-e1',  'p18'), ('fw-e1',  'p23'), ('fw-e1',  'p24'), ('fw-e1',  'p25'),
  ('fw-e1',  'p8'),
  ('fw-e2',  'p18'), ('fw-e2',  'p23'), ('fw-e2',  'p24'), ('fw-e2',  'p25'),
  ('fw-e2',  'p7'),  ('fw-e2',  'p29'),
  ('fw-e3',  'p8'),  ('fw-e3',  'p15'),
  -- Chapter 2
  ('fw-e4',  'p18'), ('fw-e4',  'p23'), ('fw-e4',  'p24'), ('fw-e4',  'p25'),
  ('fw-e5',  'p18'), ('fw-e5',  'p23'), ('fw-e5',  'p24'), ('fw-e5',  'p25'),
  ('fw-e5',  'p15'), ('fw-e5',  'p16'),
  ('fw-e6',  'p18'), ('fw-e6',  'p23'), ('fw-e6',  'p24'), ('fw-e6',  'p25'),
  ('fw-e7',  'p18'), ('fw-e7',  'p23'), ('fw-e7',  'p24'), ('fw-e7',  'p25'),
  -- Chapter 3
  ('fw-e8',  'p18'), ('fw-e8',  'p23'), ('fw-e8',  'p24'), ('fw-e8',  'p25'),
  ('fw-e9',  'p18'), ('fw-e9',  'p23'), ('fw-e9',  'p24'), ('fw-e9',  'p25'),
  ('fw-e10', 'p18'), ('fw-e10', 'p23'), ('fw-e10', 'p24'), ('fw-e10', 'p25'),
  ('fw-e10', 'p13'),
  ('fw-e11', 'p18'), ('fw-e11', 'p23'), ('fw-e11', 'p24'), ('fw-e11', 'p25'),
  ('fw-e11', 'p13'), ('fw-e11', 'p14'),
  ('fw-e12', 'p18'), ('fw-e12', 'p23'), ('fw-e12', 'p24'), ('fw-e12', 'p25'),
  ('fw-e12', 'p11'), ('fw-e12', 'p28'),
  ('fw-e13', 'p18'), ('fw-e13', 'p23'), ('fw-e13', 'p24'), ('fw-e13', 'p25'),
  -- Chapter 4
  ('fw-e14', 'p19'), ('fw-e14', 'p17'),
  ('fw-e15', 'p18'), ('fw-e15', 'p19'), ('fw-e15', 'p20'), ('fw-e15', 'p21'),
  ('fw-e15', 'p22'), ('fw-e15', 'p23'), ('fw-e15', 'p24'), ('fw-e15', 'p25'),
  ('fw-e16', 'p18'), ('fw-e16', 'p19'), ('fw-e16', 'p20'), ('fw-e16', 'p21'),
  ('fw-e16', 'p22'), ('fw-e16', 'p23'), ('fw-e16', 'p24'), ('fw-e16', 'p25'),
  ('fw-e16', 'p1'),
  ('fw-e17', 'p18'), ('fw-e17', 'p19'), ('fw-e17', 'p20'), ('fw-e17', 'p21'),
  ('fw-e17', 'p22'), ('fw-e17', 'p23'), ('fw-e17', 'p24'), ('fw-e17', 'p25'),
  ('fw-e17', 'p5'),
  ('fw-e18', 'p18'), ('fw-e18', 'p19'), ('fw-e18', 'p20'), ('fw-e18', 'p21'),
  ('fw-e18', 'p22'), ('fw-e18', 'p23'), ('fw-e18', 'p24'), ('fw-e18', 'p25'),
  ('fw-e18', 'p5')
) as v(event_id, person_id)
on conflict (event_id, person_id) do nothing;

-- ==========================================================================
-- 3. Session participants — the junction last_seen is derived from
--
-- Inserting here fires recompute_last_seen (0013) per person, which sets
-- last_seen_session_id to the highest-num session that person appears in. The
-- rows are chosen so all 16 existing hand-written pointers recompute to exactly
-- the value they already hold, and the four dead gain the chapter they died in.
-- ==========================================================================

insert into public.session_participants (campaign_id, session_id, person_id)
select 'fendwick', v.session_id, v.person_id
from (values
  -- Chapters 1-3: the on-screen party (see the header's inference note)
  ('fw-s1', 'p18'), ('fw-s1', 'p23'), ('fw-s1', 'p24'), ('fw-s1', 'p25'),
  ('fw-s2', 'p18'), ('fw-s2', 'p23'), ('fw-s2', 'p24'), ('fw-s2', 'p25'),
  ('fw-s3', 'p18'), ('fw-s3', 'p23'), ('fw-s3', 'p24'), ('fw-s3', 'p25'),
  -- Chapter 4: the full table, Berend and Faye joining mid-session
  ('fw-s8', 'p18'), ('fw-s8', 'p19'), ('fw-s8', 'p20'), ('fw-s8', 'p21'),
  ('fw-s8', 'p22'), ('fw-s8', 'p23'), ('fw-s8', 'p24'), ('fw-s8', 'p25'),
  -- NPCs, by the chapter they were on screen in
  ('fw-s1', 'p7'),   -- Ash Lemore, killed at the base
  ('fw-s1', 'p8'),   -- Perennia Vine, killed behind closed doors
  ('fw-s1', 'p15'),  -- the False Warden, who killed her
  ('fw-s1', 'p29'),  -- the mercenary taken alive
  ('fw-s2', 'p15'),  -- the False Warden, killed
  ('fw-s2', 'p16'),  -- BaldRick, one of the two demon Legionnaires
  ('fw-s3', 'p13'),  -- Warden Chainguard, found alive
  ('fw-s3', 'p14'),  -- Dr. Ivory, who took her in
  ('fw-s3', 'p11'),  -- Mayor Marduke
  ('fw-s3', 'p28'),  -- Aeralis, carrying the letters
  ('fw-s8', 'p1'),   -- Derin Zepper
  ('fw-s8', 'p5'),   -- Alivar Thalin
  ('fw-s8', 'p14'),  -- Dr. Ivory, who pointed Berend at the mansion
  ('fw-s8', 'p17'),  -- Ezra
  ('fw-s8', 'p26')   -- the Masked Man, speaking through Derin
) as v(session_id, person_id)
on conflict (session_id, person_id) do nothing;

-- ==========================================================================
-- 4. Connections — hang the timeline off the codex
--
-- Events are a legitimate connections endpoint (findEntity falls through the
-- campaign's collections), and deriveRelations already turns events.location_id
-- into an FK edge — so nothing below duplicates a location a row already
-- carries. These are the links the FK columns cannot express.
-- ==========================================================================

insert into public.connections (campaign_id, from_id, to_id, label)
select v.campaign_id, v.from_id, v.to_id, v.label
from (values
  ('fendwick', 'fw-e3',  'p4',  'first named'),
  ('fendwick', 'fw-e6',  'p4',  'named a second time'),
  ('fendwick', 'fw-e9',  'p4',  'named a third time'),
  ('fendwick', 'fw-e3',  'i1',  'motivated by'),
  ('fendwick', 'fw-e6',  'i5',  'recovered'),
  ('fendwick', 'fw-e9',  'i2',  'recovered'),
  ('fendwick', 'fw-e12', 'i4',  'produced'),
  ('fendwick', 'fw-e12', 'f5',  'addressed'),
  ('fendwick', 'fw-e2',  'f6',  'destroyed'),
  ('fendwick', 'fw-e8',  'lo9', 'uncovered'),
  ('fendwick', 'fw-e15', 'm3',  'killed'),
  ('fendwick', 'fw-e15', 'm1',  'unhelmed'),
  ('fendwick', 'fw-e15', 'm2',  'dissected'),
  ('fendwick', 'fw-e16', 'p26', 'overheard by'),
  ('fendwick', 'fw-e17', 'f4',  'introduced'),
  ('fendwick', 'fw-e18', 'q1',  'opened'),
  ('fendwick', 'fw-e18', 'q7',  'opened'),
  ('fendwick', 'fw-e4',  'lo2', 'resolved')
) as v(campaign_id, from_id, to_id, label)
where not exists (
  select 1 from public.connections c
  where c.campaign_id = v.campaign_id
    and c.from_id     = v.from_id
    and c.to_id       = v.to_id
    and c.label       = v.label
);
