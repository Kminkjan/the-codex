-- ===========================================================================
-- Fendwick: restructure the whole pre-session-8 campaign against the DM's own
-- notes ("Most Recent Overview"), the first authoritative source this campaign
-- has had.
--
-- Everything before this migration was reconstructed from player recaps: the
-- 0002 seed from a written recap, 0026/0027 from Faithbreaker's session-8
-- diary. The DM's notes correct that record in ways a spelling pass would miss,
-- so this file is a restructure rather than a patch.
--
-- WHAT THE DM'S NOTES CHANGE
--
--   Names          Darren            -> Derin Zepper (and half-orc, not half-elf)
--                  Perenia Fine      -> Perennia Vine
--                  Mayor Marducke    -> Mayor Avil Marduke
--                  Warden Chainguard -> Warden Hadoline Chainguard, female DWARF
--                  Commander         -> Section Commander Saemus Blackstow
--                  Fitzgerald        -> Grand Warden Ayrton Fitzgerald
--
--   Facts          The listener on the other end of Derin's spell is "some
--                  scary masked man", NOT Mr. Orin (q12 was wrong).
--
--                  Alivar Thalin's offer is not the player-recorded "binary
--                  choice A/B". He offered to bury the party's names under
--                  bureaucracy so they could investigate Fitzgerald off-record;
--                  Melvin counter-offered faking everyone's deaths; Thalin gave
--                  them the night. q1 and q7 are both rewritten around this.
--
--                  The timeline mystery (q4) is ANSWERED: Thalin's section was
--                  on patrol further south and was magically informed. That is
--                  also why they approached Fendwick from the south. Resolved.
--
--                  Ash Lemore led the mercenaries Perennia Vine hired; he did
--                  NOT blackmail her. "Someone powerful" did, over the Halfling
--                  Weed under the Florareum. q5 re-points at that blackmailer.
--
--                  Ash also cannot be the field poisoner: he died Emberlain 23
--                  and the fields were saved Emberlain 26, three days later.
--                  The attribution comes off him and off lo2, and q16 opens.
--
--                  Fitzgerald is "indirectly implicated thrice" — once per
--                  in-game day. q2 now names all three.
--
--   Structure      Four chapters on the DM's calendar (Sel/Meldae/Xuna,
--                  Emberlain 23/26/27) instead of seven empty placeholders plus
--                  a session 8. The world gains its real scale: Gaeva (planet)
--                  -> Esmaria (continent) -> The Alderin Kingdom (country).
--
-- SESSION RENUMBERING. fw-s1/2/3 are rewritten in place as the three in-game
-- days, fw-s4..fw-s7 are dropped (unreferenced placeholders), and fw-s8 is
-- renumbered to chapter 4. Its id stays 'fw-s8' on purpose: it is the PK behind
-- quests.session_id, people.last_seen_session_id, session_events.session_id,
-- connections and campaigns.active_session_id, and renaming it would mean
-- rewriting all five. READ THIS BEFORE WRITING ANOTHER FENDWICK MIGRATION:
-- session id 'fw-s8' is chapter 4.
--
-- ARCHIVING is strict, as asked: King Barillon Alderin, Wingleader Domar, Ol'
-- Man Ol' Fellar, The Yeasting Barrel, Jailguard BaldRick. Four of those five
-- are absent from both the DM's notes and session 8. Domar is the exception and
-- is archived on different grounds: session 8 does name him, but the notes
-- replace his whole function — Alivar's section was "magically informed" while
-- on patrol, so "who told Domar?" is superseded by q3's "who sent that
-- message?". He is archived as a spent thread, not an unnamed one. Archiving is
-- declutter
-- only (0027): the rows stay searchable, linkable, and keep their board
-- positions so unarchiving restores the card.
--
-- Two rows go the other way. 0027 archived the Florareum and the Halfling Weed
-- as "closed threads"; the DM's notes make them the hinge of the whole opening
-- (Perennia was blackmailed over that weed by someone still unnamed), so both
-- are unarchived and the weed is pinned.
--
-- The Conspiracy (f1) and its lore (lo3) are KEPT despite not being named in
-- the DM's notes verbatim. They are the notes' own "someone powerful" and the
-- thread tying Fitzgerald's three implications together, and 0027 pinned them
-- as the campaign's spine. Archiving the spine to satisfy a literal reading of
-- a working recap would be the wrong call; flagging it here is the honest one.
--
-- Idempotent: id'd inserts use ON CONFLICT DO NOTHING, bigserial connection
-- rows are NOT EXISTS-guarded, board_positions upserts on its PK, and every
-- UPDATE and DELETE is a straight assignment or a naturally repeatable filter.
-- The one statement that could have broken that rule — the placeholder-session
-- renumber in section 1 — assigns an absolute number derived from the id rather
-- than incrementing, precisely so a replay lands on the same value.
-- ===========================================================================

-- ==========================================================================
-- 1. Sessions — four chapters on the DM's calendar
--
-- Order matters: the placeholders go first so nothing transiently shares a
-- chapter number with fw-s8's new value. There is no unique constraint on
-- (campaign_id, num), so this is tidiness rather than necessity.
-- ==========================================================================

-- Safety net rather than an expectation: these placeholders were inserted by
-- 0026 with no summary and nothing has pointed at them since. If a later
-- in-app edit gave one a body or attached anything to it, it is kept and only
-- renumbered out of the way, because deleting a DM's writing to satisfy a
-- restructure is not a trade this migration gets to make.
--
-- "Attached anything" has to be checked against every table that can hold
-- session-linked state, not just the obvious two. Three of them cascade on
-- session delete and would vanish silently: session_participants (0013),
-- session_staging and session_events (0016) — i.e. attendance, staged reveals
-- and the whole live-session feed. connections is worse, because from_id/to_id
-- carry no FK at all (by design, since entity ids span eight tables), so a
-- deleted session leaves a dangling edge that breaks the relations rail without
-- erroring. arcs.start_session_id/end_session_id only null out, so they are not
-- destructive and are left off this list.
-- Delete first, renumber second. That way the guard is written once: whatever
-- survives the delete is by definition a placeholder somebody has since used,
-- and every survivor needs moving out of chapters 1-4's way.
delete from public.sessions s
where s.campaign_id = 'fendwick'
  and s.id in ('fw-s4','fw-s5','fw-s6','fw-s7')
  and s.summary is null
  and not exists (select 1 from public.quests               q where q.session_id = s.id)
  and not exists (select 1 from public.session_participants p where p.session_id = s.id)
  and not exists (select 1 from public.session_staging      t where t.session_id = s.id)
  and not exists (select 1 from public.session_events       e where e.session_id = s.id)
  and not exists (select 1 from public.connections          c where c.from_id    = s.id or c.to_id = s.id);

-- Absolute, not `num + 100`: a relative increment gated on a condition it never
-- changes would compound on every replay. Deriving the number from the id makes
-- a second run land on exactly the same value.
update public.sessions set num = 100 + (substring(id from 'fw-s(\d+)$'))::int
where campaign_id = 'fendwick'
  and id in ('fw-s4','fw-s5','fw-s6','fw-s7');

update public.sessions set
  num          = 1,
  title        = 'Blood in the Florareum',
  in_game_date = 'Sel, Emberlain 23',
  summary      = $md$*Distilled from the DM's notes. Four days before the Windriders came.*

Mercenaries attacked the Florareum, Perennia Vine's flower shop in Fendwick.

We found the mercenaries' base and killed them, their leader Ash Lemore included. One of them we kept alive and imprisoned — the DM's own notes put a question mark on that, so where he is now is a question the codex cannot answer.

Perennia had hired them herself. She was being blackmailed over the illegal Halfling Weed she was secretly growing beneath her shop, and the blackmailer was **someone powerful** — a name we still do not have.

She was brought to Warden Chainguard, who killed her behind closed doors. We did not know yet that the Warden was not the Warden.

**Ayrton Fitzgerald's name was dropped for the first time.**$md$
where id = 'fw-s1' and campaign_id = 'fendwick';

update public.sessions set
  num          = 2,
  title        = 'The Warden Was Never the Warden',
  in_game_date = 'Meldae, Emberlain 26',
  summary      = $md$*Distilled from the DM's notes. The day before the Windriders came.*

