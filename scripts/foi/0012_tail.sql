-- ==========================================================================
-- 0012 additive extraction — people, arcs, quests, events, connections and
-- board positions for sessions 179–191. This block follows the session
-- inserts, since it references the new session ids.
-- IDs continue the sequences from scripts/foi/tail.sql.
-- ==========================================================================

-- People -------------------------------------------------------------------
insert into public.people (id, campaign_id, name, epithet, race, role, disposition, location_id, faction_id, last_seen_session_id, notes) values
  ('foi-p28', 'fist-of-ilmater', 'Theldin',              'Smith of the Forge of Spells',   'Human',      'Master smith of magic items',            'ally',    'foi-l4',  null,     'foi-s186', 'Abducted by Guh''s hill giants and sold to the fire giants, who held him at the Starforge. Freed by the party and brought to the Forge of Spells, where he upgrades their Dragon-Touched gear and asks for Elder Dragon scales. His niece Dana lived in Port Llast.'),
  ('foi-p29', 'fist-of-ilmater', 'Akaanvaerd',           'The Kind Dragon (dec.)',         'Red Dragon', 'Guardian of the Starforge crater',       'hostile', 'foi-l15', null,     'foi-s183', 'A red dragon of the Shadowfell, called kind but lost his way. His echo on the Material Plane was Venomfang. The party were forced to slay him over the acid lake — then had to put down his skeletal echo too.'),
  ('foi-p30', 'fist-of-ilmater', 'Brimskarda',           'Widow of the Vonindod (dec.)',   'Fire Giant', 'Fire giant of Ironslag',                 'hostile', 'foi-l15', null,     'foi-s181', 'Married Duke Zalto and worked the Vonindod at Ironslag. Fought Gomoth, was corrupted by Mephistopheles'' voice, and fled to the Shadowfell. Set on finishing the Titan of Death; she knew Barendd. Killed with her sister Zohelm; Speak with Dead named Hutijin as Mephistopheles'' current right hand.'),
  ('foi-p31', 'fist-of-ilmater', 'Duke Zalto',           'Lord of Ironslag',               'Fire Giant', 'Ruler of the fire giants',               'hostile', 'foi-l17', null,     null,       'Ruler of the fire giants and master of the Vonindod project. Brimskarda''s husband; never yet faced by the party.'),
  ('foi-p32', 'fist-of-ilmater', 'Gomoth',               'The Mad Fire Giant',             'Fire Giant', 'Founder of the Cult of Gomoth',          'hostile', null,      'foi-f7', null,       'Left his tribe, took slaves, and tried to revive Maegera — erupting Mount Hotenow and killing thousands. Made copies of himself and was defeated in the Temple of the Primordial. Whether he is truly dead is a lingering question.'),
  ('foi-p33', 'fist-of-ilmater', 'Dagult Neverember',    'Lord Protector of Neverwinter',  'Human',      'Ruler of Neverwinter',                   'unknown', 'foi-l11', null,     'foi-s187', 'Regal, blue-caped ruler who set the party a day''s service to repay their teleportation debt: root out a cult murdering his people. Prefers captives to corpses. Someone in the cult knows one of his secrets.'),
  ('foi-p34', 'fist-of-ilmater', 'Kevori Fearnehart',    'The Protector''s Investigator',  'Human',      'Investigator of the Lord Protector',     'ally',    'foi-l11', null,     'foi-s189', 'Investigates the Vecna cult with her brother Delvin, who went undercover and was found dead a week later with a desiccated eyeball — the party''s only lead. Six other Neverwintans remain missing.'),
  ('foi-p35', 'fist-of-ilmater', 'Zalryr',               'Cult Leader (dec.)',             null,         'Leader of the Undying Cult',             'hostile', 'foi-l11', 'foi-f9', 'foi-s188', 'Gaunt, oily-haired cult leader experimenting with ways to siphon secrets from souls; early volunteers became necrotic sludge. When his god judged his efforts disappointing, the apparition of Vecna turned him to sludge as well.'),
  ('foi-p36', 'fist-of-ilmater', 'Chanelle Hallwinter',  'The Forgetful Ghost',            null,         'Bound ghost of the Hallwinter line',     'unknown', 'foi-l11', null,     'foi-s187', 'An orb-headed ghost knight bound to her tomb, bearing the Hallwinter crest — kin to Sildar Hallwinter. She had forgotten her name; when the party spoke it, her memory and face returned and she was laid to rest, revealing the Shield of Missile Attraction.'),
  ('foi-p37', 'fist-of-ilmater', 'Eldon Keyward',        'Scholar of Psychoportation',     null,         'Teleportation scholar of Neverwinter',   'ally',    'foi-l19', null,     'foi-s190', 'Studies the Crevices of Dusk linking Evernight and Neverwinter, and names their power Psychoportation. Kidnapped by the cult and escaped; found schematics in Candlekeep and is bound to share all he learns with St. Ebenezer.'),
  ('foi-p38', 'fist-of-ilmater', 'Sarcelle Malinosh',    'The Stripped Sorcerer',          null,         'Wild magic sorcerer',                    'ally',    'foi-l19', null,     'foi-s190', 'One of Kevori''s six missing. Robed, masked cultists broke down her door a month ago; her wild-magic power was stripped during the journey to a distant plane. She seems to have been targeted on purpose.'),
  ('foi-p39', 'fist-of-ilmater', 'Umberto Noblin',       'Historian of Vecna',             null,         'Historian and gourmand',                 'ally',    'foi-l19', null,     'foi-s190', 'One of the six missing, taken while writing at home. A historian of Vecna and lover of the culinary arts; knows the tangled tale of Cas the Vampire and Vecna, and owns a painting of the two of them when young.'),
  ('foi-p40', 'fist-of-ilmater', 'Vecna',                'The Whispered One',              'Lich God',   'Overarching villain',                    'hostile', null,      'foi-f9', 'foi-s188', 'Appeared over the ritual as an emaciated skull with one glowing green eye, judged the cult, and marked the party: "there is great potential here... I have my eye on you." His words match the obelisks Mephistopheles harvested in Barovia; the link between them is unknown.'),
  ('foi-p41', 'fist-of-ilmater', 'St. Ebenezer',         'Undead Saint of the Guild',      null,         'Saint of teleportation',                 'ally',    'foi-l1',  'foi-f1', 'foi-s186', 'One of the undead saints who tend the guild''s floors. Teleported the party home and can track every hero on the Material Plane. The white void troubles him — only a power to rival the gods could make such a thing.')
