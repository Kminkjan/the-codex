-- Replace the Ember Accord demo seed with the real Fendwick campaign.
-- Adds people.image_url and a public `portraits` storage bucket.

-- ==========================================================================
-- Schema change
-- ==========================================================================

alter table public.people add column if not exists image_url text;

-- ==========================================================================
-- Storage bucket for character portraits (public read)
-- ==========================================================================

insert into storage.buckets (id, name, public)
values ('portraits', 'portraits', true)
on conflict (id) do nothing;

-- Public buckets already serve individual object URLs without an extra
-- SELECT policy on storage.objects; we intentionally skip one to avoid
-- granting list-bucket-contents access.

-- ==========================================================================
-- Wipe the old Ember Accord seed (CASCADE handles dependent rows)
-- ==========================================================================

delete from public.campaigns where id = 'ember-accord';

-- ==========================================================================
-- Seed: The Fendwick Investigation
-- ==========================================================================

insert into public.campaigns (id, title, subtitle) values
  ('fendwick', 'The Fendwick Investigation', 'A conspiracy traced from a rural town to the throne');

insert into public.factions (id, campaign_id, name, sigil, "desc", allegiance) values
  ('f1', 'fendwick', 'The Conspiracy',        'C',  'A group influencing events in the Alderin Kingdom from the shadows.',                                'Hostile'),
  ('f2', 'fendwick', 'Falcon Legion',         'F',  'Law enforcement and military of the Alderin Kingdom.',                                                'Neutral'),
  ('f3', 'fendwick', 'Fendwick Legionnaires', 'FL', 'The party — de facto town militia, pieced together from reluctant locals and stranded Falcon Legion.', 'Ally');

insert into public.locations (id, campaign_id, name, kind, "desc", region, ruler, notes) values
  ('l1', 'fendwick', 'Fendwick',              'Town',          'Rural town where the campaign started. Flowerfields, a tavern, and more trouble than it has any right to hold.', 'Alderin Kingdom',  'Mayor Avil Marducke',  'The fields were being poisoned. Not everyone in the town guard is who they claim to be.'),
  ('l2', 'fendwick', 'Toringale',             'City',          'One of the three major cities in the Alderin Kingdom.',                                                         'Alderin Kingdom',  null,                   'Warden Chainguard was investigating Grand Warden Fitzgerald here before her abduction.'),
  ('l3', 'fendwick', 'Spireholm',             'Capital City',  'Capital of the Alderin Kingdom, west of Fendwick, near the coast.',                                             'Alderin Kingdom',  'King Barillon Alderin', 'Seat of the crown and the Falcon Legion high command.'),
  ('l4', 'fendwick', 'Kellin Estate',         'Ruin',          'Decrepit mansion with a teleportation circle hidden in the basement. Fought ghouls and beastmen here.',          'Outside Fendwick', null,                   'Darren was teleported here. Warden Chainguard was found alive in the basement after the false warden was killed.'),
  ('l5', 'fendwick', 'Warehouse in Toringale','Warehouse',     'Where Darren worked before being teleported to Fendwick.',                                                      'Toringale',        null,                   'Connected to Mr. Orin''s operation.'),
  ('l6', 'fendwick', 'Bandit Hideout',        'Hideout',       'Camp where Ash Lemore was run to ground. Evidence of deeply unpleasant experiments.',                            'Outside Fendwick', null,                   'Possible human experimentation — unresolved.'),
  ('l7', 'fendwick', 'Florareum',             'Building',      'Perenia Fine''s flower shop in Fendwick. Halfling weed was being grown beneath it.',                             'Fendwick',         'Perenia Fine (dec.)', null),
  ('l8', 'fendwick', 'The Yeasting Barrel',   'Tavern',        'Fendwick''s tavern — where we met Ol'' Man Ol'' Fellar.',                                                        'Fendwick',         null,                   null);

