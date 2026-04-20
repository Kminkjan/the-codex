-- Schema + RLS + realtime + seed for The Codex (DnD journal).
-- IDs are short text keys (p1, l1, q1, lo1, s1, ...) preserved from the original
-- hardcoded CAMPAIGN object so existing cross-references keep working.

-- ==========================================================================
-- Tables
-- ==========================================================================

create table public.campaigns (
  id text primary key,
  title text not null,
  subtitle text,
  created_at timestamptz default now()
);

create table public.sessions (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  num int not null,
  title text not null,
  date text
);

create table public.locations (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text not null,
  kind text not null,
  "desc" text,
  region text,
  ruler text,
  notes text
);

create table public.factions (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text not null,
  sigil text,
  "desc" text,
  allegiance text
);

create table public.people (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text not null,
  epithet text,
  race text,
  role text,
  disposition text,
  alignment text,
  location_id text references public.locations(id) on delete set null,
  faction_id text references public.factions(id) on delete set null,
  last_seen_session_id text references public.sessions(id) on delete set null,
  notes text
);

create table public.quests (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  title text not null,
  status text,
  reward text,
  giver_id text references public.people(id) on delete set null,
  session_id text references public.sessions(id) on delete set null,
  "desc" text,
  hooks text
);

create table public.goals (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  text text not null,
  owner text,
  kind text,
  status text
);

create table public.items (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text not null,
  kind text,
  "desc" text
);

create table public.lore (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  title text,
  text text
);

create table public.connections (
  id bigserial primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  from_id text not null,
  to_id text not null,
  label text
);

create table public.board_positions (
  campaign_id text not null references public.campaigns(id) on delete cascade,
  entity_id text not null,
  x int not null,
  y int not null,
  rot int default 0,
  kind text not null,
  primary key (campaign_id, entity_id)
);

create table public.presence_users (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  name text,
  initials text,
  color text,
  active boolean default true
);

create table public.party_notes (
  id bigserial primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  entity_id text not null,
  author text,
  when_label text,
  text text,
  hand boolean default true,
  created_at timestamptz default now()
);

-- ==========================================================================
-- RLS: anonymous read, no writes (blocked by default)
-- ==========================================================================

alter table public.campaigns       enable row level security;
alter table public.sessions        enable row level security;
alter table public.locations       enable row level security;
alter table public.factions        enable row level security;
alter table public.people          enable row level security;
alter table public.quests          enable row level security;
alter table public.goals           enable row level security;
alter table public.items           enable row level security;
alter table public.lore            enable row level security;
alter table public.connections     enable row level security;
alter table public.board_positions enable row level security;
alter table public.presence_users  enable row level security;
alter table public.party_notes     enable row level security;

create policy "anon read campaigns"        on public.campaigns       for select to anon, authenticated using (true);
create policy "anon read sessions"         on public.sessions        for select to anon, authenticated using (true);
create policy "anon read locations"        on public.locations       for select to anon, authenticated using (true);
create policy "anon read factions"         on public.factions        for select to anon, authenticated using (true);
create policy "anon read people"           on public.people          for select to anon, authenticated using (true);
create policy "anon read quests"           on public.quests          for select to anon, authenticated using (true);
create policy "anon read goals"            on public.goals           for select to anon, authenticated using (true);
create policy "anon read items"            on public.items           for select to anon, authenticated using (true);
create policy "anon read lore"             on public.lore            for select to anon, authenticated using (true);
create policy "anon read connections"      on public.connections     for select to anon, authenticated using (true);
create policy "anon read board_positions"  on public.board_positions for select to anon, authenticated using (true);
create policy "anon read presence_users"   on public.presence_users  for select to anon, authenticated using (true);
create policy "anon read party_notes"      on public.party_notes     for select to anon, authenticated using (true);

-- ==========================================================================
-- Realtime publication
-- ==========================================================================

alter publication supabase_realtime add table
  public.campaigns,
  public.sessions,
  public.locations,
  public.factions,
  public.people,
  public.quests,
  public.goals,
  public.items,
  public.lore,
  public.connections,
  public.board_positions,
  public.presence_users,
  public.party_notes;