We saved the flower fields from being ruined by some sort of poison or toxin. Who put it there is still unanswered — Ash Lemore was three days dead by this point, so it was not him.

We fought and killed the fake Warden Chainguard, and two Legionnaires who also turned out to be demons.

We investigated Chainguard's house and found her personal investigation. **Fitzgerald's name was dropped for the second time.**

Then we started investigating the abandoned Kellin Estate.$md$
where id = 'fw-s2' and campaign_id = 'fendwick';

update public.sessions set
  num          = 3,
  title        = 'The Circle in the Cellar',
  in_game_date = 'Xuna, Emberlain 27 — before dawn to early afternoon',
  summary      = $md$*Distilled from the DM's notes. The same day as chapter 4, earlier.*

Very early morning: we cleared the Kellin Estate and found the teleportation circle in the basement.

A journal written by the impersonator demon contained Fitzgerald's name. **That is three times, on three consecutive days, and never once directly.**

We found the real Warden Hadoline Chainguard in the Estate — badly injured and unconscious. We brought her to Dr. Ivory at the barracks, where she remains unconscious.

We discussed everything with Mayor Avil Marduke. He sent letters by magical bird — Aeralis — to the Council of Toringale, and gave us a copy to carry personally in case the originals are intercepted.

Then a long rest, from early morning to early afternoon.$md$
where id = 'fw-s3' and campaign_id = 'fendwick';

-- Chapter 4 — session 8's own record. Player-written and largely sound; the
-- DM's notes correct the boy's name and species, the identity of the listener,
-- the mounts, and above all the substance of Alivar's offer.
update public.sessions set
  num          = 4,
  in_game_date = 'Xuna, Emberlain 27 — afternoon into evening',
  summary      = $md$**Attendance:** Melvin, Mono, Montague, Rosie, Jo, Faithbreaker — joined mid-session by Berend and Faye.

*De recap is een retcon. Fuck de recap.*

### Berend's morning

Berend returned to Ezra while the rest of us rested. Ezra — a female tabaxi, hurt and clearly not thinking straight — was in the middle of dressing her wounds with an old, dirty bandage. Berend told her what happened at the Estate. Ezra wasn't sure she could trust us, or the Falcon Legion.

By morning she had decided she wasn't healthy enough to take an active part in any of this, but she told Berend to join us for now: our cause, she thinks, would benefit her employer. Berend knows nothing about this employer, and Ezra turned evasive when he asked. She distrusts part of our Legion but wants to believe most of us are good. She and Berend have worked together these past few weeks; this is where their paths diverge. She heads for Toringale, and she will miss him.

Berend went to the Barracks, where Dr. Ivory told him we had headed back towards the mansion. He decided to go after us.

### Faye

Faye has been renting a room at the Lily for a couple of weeks, looking for something in Fendwick. Today, walking around town, her vision distorted. The tremors subsided; a black spot in her eye did not.

She arrived at the mansion just as we killed the big demon — the same moment Berend arrived. Melvin gave Berend a part of his cape to let him join us on a temporary contract. Then the elf approached us: Clae Halygalyn. Faye. She'd had a vision, and that is why she went to the mansion. For some reason she and Berend met each other in Spireholm a month ago, and Berend therefore trusts her blindly. Melvin gave Faye a part of his cape as well. The idiot.

### Derin

Meanwhile Jo fell asleep against the cart she arrived in, whilst the boy was still tied up in that cart. We decided to send Berend and Rosie to talk to him. The boy, whose leg is broken, looked at them with mean eyes. He's from Toringale.

We had him down as "Darren". His name is **Derin Zepper**, and he is a half-orc, not the half-elf we took him for.

Derin was just working for "Mr. Orin" to make some money, packing crates with food and drinks in a warehouse in Toringale. He had been tasked with checking whether the coast was clear. Someone had cast a spell on him so they could hear everything he said even from far away — and per Derin himself, that someone is **a scary masked man**, which is not the same as saying it is Mr. Orin. After speaking to whoever was listening, Berend cut his ropes so he could eat his croissant, then carried him to the rest of us.

He is scared shitless and does not really know what is going on. He is trying to earn money to care for his sick mother.

### What's inside them

The helmed beast was unhelmed by Melvin and me — which makes him no longer a helmed beast — revealing his head to be buffalo-esque. Reminds me of children's tales of animals transformed into soldiers.

Mono gutted one of the lesser demons and found out that they seemed decidedly human on the inside, but blackened and twisted. The blackness seems to spread from the heart. He gutted a second one, which was way more rotted on the inside. The "fresher" one apparently pleaded for his life (or death) to Montague during the fight. The demons each have tattered clothes on their bodies and some unique individual traits — beautiful phrasing there. They also have animalistic teeth.

### The Windriders

There are two moons. It's summer.

We waited at the basement teleportation circle for four hours, but nothing happened. We gagged Derin and left back for Fendwick. Close to Fendwick, a group of six flying, panther-like creatures came down bearing people in tailor-made Falcon Legionnaire outfits — a section commander and five Legionnaires, each on their own mount. They questioned our outfits while Melvin tried to convince them of his position as interim commander. Their leader introduced themselves as Alivar Thalin, section commander of the 7th Windriders, Lightning Section. They had heard of an attack or incursion on Fendwick from their higher-ups — Wingleader Domar.

Melvin tells them EVERYTHING, including that Ayrton Fitzgerald is the Grand Warden of Toringale and that this might possibly have something to do with all the stuff happening. Alivar is stoic, but he does react slightly to hearing that name.

They headed towards the Barracks with us. I didn't trust them, because the timeline seemed weird — the attacks were four days ago, so how did they get here so fast? And they came from the *south* of Fendwick. It turns out there is an answer: the section was already on patrol further south, and was **magically informed** to aid Fendwick. Who sent that message is the part still worth asking about.

Alivar took office in the, ah, office of the missing commander. He asked us if someone outside of Fendwick would recognise us. He did something to us by fiddling something out of sight, and asked all of us individually if he could trust us. He then started a monologue about serving in the Falcon Legion for about 25 years, how people don't trust the Legion, and how he and his men aren't necessarily the most "good" people. More of *his* people are supposedly on their way to Fendwick.

### The offer

I wrote this down as a strange binary choice — do what we already planned, or stay in Fendwick on lowly duties. That was my read, and it was thin.

What Alivar actually put on the table, early evening, was this: he would **bury our names under piles of bureaucratic bullshit** while we went off-record and investigated Fitzgerald and whatever conspiracy he might be part of.

Melvin counter-offered going a step further — **faking all of our deaths**, killed at the mansion, and going undercover deeper still.

Alivar gave us the night to sleep on it.$md$
where id = 'fw-s8' and campaign_id = 'fendwick';

-- ==========================================================================
-- 2. The chronicle: one saga, two arcs
--
-- A row with parent_id null is a saga (0025); its children are its arcs. Two
-- arcs is what the story actually breaks into — the Florareum on Emberlain 23,
-- then everything from the fake warden through the Windriders.
--
-- end_session_id is left null on the saga and on the second arc: both are still
-- being played, and pinning a last chapter here would go stale the next time
-- the party sits down (0025's own reasoning for the Giant Saga).
-- ==========================================================================

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num, parent_id) values
  ('fw-saga-fendwick', 'fendwick', 'The Fendwick Investigation',
   'A rural town''s flower shop is attacked, and four days later the party is being offered a way to disappear off the Falcon Legion''s books. Between those two points: a murdered proprietor, a Warden who was never the Warden, demons that are human on the inside, and Grand Warden Ayrton Fitzgerald''s name surfacing three days running without anyone ever saying it outright.',
   'fw-s1', null, 1, null)
on conflict (id) do nothing;

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num, parent_id) values
  ('fw-arc-florareum', 'fendwick', 'Florareum Arc',
   'Mercenaries hit Perennia Vine''s flower shop — hired by Perennia herself, who was being blackmailed over the Halfling Weed growing beneath it. Their leader Ash Lemore dies at their base; one mercenary is taken alive. Perennia is brought to Warden Chainguard and killed behind closed doors, and Fitzgerald''s name is spoken for the first time.',
   'fw-s1', 'fw-s1', 1, 'fw-saga-fendwick'),
  ('fw-arc-kellin-estate', 'fendwick', 'Kellin Estate Arc',
   'The fields are saved, the false Warden and two demon Legionnaires fall, and Chainguard''s own investigation turns up in her house. The abandoned Kellin Estate gives up a teleportation circle, the impersonator''s journal, and the real Hadoline Chainguard — then the 7th Windriders drop out of the sky with an offer.',
   'fw-s2', null, 2, 'fw-saga-fendwick')
