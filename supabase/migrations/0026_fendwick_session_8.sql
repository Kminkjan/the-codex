-- ===========================================================================
-- Fendwick session 8: "The Recap Is a Retcon"
--
-- The first session rows this campaign has ever had. The 0002 seed was built
-- from a recap that already summarized this session's Alivar Thalin meeting
-- (people p5, quests q1/q3/q4), so the verbatim notes land here as a mix of
-- creates and updates rather than a fresh import — the Alivar/Domar/Fitzgerald
-- rows are corrected and deepened, not duplicated.
--
-- Sessions 1-7 are inserted as empty placeholders so session 8 doesn't read as
-- the campaign's first night. Fill them in if the older notes turn up.
--
-- Naming: the notes spell things Fenwick / Torringale / Alevar / Fitz Derald.
-- The codex spellings (Fendwick, Toringale, Alivar, Fitzgerald) win; the only
-- correction taken from the notes is Alivar's length of service, 24 -> 25
-- years, and Fitzgerald's first name, Ayrton.
--
-- Idempotent: id'd rows use ON CONFLICT DO NOTHING, the bigserial tables
-- (connections, session_events) are guarded by NOT EXISTS on their natural
-- key, and every UPDATE is a straight assignment.
-- ===========================================================================

-- ==========================================================================
-- 1. Sessions — placeholders for 1-7, the real record for 8
-- ==========================================================================

insert into public.sessions (id, campaign_id, num, title, date, in_game_date, summary) values
  ('fw-s1', 'fendwick', 1, 'Notes not yet transcribed', null, null, null),
  ('fw-s2', 'fendwick', 2, 'Notes not yet transcribed', null, null, null),
  ('fw-s3', 'fendwick', 3, 'Notes not yet transcribed', null, null, null),
  ('fw-s4', 'fendwick', 4, 'Notes not yet transcribed', null, null, null),
  ('fw-s5', 'fendwick', 5, 'Notes not yet transcribed', null, null, null),
  ('fw-s6', 'fendwick', 6, 'Notes not yet transcribed', null, null, null),
  ('fw-s7', 'fendwick', 7, 'Notes not yet transcribed', null, null, null)
on conflict (id) do nothing;