-- ==========================================================================
-- Seed: The Ember Accord
-- ==========================================================================

insert into public.campaigns (id, title, subtitle) values
  ('ember-accord', 'The Ember Accord', 'Chronicles of the Thornbound Four');

insert into public.sessions (id, campaign_id, num, title, date) values
  ('s1', 'ember-accord', 1, 'The Crooked Tankard',     'First Frost, 1487'),
  ('s2', 'ember-accord', 2, 'Under the Salt Road',     'Second Frost, 1487'),
  ('s3', 'ember-accord', 3, 'Of Ash and Oath',         'Third Frost, 1487'),
  ('s4', 'ember-accord', 4, 'The Hollow Bell',         'First Thaw, 1488'),
  ('s5', 'ember-accord', 5, 'Embers at Blackmere',     'Second Thaw, 1488'),
  ('s6', 'ember-accord', 6, 'The Cartographer''s Debt', 'Third Thaw, 1488'),
  ('s7', 'ember-accord', 7, 'Names Writ in Salt',      'First Bloom, 1488');

insert into public.locations (id, campaign_id, name, kind, "desc", region, ruler, notes) values
  ('l1', 'ember-accord', 'Harrowgate',          'City',          'A port of salt, rope, and whispered treaties.',                                  'The Iron Coast',          'Council of Nine',             'Four gates. The fifth is locked from the inside. Nobody remembers the fifth.'),
  ('l2', 'ember-accord', 'The Ember Court',     'Seat',          'A walled keep whose banners have not changed in eight hundred years.',           'Halden Reach',            'House Halden',                'Guests must surrender their names at the threshold. They are returned upon leaving. Usually.'),
  ('l3', 'ember-accord', 'The Salt Road',       'Road',          'An ancient causeway across the marsh. The stones are older than cartography.',   'Iron Coast → Halden Reach', null,                        'Lanterns burn along it without fuel. Do not count them.'),
  ('l4', 'ember-accord', 'Blackmere Abbey',     'Ruin',          'A drowned abbey whose bells still ring at the tide''s turning.',                  'The Lowmarch',            'The Drowned Saint (disputed)', 'Bring coin for the ferryman. Do not sleep in the crypt.'),
  ('l5', 'ember-accord', 'The Thornbound Wood', 'Forest',        'A forest that refuses to be mapped; trees shift between sessions.',              'The Green Verge',         null,                          'We have camped here three times. Each time in a different grove.'),
  ('l6', 'ember-accord', 'Caerdwy Pass',        'Mountain Pass', 'The only land-crossing before winter seals the high passes.',                   'Spine of the World',      null,                          'Tolls paid to a shrine, not a gatekeeper.');

insert into public.factions (id, campaign_id, name, sigil, "desc", allegiance) values
  ('f1', 'ember-accord', 'The Ember Court',    'E',  'A secretive council that rules from shadow.',         'Neutral'),
  ('f2', 'ember-accord', 'The Long Knives',    'LK', 'A guild of contract killers and blackmailers.',       'Hostile'),
  ('f3', 'ember-accord', 'The Weeping Choir',  '✞',  'Clerics and penitents of the Drowned Saint.',         'Ally'),
  ('f4', 'ember-accord', 'House Halden',       'H',  'The last blood-line of the Ember Accord.',            'Neutral'),
  ('f5', 'ember-accord', 'The Salt Council',   'S',  'Nine merchant princes who rule Harrowgate in name.',  'Neutral');