on conflict (id) do nothing;

update public.sessions set arc_id = 'fw-arc-florareum'     where campaign_id = 'fendwick' and id = 'fw-s1';
update public.sessions set arc_id = 'fw-arc-kellin-estate' where campaign_id = 'fendwick' and id in ('fw-s2','fw-s3','fw-s8');

-- Quests are filed against arcs at the END of this migration (section 13), not
-- here: section 9 re-dates most of them onto chapters they had no session_id for
-- before, and deriving the arc first would strand them all at saga altitude.

-- ==========================================================================
-- 3. Locations — the world's real scale, and the places the notes name
-- ==========================================================================

insert into public.locations (id, campaign_id, name, kind, "desc", region, ruler, notes) values
  ('l11', 'fendwick', 'Gaeva',               'Planet',    'The world. Everything the codex records happens here.', null, null, 'Named in the DM''s notes as the outermost ring of the setting: Gaeva -> Esmaria -> The Alderin Kingdom.'),
  ('l12', 'fendwick', 'Esmaria',             'Continent', 'The continent holding the Alderin Kingdom.', 'Gaeva', null, 'What else shares the continent with Alderin is not yet recorded.'),
  ('l13', 'fendwick', 'The Alderin Kingdom', 'Country',   'The kingdom the campaign takes place in, policed by the Falcon Legion. Three major cities, of which the codex knows Spireholm and Toringale.', 'Esmaria', 'King Barillon Alderin', 'The third major city has never been named to us.'),
  ('l14', 'fendwick', 'Nordmill',            'Town',      'A town on the road between Fendwick and Toringale.', 'The Alderin Kingdom', null, 'Unvisited. It sits directly on the route the party is about to take — Derin goes home to Toringale, and the Mayor''s letter goes to the Council there.'),
  ('l15', 'fendwick', 'The Forest',          'Wilderness','Woodland outside Fendwick. Thernys the druid lives here.', 'Outside Fendwick', null, 'The only name attached to it so far is the druid''s.'),
  ('l16', 'fendwick', 'Chainguard''s House', 'Residence', 'Warden Hadoline Chainguard''s home in Fendwick. Her private investigation into Grand Warden Fitzgerald was found here.', 'Fendwick', 'Warden Hadoline Chainguard', 'Searched on Emberlain 26, while she was still a captive at the Kellin Estate. The second of Fitzgerald''s three implications came out of this house.'),
  ('l17', 'fendwick', 'The Flower Fields',   'Farmland',  'The flowerfields around Fendwick — the town''s living. Poisoned, and saved on Emberlain 26.', 'Fendwick', null, 'Who introduced the poison is unresolved. Ash Lemore had been dead three days when the fields were saved, so the codex''s old attribution to him does not survive the dates.')
on conflict (id) do nothing;

-- Fendwick: the mayor's name, and the curfew.
update public.locations set
  ruler = 'Mayor Avil Marduke',
  notes = 'Where our story has taken place thus far. The fields were being poisoned, and not everyone in the town guard was who they claimed to be — three of them turned out to be demons. Mayor Marduke has instated a curfew and reported to the Council of Toringale. The Legion''s section commander here, Saemus Blackstow, has been missing for days.'
where id = 'l1' and campaign_id = 'fendwick';

-- Toringale: north of Fendwick, and the destination of every open thread.
update public.locations set
  "desc" = 'The big city north of Fendwick, and one of the three major cities of the Alderin Kingdom.',
  notes  = 'Warden Chainguard was investigating Grand Warden Fitzgerald here before her abduction, and Fitzgerald presides here as its "High Judge". Derin Zepper is from here and packs crates in a warehouse here for Mr. Orin; Ezra left for it; the Council of Toringale sits here, and the Mayor''s letter is addressed to them. Nordmill lies on the road between.'
where id = 'l2' and campaign_id = 'fendwick';

-- The mercenaries' base — never a bandit hideout.
update public.locations set
  name   = 'The Mercenaries'' Base',
  kind   = 'Camp',
  "desc" = 'Camp of the mercenary band that attacked the Florareum. Run to ground on Emberlain 23; the band was killed there, their leader Ash Lemore included, and one mercenary taken alive. Evidence of deeply unpleasant experiments.',
  notes  = 'Recorded here as a "bandit hideout" until the DM''s notes named them mercenaries — and named who hired them: Perennia Vine herself. Possible human experimentation, unresolved.'
where id = 'l6' and campaign_id = 'fendwick';

-- The Florareum: unarchived. This is where the campaign starts.
update public.locations set
  archived = false,
  pinned   = true,
  ruler    = 'Perennia Vine (dec.)',
  "desc"   = 'Perennia Vine''s flower shop in Fendwick, and the first place in this campaign anyone drew blood. Halfling Weed was being grown beneath it.',
  notes    = 'Attacked by mercenaries on Emberlain 23 — mercenaries Perennia had hired herself, while being blackmailed over the weed in her cellar by someone powerful who has never been named. Archived as a closed thread before the DM''s notes arrived; it is nothing of the kind.'
where id = 'l7' and campaign_id = 'fendwick';

-- Kellin Estate: three days of the campaign happened here.
update public.locations set
  pinned = true,
  notes  = 'Investigated from Emberlain 26 and cleared before dawn on the 27th. Held a teleportation circle in the basement, the impersonator demon''s journal naming Fitzgerald, and the real Warden Hadoline Chainguard — badly injured and unconscious. Derin Zepper was teleported in. The big demon died here, at the moment Faye and Berend arrived; the helmed beast was unhelmed here and proved buffalo-headed, and Mono opened up two of the lesser demons. We watched the circle for four hours and nothing came through. The party returned to bury the bodies and set a trap.'
where id = 'l4' and campaign_id = 'fendwick';

-- The Toringale warehouse: what Derin actually did there.
update public.locations set
  "desc" = 'Warehouse in Toringale where Derin Zepper packs crates with food and drinks for Mr. Orin. He was teleported from here to the Kellin Estate.',
  notes  = 'Derin''s account is a boy''s account: crates, food, drinks, a boss called Mr. Orin. Whether the crates are what they look like is the open question.'
where id = 'l5' and campaign_id = 'fendwick';

-- ==========================================================================
-- 4. Factions
-- ==========================================================================

insert into public.factions (id, campaign_id, name, sigil, "desc", allegiance) values
  ('f5', 'fendwick', 'Council of Toringale',   'CT', 'The governing council of Toringale. Mayor Marduke has reported the events in Fendwick to them by magical bird, and the party carries a personal copy of that letter in case the originals are intercepted.', 'Neutral'),
  ('f6', 'fendwick', 'Lemore''s Mercenaries',  'LM', 'The mercenary band that attacked the Florareum on Emberlain 23, hired by Perennia Vine herself. Killed at their base along with their leader Ash Lemore — except one, taken alive.', 'Hostile')
on conflict (id) do nothing;

update public.factions set
  "desc" = 'A group influencing events in the Alderin Kingdom from the shadows. The DM''s notes never name it; what they name is "someone powerful" blackmailing Perennia Vine, and a Grand Warden implicated three days running without ever being named directly. This row is the codex''s word for that shape.'
where id = 'f1' and campaign_id = 'fendwick';

-- ==========================================================================
-- 5. People
--
-- Corrections first, then the new cast. Tiers are re-cut across the whole
-- roster in section 5c.
-- ==========================================================================

-- --- 5a. Corrections ------------------------------------------------------