on conflict (id) do nothing;

-- Arcs ---------------------------------------------------------------------
-- The Mount Hotenow arc pays off at the Starforge, so extend it to 184.
update public.arcs set end_session_id = 'foi-s184'
  where id = 'foi-arc3' and campaign_id = 'fist-of-ilmater';

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num) values
  ('foi-arc4', 'fist-of-ilmater', 'The Undying Eye', 'The guild plants roots in Waterdeep and repays Neverwinter by hunting a cult of Vecna beneath the city — secrets siphoned from souls, the missing recovered from the crypts of Neverdeath, and a one-eyed lich-god who now has his eye on the party.', 'foi-s185', 'foi-s191', 4)
on conflict (id) do nothing;

update public.sessions set arc_id = 'foi-arc3' where campaign_id = 'fist-of-ilmater' and num between 179 and 184;
update public.sessions set arc_id = 'foi-arc4' where campaign_id = 'fist-of-ilmater' and num between 185 and 191;

-- Quests -------------------------------------------------------------------
-- Theldin is rescued and delivered to the Forge of Spells.
update public.quests set status = 'resolved'
  where id = 'foi-q6' and campaign_id = 'fist-of-ilmater';

insert into public.quests (id, campaign_id, title, status, reward, giver_id, session_id, arc_id, "desc", hooks) values
  ('foi-q9',  'fist-of-ilmater', 'Break the Undying Cult',      'pursuing', 'Neverwinter''s gratitude',       'foi-p34', 'foi-s187', 'foi-arc4', 'A cult beneath Neverwinter worships Vecna and siphons secrets from souls, killing Kevori''s brother among others. The party traced one sect by a desiccated eyeball and broke it — but many more sects hide in the catacombs.', 'The Lord Protector prefers captives to corpses. A desiccated eyeball points the way when you say "Hail the undying".'),
  ('foi-q10', 'fist-of-ilmater', 'Repay Neverwinter''s Debt',   'pursuing', 'The teleportation debt cleared', 'foi-p33', 'foi-s186', 'foi-arc4', 'Users of Neverwinter''s teleportation circles owe the city a day of service. The Lord Protector calls in the debt: help him against the cult killing his citizens.', null),
  ('foi-q11', 'fist-of-ilmater', 'Uncover Vecna''s Design',     'pursuing', 'Unknown',                        null,      'foi-s188', null,       'Vecna''s apparition marked the party after the cult''s ritual. Is the cult trying to release him? What is the connection between the lich-god of secrets and Mephistopheles, whose harvested obelisks bore the same words?', 'The ritual chant matched the Barovian obelisks. Umberto Noblin knows the history of Cas and Vecna.')