insert into public.sessions (id, campaign_id, num, title, date, in_game_date, summary) values
  ('fw-s8', 'fendwick', 8, 'The Recap Is a Retcon', null, 'Summer',
$md$**Attendance:** Melvin, Mono, Montague, Rosie, Jo, Faithbreaker — joined mid-session by Berend and Faye.

*De recap is een retcon. Fuck de recap.*

### Berend's morning

Berend returned to Ezra while the rest of us rested. Ezra — a female tabaxi, hurt and clearly not thinking straight — was in the middle of dressing her wounds with an old, dirty bandage. Berend told her what happened at the Estate. Ezra wasn't sure she could trust us, or the Falcon Legion.

By morning she had decided she wasn't healthy enough to take an active part in any of this, but she told Berend to join us for now: our cause, she thinks, would benefit her employer. Berend knows nothing about this employer, and Ezra turned evasive when he asked. She distrusts part of our Legion but wants to believe most of us are good. She and Berend have worked together these past few weeks; this is where their paths diverge. She heads for Toringale, and she will miss him.

Berend went to the Barracks, where Dr. Ivory told him we had headed back towards the mansion. He decided to go after us.

### Faye

Faye has been renting a room at the Lily for a couple of weeks, looking for something in Fendwick. Today, walking around town, her vision distorted. The tremors subsided; a black spot in her eye did not.

She arrived at the mansion just as we killed the big demon — the same moment Berend arrived. Melvin gave Berend a part of his cape to let him join us on a temporary contract. Then the elf approached us: Clae Halygalyn. Faye. She'd had a vision, and that is why she went to the mansion. For some reason she and Berend met each other in Spireholm a month ago, and Berend therefore trusts her blindly. Melvin gave Faye a part of his cape as well. The idiot.

### Darren

Meanwhile Jo fell asleep against the cart she arrived in, whilst Darren was still tied up in that cart. We decided to send Berend and Rosie to talk to him. The boy, whose leg is broken, looked at them with mean eyes. He's from Toringale.

Darren was just working for "Mr. Orin" to make some money; he was preparing for a "shipment". Mr. Orin — or someone — cast a spell on Darren so that they could hear what Darren says even when he's far away. After telling whoever that is (it might be Mr. Orin, it might also not be Mr. Orin) about this, Berend cut his ropes so he could eat his croissant, then carried Darren to the rest of us.

### What's inside them

The helmed beast was unhelmed by Melvin and me — which makes him no longer a helmed beast — revealing his head to be buffalo-esque. Reminds me of children's tales of animals transformed into soldiers.

Mono gutted one of the lesser demons and found out that they seemed decidedly human on the inside, but blackened and twisted. The blackness seems to spread from the heart. He gutted a second one, which was way more rotted on the inside. The "fresher" one apparently pleaded for his life (or death) to Montague during the fight. The demons each have tattered clothes on their bodies and some unique individual traits — beautiful phrasing there. They also have animalistic teeth.

### The Windriders

There are two moons. It's summer.

We waited at the basement teleportation circle for four hours, but nothing happened. We gagged Darren and left back for Fendwick. Close to Fendwick, a group of six flying, cat-like creatures came down bearing people in tailor-made Falcon Legionnaire outfits. They questioned our outfits while Melvin tried to convince them of his position as interim commander. Their leader introduced themselves as Alivar Thalin, section commander of the 7th Windriders, Lightning Section. They had heard of an attack or incursion on Fendwick from their higher-ups — Wingleader Domar.

Melvin tells them EVERYTHING, including that Ayrton Fitzgerald is the Grand Warden of Toringale and that this might possibly have something to do with all the stuff happening. Alivar is stoic, but he does react slightly to hearing that name.

They headed towards the Barracks with us. I don't trust them, because the timeline seems weird — the attacks were four days ago, so how did they get here so fast? And they came from the *south* of Fendwick.

Alivar took office in the, ah, office of the missing commander. He asked us if someone outside of Fendwick would recognise us. He did something to us by fiddling something out of sight, and asked all of us individually if he could trust us. He then started a monologue about serving in the Falcon Legion for about 25 years, how people don't trust the Legion, and how he and his men aren't necessarily the most "good" people. More of *his* people are supposedly on their way to Fendwick.

And we were given a strange binary choice between **A.** doing what we already planned to do, or **B.** staying in Fendwick and performing our lowly duties.$md$)
on conflict (id) do nothing;

-- ==========================================================================
-- 2. Locations
-- ==========================================================================

insert into public.locations (id, campaign_id, name, kind, "desc", region, ruler, notes) values
  ('l9',  'fendwick', 'The Lily',          'Lodging House', 'Rooms to let in Fendwick. Faye has been renting one for a couple of weeks while she looks for something in town.', 'Fendwick', null, 'Whatever Faye is looking for, she thinks it is in Fendwick.'),
  ('l10', 'fendwick', 'Fendwick Barracks', 'Barracks',      'The Falcon Legion''s station in Fendwick, and the seat of the town''s absent command.', 'Fendwick', null, 'Commander Blackstow''s office stood empty until Alivar Thalin took it. Dr. Ivory can usually be found here.')
on conflict (id) do nothing;

-- ==========================================================================
-- 3. Factions
-- ==========================================================================

insert into public.factions (id, campaign_id, name, sigil, "desc", allegiance) values
  ('f4', 'fendwick', '7th Windriders, Lightning Section', 'W', 'A Falcon Legion air section that rides flying, cat-like mounts and wears tailor-made uniforms. Six of them dropped on us outside Fendwick under section commander Alivar Thalin. More are said to be on the way.', 'Neutral')
