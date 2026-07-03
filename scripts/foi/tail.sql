-- ==========================================================================
-- People (after sessions: last_seen_session_id references them)
-- ==========================================================================

insert into public.people (id, campaign_id, name, epithet, race, role, disposition, location_id, faction_id, last_seen_session_id, notes) values
  -- The party
  ('foi-p1',  'fist-of-ilmater', 'Karn',                  'Shield of the Crying God (dec.)', 'Warforged', 'Party frontline, built by Forgeback',   'ally',    null,      'foi-f1', 'foi-s76',  'About 100 years old, sentient for 50. Built by Forgeback of Mirabar. Killed by Zhentarim soldiers and Nupperibo devils at Nesmé — returned in a blaze one last time as a shield of the crying god. Buried at a riverside gravesite; his ruby remains.'),
  ('foi-p2',  'fist-of-ilmater', 'Tillem',                'The Coin Tosser',                 null,        'Party member; ex-Trade Off delivery boy', 'ally',  null,      'foi-f1', 'foi-s44',  'Unknowingly smuggled for Trade Off under the alias Ray Jackson. Left the guild after session 44 to nurse his brother Wom in the High Forest — everyone cried like little girls.'),
  ('foi-p3',  'fist-of-ilmater', 'Theothor',              null,                              'Leonin',    'Party frontline, of the Grey Manes',     'ally',    null,      'foi-f1', null,       'Slew Isendraug at Ice Spire Hold. The rival Iron Manes granted him lightning resistance, saying it wasn''t yet time for their meeting. "This one''s for Theoterrence!"'),
  ('foi-p4',  'fist-of-ilmater', 'Mort',                  'Bonny St. Claire',                'Skeleton',  'Party scout and lockpick',               'ally',    null,      'foi-f1', null,       'His last remembered job before becoming a skeleton bears the sigil of the Shadow Thieves — a dagger with a mask over the eyes. His shadow has gone missing (session 176).'),
  ('foi-p5',  'fist-of-ilmater', 'Fynn',                  null,                              null,        'Party spellcaster',                      'ally',    null,      'foi-f1', null,       'Joined the party at the guild in Triboar. Attuned to Madam Eva''s mist talisman to lead the party home; a Fire Giant destroyed the Conclave of Silverymoon — he is not the killer he thought he was.'),
  ('foi-p6',  'fist-of-ilmater', 'Barendd Battlegore',    'Chosen of the Morninglord',       'Duergar',   'Party member, exiled from Gracklstugh',  'ally',    null,      'foi-f1', null,       'Kicked in the party''s door in Rivermoot with his giant lizard Balthazar. Refused the Corpse Star''s bargain in the Amber Temple, and staked Strahd in his coffin with the Sunsword. Orcsplitter deemed him worthy.'),
  ('foi-p7',  'fist-of-ilmater', 'Oliver Goodhill',       'Seeker of the Silver City',       'Halfling',  'Party spellcaster and scholar',          'ally',    null,      'foi-f1', null,       'From the Calim Desert; deciphered the coded map to the Forge of Spells and searches for the Silver City, whose water could cure every disease. Scouts with a floating arcane eye. Has never seen a naked female body.'),
  -- The guild
  ('foi-p8',  'fist-of-ilmater', 'Weaver',                'Guild Leader',                    null,        'Leader of the Shields of the Crying God', 'ally',   'foi-l1',  'foi-f1', 'foi-s168', 'Legendary hero who once thwarted Vecna and was part of the Black Spider''s banishment 1500 years ago. Trained at the Fireside Monastery; very good at wrestling.'),
  ('foi-p9',  'fist-of-ilmater', 'Wan Shi Tong',          '(dec.)',                          null,        'Guild leader figure',                    'ally',    'foi-l1',  'foi-f1', 'foi-s57',  'Stuck in Limbo when his fortress was attacked by fiends. His severed head was Mephistopheles'' parting gift in the Wave Echo Cave.'),
  -- Sword Coast
  ('foi-p10', 'fist-of-ilmater', 'Gundren Rockseeker',    'of Rockseeker Industries',        'Dwarf',     'Mine prospector',                        'ally',    'foi-l2',  null,     'foi-s59',  'Rescued from Gragmaw Castle; his coded map led to the Forge of Spells. Brother Tharden died in the mine, Nundro survived. Agreed a new Phandelver Pact with the guild.'),
  ('foi-p11', 'fist-of-ilmater', 'Mephistopheles',        'Lord of Cania',                   'Archdevil', 'The campaign''s overarching villain',    'hostile', null,      null,     'foi-s141', 'The hospital clown, banished to the Dollmother''s domain of dread 1500 years ago; the Black Spider was merely his disguise. He broke the balance of the Hells and vows to burn down the multiverse — the party were his ''useful vessels''.'),
  ('foi-p12', 'fist-of-ilmater', 'Strahd von Zarovich',   'The Devil Strahd (dec.)',         'Vampire',   'Darklord of Barovia',                    'hostile', 'foi-l8',  null,     'foi-s143', 'Once a good and just warlord; became a vampire when his muse Tatiana died. Hid as the revived Vasili after his first defeat — Barendd staked him in his coffin with the Sunsword, exploding him for good.'),
  ('foi-p13', 'fist-of-ilmater', 'Baba Lysaga',           'The Witch of Berez (dec.)',       null,        'Witch; Strahd''s former midwife',        'hostile', 'foi-l8',  null,     'foi-s142', 'Fed Strahd darkness from a young age. Devoted to Mephistopheles, who promised her the domain; her walking hut fell at Berez, and she fell for good in Ravenloft''s throne room beside Aribeth.'),
  ('foi-p14', 'fist-of-ilmater', 'Rudolph van Richten',   'The Vampire Hunter',              null,        'Monster hunter of Darkon',               'ally',    'foi-l1',  null,     'foi-s147', 'Hunted Strahd disguised as the ring master Rictavio; owns a sabertooth tiger trained to smell Vistani blood. Came through the mists with the party and now trains at the guild.'),
  ('foi-p15', 'fist-of-ilmater', 'Madam Eva',             'The Fortune Teller',              null,        'Vistani seer at the Tser Pool',          'unknown', 'foi-l6',  'foi-f2', 'foi-s145', 'Knew the party''s names before they gave them and read their fortune: a hidden tome, the Symbol of Ravenkind, the Sunsword, an ageless man-made ally. Named Barendd the Morninglord''s chosen and prepared the mist talisman home.'),
  ('foi-p16', 'fist-of-ilmater', 'Ireena Kolyana',        null,                              null,        'Bearer of Tatiana''s likeness',          'ally',    'foi-l7',  null,     'foi-s145', 'Courted by Strahd; strongly resembles the monument to Marina in Berez. Found barricaded in the Toy Maker''s store in ruined Vallaki. After Strahd''s death she volunteered to spread the news and take Gertruda home.'),
  ('foi-p17', 'fist-of-ilmater', 'Urwin Martikov',        'Innkeeper of the Blue Water Inn', 'Were-raven','Innkeeper; Keeper of the Feather',       'ally',    'foi-l7',  'foi-f3', 'foi-s119', 'Revealed himself as a were-raven and pledged twenty wings against Strahd. Survived Vallaki''s destruction, though his children were killed and his wife taken.'),
  ('foi-p18', 'fist-of-ilmater', 'Kasimir Velikov',       'Last King of the Dusk Elves',     'Dusk Elf',  'Ruler of the dusk elves',                'ally',    'foi-l6',  null,     'foi-s123', 'His people owned these lands before Strahd, and are kept close by the Vistani. Held a void threat at bay for seven days straight while his people died; rescued when the party defeated Strahd''s Shadow.'),
  ('foi-p19', 'fist-of-ilmater', 'Ezmerelda D''Avenir',   'Vampire Hunter',                  'Vistani',   'Monster hunter from Darkon',             'ally',    'foi-l6',  'foi-f2', 'foi-s145', 'Found hiding in the Abbey, planning to assassinate Strahd; carries a Vorplan sword with a 5% chance to behead. The party burned her wagon in session 145, as is usual for Vistani.'),
  ('foi-p20', 'fist-of-ilmater', 'Morgantha',             'The Pastry Granny',               'Night Hag', 'Witch of the windmill',                  'hostile', 'foi-l6',  null,     'foi-s82',  'Sold dream pastries door to door in the Village of Barovia — the flour contained the children she bought. Her mill, and her daughters Bella and Ophelia, burned. She had also been feeding girls to the kraken of Lake Zarovich.'),
  ('foi-p21', 'fist-of-ilmater', 'Wom',                   null,                              null,        'Tillem''s brother',                      'ally',    null,      null,     'foi-s44',  'Kidnapped by Trade Off and found missing a horn and two thumbs, possessed by an Ooze; his magic crystal was corrupted by domain-of-dread energy. Tillem left the guild to care for him in the High Forest.'),
  ('foi-p22', 'fist-of-ilmater', 'Kriv',                  'Leader of Trade Off (dec.)',      null,        'Smuggling boss',                         'hostile', 'foi-l3',  'foi-f8', 'foi-s43',  'Called for Tillem''s head after he ran from the company. Killed by a very lethal bullet from the bounty hunter Athos after the fight beneath the slaughterhouse.'),
  ('foi-p23', 'fist-of-ilmater', 'Isendraug',             'The White Dragon''s Widow (dec.)','Elf',       'Vengeful widow of Cryovain',             'hostile', null,      null,     'foi-s66',  'Captured with her husband by Jarl Storvald''s frost giants and forced to breed dragon mounts. After finding Cryovain dead she wore his skin-disguise, froze Phandalin, and chose to take the world with her at Ice Spire Hold.'),
  ('foi-p24', 'fist-of-ilmater', 'Chief Guh',             'Chief of Grudd Haug (dec.)',      'Hill Giant','Giant lord',                             'hostile', 'foi-l12', null,     'foi-s156', 'Ruled Grudd Haug''s kidnapping and slavery operation; somehow saw and squashed Oliver''s arcane eye. Jumped into the pigsty pit to kill the party herself when they refused an honored duel.'),
  ('foi-p25', 'fist-of-ilmater', 'Faldorn',               'Master of Hamadryads',            null,        'Renegade druid',                         'hostile', null,      null,     null,       'Kyvan''s old master — ''IT WAS FALDORN'' was left at his burned house. Working with Mephistopheles to destroy the Emerald Enclave from the inside. Still at large.'),
  ('foi-p26', 'fist-of-ilmater', 'Ariana Riverlost',      null,                              'Elf',       'Harper investigator',                    'ally',    null,      'foi-f6', 'foi-s178', 'Took Orcsplitter for safekeeping in exchange for promised magic items. Told Fynn a Fire Giant destroyed the Conclave of Silverymoon — he is not the killer he thought he was.'),
  ('foi-p27', 'fist-of-ilmater', 'Aribeth',               'Avatar of Mephistopheles',        null,        'Fiendish champion',                      'hostile', null,      null,     'foi-s141', 'Leads gnolls, demons and Straw Priests as they pull obsidian obelisks through portals into an icy hellscape. Promised Baba Lysaga the domain of Barovia and beyond; her sword captures souls.')