insert into public.people (id, campaign_id, name, epithet, race, role, disposition, alignment, location_id, faction_id, last_seen_session_id, image_url, notes) values
  ('p1',  'fendwick', 'Darren',                    'The Scout Boy',           'Half-elf',  'Conscripted scout',                       'ally',    'Neutral Good',      'l1', null, null, 'https://nsemknuzupcnvctevgfd.supabase.co/storage/v1/object/public/portraits/darren.png', 'Young boy enlisted by the Conspiracy via Mr. Orin. Teleported from the Toringale warehouse to Kellin Estate. Wants to go home to his sick mother.'),
  ('p2',  'fendwick', 'King Barillon Alderin',     null,                      'Human',     'Ruler of the Alderin Kingdom',            'unknown', 'Lawful Neutral',    'l3', null, null, null, 'Unclear how deep the Conspiracy reaches toward the throne.'),
  ('p3',  'fendwick', 'Mr. Orin',                  null,                      'Human',     'Spellcaster; Conspiracy handler',         'hostile', 'Neutral Evil',      'l2', 'f1', null, null, 'Enlisted Darren and used him to scout the mansion. Whereabouts unknown.'),
  ('p4',  'fendwick', 'Grand Warden Fitzgerald',   'High Judge of Toringale', 'Human',     'Highest judge of Toringale',              'unknown', 'Lawful Neutral',    'l2', null, null, null, 'Was under investigation by Warden Chainguard before her abduction. Named in a diary found in Kellin Estate — in the demon''s hand.'),
  ('p5',  'fendwick', 'Alivar Thalin',             'Section Commander',       'Human',     '7th Windriders, Lightning Section',       'ally',    'Lawful Good',       'l1', 'f2', null, null, 'Sent to reinforce Fendwick, allegedly by Wingleader Domar. Has hunted traitors in the Legion for 24 years. Asked the party to go undercover in Toringale.'),
  ('p6',  'fendwick', 'Wingleader Domar',          null,                      'Human',     'Wingleader, Falcon Legion',               'unknown', 'Lawful Neutral',    'l3', 'f2', null, null, 'Allegedly sent Alivar Thalin. Who told him about the disturbances in Fendwick?'),
  ('p7',  'fendwick', 'Ash Lemore',                'The Poisoner (dec.)',     'Human',     'Bandit',                                  'hostile', 'Chaotic Evil',      'l6', null, null, null, 'Poisoned Fendwick''s fields. Blackmailed Perenia Fine. Deceased. Who was he working for?'),
  ('p8',  'fendwick', 'Perenia Fine',              'Proprietor (dec.)',       'Halfling',  'Proprietor of the Florareum',             'unknown', 'Chaotic Neutral',   'l7', null, null, null, 'Blackmailed by the Conspiracy. Growing halfling weed in the cellar. Murdered by the fake Chainguard.'),
  ('p9',  'fendwick', 'Donald & Turnip',           'Two Dimwits',             'Human',     'Legionnaires stationed in Fendwick',      'ally',    'Chaotic Neutral',   'l1', 'f2', null, null, 'Two dimwitted Legionnaires. Reluctantly help the Fendwick Legionnaires.'),
  ('p10', 'fendwick', 'Commander Blackstow',       null,                      'Human',     'Local Falcon Legion commander',           'unknown', 'Lawful Neutral',    'l1', 'f2', null, null, 'Absent for several days. Nobody has said where.'),
  ('p11', 'fendwick', 'Mayor Avil Marducke',       'Mayor of Fendwick',       'Human',     'Mayor',                                   'ally',    'Lawful Good',       'l1', null, null, null, 'Assisted the party in the investigation around Fendwick.'),
  ('p12', 'fendwick', 'Ol'' Man Ol'' Fellar',      'The Local',               'Human',     'Tavern regular',                          'ally',    'Chaotic Good',      'l8', 'f3', null, null, 'Local met in the Yeasting Barrel. The main character, per his own account.'),
  ('p13', 'fendwick', 'Warden Chainguard',         'Judge of Fendwick',       'Human',     'Judge of Fendwick',                       'ally',    'Lawful Good',       'l1', null, null, null, 'Abducted and tortured by a doppelganger. Found alive in Kellin Estate after the false warden was killed. Had been investigating Fitzgerald.'),
  ('p14', 'fendwick', 'Dr. Ivory',                 null,                      'Human',     'Fendwick doctor',                         'ally',    'Neutral Good',      'l1', null, null, null, 'Local doctor. Treated the real Warden Chainguard after her rescue.'),
  ('p15', 'fendwick', 'Fake Warden',               'Doppelganger (dec.)',     'Doppelganger', 'Impostor',                             'hostile', 'Neutral Evil',      'l1', 'f1', null, null, 'Replaced and tortured Warden Chainguard. Murdered Perenia Fine. Killed by the Fendwick Legionnaires.'),
  ('p16', 'fendwick', 'Jailguard BaldRick',        'The Demon',               'Demon',     'Impersonated a Legionnaire',              'hostile', 'Chaotic Evil',      'l1', 'f1', null, null, 'A cunt that turned out to be a demon. Was impersonating a Legionnaire.');