on conflict (id) do nothing;

-- ==========================================================================
-- 4. Items
-- ==========================================================================

insert into public.items (id, campaign_id, name, kind, "desc") values
  ('i3', 'fendwick', 'Melvin''s Cape', 'Insignia', 'Melvin tears strips off his own cape and hands them out as temporary contracts with the Fendwick Legionnaires. Berend and Faye each hold a piece. Whether this means anything to the actual Falcon Legion is untested.')
on conflict (id) do nothing;

-- ==========================================================================
-- 5. Lore
-- ==========================================================================

insert into public.lore (id, campaign_id, title, text) values
  ('lo4', 'fendwick', 'Two Moons Over Alderin', 'There are two moons in the sky. It is currently summer.'),
  ('lo5', 'fendwick', 'What''s Inside a Demon', 'Cut one open and it is decidedly human on the inside — but blackened and twisted, and the blackness spreads outward from the heart. Older ones are further gone: the second Mono opened was far more rotted than the first. They wear tattered clothes, they have animalistic teeth, and each one carries some unique individual trait. The "fresher" one begged Montague for its life, or its death.'),
  ('lo6', 'fendwick', 'Tales of Animals Made Soldiers', 'Unhelm a helmed beast and it stops being a helmed beast. Under the helmet was a buffalo-esque head — which calls up the children''s tales about animals transformed into soldiers.')
on conflict (id) do nothing;

-- ==========================================================================
-- 6. Monsters — the Bestiary's first plates
-- ==========================================================================

insert into public.monsters (id, campaign_id, name, kind, threat, habitat, "desc", notes) values
  ('m1', 'fendwick', 'The Helmed Beast', 'Beastman', 'deadly', 'Kellin Estate',
   'A helmeted soldier-thing that fought us at the mansion. Unhelmed, its head proved buffalo-esque — an animal''s skull on a soldier''s body.',
   'Unhelmed by Melvin and Faithbreaker, which by definition makes it no longer a helmed beast. Matches the children''s tales of animals transformed into soldiers.'),
  ('m2', 'fendwick', 'Lesser Demon', 'Demon', 'risky', 'Kellin Estate',
   'The rank and file of the mansion''s demons. Human on the inside, blackened and twisted, with the corruption radiating out from the heart. Tattered clothes, animalistic teeth, and one unique individual trait each.',
   'Mono gutted two. The second was far more rotted than the first, so the rot appears to progress. The fresher one pleaded with Montague mid-fight for its life or its death — they can still talk, and still want something.'),
  ('m3', 'fendwick', 'The Big Demon', 'Demon', 'deadly', 'Kellin Estate',
   'The large demon that held the mansion. Killed at the moment Faye and Berend arrived.',
   'Died before either newcomer could see what we had been fighting.')
on conflict (id) do nothing;

-- ==========================================================================
-- 7. People — Ezra, and the party roster (first PC rows in this campaign)
--
-- race/alignment deliberately left null on the party: the notes establish what
-- everyone did, not what they are. Fill those in from the app.
-- ==========================================================================