-- Derin Zepper, not Darren. Half-orc, not half-elf. And the listener is not
-- Mr. Orin.
update public.people set
  name    = 'Derin Zepper',
  epithet = 'The Boy in the Circle',
  race    = 'Half-orc',
  role    = 'Warehouse hand; Mr. Orin''s errand boy',
  notes   = 'A young half-orc boy, scared shitless and not really aware of what is going on. Packs crates with food and drinks in a warehouse in Toringale, where he is from; his boss''s name is Mr. Orin. He was tasked with checking whether the coast was clear, and was teleported from the warehouse to the Kellin Estate, where we found him in the circle with a broken leg. Someone had cast a spell on him that let them hear everything he said from far away — Derin describes that someone as a scary masked man, which is not the same as saying it was Mr. Orin. Berend cut his ropes so he could eat his croissant and carried him to us; we gagged him again before leaving. He is only trying to earn money to care for his sick mother, and we mean to take him home.',
  location_id = 'l1',
  last_seen_session_id = 'fw-s8'
where id = 'p1' and campaign_id = 'fendwick';

-- Mr. Orin: still Derin's boss, no longer the confirmed eavesdropper.
update public.people set
  role  = 'Warehouse boss in Toringale; suspected Conspiracy handler',
  notes = 'Derin Zepper''s boss at the Toringale warehouse, and the man who sent him to check whether the coast was clear at the Kellin Estate. Whereabouts unknown. The codex previously had him listening through the spell on Derin — the boy''s own account says that voice belongs to a scary masked man, so those are now two separate people until something joins them.'
where id = 'p3' and campaign_id = 'fendwick';

-- Fitzgerald: the full name and title, and all three implications.
update public.people set
  name    = 'Grand Warden Ayrton Fitzgerald',
  epithet = '"High Judge" of Toringale',
  role    = 'Grand Warden of Toringale — its "High Judge", so to speak',
  notes   = 'Indirectly implicated three times in the events at Fendwick, once on each of the three recorded days, and never once directly. Emberlain 23: named for the first time when Perennia Vine was brought to the false Warden Chainguard and killed behind closed doors. Emberlain 26: named again in Warden Chainguard''s own private investigation, found in her house. Emberlain 27: named in the journal written by the impersonator demon, recovered from the Kellin Estate. Melvin then named him aloud to the Windriders as the Grand Warden of Toringale and a likely hand behind all of this; Alivar Thalin is stoic, but he reacted slightly to hearing it.'
where id = 'p4' and campaign_id = 'fendwick';

-- Alivar Thalin: the real offer, and the answer to the timeline.
update public.people set
  epithet     = 'Section Commander, 7th Windriders',
  role        = 'Section commander, 7th Windriders, Lightning Section',
  disposition = 'wary',
  faction_id  = 'f4',
  location_id = 'l10',
  notes       = 'Arrived in Fendwick with five Legionnaires, each on their own flying, panther-like mount. His section was on patrol further south and was magically informed to aid Fendwick — which is the answer to the timeline that bothered us, and to why they came from the south. Stoic. Took office in the missing commander''s office at the Barracks, asked whether anyone outside Fendwick would recognise us, then questioned each of us individually about whether he could trust us while fiddling with something out of sight. Monologued about 25 years in the Falcon Legion, how people don''t trust it, and how he and his men aren''t necessarily the most "good" people. More of his people are supposedly on their way. His offer: bury our names under piles of bureaucratic bullshit so we can go off-record and investigate Fitzgerald and whatever conspiracy he might be part of. Melvin counter-offered faking all our deaths at the mansion and going deeper undercover. Thalin gave us the night to sleep on it.',
  last_seen_session_id = 'fw-s8'
where id = 'p5' and campaign_id = 'fendwick';

-- Ash Lemore: mercenary leader, not the blackmailer, and not the poisoner.
update public.people set
  epithet     = 'Mercenary Leader (dec.)',
  role        = 'Leader of the mercenary band that struck the Florareum',
  status      = 'dead',
  faction_id  = 'f6',
  location_id = 'l6',
  notes       = 'Led the mercenaries Perennia Vine hired to attack her own Florareum, and died with his band when we found their base on Emberlain 23. The codex previously had him blackmailing Perennia and poisoning the flowerfields; the DM''s notes overturn both. Perennia was blackmailed by someone powerful and unnamed, and the fields were saved on Emberlain 26 — three days after Ash was already dead. Who he was working for, and who was working alongside him, are both still open.'
where id = 'p7' and campaign_id = 'fendwick';

-- Perennia Vine, not Perenia Fine.
update public.people set
  name        = 'Perennia Vine',
  epithet     = 'Owner of the Florareum (dec.)',
  role        = 'Owner of the Florareum',
  status      = 'dead',
  disposition = 'unknown',
  location_id = 'l7',
  notes       = 'Owner of the Florareum. She was secretly growing illegal Halfling Weed beneath her shop, was blackmailed over it by someone powerful, and hired the mercenaries who attacked her own premises on Emberlain 23. She was then brought to Warden Chainguard — the impersonator — and killed behind closed doors. Fitzgerald''s name was spoken for the first time at that meeting. She is the first death of this campaign and the only person who knew who was squeezing her.'
where id = 'p8' and campaign_id = 'fendwick';

-- Donald & Turnip: the DM's notes call them what they are.
update public.people set
  epithet = 'Legionnaire Colleagues',
  role    = 'Legionnaires stationed in Fendwick',
  status  = 'alive',
  notes   = 'Two dimwitted Legionnaires, and per the DM''s notes simply our colleagues. They reluctantly help the Fendwick Legionnaires.'
where id = 'p9' and campaign_id = 'fendwick';

-- Blackstow: a first name, a rank, and a status.
update public.people set
  name    = 'Section Commander Saemus Blackstow',
  epithet = 'The Missing Commander',
  role    = 'Section Commander of the Legionnaires in Fendwick',
  status  = 'missing',
  notes   = 'Section Commander of the Legionnaires in Fendwick, and missing for several days. Nobody has said where. Alivar Thalin has now taken his office at the Barracks, which is the closest thing to an answer anyone has offered.'
where id = 'p10' and campaign_id = 'fendwick';

-- Marduke, not Marducke.
update public.people set
  name    = 'Mayor Avil Marduke',
  epithet = 'Mayor and Lawmaker of Fendwick',
  role    = 'Mayor and Lawmaker of Fendwick',
  status  = 'alive',
  notes   = 'Mayor and Lawmaker of Fendwick. He has instated a curfew and informed the Council of Toringale of recent events by magical bird — Aeralis — and gave us a copy of those letters to deliver personally, in case the originals are intercepted. He seems overwhelmed by everything that has happened recently.',
  last_seen_session_id = 'fw-s3'
where id = 'p11' and campaign_id = 'fendwick';

-- Warden Hadoline Chainguard: a first name, and she is a dwarf.
update public.people set
  name    = 'Warden Hadoline Chainguard',
  epithet = 'Judge and Lawkeeper of Fendwick',
  race    = 'Dwarf',
  role    = 'Judge and lawkeeper of Fendwick',
  status  = 'alive',
  location_id = 'l10',
  notes   = 'A female dwarf, and the judge and lawkeeper of Fendwick — recorded here as human until the DM''s notes said otherwise. She was abducted and impersonated by demons, and had been investigating Grand Warden Fitzgerald before it happened; her private investigation was found in her own house on Emberlain 26. We found her at the Kellin Estate before dawn on the 27th, badly injured and unconscious, and brought her to Dr. Ivory at the barracks. She is still unconscious. Everything she knows is still inside her.',
  last_seen_session_id = 'fw-s3'
where id = 'p13' and campaign_id = 'fendwick';

-- The impersonator: a demon, not a doppelganger, and the journal is hers.
--
-- The DM's notes are explicit twice over — Chainguard "was abducted and
-- impersonated by demons", and the thing wearing her face fell on Emberlain 26
-- alongside "two Legionnaires who also turned out to be demons". The codex's
-- first draft guessed doppelganger from the behaviour.
update public.people set
  name    = 'The False Warden',
  epithet = 'The Impersonator Demon (dec.)',
  race    = 'Demon',
  status  = 'dead',
  notes   = 'Replaced and tortured Warden Hadoline Chainguard, and murdered Perennia Vine behind closed doors on Emberlain 23 — the meeting where Fitzgerald''s name first surfaced. Killed on Emberlain 26 alongside two Legionnaires who also turned out to be demons. The journal recovered from the Kellin Estate is the impersonator demon''s, and it names Fitzgerald.'
where id = 'p15' and campaign_id = 'fendwick';