on conflict (id) do nothing;

-- Events -------------------------------------------------------------------
insert into public.events (id, campaign_id, title, summary, in_game_date, session_id, location_id, order_num) values
  ('foi-e15', 'fist-of-ilmater', 'The Crater of the Starforge', 'The party climbed the erupting Shadowfell echo of Mount Hotenow and dimension-doored onto the island in the acid lake, where fire giants laboured over a half-built war machine — and tried, badly, to pass themselves off as agents of Mephistopheles.', 'Marpenoth 5', 'foi-s179', 'foi-l15', 15),
  ('foi-e16', 'fist-of-ilmater', 'Brimskarda''s Confession',    'The fire giant Brimskarda told of the Ordning, of Ironslag and the Vonindod, and of the voice of Mephistopheles that now unites the giants. The party dispelled the enchantments holding her and her sister, then killed them both when they turned to fight.', 'Marpenoth 5', 'foi-s180', 'foi-l15', 16),
  ('foi-e17', 'fist-of-ilmater', 'The Fall of Akaanvaerd',      'The party freed Theldin and slew the dragon Akaanvaerd over the acid lake — then his skeletal echo — before opening a teleportation circle home. Theothor, having banished himself, was left behind beneath the Siren Sea.', 'Marpenoth 5', 'foi-s183', 'foi-l15', 17),
  ('foi-e18', 'fist-of-ilmater', 'A Base in Waterdeep',         'The Shields chose Waterdeep for their new base. Rudolph van Richten summoned them, Theldin returned their upgraded gear and asked for Elder Dragon scales, and the Harpers'' gifts — rings, earrings and a Weapon of Certain Death — arrived.', 'Marpenoth 6', 'foi-s186', 'foi-l18', 18),
  ('foi-e19', 'fist-of-ilmater', 'The Undying Cult Uncovered',  'A desiccated eyeball led the party to a Vecna cult beneath Neverwinter. They laid the ghost Chanelle Hallwinter to rest, broke Zalryr''s soul-siphoning ritual, and were marked by the apparition of Vecna: "I have my eye on you."', 'Marpenoth 6', 'foi-s188', 'foi-l11', 19),
  ('foi-e20', 'fist-of-ilmater', 'The Missing of Neverdeath',   'Clearing the Hallix Mausoleum in Neverdeath, the party freed Sarcelle Malinosh and Umberto Noblin, bargained with bound water spirits, and learned of the Crevices of Dusk from the escaped scholar Eldon Keyward.', 'Marpenoth 6', 'foi-s190', 'foi-l19', 20)
on conflict (id) do nothing;