on conflict (id) do nothing;

-- ==========================================================================
-- Arcs (after sessions; then stamp arc_id back onto sessions)
-- ==========================================================================

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num) values
  ('foi-arc1', 'fist-of-ilmater', 'From Phandalin to the Mists',   'The Shields of the Crying God rescue Gundren Rockseeker, break Trade Off, and reclaim the Forge of Spells — only to learn the Black Spider was Mephistopheles all along. The road north costs them Tillem, then Karn, before the mists swallow the survivors.', 'foi-s31',  'foi-s77',  1),
  ('foi-arc2', 'fist-of-ilmater', 'The Barovia Saga',              'Trapped in Strahd von Zarovich''s Domain of Dread, the party follows Madam Eva''s cards through Vallaki, the Amber Temple, and Castle Ravenloft — unseating Baba Lysaga, staking the Devil Strahd in his coffin, and walking the mists home.', 'foi-s78',  'foi-s146', 2),
  ('foi-arc3', 'fist-of-ilmater', 'The Shadow of Mount Hotenow',   'Back on the Sword Coast, giants stir: Grudd Haug falls, Port Llast burns, and the trail of the abducted smith Theldin leads through seven iron doors into the Shadowfell — while Faldorn and Mephistopheles move against the Emerald Enclave.', 'foi-s147', 'foi-s178', 3)