-- BaldRick: one of the two demon Legionnaires killed on Emberlain 26.
update public.people set
  status = 'dead',
  notes  = 'A cunt that turned out to be a demon, impersonating a Legionnaire — one of the two killed alongside the false Warden on Emberlain 26. The demon''s diary was attributed to him in the codex''s first draft; the DM''s notes credit it to the impersonator demon, so that attribution has moved.'
where id = 'p16' and campaign_id = 'fendwick';

-- --- 5b. New cast ---------------------------------------------------------

insert into public.people (id, campaign_id, name, epithet, race, role, tier, status, disposition, alignment, faction_id, location_id, notes, last_seen_session_id) values
  -- faction_id deliberately null. The FK renders as "member of" at weight 3,
  -- which would assert Conspiracy membership the fiction does not support — all
  -- we have is a mask and a listening spell. The manual "suspected agent of"
  -- edge in section 11 carries the doubt the FK cannot express, which is the
  -- same reason 0027 kept Melvin's "interim commander of" string.
  ('p26', 'fendwick', 'The Masked Man', 'The Voice Through Derin', null, 'Unknown — an eavesdropper with a mask', 'major', 'unknown', 'hostile', null, null, null,
   'Derin Zepper says a scary masked man cast the spell that let him hear everything Derin said, from any distance. Berend spoke to him through the boy without knowing who he was. He is not, on Derin''s account, Mr. Orin — though nothing rules out that they work for the same hand. Everything said around Derin between his capture and his gagging may already be known to him.',
   'fw-s8'),

  ('p27', 'fendwick', 'Thernys', 'The Druid in the Forest', null, 'Druid', 'supporting', 'alive', 'unknown', null, null, 'l15',
   'A druid who lives in the Forest outside Fendwick. Named in the DM''s notes among the people who matter; what he wants, and what he knows about poisoned fields and buffalo-headed soldiers, is not yet recorded.',
   null),

  ('p28', 'fendwick', 'Aeralis', 'The Magical Bird', 'Magical bird', 'Message courier', 'supporting', 'alive', 'ally', null, null, 'l1',
   'The magical bird Mayor Marduke used to carry his letters about Fendwick to the Council of Toringale. Named in the DM''s notes in parentheses, so whether Aeralis is this particular bird or the means itself is not certain. Either way the originals are in the air, and the party carries the copy in case they never land.',
   'fw-s3'),

  ('p29', 'fendwick', 'The Captive Mercenary', 'Taken Alive (?)', null, 'Mercenary of Lemore''s band', 'supporting', 'unknown', 'hostile', null, 'f6', 'l1',
   'One of Ash Lemore''s mercenaries, kept alive and imprisoned when the rest of the band was killed at their base on Emberlain 23. The DM''s notes end that line with a question mark, which is the honest state of it: nobody has said where he is now, or whether anyone has asked him who hired the band and who was squeezing Perennia. He is the only living witness to the campaign''s first crime.',
   null)
on conflict (id) do nothing;

-- --- 5c. Retier the whole roster ------------------------------------------
--
-- `major` is the cast the story turns on. `supporting` is named, placed, and
-- consequential but not load-bearing. `background` drops a person out of Tidy's
-- suggestions and out of the default view of both browse surfaces, while
-- staying fully searchable in the command palette (0027 section 4).

update public.people set tier = 'major'
where campaign_id = 'fendwick' and id in (
  'p4',   -- Grand Warden Ayrton Fitzgerald — implicated thrice
  'p5',   -- Alivar Thalin — the offer on the table
  'p13',  -- Warden Hadoline Chainguard — the campaign's original victim
  'p11',  -- Mayor Avil Marduke — the letter, the curfew
  'p3',   -- Mr. Orin — a live lead in Toringale
  'p10',  -- Saemus Blackstow — the open mystery Alivar just moved into
  'p26',  -- The Masked Man
  'p18','p19','p20','p21','p22','p23','p24','p25'  -- the party
);

update public.people set tier = 'supporting'
where campaign_id = 'fendwick' and id in (
  'p1',   -- Derin Zepper — a goal points at him, but he is cargo, not an actor
  'p14',  -- Dr. Ivory
  'p17',  -- Ezra
  'p8',   -- Perennia Vine (dec.)
  'p7',   -- Ash Lemore (dec.)
  'p15',  -- the impersonator demon (dec.)
  'p27',  -- Thernys
  'p28',  -- Aeralis
  'p29'   -- The Captive Mercenary
);

-- Life status was never set on five rows the 0002 seed created. Nobody has
-- reported any of them dead, and "unknown" is reserved for the ones we have
-- genuinely never laid eyes on.
update public.people set status = 'alive'
where campaign_id = 'fendwick' and id in ('p2','p4','p12') and status is null;

update public.people set status = 'unknown'
where campaign_id = 'fendwick' and id in ('p3','p6') and status is null;

update public.people set tier = 'background'
where campaign_id = 'fendwick' and id in (
  'p9',   -- Donald & Turnip
  'p12',  -- Ol' Man Ol' Fellar
  'p2',   -- King Barillon Alderin
  'p6',   -- Wingleader Domar
  'p16'   -- Jailguard BaldRick (dec.)
);

-- ==========================================================================
-- 6. Items
-- ==========================================================================

insert into public.items (id, campaign_id, name, kind, "desc") values
  ('i4', 'fendwick', 'Marduke''s Letter to the Council', 'Document', 'Mayor Avil Marduke''s report on the events in Fendwick, sent to the Council of Toringale by magical bird — and copied, so the party can carry one by hand in case the originals are intercepted. Delivering that copy personally is one of the party''s standing plans.'),
  ('i5', 'fendwick', 'Chainguard''s Private Investigation', 'Document', 'Warden Hadoline Chainguard''s own investigation into Grand Warden Ayrton Fitzgerald, found in her house on Emberlain 26 while she was still a captive at the Kellin Estate. The second of Fitzgerald''s three implications.')
on conflict (id) do nothing;

-- The weed is the reason Perennia was squeezed. Unarchive and pin it.
update public.items set
  archived = false,
  pinned   = true,
  "desc"   = 'An illegal substance Perennia Vine was secretly growing beneath the Florareum. Someone powerful found out and blackmailed her over it, which is how the mercenaries, the murder, and this entire campaign began.'
where id = 'i1' and campaign_id = 'fendwick';

-- The diary belongs to the impersonator, not to BaldRick.
update public.items set
  name   = 'The Impersonator''s Journal',
  "desc" = 'Recovered from the Kellin Estate before dawn on Emberlain 27. Written by the impersonator demon — the thing that wore Warden Chainguard''s face — and it names Grand Warden Ayrton Fitzgerald. Catalogued in the codex''s first draft as the diary of the demon impersonating BaldRick; the DM''s notes credit it to the impersonator instead.'
where id = 'i2' and campaign_id = 'fendwick';

-- ==========================================================================
-- 7. Lore
-- ==========================================================================

insert into public.lore (id, campaign_id, title, text) values
  ('lo7', 'fendwick', 'The Calendar of Alderin',
   'Days carry names — Sel, Meldae, Xuna — and the current month is Emberlain. The campaign''s recorded history so far spans five days of it: the Florareum was attacked on Sel, Emberlain 23; the false Warden fell on Meldae, Emberlain 26; and everything from the Kellin Estate to Alivar Thalin''s offer happened on Xuna, Emberlain 27. It is summer, and there are two moons.'),
  ('lo8', 'fendwick', 'The Curfew',
   'Mayor Avil Marduke has instated a curfew in Fendwick after the attacks, and reported the events to the Council of Toringale by magical bird. He seems overwhelmed by everything that has happened.'),
  ('lo9', 'fendwick', 'The Circle in the Kellin Cellar',
   'A teleportation circle in the basement of the abandoned Kellin Estate. Derin Zepper arrived through it from Toringale, sent to check whether the coast was clear. The party watched it for four hours on Emberlain 27 and nothing came through — so either whatever was expected is late, or it is not coming that way.')
on conflict (id) do nothing;

update public.lore set
  text = 'The kingdom this campaign takes place in: Gaeva is the world, Esmaria the continent, and the Alderin Kingdom the country. Three major cities, of which we know Spireholm — the capital, west of Fendwick near the coast — and Toringale, north of Fendwick. The third has never been named to us. Ruled by King Barillon Alderin and policed by the Falcon Legion. Nordmill sits on the road between Fendwick and Toringale.'