insert into public.people (id, campaign_id, name, epithet, race, role, tier, status, disposition, faction_id, location_id, notes, last_seen_session_id) values
  ('p17', 'fendwick', 'Ezra', 'Berend''s Former Partner', 'Tabaxi', 'Mercenary in someone else''s employ', 'supporting', 'alive', 'ally', null, 'l2',
   'Female tabaxi. Found hurt and clearly not thinking straight, dressing her wounds with an old, dirty bandage. Judged herself too unwell to take an active part and sent Berend to us instead — she believes our cause would benefit her employer, whom Berend knows nothing about and about whom she turns evasive. Distrusts part of our Legion but wants to believe most of us are good. Worked alongside Berend for the past few weeks. Left for Toringale; she will miss him.', 'fw-s8'),

  ('p18', 'fendwick', 'Melvin', 'Interim Commander', null, 'Self-appointed interim commander of the Fendwick Legionnaires', 'major', 'alive', 'ally', 'f3', 'l1',
   'Holds the Fendwick Legionnaires together by asserting that he does. Hands out strips of his own cape as temporary contracts — Berend and Faye both got one, on the strength of very little. Told the Windriders EVERYTHING, Fitzgerald included. Helped Faithbreaker unhelm the helmed beast.', 'fw-s8'),

  ('p19', 'fendwick', 'Berend', null, null, 'Legionnaire on a temporary cape-contract', 'major', 'alive', 'ally', 'f3', 'l1',
   'Worked with Ezra for the past few weeks and went back to her while we rested; she sent him to join us. Learned from Dr. Ivory at the Barracks that we had gone back to the mansion, and followed. Met Faye in Spireholm a month ago and therefore trusts her blindly. Questioned Darren with Rosie, then cut the boy''s ropes so he could eat his croissant and carried him back to us.', 'fw-s8'),

  ('p20', 'fendwick', 'Faye', 'Clae Halygalyn', 'Elf', 'Legionnaire on a temporary cape-contract', 'major', 'alive', 'ally', 'f3', 'l1',
   'Has been renting a room at the Lily for a couple of weeks, looking for something in Fendwick — she has not said what. Her vision distorted while walking through town; the tremors passed but a black spot in her eye remains. A vision is what sent her to the mansion, which she reached just as the big demon died. Met Berend in Spireholm a month ago.', 'fw-s8'),

  ('p21', 'fendwick', 'Rosie', null, null, 'Fendwick Legionnaire', 'major', 'alive', 'ally', 'f3', 'l1',
   'Sent with Berend to question Darren in the cart.', 'fw-s8'),

  ('p22', 'fendwick', 'Jo', null, null, 'Fendwick Legionnaire', 'major', 'alive', 'ally', 'f3', 'l1',
   'Arrived by cart and fell asleep against it — the same cart Darren was tied up in.', 'fw-s8'),

  ('p23', 'fendwick', 'Montague', null, null, 'Fendwick Legionnaire', 'major', 'alive', 'ally', 'f3', 'l1',
   'The "fresher" of the lesser demons pleaded with him during the fight, for its life or its death. It chose him; we do not know why.', 'fw-s8'),

  ('p24', 'fendwick', 'Mono', null, null, 'Fendwick Legionnaire', 'major', 'alive', 'ally', 'f3', 'l1',
   'Gutted two of the lesser demons and worked out what is inside them: human, blackened and twisted, the corruption spreading from the heart. The second was further gone than the first.', 'fw-s8'),

  ('p25', 'fendwick', 'Faithbreaker', 'The Chronicler', null, 'Fendwick Legionnaire', 'major', 'alive', 'ally', 'f3', 'l1',
   'Keeps these notes, and the opinions in them. Helped Melvin unhelm the helmed beast. Does not trust the Windriders: the attacks were four days ago and they arrived from the south, which does not add up.', 'fw-s8')
on conflict (id) do nothing;

-- ==========================================================================
-- 8. Quests — the threads session 8 opened
-- ==========================================================================