on conflict (id) do nothing;

update public.sessions set arc_id = 'foi-arc1' where campaign_id = 'fist-of-ilmater' and num between 31  and 77;
update public.sessions set arc_id = 'foi-arc2' where campaign_id = 'fist-of-ilmater' and num between 78  and 146;
update public.sessions set arc_id = 'foi-arc3' where campaign_id = 'fist-of-ilmater' and num between 147 and 178;

-- ==========================================================================
-- Quests
-- ==========================================================================

insert into public.quests (id, campaign_id, title, status, reward, giver_id, session_id, arc_id, "desc", hooks) values
  ('foi-q1', 'fist-of-ilmater', 'Rescue Gundren Rockseeker',            'resolved', '125 gp · Gundren''s gratitude',                null,     'foi-s31',  'foi-arc1', 'Gundren was held at Gragmaw Castle, where the drow priestess Vyerith extracted the Wave Echo Cave''s location for the Black Spider. The party stormed the castle and escorted him to Phandalin to heal.', null),
  ('foi-q2', 'fist-of-ilmater', 'Save Wom from Trade Off',              'resolved', 'Wom''s life · Trade Off destroyed',            null,     'foi-s32',  'foi-arc1', 'Trade Off held Tillem''s brother hostage in Longsaddle. The party burned their HQ, fought through the slaughterhouse dungeon, and freed Wom from an Ooze possession — after which Tillem left to nurse him home.', null),
  ('foi-q3', 'fist-of-ilmater', 'Find the Forge of Spells',             'resolved', 'A new Phandelver Pact · guild share of the mine', 'foi-p10', 'foi-s35', 'foi-arc1', 'Gundren and Oliver''s deciphered map led into the Wave Echo Cave, past Nazznar, Iarno, and Mormesk, to the beholder Guardian and the waning Forge.', null),
  ('foi-q4', 'fist-of-ilmater', 'Defeat Strahd von Zarovich',           'resolved', 'Barovia freed',                                null,     'foi-s78',  'foi-arc2', 'The hunt for Barovia''s vampire lord: gathering the Sunsword, the Tome of Strahd, and allies like the Keepers of the Feather before riding on Castle Ravenloft. Powerful vampires only truly die in their coffins — Barendd made sure of it.', null),
  ('foi-q5', 'fist-of-ilmater', 'Escape Barovia through the Mists',     'resolved', 'The way home',                                 'foi-p15', 'foi-s143', 'foi-arc2', 'Rudolph led the party to Madam Eva, who explained the Mistwalking curse and prepared a talisman keyed to their home world. They emerged on the Sword Coast beside Proserpine''s group, mid-troll-fight.', null),
  ('foi-q6', 'fist-of-ilmater', 'Rescue Theldin the Blacksmith',        'pursuing', 'Unknown',                                      'foi-p8',  'foi-s148', 'foi-arc3', 'Weaver''s task: rescue the smith Theldin, captured by Guh''s hill giants and sold to fire giants of the Cult of Gomoth. The trail leads through Mount Hotenow''s one-way dungeon into the Shadowfell, toward the Starforge.', 'Hruk the turncoat hill giant pointed the way. The iron doors only open forward.'),
  ('foi-q7', 'fist-of-ilmater', 'Stop Mephistopheles',                  'pursuing', 'The multiverse, presumably',                   null,     'foi-s57',  null,       'The archdevil has broken the balance of the Hells and gathers power in every world — obsidian obelisks, dread domains, stolen dragons, agents like Aribeth and Baba Lysaga. What is the next step of his plan?', 'He called the party ''useful vessels''. They helped him escape the domain of dread without knowing it.'),
  ('foi-q8', 'fist-of-ilmater', 'Unmask Faldorn''s treachery',          'pursuing', 'Unknown',                                      null,     'foi-s167', 'foi-arc3', 'Kyvan''s old master Faldorn burned his house and works with Mephistopheles to destroy the Emerald Enclave from the inside. Weaver''s suspicions are confirmed; Faldorn is still at large.', null)