where id = 'lo1' and campaign_id = 'fendwick';

update public.lore set
  title = 'Poisoning of the Flower Fields',
  text  = 'The flowerfields around Fendwick — the town''s living — were being ruined by some sort of poison or toxin, and were saved on Emberlain 26. Nobody has been placed at it. The codex''s first draft named Ash Lemore as the hand, which the dates do not allow: he died at the mercenaries'' base on Emberlain 23, three days before the fields were saved.'
where id = 'lo2' and campaign_id = 'fendwick';

update public.lore set
  text = 'A shadow network reaching into Toringale''s courts and possibly the Falcon Legion itself. It uses demons wearing other people''s faces, blackmail and eavesdropping spells, and it enlists the desperate — Derin, Perennia — as disposable tools. The DM''s notes never use the word: what they record is "someone powerful" leaning on a flower-seller, a Grand Warden implicated three days running and never once directly, and a masked man listening through a frightened boy. This entry is the codex''s name for the shape those make.'
where id = 'lo3' and campaign_id = 'fendwick';

-- ==========================================================================
-- 8. Goals — the DM's "Plans" section, verbatim in substance
--
-- The Fendwick campaign has had zero goal rows until now.
-- ==========================================================================

insert into public.goals (id, campaign_id, text, owner, kind, status) values
  ('fw-g1', 'fendwick', 'Consider Thalin''s offer — bury our names and go off-record after Fitzgerald, or take Melvin''s counter-offer and fake our deaths. He gave us the night.', 'The Fendwick Legionnaires', 'Party', 'pursuing'),
  ('fw-g2', 'fendwick', 'Bring Derin Zepper back home to his mother in Toringale.',                                                                                              'The Fendwick Legionnaires', 'Party', 'pursuing'),
  ('fw-g3', 'fendwick', 'Deliver Marduke''s letter to the Council of Toringale personally, in case the originals are intercepted.',                                              'The Fendwick Legionnaires', 'Party', 'pursuing')
on conflict (id) do nothing;

-- ==========================================================================
-- 9. Quests
-- ==========================================================================

-- q1 — Thalin's actual offer, not the recap's paraphrase.
update public.quests set
  title  = 'Go off-record: Thalin''s offer',
  "desc" = 'Alivar Thalin offered to bury our names under piles of bureaucratic bullshit so we could go off-record and investigate Grand Warden Ayrton Fitzgerald, and whatever conspiracy he might be part of. He gave us the night to sleep on it.',
  hooks  = 'Accepting means the Falcon Legion stops being able to account for us — which cuts both ways. He asked first whether anyone outside Fendwick would recognise us, and he was fiddling with something out of sight while he asked. Start where Chainguard stopped: her own investigation, and the warehouse where Derin packed crates.',
  reward = 'Alivar''s cover · a free hand in Toringale',
  status = 'pursuing',
  giver_id = 'p5',
  session_id = 'fw-s8'
where id = 'q1' and campaign_id = 'fendwick';

-- q2 — all three implications, dated.
update public.quests set
  title  = 'Why is Fitzgerald implicated three times over?',
  "desc" = 'Grand Warden Ayrton Fitzgerald has been indirectly implicated three times, once on each recorded day, and never once directly. Emberlain 23: named when Perennia Vine was brought to the false Warden and killed. Emberlain 26: named in Chainguard''s own private investigation, found in her house. Emberlain 27: named in the impersonator demon''s journal at the Kellin Estate.',
  hooks  = 'Three sources, three days, no direct accusation — which is either a man being framed with unusual patience, or a man whose name simply cannot be kept out of it. Alivar Thalin reacted to hearing it.',
  giver_id = 'p13',
  session_id = 'fw-s3'
where id = 'q2' and campaign_id = 'fendwick';

-- q3 — Domar is no longer the question. The magical summons is.
update public.quests set
  title  = 'Who magically informed Alivar''s section?',
  "desc" = 'The 7th Windriders were on patrol further south when they were magically informed to aid Fendwick. Somebody with the reach to send that message knew what was happening here, and chose them.',
  hooks  = 'Their own account routes it through their higher-ups — Wingleader Domar was the name given. But who told Domar, and what exactly the message said, nobody has offered.',
  status = 'whispered',
  session_id = 'fw-s8'
where id = 'q3' and campaign_id = 'fendwick';

-- q4 — answered by the DM's notes.
update public.quests set
  title  = 'Does Alivar''s timeline check out?',
  "desc" = 'It does. The attacks were four days ago and the Windriders came from the south, which looked impossible — but the section was already on patrol further south and was magically informed to aid Fendwick. The distrust was reasonable; the arithmetic simply had a term missing.',
  hooks  = 'Closed. What it hands off is q3: somebody sent that message.',
  status = 'resolved',
  session_id = 'fw-s8'
where id = 'q4' and campaign_id = 'fendwick';

-- q5 — the blackmailer, not Ash's employer.
update public.quests set
  title  = 'Who blackmailed Perennia Vine?',
  "desc" = 'Perennia Vine was secretly growing illegal Halfling Weed beneath the Florareum. Someone powerful found out and blackmailed her over it, and she hired mercenaries to attack her own shop. Then she was brought to the false Warden and killed behind closed doors. The blackmailer has never been named.',
  hooks  = 'She is dead and she was the only one being squeezed — but one of Ash Lemore''s mercenaries was taken alive, and somebody hired the band on her behalf. Fitzgerald''s name surfaced for the first time at the meeting where she died.',
  giver_id = 'p8',
  session_id = 'fw-s1'
where id = 'q5' and campaign_id = 'fendwick';

-- q6 — dated, and no longer calling a demon a doppelganger.
update public.quests set
  title  = 'Who ordered the False Warden to disturb Fendwick?',
  "desc" = 'The demon that wore Warden Chainguard''s face did not pick Fendwick by accident, and it did not act alone — two Legionnaires fell beside it on Emberlain 26, demons both. Find the hand behind it.',
  hooks  = 'Its own journal names Fitzgerald. It also took the trouble to kill Perennia Vine in private rather than let her talk.',
  session_id = 'fw-s2'
where id = 'q6' and campaign_id = 'fendwick';

-- q7 — Melvin's counter-offer is its own decision, not a re-run of q1.
update public.quests set
  title  = 'Melvin''s counter-offer: fake our deaths',
  "desc" = 'Melvin answered Thalin''s offer by going further — fake all of our deaths, killed at the mansion, and go undercover deeper still. Thalin gave us the night to sleep on it. The recap recorded this as a binary choice between proceeding and staying on lowly duties, which was not what was said.',
  hooks  = 'Faking a death costs the people who believe it. Ezra has gone to Toringale believing we live; Derin''s mother is expecting her son; Chainguard is unconscious and cannot be told anything at all.',
  status = 'pursuing',
  giver_id = 'p18',
  session_id = 'fw-s8'
where id = 'q7' and campaign_id = 'fendwick';

-- q11 — what the warehouse actually is, on Derin's account.
update public.quests set
  title  = 'What is moving through Mr. Orin''s warehouse?',
  "desc" = 'Derin Zepper packs crates with food and drinks in a Toringale warehouse for a boss called Mr. Orin, and was sent through the Kellin Estate''s teleportation circle to check whether the coast was clear. Coast clear for what is the question the boy cannot answer.',
  hooks  = 'Nothing came through the circle in the four hours we watched it. A boy is sent ahead to check a route; the route runs from a warehouse in Toringale to an abandoned mansion outside Fendwick; the crates hold food and drinks. One of those three facts is a lie.',
  giver_id = 'p3',
  session_id = 'fw-s8'
where id = 'q11' and campaign_id = 'fendwick';

-- q12 — the listener has a mask, and it is not necessarily Orin.
update public.quests set
  title  = 'Who has been listening through Derin?',
  "desc" = 'A spell on Derin Zepper let someone hear everything he said from far away, and Berend spoke to that listener directly without knowing who he was. Derin describes him as a scary masked man — which the codex previously recorded as Mr. Orin, on no authority but assumption.',
  hooks  = 'Everything said around the boy between his capture and his gagging may already be known. The mask is the only description we have, and the only reason to think it is not Orin is that Derin, who knows Orin, did not say Orin.',
  giver_id = 'p1',
  session_id = 'fw-s8'