insert into public.quests (id, campaign_id, title, "desc", status, giver_id, session_id, hooks, reward) values
  ('q7',  'fendwick', 'Alivar''s binary choice',
   'Alivar Thalin offered a strange binary choice: A. do what we had already planned to do, or B. stay in Fendwick and perform our lowly duties. Both roads are his to offer, which is itself the problem.',
   'pursuing', 'p5', 'fw-s8',
   'Neither option is refusal. Ask what happens to Fendwick if we pick A, and who garrisons it if we pick B.', 'Unknown'),

  ('q8',  'fendwick', 'What did Alivar do to us out of sight?',
   'While questioning each of us individually about whether he could trust us, Alivar was fiddling with something out of sight. Whatever it was, it was aimed at us.',
   'whispered', null, 'fw-s8',
   'He also asked whether anyone outside of Fendwick would recognise us — an odd thing to want to know.', 'Unknown'),

  ('q9',  'fendwick', 'Who is Ezra''s employer?',
   'Ezra believes our cause would benefit her employer. Berend has worked beside her for weeks and knows nothing about them, and she turns evasive when asked.',
   'whispered', 'p17', 'fw-s8',
   'She has gone to Toringale — the same city as Fitzgerald, Mr. Orin, and the warehouse.', 'Unknown'),

  ('q10', 'fendwick', 'What is Faye looking for in Fendwick?',
   'Faye has been renting a room at the Lily for weeks, searching for something in town she has not named. Her visions sent her to the mansion, and one of them left a black spot in her eye.',
   'whispered', 'p20', 'fw-s8',
   'The visions arrive with tremors and distorted sight. Something is aiming her.', 'Unknown'),

  ('q11', 'fendwick', 'What was Mr. Orin''s "shipment"?',
   'Darren was working for Mr. Orin to make some money, and says he was preparing for a "shipment". Darren was himself moved by teleportation circle, which suggests how the goods travel.',
   'whispered', 'p1', 'fw-s8',
   'Nothing came through the Kellin Estate circle in the four hours we watched it. Either the shipment is late, or it is not coming that way.', 'Unknown'),

  ('q12', 'fendwick', 'Has Orin heard everything Darren has said?',
   'A spell on Darren let someone hear what he says even from far away. Berend spoke to that listener directly. Everything said around the boy since his capture may already be known.',
   'whispered', null, 'fw-s8',
   'The listener may or may not be Mr. Orin. Darren is gagged now — which only helps from the moment we gagged him.', 'Unknown')
on conflict (id) do nothing;

-- ==========================================================================
-- 9. Updates to existing rows
-- ==========================================================================

-- Darren: broken leg, a handler listening through him, and a ride back to town.
update public.people set
  race    = 'Half-elf',
  role    = 'Conscripted scout; Mr. Orin''s errand boy',
  tier    = 'supporting',
  status  = 'alive',
  notes   = 'Young boy enlisted by the Conspiracy via Mr. Orin. Teleported from the Toringale warehouse to Kellin Estate. Wants to go home to his sick mother. He is from Toringale himself, and says he was only working for "Mr. Orin" for the money — he was preparing for a "shipment". His leg is broken and he looks at us with mean eyes. Someone had put a spell on him that let them hear what he says from far away. Berend cut his ropes so he could eat his croissant and carried him to us; we gagged him again before leaving the mansion.',
  location_id = 'l1',
  last_seen_session_id = 'fw-s8'
where id = 'p1' and campaign_id = 'fendwick';

-- Mr. Orin: the listener at the other end of Darren's spell.
update public.people set
  notes = 'Enlisted Darren and used him to scout the mansion. Whereabouts unknown. Had a spell placed on Darren that let him — or whoever holds the other end — hear the boy from far away, so he may have heard everything said around him. Darren was preparing a "shipment" for him.'
where id = 'p3' and campaign_id = 'fendwick';

-- Fitzgerald: a first name, and a flinch from Alivar.
update public.people set
  name  = 'Ayrton Fitzgerald',
  notes = 'Was under investigation by Warden Chainguard before her abduction. Named in a diary found in Kellin Estate — in the demon''s hand. Melvin named him to the Windriders as the Grand Warden of Toringale and a likely hand behind all of this; Alivar is stoic, but he reacted slightly to hearing the name.'
where id = 'p4' and campaign_id = 'fendwick';