insert into public.quests (id, campaign_id, title, status, reward, giver_id, session_id, "desc", hooks) values
  ('q1', 'fendwick', 'Infiltrate and investigate in Toringale',              'pursuing',  'Alivar''s trust · a lead on the Conspiracy',    'p5', null, 'Go undercover in Toringale at Section Commander Alivar Thalin''s request. Find out what Chainguard found — and who buried it.', 'Fitzgerald is the obvious target, but Chainguard''s investigation was buried for a reason. Start at the warehouse where Darren worked.'),
  ('q2', 'fendwick', 'Why did Chainguard suspect Fitzgerald?',               'whispered', 'Unknown',                                       'p13', null, 'Warden Chainguard was investigating Grand Warden Fitzgerald before her abduction. Fitzgerald is also named by the demon in its diary, recovered from Kellin Estate.', null),
  ('q3', 'fendwick', 'Who told Domar about the disturbances in Fendwick?',   'whispered', 'Unknown',                                       null, null, 'Alivar was sent to Fendwick allegedly by Wingleader Domar. But how did Domar hear about it at all?', null),
  ('q4', 'fendwick', 'Does Alivar''s timeline check out?',                   'whispered', 'Unknown',                                       null, null, 'The dates of the events in Fendwick and Alivar''s reaction time do not obviously line up. Verify.', null),
  ('q5', 'fendwick', 'Who was Ash Lemore working for?',                      'whispered', 'Unknown',                                       null, null, 'Ash poisoned the flowerfields and blackmailed Perenia Fine. He was not acting alone.', null),
  ('q6', 'fendwick', 'Who ordered the doppelganger to disturb Fendwick?',    'whispered', 'Unknown',                                       null, null, 'The fake warden didn''t pick Fendwick by accident. Find the hand behind it.', null);

insert into public.items (id, campaign_id, name, kind, "desc") values
  ('i1', 'fendwick', 'Halfling Weed',      'Contraband', 'An illegal substance Perenia Fine was growing beneath the Florareum.'),
  ('i2', 'fendwick', 'The Demon''s Diary', 'Document',   'Recovered from Kellin Estate. Written by the demon impersonating BaldRick. Names Grand Warden Fitzgerald in passing.');

insert into public.lore (id, campaign_id, title, text) values
  ('lo1', 'fendwick', 'The Alderin Kingdom',           'A kingdom of three major cities — Spireholm, Toringale, and one more — ruled by King Barillon Alderin and policed by the Falcon Legion.'),
  ('lo2', 'fendwick', 'Poisoning of the Flowerfields', 'The fields around Fendwick were discovered to be poisoned. Ash Lemore was the hand; the mind behind him is not yet known.'),
  ('lo3', 'fendwick', 'The Conspiracy',                'A shadow network reaching into Toringale''s courts and possibly the Falcon Legion itself. Uses doppelgangers, demons, and blackmail. Enlists the desperate — Darren, Perenia — as disposable tools.');

insert into public.connections (campaign_id, from_id, to_id, label) values
  ('fendwick', 'p1',  'p3',  'enlisted by'),
  ('fendwick', 'p1',  'l4',  'teleported to'),
  ('fendwick', 'p1',  'l5',  'worked at'),
  ('fendwick', 'p3',  'f1',  'agent of'),
  ('fendwick', 'p3',  'l2',  'operates out of'),
  ('fendwick', 'f1',  'p2',  'influences'),
  ('fendwick', 'f1',  'p4',  'suspected member'),
  ('fendwick', 'f1',  'l2',  'operates in'),
  ('fendwick', 'p4',  'l2',  'presides over'),
  ('fendwick', 'p4',  'i2',  'named in'),
  ('fendwick', 'p13', 'p4',  'was investigating'),
  ('fendwick', 'p13', 'l4',  'held captive at'),
  ('fendwick', 'p13', 'p14', 'treated by'),
  ('fendwick', 'p5',  'p6',  'sent by'),
  ('fendwick', 'p5',  'f2',  'officer of'),
  ('fendwick', 'p5',  'q1',  'assigned'),
  ('fendwick', 'p6',  'f2',  'officer of'),
  ('fendwick', 'f2',  'l3',  'based at'),
  ('fendwick', 'p10', 'f2',  'commands'),
  ('fendwick', 'p9',  'f2',  'stationed with'),
  ('fendwick', 'p9',  'f3',  'reluctantly helps'),
  ('fendwick', 'p7',  'l6',  'hid at'),
  ('fendwick', 'p7',  'p8',  'blackmailed'),
  ('fendwick', 'p7',  'lo2', 'responsible for'),
  ('fendwick', 'p8',  'l7',  'ran'),
  ('fendwick', 'p8',  'i1',  'grew'),
  ('fendwick', 'p8',  'p15', 'murdered by'),
  ('fendwick', 'p8',  'f1',  'blackmailed by'),
  ('fendwick', 'p15', 'p13', 'replaced'),
  ('fendwick', 'p15', 'f1',  'agent of'),
  ('fendwick', 'p16', 'f1',  'agent of'),
  ('fendwick', 'p16', 'f2',  'impersonated'),
  ('fendwick', 'p11', 'l1',  'governs'),
  ('fendwick', 'p12', 'l8',  'haunts'),
  ('fendwick', 'i1',  'l7',  'grown beneath'),
  ('fendwick', 'i2',  'l4',  'found at'),
  ('fendwick', 'lo1', 'p2',  'ruled by'),
  ('fendwick', 'lo1', 'f2',  'policed by'),
  ('fendwick', 'lo2', 'l1',  'occurred at'),
  ('fendwick', 'lo3', 'f1',  'describes'),
  ('fendwick', 'q1',  'l2',  'set in'),
  ('fendwick', 'q2',  'p4',  'concerns'),
  ('fendwick', 'q3',  'p6',  'concerns'),
  ('fendwick', 'q4',  'p5',  'concerns'),
  ('fendwick', 'q5',  'p7',  'concerns'),
  ('fendwick', 'q6',  'p15', 'concerns');