insert into public.people (id, campaign_id, name, epithet, race, role, disposition, alignment, location_id, faction_id, last_seen_session_id, notes) values
  ('p1', 'ember-accord', 'Maerwyn Vex',        'The Ashen Envoy',       'Half-elf', 'Emissary of the Ember Court',       'wary',    'Lawful Neutral',   'l2', 'f1', 's6', 'Paid us in silver struck with no king''s mark. Left before dawn — horse unshod, tracks gone.'),
  ('p2', 'ember-accord', 'Old Bramble',        'Keeper of the Tankard', 'Dwarf',    'Innkeeper',                          'ally',    'Chaotic Good',     'l1', null, 's1', 'Knew our names before we said them. Keeps a locked ledger behind the third keg.'),
  ('p3', 'ember-accord', 'Sable Thorne',       'The Long Knife',        'Human',    'Spymaster',                          'hostile', 'Neutral Evil',     'l3', 'f2', 's5', 'Claims a debt against House Vex. Left a severed finger in Kael''s bedroll.'),
  ('p4', 'ember-accord', 'Sister Oriane',      'Of the Weeping Choir',  'Aasimar',  'Cleric of the Drowned Saint',        'ally',    'Lawful Good',      'l4', 'f3', 's4', 'Speaks only at dusk. The bells at Blackmere ring for her alone.'),
  ('p5', 'ember-accord', 'Corvin Lark',        'Cartographer',          'Human',    'Mapmaker & drunkard',                'ally',    'Chaotic Neutral',  'l1', null, 's6', 'Owes us a map of the salt roads. Owes everyone else coin.'),
  ('p6', 'ember-accord', 'Prince Erys Halden', 'The Quiet Heir',        'Human',    'Heir of the Halden Line',            'unknown', 'Lawful Neutral',   'l2', 'f4', 's3', 'Has not been seen above ground since the Crowning. Letters still arrive in his hand.'),
  ('p7', 'ember-accord', 'Grennick the Soot',  'Gutter-Prophet',        'Gnome',    'Street oracle',                      'ally',    'Chaotic Neutral',  'l1', null, 's2', 'Prophecies only come at the bottom of a tankard. Usually right.');

insert into public.quests (id, campaign_id, title, status, reward, giver_id, session_id, "desc", hooks) values
  ('q1', 'ember-accord', 'The Ashen Envoy''s Errand', 'pursuing',  '400 gp · a favor from the Court',                    'p1', 's1', 'Deliver the sealed letter to Prince Erys before the second thaw. Do not break the seal.', 'The seal is of black wax, sigil unknown. Maerwyn warned: ''If it warms in your hand, it is already too late.'''),
  ('q2', 'ember-accord', 'The Hollow Bell',           'whispered', 'Unknown',                                            'p4', 's4', 'Find out why Blackmere''s bells ring for the living.', null),
  ('q3', 'ember-accord', 'A Cartographer''s Debt',    'pursuing',  'Map of the Salt Road · 60 gp',                       'p5', 's6', 'Recover Corvin Lark''s stolen survey from Sable Thorne''s hold.', null),
  ('q4', 'ember-accord', 'The Fifth Gate',            'whispered', 'Unknown',                                            null, 's2', 'Find the fifth gate of Harrowgate. Find who forgot it.', null),
  ('q5', 'ember-accord', 'Salt-Kin',                  'resolved',  'Granted passage · Old Bramble''s gratitude',          'p2', 's1', 'Clear the cellar beneath the Crooked Tankard of whatever was eating the wine.', null),
  ('q6', 'ember-accord', 'The Ember Accord',          'pursuing',  'A seat at the Court',                                null, 's3', 'Broker a truce between House Halden and the Salt Council before the bells of Blackmere ring for the third time.', null),
  ('q7', 'ember-accord', 'Of Signed Names',           'lost',      '—',                                                  'p3', 's5', 'A contract we never should have signed. Sable Thorne knows our true names now.', null);

insert into public.goals (id, campaign_id, text, owner, kind, status) values
  ('g1', 'ember-accord', 'Learn my mother''s true name before the tenth moon.',    'Kael (Ranger)',   'Personal',  'pursuing'),
  ('g2', 'ember-accord', 'Keep the party from signing anything ever again.',       'Nym (Rogue)',     'Party',     'pursuing'),
  ('g3', 'ember-accord', 'Restore the Drowned Saint''s altar at Blackmere.',       'Oriane (Cleric)', 'Sacred',    'whispered'),
  ('g4', 'ember-accord', 'Retrieve my family''s sword from the Thornbound Wood.',  'Vareth (Paladin)','Personal',  'pursuing'),
  ('g5', 'ember-accord', 'Die with a full tankard.',                               'Bramble Jr.',     'Personal',  'whispered');