on conflict (id) do nothing;

-- ==========================================================================
-- Events (order_num carries chronology; in_game_date is free-form)
-- ==========================================================================

insert into public.events (id, campaign_id, title, summary, in_game_date, session_id, location_id, order_num) values
  ('foi-e1',  'fist-of-ilmater', 'Gundren Rescued at Gragmaw Castle',  'The party freed Gundren from King Grol and the priestess Vyerith, who had already extracted the Wave Echo Cave''s location. Grol offered his life, and Targor Bloodsword led the goblins to become Phandalin''s militia.', 'Flamerule 1',  'foi-s35',  'foi-l5',  1),
  ('foi-e2',  'fist-of-ilmater', 'Tillem''s Farewell',                 'After Zorgarp''s ritual saved Wom — whose corruption must be countered by deep love — Tillem left the guild to care for his brother in the High Forest. Everyone cried like little girls.', 'Flamerule 11', 'foi-s44',  'foi-l1',  2),
  ('foi-e3',  'fist-of-ilmater', 'Mephistopheles Revealed',            'The clown appeared in the Wave Echo Cave and revealed the Black Spider was merely his disguise — he is Mephistopheles, Lord of Cania, and the party were his ''useful vessels''. He left behind the head of Wan Shi Tong.', 'Flamerule 21', 'foi-s57',  'foi-l4',  3),
  ('foi-e4',  'fist-of-ilmater', 'Karn''s Last Stand',                 'Killed by Zhentarim soldiers and Nupperibo devils at Nesmé, Karn returned in a blaze one last time as a shield of the crying god and exploded to take the enemies with him. He could not be revived.', null,           'foi-s76',  null,      4),
  ('foi-e5',  'fist-of-ilmater', 'Taken by the Mists',                 'Searching the Evermoors for Baba Lysaga, the party met the scarecrow-child Kid Clapperclaw before mists smelling of rotten glass swallowed them. Four days later they emerged in a dreary, weeping village: Barovia.', 'Eleasis 1',    'foi-s77',  'foi-l6',  5),
  ('foi-e6',  'fist-of-ilmater', 'Madam Eva Reads the Cards',          'At the Tser Pool camp, Madam Eva already knew the party''s names and drew their fortune: a hidden tome, the Symbol of Ravenkind, the Sunsword, and an ageless man-made ally haunting the castle towers.', 'Eleasis 5',    'foi-s80',  'foi-l6',  6),
  ('foi-e7',  'fist-of-ilmater', 'The Fall of Vallaki',                'After the wolf-hunter brothers sowed infighting, werewolves destroyed Vallaki — the men killed, the women brewed, the children carried to the den. The Keepers of the Feather were among the dead.', 'Eleasis 26',   'foi-s115', 'foi-l7',  7),
  ('foi-e8',  'fist-of-ilmater', 'The Crystal Heart Destroyed',        'The party killed the spawned vampires and the pulsing crystal heart Baba Lysaga had claimed, losing Aleksandru in the battle; Fynn fell down the tower and almost died.', null,           'foi-s137', 'foi-l8',  8),
  ('foi-e9',  'fist-of-ilmater', 'The Fall of Baba Lysaga',            'Baba Lysaga fell in Ravenloft''s throne room beside Aribeth, avatar of Mephistopheles — but the revived Vasili turned out to be Strahd in disguise, animating the fallen as he fled.', null,           'foi-s142', 'foi-l8',  9),
  ('foi-e10', 'fist-of-ilmater', 'Strahd''s True Death',               'The party found Strahd''s coffin in the crypts, and Barendd stabbed him through the heart with the Sunsword — exploding the first vampire for good, cryptkeeper and all.', null,           'foi-s143', 'foi-l8',  10),
  ('foi-e11', 'fist-of-ilmater', 'Return Through the Mists',           'Fynn attuned to Madam Eva''s talisman and it pulled the party through the mists to their home world, where they emerged beside Proserpine''s group fighting trolls and teleported to the guild.', 'Eleint 24',    'foi-s146', null,      11),
  ('foi-e12', 'fist-of-ilmater', 'The Fall of Grudd Haug',             'The party defeated everyone in Grudd Haug save the hill giant Hruk, who switched sides and revealed the fire giants belong to a cult headed for the Shadow of Mount Hotenow.', 'Eleint 29',    'foi-s157', 'foi-l12', 12),
  ('foi-e13', 'fist-of-ilmater', 'Port Llast Falls',                   'Corrupted, red-eyed frost giants carrying sacks of corpses gathered around the giant ship Krigvind as two dragons roared into the fog-covered town. Port Llast had fallen.', 'Marpenoth 1',  'foi-s164', 'foi-l14', 13),
  ('foi-e14', 'fist-of-ilmater', 'Slaying the Last Guardian',          'The party was forced to slay the dragon Calumnus, Last Guardian of Netheril, who wanted to unleash what the iron doors imprison — then climbed through the mist into the Shadowfell, sighting Evernight beside a sea of lava.', 'Marpenoth 5',  'foi-s178', 'foi-l13', 14)