-- Alivar Thalin: 25 years, the missing commander's office, and our distrust.
update public.people set
  role        = 'Section commander, 7th Windriders, Lightning Section',
  tier        = 'major',
  status      = 'alive',
  disposition = 'wary',
  faction_id  = 'f4',
  location_id = 'l10',
  notes       = 'Dropped on us outside Fendwick with six flying, cat-like mounts and a section in tailor-made uniforms, sent to reinforce the town after his higher-ups heard of an attack or incursion — allegedly on Wingleader Domar''s word. Stoic. Took office in the missing commander''s office at the Barracks, asked whether anyone outside Fendwick would recognise us, then questioned each of us individually about whether he could trust us while fiddling with something out of sight. Monologued about 25 years in the Falcon Legion, how people don''t trust it, and how he and his men aren''t necessarily the most "good" people. More of his people are supposedly on their way. Offered us a binary choice: proceed as planned, or stay in Fendwick on lowly duties.',
  last_seen_session_id = 'fw-s8'
where id = 'p5' and campaign_id = 'fendwick';

-- Domar: where the order came from.
update public.people set
  notes = 'Allegedly sent Alivar Thalin. Alivar''s section heard of the attack or incursion on Fendwick from their higher-ups, Domar among them. Who told Domar?'
where id = 'p6' and campaign_id = 'fendwick';

-- Dr. Ivory: the reason Berend caught up with us.
update public.people set
  role        = 'Fendwick doctor',
  tier        = 'supporting',
  status      = 'alive',
  location_id = 'l10',
  notes       = 'Local doctor. Treated the real Warden Chainguard after her rescue. Told Berend at the Barracks that we had headed back towards the mansion, which is how he found us.',
  last_seen_session_id = 'fw-s8'
where id = 'p14' and campaign_id = 'fendwick';

-- Kellin Estate: the big demon dies, the beast is unhelmed, the circle stays shut.
update public.locations set
  notes = 'Darren was teleported here. Warden Chainguard was found alive in the basement after the false warden was killed. The big demon died here, at the moment Faye and Berend arrived. The helmed beast was unhelmed here and proved buffalo-headed; Mono opened up two of the lesser demons. We watched the basement teleportation circle for four hours and nothing came through.'
where id = 'l4' and campaign_id = 'fendwick';

-- Toringale: everyone's heading there.
update public.locations set
  notes = 'Warden Chainguard was investigating Grand Warden Fitzgerald here before her abduction. Darren is from here, and Ezra left for it. Mr. Orin operates out of it.'
where id = 'l2' and campaign_id = 'fendwick';

-- Fendwick Legionnaires: two new cape-contracts.
update public.factions set
  "desc" = 'The party — de facto town militia, pieced together from reluctant locals and stranded Falcon Legion. Melvin holds it together as interim commander and recruits by tearing strips off his own cape; Berend and Faye joined this way.'
where id = 'f3' and campaign_id = 'fendwick';

-- The timeline question, with the numbers that make it a question.
update public.quests set
  "desc" = 'The dates do not line up. The attacks on Fendwick were four days ago — how did a section from outside get here that fast? And Alivar''s Windriders came from the south of Fendwick, not from Spireholm.',
  hooks  = 'Four days, and they arrived from the south. Find out where the 7th Windriders were actually stationed.',
  session_id = 'fw-s8'
where id = 'q4' and campaign_id = 'fendwick';

-- ==========================================================================
-- 10. Connections
--
-- bigserial ids, so each edge is guarded on its own (from, to, label) triple.
-- ==========================================================================