insert into public.items (id, campaign_id, name, kind, "desc") values
  ('i1', 'ember-accord', 'The Black Wax Letter',    'Artifact',   'Sealed. Warm to the touch some mornings.'),
  ('i2', 'ember-accord', 'Corvin''s Half-Map',      'Document',   'Shows two of the Salt Road''s nine lantern-points.'),
  ('i3', 'ember-accord', 'Severed Finger',          'Relic',      'A warning. Ring still on it.'),
  ('i4', 'ember-accord', 'Drowned Saint''s Icon',   'Holy Relic', 'Brass. Always damp.'),
  ('i5', 'ember-accord', 'Ledger of the Tankard',   'Document',   'Names in a script none of us read.');

insert into public.lore (id, campaign_id, title, text) values
  ('lo1', 'ember-accord', 'The Ember Accord',  '"When the ember forgets the hearth, the hearth shall burn the house." — Accord, Clause 1'),
  ('lo2', 'ember-accord', 'On the Fifth Gate', 'Harrowgate has four gates. The fifth was sealed by vote — the vote, and the gate, are both missing from the archives.'),
  ('lo3', 'ember-accord', 'The Drowned Saint', 'She walked into the sea singing and did not stop. Her choir sings still, at Blackmere, when the tide pulls the wrong way.');

insert into public.connections (campaign_id, from_id, to_id, label) values
  ('ember-accord', 'p1',  'q1',  'delivered the errand'),
  ('ember-accord', 'p1',  'f1',  'envoy of'),
  ('ember-accord', 'q1',  'p6',  'recipient'),
  ('ember-accord', 'p6',  'l2',  'heir of'),
  ('ember-accord', 'p6',  'f4',  'scion of'),
  ('ember-accord', 'q3',  'p5',  'client'),
  ('ember-accord', 'q3',  'p3',  'target'),
  ('ember-accord', 'p3',  'f2',  'master of'),
  ('ember-accord', 'p3',  'q7',  'holds contract'),
  ('ember-accord', 'q2',  'l4',  'centered at'),
  ('ember-accord', 'p4',  'l4',  'abbess of'),
  ('ember-accord', 'p4',  'f3',  'of the choir'),
  ('ember-accord', 'q6',  'f1',  'brokered for'),
  ('ember-accord', 'q6',  'f5',  'brokered with'),
  ('ember-accord', 'q4',  'l1',  'located within'),
  ('ember-accord', 'p2',  'l1',  'resides at'),
  ('ember-accord', 'p7',  'l1',  'haunts'),
  ('ember-accord', 'q5',  'p2',  'served'),
  ('ember-accord', 'g3',  'l4',  'set at'),
  ('ember-accord', 'g4',  'l5',  'set at'),
  ('ember-accord', 'p1',  'l3',  'travels by'),
  ('ember-accord', 'q1',  'i1',  'carries'),
  ('ember-accord', 'p5',  'i2',  'drew'),
  ('ember-accord', 'p3',  'i3',  'sent'),
  ('ember-accord', 'p4',  'i4',  'keeps'),
  ('ember-accord', 'p2',  'i5',  'guards'),
  ('ember-accord', 'lo1', 'f1',  'binds'),
  ('ember-accord', 'lo2', 'q4',  'concerns'),
  ('ember-accord', 'lo3', 'p4',  'foretells');