where id = 'q12' and campaign_id = 'fendwick';

insert into public.quests (id, campaign_id, title, "desc", status, giver_id, session_id, arc_id, hooks, reward) values
  ('q13', 'fendwick', 'Where is Section Commander Saemus Blackstow?',
   'The Legion''s section commander in Fendwick has been missing for several days, and nobody has said where. Alivar Thalin has now taken his office.',
   'whispered', null, 'fw-s8', 'fw-arc-kellin-estate',
   'Three of the people wearing Fendwick uniforms turned out to be demons. Nobody has asked out loud whether the commander was the first.', 'Unknown'),

  ('q14', 'fendwick', 'Who is the masked man?',
   'The scary masked man who cast the listening spell on Derin Zepper. Derin does not name him as Mr. Orin, and Berend has spoken to him without seeing him.',
   'whispered', 'p1', 'fw-s8', 'fw-arc-kellin-estate',
   'He recruits through frightened children and hears through them afterwards. Ask Derin what the mask looked like — it is the only detail anyone has.', 'Unknown'),

  ('q15', 'fendwick', 'What happened to the mercenary we kept alive?',
   'One of Ash Lemore''s mercenaries was taken alive at their base on Emberlain 23 while the rest of the band died. Where he is now, and whether anyone has questioned him, is unrecorded — the DM''s own notes put a question mark on it.',
   'whispered', null, 'fw-s1', 'fw-arc-florareum',
   'He is the only living witness to the campaign''s first crime, and the only person left who might know who hired the band and who was leaning on Perennia Vine.', 'Unknown'),

  ('q16', 'fendwick', 'Who poisoned the flower fields?',
   'The flowerfields were being ruined by some sort of poison or toxin, and were saved on Emberlain 26. Nobody has been placed at it. Ash Lemore was named for it in the codex''s first draft, but he had been dead three days by then.',
   'whispered', null, 'fw-s2', 'fw-arc-kellin-estate',
   'Poisoning a town''s living is slow, patient work that needs someone still standing to keep doing it. Thernys the druid lives in that Forest and has not been asked anything.', 'Unknown')
on conflict (id) do nothing;

-- ==========================================================================
-- 10. Archive the absent — strict pass
--
-- Anything the DM's notes and session 8 both fail to name. Archiving is
-- declutter only: these rows stay searchable, stay linkable, and keep their
-- board positions so unarchiving restores the card exactly where it was.
-- ==========================================================================

update public.people set archived = true, pinned = false
where campaign_id = 'fendwick' and id in (
  'p2',   -- King Barillon Alderin — the throne, still unmentioned by the DM
  'p6',   -- Wingleader Domar — superseded by "magically informed" (see q3)
  'p12',  -- Ol' Man Ol' Fellar — a tavern regular, and the tavern is going too
  'p16'   -- Jailguard BaldRick — dead, and his one artefact reattributed
);

update public.locations set archived = true, pinned = false
where campaign_id = 'fendwick' and id = 'l8';  -- The Yeasting Barrel

-- ==========================================================================
-- 11. Connections
--
-- Three edges the DM's notes falsify, then the new web.
--
-- A manual connection suppresses the FK-derived edge for the same pair (0027
-- section 6, src/relations.ts), so nothing below duplicates a faction_id,
-- location_id or giver_id already carried on the row — with one deliberate
-- exception, p26 -> f1 "suspected agent of", where the label is the whole point
-- and p26.faction_id is left null so there is no FK edge to suppress.
--
-- The pre-existing collisions from 0026 are left alone: q11.giver_id = 'p3' and
-- q12.giver_id = 'p1' (set in section 9) meet manual "concerns" edges 0026
-- already wrote. Those suppress a GIVER_WEIGHT (1) edge with a MANUAL_WEIGHT (2)
-- one, so the pair ends up more strongly linked, not less. Nothing to fix.
-- ==========================================================================

delete from public.connections
where campaign_id = 'fendwick' and (
     (from_id = 'p7' and to_id = 'p8'  and label = 'blackmailed')       -- Ash did not blackmail Perennia
  or (from_id = 'p7' and to_id = 'lo2' and label = 'responsible for')   -- and cannot be the poisoner
  or (from_id = 'p3' and to_id = 'p1'  and label = 'listens through')   -- that is the masked man
);

insert into public.connections (campaign_id, from_id, to_id, label)
select v.campaign_id, v.from_id, v.to_id, v.label
from (values
  -- The world, nested
  ('fendwick', 'l12', 'l11', 'lies on'),
  ('fendwick', 'l13', 'l12', 'lies on'),
  ('fendwick', 'l1',  'l13', 'lies within'),
  ('fendwick', 'l2',  'l13', 'lies within'),
  ('fendwick', 'l3',  'l13', 'lies within'),
  ('fendwick', 'l14', 'l13', 'lies within'),
  ('fendwick', 'l14', 'l2',  'on the road to'),
  ('fendwick', 'l14', 'l1',  'on the road from'),
  ('fendwick', 'lo1', 'l13', 'describes'),
  -- Fendwick's places
  ('fendwick', 'l15', 'l1',  'outside'),
  ('fendwick', 'l16', 'l1',  'stands in'),
  ('fendwick', 'l17', 'l1',  'surrounds'),
  ('fendwick', 'l7',  'l1',  'stands in'),
  -- The Florareum, and who was squeezing whom
  ('fendwick', 'p8',  'f6',  'hired'),
  ('fendwick', 'p7',  'l7',  'attacked'),
  ('fendwick', 'f6',  'l7',  'attacked'),
  ('fendwick', 'p29', 'l6',  'taken alive at'),
  ('fendwick', 'q15', 'p29', 'concerns'),
  ('fendwick', 'q5',  'i1',  'turns on'),
  ('fendwick', 'q5',  'f1',  'suspects'),
  -- The fields
  ('fendwick', 'lo2', 'l17', 'occurred at'),
  ('fendwick', 'q16', 'l17', 'set at'),
  ('fendwick', 'q16', 'lo2', 'concerns'),
  -- Chainguard's investigation
  ('fendwick', 'p13', 'l16', 'lives at'),
  ('fendwick', 'i5',  'l16', 'found at'),
  ('fendwick', 'p13', 'i5',  'wrote'),
  ('fendwick', 'i5',  'p4',  'names'),
  ('fendwick', 'p15', 'i2',  'wrote'),
  ('fendwick', 'p13', 'p15', 'impersonated by'),
  -- The Mayor, the bird, the letter, the Council
  ('fendwick', 'p11', 'i4',  'wrote'),
  ('fendwick', 'p11', 'p28', 'sent'),
  ('fendwick', 'p28', 'f5',  'carried word to'),
  ('fendwick', 'i4',  'f5',  'addressed to'),
  ('fendwick', 'f5',  'l2',  'sits in'),
  ('fendwick', 'p4',  'f5',  'answers to (nominally)'),
  ('fendwick', 'p11', 'lo8', 'instated'),
  ('fendwick', 'lo8', 'l1',  'in force in'),
  -- The masked man
  ('fendwick', 'p26', 'p1',  'listens through'),
  ('fendwick', 'q14', 'p26', 'concerns'),
  ('fendwick', 'p26', 'f1',  'suspected agent of'),
  -- The circle
  ('fendwick', 'lo9', 'l4',  'hidden beneath'),
  ('fendwick', 'p1',  'lo9', 'arrived through'),
  ('fendwick', 'q11', 'l5',  'set at'),
  -- The missing commander
  ('fendwick', 'q13', 'p10', 'concerns'),
  ('fendwick', 'p5',  'p10', 'took the office of'),
  -- Thernys needs no edge here: location_id = 'l15' on his row already derives
  -- "resides at", and a manual "lives in" string would only suppress it to say
  -- the same thing at the same weight.
  -- The calendar
  ('fendwick', 'lo7', 'lo4', 'counts'),
  -- Goals
  ('fendwick', 'fw-g1', 'p5',  'answers'),
  ('fendwick', 'fw-g1', 'q1',  'decides'),
  ('fendwick', 'fw-g1', 'q7',  'decides'),
  ('fendwick', 'fw-g2', 'p1',  'concerns'),
  ('fendwick', 'fw-g2', 'l2',  'leads to'),
  ('fendwick', 'fw-g3', 'i4',  'delivers'),
  ('fendwick', 'fw-g3', 'f5',  'addresses'),
  -- The chapters
  ('fendwick', 'fw-s1', 'l7',  'takes place at'),
  ('fendwick', 'fw-s1', 'l6',  'takes place at'),
  ('fendwick', 'fw-s1', 'p8',  'killed'),
  ('fendwick', 'fw-s1', 'p7',  'killed'),
  ('fendwick', 'fw-s1', 'p29', 'introduced'),
  ('fendwick', 'fw-s2', 'l17', 'takes place at'),
  ('fendwick', 'fw-s2', 'l16', 'takes place at'),
  ('fendwick', 'fw-s2', 'p15', 'killed'),
  ('fendwick', 'fw-s2', 'i5',  'recovered'),
  ('fendwick', 'fw-s3', 'l4',  'takes place at'),
  ('fendwick', 'fw-s3', 'p13', 'rescued'),
  ('fendwick', 'fw-s3', 'i2',  'recovered'),
  ('fendwick', 'fw-s3', 'i4',  'introduced'),
  ('fendwick', 'fw-s3', 'p28', 'introduced'),
  ('fendwick', 'fw-s3', 'lo9', 'recorded'),
  ('fendwick', 'fw-s8', 'p26', 'introduced'),
  ('fendwick', 'fw-s8', 'lo7', 'recorded')
) as v(campaign_id, from_id, to_id, label)
where not exists (
  select 1 from public.connections c
  where c.campaign_id = v.campaign_id
    and c.from_id     = v.from_id
    and c.to_id       = v.to_id
    and c.label       = v.label
);