insert into public.connections (campaign_id, from_id, to_id, label)
select v.campaign_id, v.from_id, v.to_id, v.label
from (values
  -- Ezra
  ('fendwick', 'p17', 'p19',  'former partner of'),
  ('fendwick', 'p17', 'l2',   'left for'),
  ('fendwick', 'p17', 'q9',   'serves an unnamed employer'),
  -- The party
  ('fendwick', 'p18', 'f3',   'interim commander of'),
  ('fendwick', 'p19', 'f3',   'contracted to'),
  ('fendwick', 'p20', 'f3',   'contracted to'),
  ('fendwick', 'p21', 'f3',   'member of'),
  ('fendwick', 'p22', 'f3',   'member of'),
  ('fendwick', 'p23', 'f3',   'member of'),
  ('fendwick', 'p24', 'f3',   'member of'),
  ('fendwick', 'p25', 'f3',   'member of'),
  -- The cape
  ('fendwick', 'p18', 'i3',   'tears up'),
  ('fendwick', 'i3',  'p19',  'contracted'),
  ('fendwick', 'i3',  'p20',  'contracted'),
  -- Berend and Faye's arrival
  ('fendwick', 'p19', 'p20',  'met in Spireholm'),
  ('fendwick', 'p14', 'p19',  'directed to the mansion'),
  ('fendwick', 'p20', 'l9',   'rents a room at'),
  ('fendwick', 'l9',  'l1',   'stands in'),
  -- Darren in the cart
  ('fendwick', 'p19', 'p1',   'questioned'),
  ('fendwick', 'p21', 'p1',   'questioned'),
  ('fendwick', 'p1',  'l2',   'comes from'),
  ('fendwick', 'p3',  'p1',   'listens through'),
  -- The Bestiary
  ('fendwick', 'p18', 'm1',   'unhelmed'),
  ('fendwick', 'p25', 'm1',   'unhelmed'),
  ('fendwick', 'p24', 'm2',   'dissected'),
  ('fendwick', 'm2',  'p23',  'pleaded with'),
  ('fendwick', 'm1',  'l4',   'fought at'),
  ('fendwick', 'm2',  'l4',   'fought at'),
  ('fendwick', 'm3',  'l4',   'slain at'),
  ('fendwick', 'm1',  'lo6',  'echoes'),
  ('fendwick', 'm2',  'lo5',  'described in'),
  -- The Windriders
  ('fendwick', 'p5',  'f4',   'commands'),
  ('fendwick', 'f4',  'f2',   'section of'),
  ('fendwick', 'p5',  'l10',  'took office at'),
  ('fendwick', 'l10', 'l1',   'stands in'),
  ('fendwick', 'p10', 'l10',  'commanded from'),
  ('fendwick', 'p5',  'p4',   'reacted to the name of'),
  -- Lore
  ('fendwick', 'lo4', 'lo1',  'sky over'),
  -- New threads
  ('fendwick', 'q7',  'p5',   'offered by'),
  ('fendwick', 'q8',  'p5',   'concerns'),
  ('fendwick', 'q10', 'p20',  'concerns'),
  ('fendwick', 'q11', 'p3',   'concerns'),
  ('fendwick', 'q12', 'p1',   'concerns'),
  ('fendwick', 'q11', 'l4',   'set at')
) as v(campaign_id, from_id, to_id, label)
where not exists (
  select 1 from public.connections c
  where c.campaign_id = v.campaign_id
    and c.from_id     = v.from_id
    and c.to_id       = v.to_id
    and c.label       = v.label
);

-- ==========================================================================
-- 11. Session events — ink the Bestiary plates
--
-- monsters.ts derives "discovered" from a `reveal` row, which is what the DM's
-- RELEASE / SHOW NOW ceremony writes. Session 8 met all three in the flesh, so
-- the plates should be inked rather than sitting behind un-inked frames.
-- ==========================================================================

insert into public.session_events (campaign_id, session_id, type, entity_id, author, text)
select v.campaign_id, v.session_id, v.type, v.entity_id, v.author, v.text
from (values
  ('fendwick', 'fw-s8', 'reveal', 'm1', null::text, 'The helmed beast, unhelmed.'),
  ('fendwick', 'fw-s8', 'reveal', 'm2', null::text, 'Opened up, twice.'),
  ('fendwick', 'fw-s8', 'reveal', 'm3', null::text, 'Killed as Faye and Berend arrived.')
) as v(campaign_id, session_id, type, entity_id, author, text)
where not exists (
  select 1 from public.session_events e
  where e.campaign_id = v.campaign_id
    and e.session_id  = v.session_id
    and e.type        = v.type
    and e.entity_id   = v.entity_id
);