insert into public.event_participants (campaign_id, event_id, person_id) values
  ('fist-of-ilmater', 'foi-e15', 'foi-p4'), ('fist-of-ilmater', 'foi-e15', 'foi-p5'), ('fist-of-ilmater', 'foi-e15', 'foi-p6'),
  ('fist-of-ilmater', 'foi-e16', 'foi-p3'), ('fist-of-ilmater', 'foi-e16', 'foi-p4'), ('fist-of-ilmater', 'foi-e16', 'foi-p5'), ('fist-of-ilmater', 'foi-e16', 'foi-p6'), ('fist-of-ilmater', 'foi-e16', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e17', 'foi-p4'), ('fist-of-ilmater', 'foi-e17', 'foi-p5'), ('fist-of-ilmater', 'foi-e17', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e18', 'foi-p4'), ('fist-of-ilmater', 'foi-e18', 'foi-p5'), ('fist-of-ilmater', 'foi-e18', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e19', 'foi-p4'), ('fist-of-ilmater', 'foi-e19', 'foi-p5'), ('fist-of-ilmater', 'foi-e19', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e20', 'foi-p4'), ('fist-of-ilmater', 'foi-e20', 'foi-p5'), ('fist-of-ilmater', 'foi-e20', 'foi-p6')
on conflict (event_id, person_id) do nothing;