on conflict (id) do nothing;

insert into public.event_participants (campaign_id, event_id, person_id) values
  ('fist-of-ilmater', 'foi-e1',  'foi-p1'), ('fist-of-ilmater', 'foi-e1',  'foi-p2'), ('fist-of-ilmater', 'foi-e1',  'foi-p3'), ('fist-of-ilmater', 'foi-e1',  'foi-p4'), ('fist-of-ilmater', 'foi-e1',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e2',  'foi-p1'), ('fist-of-ilmater', 'foi-e2',  'foi-p2'), ('fist-of-ilmater', 'foi-e2',  'foi-p3'), ('fist-of-ilmater', 'foi-e2',  'foi-p4'), ('fist-of-ilmater', 'foi-e2',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e3',  'foi-p1'), ('fist-of-ilmater', 'foi-e3',  'foi-p3'), ('fist-of-ilmater', 'foi-e3',  'foi-p4'), ('fist-of-ilmater', 'foi-e3',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e4',  'foi-p1'), ('fist-of-ilmater', 'foi-e4',  'foi-p3'), ('fist-of-ilmater', 'foi-e4',  'foi-p4'), ('fist-of-ilmater', 'foi-e4',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e5',  'foi-p3'), ('fist-of-ilmater', 'foi-e5',  'foi-p4'), ('fist-of-ilmater', 'foi-e5',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e6',  'foi-p3'), ('fist-of-ilmater', 'foi-e6',  'foi-p4'), ('fist-of-ilmater', 'foi-e6',  'foi-p5'),
  ('fist-of-ilmater', 'foi-e7',  'foi-p3'), ('fist-of-ilmater', 'foi-e7',  'foi-p4'), ('fist-of-ilmater', 'foi-e7',  'foi-p5'), ('fist-of-ilmater', 'foi-e7',  'foi-p6'),
  ('fist-of-ilmater', 'foi-e8',  'foi-p3'), ('fist-of-ilmater', 'foi-e8',  'foi-p4'), ('fist-of-ilmater', 'foi-e8',  'foi-p5'), ('fist-of-ilmater', 'foi-e8',  'foi-p6'), ('fist-of-ilmater', 'foi-e8',  'foi-p7'),
  ('fist-of-ilmater', 'foi-e9',  'foi-p3'), ('fist-of-ilmater', 'foi-e9',  'foi-p4'), ('fist-of-ilmater', 'foi-e9',  'foi-p5'), ('fist-of-ilmater', 'foi-e9',  'foi-p6'), ('fist-of-ilmater', 'foi-e9',  'foi-p7'),
  ('fist-of-ilmater', 'foi-e10', 'foi-p3'), ('fist-of-ilmater', 'foi-e10', 'foi-p4'), ('fist-of-ilmater', 'foi-e10', 'foi-p5'), ('fist-of-ilmater', 'foi-e10', 'foi-p6'), ('fist-of-ilmater', 'foi-e10', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e11', 'foi-p3'), ('fist-of-ilmater', 'foi-e11', 'foi-p4'), ('fist-of-ilmater', 'foi-e11', 'foi-p5'), ('fist-of-ilmater', 'foi-e11', 'foi-p6'), ('fist-of-ilmater', 'foi-e11', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e12', 'foi-p3'), ('fist-of-ilmater', 'foi-e12', 'foi-p4'), ('fist-of-ilmater', 'foi-e12', 'foi-p5'), ('fist-of-ilmater', 'foi-e12', 'foi-p7'),
  ('fist-of-ilmater', 'foi-e13', 'foi-p4'), ('fist-of-ilmater', 'foi-e13', 'foi-p5'),
  ('fist-of-ilmater', 'foi-e14', 'foi-p4'), ('fist-of-ilmater', 'foi-e14', 'foi-p5'), ('fist-of-ilmater', 'foi-e14', 'foi-p7')
on conflict (event_id, person_id) do nothing;

-- ==========================================================================
-- Connections (bigserial PK: delete campaign-scoped, then insert)
-- ==========================================================================

delete from public.connections where campaign_id = 'fist-of-ilmater';

insert into public.connections (campaign_id, from_id, to_id, label) values
  ('fist-of-ilmater', 'foi-p3',  'foi-f1',  'shield of the guild'),
  ('fist-of-ilmater', 'foi-p4',  'foi-f1',  'shield of the guild'),
  ('fist-of-ilmater', 'foi-p5',  'foi-f1',  'shield of the guild'),
  ('fist-of-ilmater', 'foi-p1',  'foi-f1',  'died a shield of the guild'),
  ('fist-of-ilmater', 'foi-p8',  'foi-f1',  'leads'),
  ('fist-of-ilmater', 'foi-p9',  'foi-f1',  'elite of'),
  ('fist-of-ilmater', 'foi-p2',  'foi-p21', 'brother of'),
  ('fist-of-ilmater', 'foi-p22', 'foi-f8',  'led'),
  ('fist-of-ilmater', 'foi-q2',  'foi-f8',  'destroyed'),
  ('fist-of-ilmater', 'foi-p10', 'foi-l4',  'sought the Forge within'),
  ('fist-of-ilmater', 'foi-q3',  'foi-l4',  'delved'),
  ('fist-of-ilmater', 'foi-p11', 'foi-f5',  'wore as a disguise'),
  ('fist-of-ilmater', 'foi-p13', 'foi-p11', 'devoted to'),
  ('fist-of-ilmater', 'foi-p25', 'foi-p11', 'in league with'),
  ('fist-of-ilmater', 'foi-p27', 'foi-p11', 'avatar of'),
  ('fist-of-ilmater', 'foi-p23', 'foi-l2',  'froze the town'),
  ('fist-of-ilmater', 'foi-p12', 'foi-l8',  'lord of'),
  ('fist-of-ilmater', 'foi-p14', 'foi-p12', 'hunted'),
  ('fist-of-ilmater', 'foi-i1',  'foi-p12', 'slew'),
  ('fist-of-ilmater', 'foi-p16', 'foi-p12', 'courted by'),
  ('fist-of-ilmater', 'foi-p15', 'foi-f2',  'seer of'),
  ('fist-of-ilmater', 'foi-p18', 'foi-f2',  'kept close by'),
  ('fist-of-ilmater', 'foi-p17', 'foi-f3',  'keeper of'),
  ('fist-of-ilmater', 'foi-i6',  'foi-p15', 'prepared by'),
  ('fist-of-ilmater', 'foi-i5',  'foi-p1',  'all that remains of'),
  ('fist-of-ilmater', 'foi-i4',  'foi-p6',  'deemed worthy'),
  ('fist-of-ilmater', 'foi-i4',  'foi-f6',  'kept by'),
  ('fist-of-ilmater', 'foi-p24', 'foi-l12', 'chief of'),
  ('fist-of-ilmater', 'foi-q6',  'foi-l13', 'leads to'),
  ('fist-of-ilmater', 'foi-q6',  'foi-f7',  'against'),
  ('fist-of-ilmater', 'foi-p26', 'foi-f6',  'investigates for'),
  ('fist-of-ilmater', 'foi-q4',  'foi-p12', 'destroyed'),
  ('fist-of-ilmater', 'foi-q7',  'foi-p11', 'against'),
  ('fist-of-ilmater', 'foi-i2',  'foi-p12', 'reveals the weaknesses of');

-- ==========================================================================
-- Board positions (the board hides entities without a row)
-- ==========================================================================

insert into public.board_positions (campaign_id, entity_id, x, y, rot, kind) values
  -- The party, across the top
  ('fist-of-ilmater', 'foi-p1',  700,  120, -2, 'people'),
  ('fist-of-ilmater', 'foi-p2',  880,  120,  2, 'people'),
  ('fist-of-ilmater', 'foi-p3',  1060, 120, -1, 'people'),
  ('fist-of-ilmater', 'foi-p4',  1240, 120,  3, 'people'),
  ('fist-of-ilmater', 'foi-p5',  1420, 120, -3, 'people'),
  ('fist-of-ilmater', 'foi-p6',  1600, 120,  1, 'people'),
  ('fist-of-ilmater', 'foi-p7',  1780, 120, -2, 'people'),
  -- Sword Coast cluster (left)
  ('fist-of-ilmater', 'foi-p8',  300,  300,  2, 'people'),
  ('fist-of-ilmater', 'foi-p9',  140,  420, -3, 'people'),
  ('fist-of-ilmater', 'foi-p10', 480,  420,  1, 'people'),
  ('fist-of-ilmater', 'foi-p21', 60,   560,  2, 'people'),
  ('fist-of-ilmater', 'foi-p22', 160,  700,  3, 'people'),
  ('fist-of-ilmater', 'foi-p23', 360,  860, -2, 'people'),
  ('fist-of-ilmater', 'foi-p24', 620,  1180, 1, 'people'),
  ('fist-of-ilmater', 'foi-p25', 880,  1260,-3, 'people'),
  ('fist-of-ilmater', 'foi-p26', 420,  1120, 2, 'people'),
  ('fist-of-ilmater', 'foi-p11', 1050, 600, -4, 'people'),
  -- Barovia cluster (right)
  ('fist-of-ilmater', 'foi-p12', 1900, 300, -2, 'people'),
  ('fist-of-ilmater', 'foi-p13', 2100, 440,  3, 'people'),
  ('fist-of-ilmater', 'foi-p14', 1450, 360,  1, 'people'),
  ('fist-of-ilmater', 'foi-p15', 1350, 560, -2, 'people'),
  ('fist-of-ilmater', 'foi-p16', 1650, 480,  2, 'people'),
  ('fist-of-ilmater', 'foi-p17', 1850, 640, -1, 'people'),
  ('fist-of-ilmater', 'foi-p18', 1400, 760,  3, 'people'),
  ('fist-of-ilmater', 'foi-p19', 1600, 860, -2, 'people'),
  ('fist-of-ilmater', 'foi-p20', 2050, 800,  2, 'people'),
  ('fist-of-ilmater', 'foi-p27', 2200, 950, -3, 'people'),
  -- Locations
  ('fist-of-ilmater', 'foi-l1',  200,  180,  1, 'locations'),
  ('fist-of-ilmater', 'foi-l2',  520,  260, -2, 'locations'),
  ('fist-of-ilmater', 'foi-l3',  100,  880,  2, 'locations'),
  ('fist-of-ilmater', 'foi-l4',  680,  520, -1, 'locations'),
  ('fist-of-ilmater', 'foi-l5',  820,  320,  3, 'locations'),
  ('fist-of-ilmater', 'foi-l6',  1300, 200, -2, 'locations'),
  ('fist-of-ilmater', 'foi-l7',  1750, 220,  1, 'locations'),
  ('fist-of-ilmater', 'foi-l8',  2150, 240, -3, 'locations'),
  ('fist-of-ilmater', 'foi-l9',  2250, 600,  2, 'locations'),
  ('fist-of-ilmater', 'foi-l10', 1500, 640, -1, 'locations'),
  ('fist-of-ilmater', 'foi-l11', 950,  1050, 2, 'locations'),
  ('fist-of-ilmater', 'foi-l12', 700,  1350,-2, 'locations'),
  ('fist-of-ilmater', 'foi-l13', 1150, 1300, 1, 'locations'),
  ('fist-of-ilmater', 'foi-l14', 900,  1200, 3, 'locations'),
  -- Factions
  ('fist-of-ilmater', 'foi-f1',  350,  60,  -1, 'factions'),
  ('fist-of-ilmater', 'foi-f2',  1300, 420,  2, 'factions'),
  ('fist-of-ilmater', 'foi-f3',  1950, 520, -2, 'factions'),
  ('fist-of-ilmater', 'foi-f4',  250,  1000, 1, 'factions'),
  ('fist-of-ilmater', 'foi-f5',  900,  700, -3, 'factions'),
  ('fist-of-ilmater', 'foi-f6',  500,  980,  2, 'factions'),
  ('fist-of-ilmater', 'foi-f7',  1350, 1400,-1, 'factions'),
  ('fist-of-ilmater', 'foi-f8',  150,  780, -2, 'factions'),
  -- Quests
  ('fist-of-ilmater', 'foi-q1',  700,  240,  2, 'quests'),
  ('fist-of-ilmater', 'foi-q2',  60,   760, -2, 'quests'),
  ('fist-of-ilmater', 'foi-q3',  760,  640,  1, 'quests'),
  ('fist-of-ilmater', 'foi-q4',  2000, 380, -2, 'quests'),
  ('fist-of-ilmater', 'foi-q5',  1250, 880,  3, 'quests'),
  ('fist-of-ilmater', 'foi-q6',  1300, 1180,-2, 'quests'),
  ('fist-of-ilmater', 'foi-q7',  1100, 480,  2, 'quests'),
  ('fist-of-ilmater', 'foi-q8',  1000, 1400, 1, 'quests'),
  -- Items
  ('fist-of-ilmater', 'foi-i1',  1800, 760, -2, 'items'),
  ('fist-of-ilmater', 'foi-i2',  1700, 960,  2, 'items'),
  ('fist-of-ilmater', 'foi-i3',  1900, 900, -1, 'items'),
  ('fist-of-ilmater', 'foi-i4',  450,  1250, 3, 'items'),
  ('fist-of-ilmater', 'foi-i5',  560,  180, -3, 'items'),
  ('fist-of-ilmater', 'foi-i6',  1450, 1000, 1, 'items'),
  -- Lore
  ('fist-of-ilmater', 'foi-lo1', 80,   140,  2, 'lore'),
  ('fist-of-ilmater', 'foi-lo2', 1150, 180, -2, 'lore'),
  ('fist-of-ilmater', 'foi-lo3', 1150, 900,  2, 'lore')
on conflict (campaign_id, entity_id) do nothing;