insert into public.board_positions (campaign_id, entity_id, x, y, rot, kind) values
  ('ember-accord', 'p1',  820,  180, -2, 'people'),
  ('ember-accord', 'p2',  180,  220,  3, 'people'),
  ('ember-accord', 'p3',  1500, 560, -3, 'people'),
  ('ember-accord', 'p4',  1100, 900,  2, 'people'),
  ('ember-accord', 'p5',  280,  880, -2, 'people'),
  ('ember-accord', 'p6',  1250, 180,  1, 'people'),
  ('ember-accord', 'p7',  500,  600, -4, 'people'),
  ('ember-accord', 'l1',  60,   520,  2, 'locations'),
  ('ember-accord', 'l2',  1700, 200, -1, 'locations'),
  ('ember-accord', 'l3',  900,  480,  1, 'locations'),
  ('ember-accord', 'l4',  1400, 1080, -2, 'locations'),
  ('ember-accord', 'l5',  240,  1150, 3, 'locations'),
  ('ember-accord', 'l6',  2050, 700, -2, 'locations'),
  ('ember-accord', 'q1',  560,  260,  1, 'quests'),
  ('ember-accord', 'q2',  1720, 920, -2, 'quests'),
  ('ember-accord', 'q3',  1200, 520,  2, 'quests'),
  ('ember-accord', 'q4',  380,  420, -3, 'quests'),
  ('ember-accord', 'q5',  40,   820,  2, 'quests'),
  ('ember-accord', 'q6',  1600, 420, -1, 'quests'),
  ('ember-accord', 'q7',  1840, 580,  3, 'quests'),
  ('ember-accord', 'g1',  720,  740, -4, 'goals'),
  ('ember-accord', 'g2',  960,  1180, 3, 'goals'),
  ('ember-accord', 'g3',  1400, 1320, -2, 'goals'),
  ('ember-accord', 'g4',  540,  1080, 2, 'goals'),
  ('ember-accord', 'g5',  60,   1080, -3, 'goals'),
  ('ember-accord', 'f1',  1960, 300,  2, 'factions'),
  ('ember-accord', 'f2',  1780, 780, -2, 'factions'),
  ('ember-accord', 'f3',  980,  1060, 1, 'factions'),
  ('ember-accord', 'f4',  1500, 350, -1, 'factions'),
  ('ember-accord', 'f5',  2200, 480,  2, 'factions'),
  ('ember-accord', 'i1',  720,  420,  4, 'items'),
  ('ember-accord', 'i2',  420,  730, -2, 'items'),
  ('ember-accord', 'i3',  1680, 680,  3, 'items'),
  ('ember-accord', 'i4',  1240, 780, -1, 'items'),
  ('ember-accord', 'i5',  340,  360,  2, 'items'),
  ('ember-accord', 'lo1', 2100, 150, -2, 'lore'),
  ('ember-accord', 'lo2', 180,  60,   1, 'lore'),
  ('ember-accord', 'lo3', 1120, 1170, -1, 'lore');

insert into public.presence_users (id, campaign_id, name, initials, color, active) values
  ('u1', 'ember-accord', 'Seraphine', 'SR', '#8a2a1f', true),
  ('u2', 'ember-accord', 'Kael',      'KL', '#3d5536', true),
  ('u3', 'ember-accord', 'Nym',       'NY', '#b08228', true),
  ('u4', 'ember-accord', 'Vareth',    'VR', '#4a6d68', false);

insert into public.party_notes (campaign_id, entity_id, author, when_label, text, hand) values
  ('ember-accord', 'p1', 'Kael',      'Sess 6', 'Maerwyn paid in silver, but the coins felt colder than they should.', true),
  ('ember-accord', 'p1', 'Nym',       'Sess 4', 'Do not trust the smile. The teeth are too even.',                      true),
  ('ember-accord', 'p1', 'Seraphine', 'Sess 1', 'Introduced herself as ''Envoy''. Never gave a surname until pressed.', false),
  ('ember-accord', 'q1', 'Vareth',    'Sess 3', 'If the seal warms, we ride. No questions.',                           true),
  ('ember-accord', 'q1', 'Kael',      'Sess 6', 'Checked it this morning. Still cool. I think.',                       true),
  ('ember-accord', 'l1', 'Nym',       'Sess 2', 'Counted the gates twice. Four. Then I blinked.',                      true);