-- Connections --------------------------------------------------------------
-- 0011 clears campaign connections then re-inserts; 0012 is additive, so it
-- must NOT delete (that would wipe 0011's set). connections has only a
-- bigserial PK, so there's no key for `on conflict`; instead each edge is
-- inserted only when an identical (campaign_id, from_id, to_id, label) row
-- doesn't already exist, which keeps this block idempotent on re-apply.
insert into public.connections (campaign_id, from_id, to_id, label)
select v.campaign_id, v.from_id, v.to_id, v.label
from (values
  ('fist-of-ilmater', 'foi-q6',  'foi-p28', 'rescued'),
  ('fist-of-ilmater', 'foi-p28', 'foi-l4',  'smiths at'),
  ('fist-of-ilmater', 'foi-p28', 'foi-f7',  'sold to'),
  ('fist-of-ilmater', 'foi-q6',  'foi-l15', 'ended at'),
  ('fist-of-ilmater', 'foi-p29', 'foi-l15', 'guarded'),
  ('fist-of-ilmater', 'foi-p30', 'foi-l17', 'forged the Vonindod at'),
  ('fist-of-ilmater', 'foi-p30', 'foi-p31', 'married'),
  ('fist-of-ilmater', 'foi-p31', 'foi-l17', 'lord of'),
  ('fist-of-ilmater', 'foi-p32', 'foi-f7',  'formed'),
  ('fist-of-ilmater', 'foi-p32', 'foi-l13', 'erupted'),
  ('fist-of-ilmater', 'foi-p30', 'foi-p32', 'fought'),
  ('fist-of-ilmater', 'foi-l15', 'foi-l13', 'forge atop'),
  ('fist-of-ilmater', 'foi-l16', 'foi-l11', 'shadow of'),
  ('fist-of-ilmater', 'foi-p33', 'foi-l11', 'lord protector of'),
  ('fist-of-ilmater', 'foi-q10', 'foi-p33', 'owed to'),
  ('fist-of-ilmater', 'foi-p34', 'foi-p33', 'investigates for'),
  ('fist-of-ilmater', 'foi-q9',  'foi-p34', 'set by'),
  ('fist-of-ilmater', 'foi-q9',  'foi-f9',  'against'),
  ('fist-of-ilmater', 'foi-f9',  'foi-l11', 'hides beneath'),
  ('fist-of-ilmater', 'foi-p35', 'foi-f9',  'led'),
  ('fist-of-ilmater', 'foi-p40', 'foi-f9',  'worshipped by'),
  ('fist-of-ilmater', 'foi-p35', 'foi-p40', 'served'),
  ('fist-of-ilmater', 'foi-q11', 'foi-p40', 'against'),
  ('fist-of-ilmater', 'foi-p40', 'foi-p11', 'unknown link to'),
  ('fist-of-ilmater', 'foi-p36', 'foi-i8',  'guarded'),
  ('fist-of-ilmater', 'foi-p37', 'foi-l16', 'studies the crevices to'),
  ('fist-of-ilmater', 'foi-p37', 'foi-f9',  'escaped'),
  ('fist-of-ilmater', 'foi-p38', 'foi-f9',  'captured by'),
  ('fist-of-ilmater', 'foi-p39', 'foi-f9',  'captured by'),
  ('fist-of-ilmater', 'foi-p39', 'foi-p40', 'historian of'),
  ('fist-of-ilmater', 'foi-i7',  'foi-p3',  'found by'),
  ('fist-of-ilmater', 'foi-i9',  'foi-f6',  'gift of'),
  ('fist-of-ilmater', 'foi-p41', 'foi-f1',  'saint of'),
  ('fist-of-ilmater', 'foi-p37', 'foi-p41', 'reports to')
) as v(campaign_id, from_id, to_id, label)
where not exists (
  select 1 from public.connections c
  where c.campaign_id = v.campaign_id
    and c.from_id = v.from_id
    and c.to_id = v.to_id
    and c.label = v.label
);

-- Board positions ----------------------------------------------------------
-- New clusters below the existing board: the Starforge/Shadowfell on the
-- left, the Neverwinter/Vecna web on the right.
insert into public.board_positions (campaign_id, entity_id, x, y, rot, kind) values
  -- Starforge / Shadowfell cluster
  ('fist-of-ilmater', 'foi-p28', 700,  1520, -2, 'people'),
  ('fist-of-ilmater', 'foi-p29', 1150, 1720,  2, 'people'),
  ('fist-of-ilmater', 'foi-p30', 950,  1780, -1, 'people'),
  ('fist-of-ilmater', 'foi-p31', 720,  1780,  3, 'people'),
  ('fist-of-ilmater', 'foi-p32', 520,  1680, -3, 'people'),
  ('fist-of-ilmater', 'foi-l15', 1150, 1550,  1, 'locations'),
  ('fist-of-ilmater', 'foi-l16', 1420, 1600, -2, 'locations'),
  ('fist-of-ilmater', 'foi-l17', 880,  1600,  2, 'locations'),
  ('fist-of-ilmater', 'foi-i7',  1620, 1750, -1, 'items'),
  ('fist-of-ilmater', 'foi-lo5', 680,  1960,  2, 'lore'),
  ('fist-of-ilmater', 'foi-lo6', 1500, 1880, -2, 'lore'),
  -- Neverwinter / Vecna cluster
  ('fist-of-ilmater', 'foi-l18', 1900, 1500,  1, 'locations'),
  ('fist-of-ilmater', 'foi-l19', 2120, 1700, -2, 'locations'),
  ('fist-of-ilmater', 'foi-f9',  1980, 1920, -1, 'factions'),
  ('fist-of-ilmater', 'foi-p33', 1760, 1620,  2, 'people'),
  ('fist-of-ilmater', 'foi-p34', 1980, 1650, -3, 'people'),
  ('fist-of-ilmater', 'foi-p35', 2180, 1900,  1, 'people'),
  ('fist-of-ilmater', 'foi-p36', 2380, 1740, -2, 'people'),
  ('fist-of-ilmater', 'foi-p37', 2320, 1560,  2, 'people'),
  ('fist-of-ilmater', 'foi-p38', 2500, 1900, -1, 'people'),
  ('fist-of-ilmater', 'foi-p39', 2500, 1700,  3, 'people'),
  ('fist-of-ilmater', 'foi-p40', 2160, 2110, -2, 'people'),
  ('fist-of-ilmater', 'foi-p41', 1620, 1440,  1, 'people'),
  ('fist-of-ilmater', 'foi-i8',  2380, 1550, -3, 'items'),
  ('fist-of-ilmater', 'foi-i9',  1780, 1800,  2, 'items'),
  ('fist-of-ilmater', 'foi-lo4', 2000, 2110,  1, 'lore'),
  -- New quests
  ('fist-of-ilmater', 'foi-q9',  2060, 1480, -2, 'quests'),
  ('fist-of-ilmater', 'foi-q10', 1800, 1400,  2, 'quests'),
  ('fist-of-ilmater', 'foi-q11', 2280, 2000, -1, 'quests')
on conflict (campaign_id, entity_id) do nothing;