-- ==========================================================================
-- 12. Board and pins
--
-- Coordinates were computed against the 55 cards 0002 and 0027 placed (38 + 17),
-- using the repo's own CARD_SIZE table and findFreeSpot's overlap rule (24px
-- pad), as a block in the empty region x >= 2560 / y >= 1620. This block adds
-- 33, for 88 in total, and introduces 0 overlaps.
--
-- It does NOT make the board overlap-free: the 0002 seed contains 37 overlapping
-- pairs of its own, because its people rows sit 160px apart while a people card
-- is 300px tall. That predates this migration and is left alone — "Tidy board"
-- reclusters the whole thing in one click, which is worth running afterwards
-- anyway so Louvain can pull the new sphere into shape.
--
-- This also places eight rows 0026/0027 left off the board entirely: the three
-- Bestiary plates, The Lily, two lore entries and quests q8/q10.
-- ==========================================================================

insert into public.board_positions (campaign_id, entity_id, kind, x, y, rot) values
  -- The world, nested left to right
  ('fendwick', 'l11',   'locations', 2560, 1620, -2),  -- Gaeva
  ('fendwick', 'l12',   'locations', 2794, 1620,  1),  -- Esmaria
  ('fendwick', 'l13',   'locations', 3028, 1620, -1),  -- The Alderin Kingdom
  ('fendwick', 'l14',   'locations', 3262, 1620,  3),  -- Nordmill
  ('fendwick', 'l15',   'locations', 3496, 1620, -2),  -- The Forest
  -- Fendwick's places, the Council, the documents
  ('fendwick', 'l16',   'locations', 2560, 1844,  2),  -- Chainguard's House
  ('fendwick', 'l17',   'locations', 2794, 1844, -3),  -- The Flower Fields
  ('fendwick', 'f5',    'factions',  3028, 1844,  1),  -- Council of Toringale
  ('fendwick', 'f6',    'factions',  3232, 1844, -2),  -- Lemore's Mercenaries
  ('fendwick', 'i4',    'items',     3436, 1844,  3),  -- Marduke's Letter
  ('fendwick', 'i5',    'items',     3630, 1844, -1),  -- Chainguard's Investigation
  -- New cast
  ('fendwick', 'p26',   'people',    2560, 2068, -2),  -- The Masked Man
  ('fendwick', 'p27',   'people',    2804, 2068,  1),  -- Thernys
  ('fendwick', 'p28',   'people',    3048, 2068, -3),  -- Aeralis
  ('fendwick', 'p29',   'people',    3292, 2068,  2),  -- The Captive Mercenary
  -- Lore and the party's plans
  ('fendwick', 'lo7',   'lore',      2560, 2392,  1),  -- The Calendar of Alderin
  ('fendwick', 'lo8',   'lore',      2774, 2392, -2),  -- The Curfew
  ('fendwick', 'lo9',   'lore',      2988, 2392,  3),  -- The Circle in the Kellin Cellar
  ('fendwick', 'fw-g1', 'goals',     3202, 2392, -1),  -- Consider Thalin's offer
  ('fendwick', 'fw-g2', 'goals',     3426, 2392,  2),  -- Bring Derin home
  ('fendwick', 'fw-g3', 'goals',     3650, 2392, -3),  -- Deliver the letter
  -- New threads
  ('fendwick', 'q13',   'quests',    2560, 2556,  1),  -- Where is Blackstow?
  ('fendwick', 'q14',   'quests',    2824, 2556, -2),  -- Who is the masked man?
  ('fendwick', 'q15',   'quests',    3088, 2556,  3),  -- The captive mercenary
  ('fendwick', 'q16',   'quests',    3352, 2556, -1),  -- Who poisoned the fields?
  -- Rows 0026/0027 never placed
  ('fendwick', 'm1',    'monsters',  2560, 2740, -2),  -- The Helmed Beast
  ('fendwick', 'm2',    'monsters',  2794, 2740,  2),  -- Lesser Demon
  ('fendwick', 'm3',    'monsters',  3028, 2740, -1),  -- The Big Demon
  ('fendwick', 'l9',    'locations', 3262, 2740,  3),  -- The Lily
  ('fendwick', 'lo4',   'lore',      3496, 2740, -2),  -- Two Moons Over Alderin
  ('fendwick', 'lo6',   'lore',      3710, 2740,  1),  -- Tales of Animals Made Soldiers
  ('fendwick', 'q8',    'quests',    2560, 3034, -3),  -- What did Alivar do out of sight?
  ('fendwick', 'q10',   'quests',    2824, 3034,  2)   -- What is Faye looking for?
on conflict (campaign_id, entity_id) do update
  set kind = excluded.kind, x = excluded.x, y = excluded.y, rot = excluded.rot;

-- Pins: the spine the restructure exposes. Tidy seeds its "kept alive by
-- association" set only from people last seen in the recent session window and
-- quests filed in it (0027), so the campaign's fixed points need the documented
-- exemption or they become archive candidates the moment chapter 4 ages out.
update public.people set pinned = true
where campaign_id = 'fendwick' and id in (
  'p13',  -- Warden Hadoline Chainguard — unconscious, and the only witness
  'p4',   -- Grand Warden Ayrton Fitzgerald
  'p5',   -- Alivar Thalin
  'p11',  -- Mayor Avil Marduke
  'p1',   -- Derin Zepper — a standing goal points at him
  'p26',  -- The Masked Man
  'p29'   -- The Captive Mercenary — last living witness to the first crime
);

update public.locations set pinned = true
where campaign_id = 'fendwick' and id in ('l1','l2','l4','l13');

update public.factions set pinned = true where campaign_id = 'fendwick' and id = 'f5';
update public.items    set pinned = true where campaign_id = 'fendwick' and id in ('i4','i5');
update public.lore     set pinned = true where campaign_id = 'fendwick' and id = 'lo7';

-- ==========================================================================
-- 13. File the quests against the chronicle
--
-- Last, because section 9 is what gives most of them a chapter to inherit from:
-- q1/q2/q3/q5/q6 carried session_id null out of the 0002 seed and only got
-- dated above. A quest with no chapter sits at saga altitude, which 0025
-- explicitly allows and which is the honest answer when there is no chapter to
-- place it in.
-- ==========================================================================

update public.quests q set arc_id = s.arc_id
  from public.sessions s
 where q.campaign_id = 'fendwick'
   and q.session_id  = s.id
   and s.arc_id is not null
   and q.arc_id is distinct from s.arc_id;

update public.quests set arc_id = 'fw-saga-fendwick'
 where campaign_id = 'fendwick' and arc_id is null;