insert into public.board_positions (campaign_id, entity_id, x, y, rot, kind) values
  ('fendwick', 'p1',  420,  1140, -2, 'people'),
  ('fendwick', 'p2',  1680, 180,   1, 'people'),
  ('fendwick', 'p3',  720,  700,  -3, 'people'),
  ('fendwick', 'p4',  1540, 640,   2, 'people'),
  ('fendwick', 'p5',  1960, 780,  -2, 'people'),
  ('fendwick', 'p6',  2180, 640,   3, 'people'),
  ('fendwick', 'p7',  860,  1440, -1, 'people'),
  ('fendwick', 'p8',  1180, 1760,  2, 'people'),
  ('fendwick', 'p9',  2080, 1100, -2, 'people'),
  ('fendwick', 'p10', 2300, 1100,  1, 'people'),
  ('fendwick', 'p11', 2300, 1260, -1, 'people'),
  ('fendwick', 'p12', 2300, 1420,  3, 'people'),
  ('fendwick', 'p13', 2000, 1600, -2, 'people'),
  ('fendwick', 'p14', 2300, 1600,  2, 'people'),
  ('fendwick', 'p15', 1900, 1820, -3, 'people'),
  ('fendwick', 'p16', 2180, 1820,  1, 'people'),
  ('fendwick', 'l1',  1680, 1120,  1, 'locations'),
  ('fendwick', 'l2',  820,  480,  -2, 'locations'),
  ('fendwick', 'l3',  1720, 490,   2, 'locations'),
  ('fendwick', 'l4',  820,  1160, -1, 'locations'),
  ('fendwick', 'l5',  920,  840,   2, 'locations'),
  ('fendwick', 'l6',  1140, 1440,  1, 'locations'),
  ('fendwick', 'l7',  1300, 1620, -1, 'locations'),
  ('fendwick', 'l8',  1580, 1620,  2, 'locations'),
  ('fendwick', 'f1',  1040, 120,  -2, 'factions'),
  ('fendwick', 'f2',  2000, 120,   1, 'factions'),
  ('fendwick', 'f3',  2060, 1400, -1, 'factions'),
  ('fendwick', 'q1',  1340, 290,   2, 'quests'),
  ('fendwick', 'q2',  1540, 880,  -1, 'quests'),
  ('fendwick', 'q3',  2180, 820,   2, 'quests'),
  ('fendwick', 'q4',  2040, 950,  -2, 'quests'),
  ('fendwick', 'q5',  940,  1560,  1, 'quests'),
  ('fendwick', 'q6',  2000, 1960, -1, 'quests'),
  ('fendwick', 'i1',  960,  1860,  2, 'items'),
  ('fendwick', 'i2',  1420, 770,  -2, 'items'),
  ('fendwick', 'lo1', 1400, 60,    1, 'lore'),
  ('fendwick', 'lo2', 680,  1560, -2, 'lore'),
  ('fendwick', 'lo3', 1040, 300,   2, 'lore');
