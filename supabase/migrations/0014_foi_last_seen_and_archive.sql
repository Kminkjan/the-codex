-- Fist of Ilmater board maintenance: correct last_seen for people, then archive
-- the fully-concluded arcs. Safe to run as one script in the dashboard SQL editor.
-- Archived rows are hidden from the active board but never deleted (unarchive to
-- restore). Realtime splices every change into open boards automatically.

-- ==========================================================================
-- PART 1 - last_seen_session_id corrections (people only)
-- ==========================================================================
-- Derived from the campaign notes (sessions 31-191): each person's LAST on-screen
-- appearance, not merely their last name-mention. Three classes of change:
--   * SET  - current party PCs and a few NPCs had no value at all.
--   * FIX  - genuine reappearances the seed data missed (Gundren, van Richten).
--   * TWEAK- off-by-one where the person had left/teleported away.
--
-- Deliberately NOT touched (curated value already correct): dead or departed NPCs
-- whose later name-hits are posthumous references or namesakes, e.g.
--   Karn (s76, dec.)        -- "Karn's Ruby" keeps surfacing his name
--   Strahd (s143, dec.)     -- Tome/Symbol of Strahd references
--   Chief Guh (s156, dec.)  -- "the Eye of Guh" relic, plus a base64 image blob in s191
--   Tillem / Wom (s44)      -- left the party; later hits are remote sendings/lore drops
--   Mephistopheles (s141)   -- unseen archdevil; later hits are plot references
--   Vecna (s188)            -- unseen overarching villain; later hits are references

update public.people p set last_seen_session_id = v.sid
from (values
  -- SET (were NULL): current party members -> latest session (s191)
  ('foi-p5',  'foi-s191'),  -- Fynn
  ('foi-p4',  'foi-s191'),  -- Mort
  ('foi-p3',  'foi-s191'),  -- Theothor
  ('foi-p7',  'foi-s191'),  -- Oliver Goodhill
  ('foi-p6',  'foi-s191'),  -- Barendd Battlegore
  -- SET (were NULL): NPCs
  ('foi-p25', 'foi-s168'),  -- Faldorn (unmasked s167, last seen s168)
  ('foi-p31', 'foi-s180'),  -- Duke Zalto (Brimskarda's confession, Ironslag)
  ('foi-p32', 'foi-s180'),  -- Gomoth (last substantive beat; only ever discussed, never on-screen)
  -- FIX: genuine reappearances the seed missed
  ('foi-p10', 'foi-s187'),  -- Gundren Rockseeker: was s59, reappears escorting party to Phandalin
  ('foi-p14', 'foi-s186'),  -- Rudolph van Richten: was s147, rejoins/summons party at Wave Echo Cave
  -- TWEAK: off-by-one
  ('foi-p34', 'foi-s190'),  -- Kevori Fearnehart: was s189
  ('foi-p37', 'foi-s190')   -- Eldon Keyward: was s191, teleported to Evernight at s190 and is absent from s191
) as v(id, sid)
where p.id = v.id and p.campaign_id = 'fist-of-ilmater';
-- ==========================================================================
-- PART 2 - archive concluded arcs (TIER 1, recommended)
-- ==========================================================================
-- Principle: the campaign is currently in the Sword Coast / Fire Giant / Neverwinter
-- (Vecna) arcs (s147+). Everything from those is kept ACTIVE, even the dead
-- (Brimskarda, Akaanvaerd). Only the fully-closed arcs are archived: the Trade Off
-- arc (s31-44) and the Curse of Strahd / Barovia arc (s77-146, escaped at s146).
-- The Black Spider / Dollmother is intentionally NOT archived - the campaign
-- subtitle ("to the Dollmother's web") flags it as an unresolved endgame thread.

-- People
update public.people set archived = true
where campaign_id = 'fist-of-ilmater' and id in (
  'foi-p12',  -- Strahd von Zarovich (dec., Barovia)
  'foi-p13',  -- Baba Lysaga (dec., Barovia)
  'foi-p18',  -- Kasimir Velikov (Barovia, dusk elf king)
  'foi-p16',  -- Ireena Kolyana (Barovia, left)
  'foi-p15',  -- Madam Eva (Barovia, Vistani seer)
  'foi-p19',  -- Ezmerelda D'Avenir (Barovia, monster hunter)
  'foi-p20',  -- Morgantha (Barovia, windmill hag)
  'foi-p9',   -- Wan Shi Tong (dec., early guild figure)
  'foi-p22',  -- Kriv (dec., Trade Off boss)
  'foi-p23',  -- Isendraug (dec., Cryovain's widow)
  'foi-p27',  -- Aribeth (Mephistopheles' avatar, defeated s141)
  'foi-p24'   -- Chief Guh (dec., Grudd Haug)
);
-- Locations (Barovia / early Trade Off arc)
update public.locations set archived = true
where campaign_id = 'fist-of-ilmater' and id in (
  'foi-l6',   -- Barovia
  'foi-l8',   -- Castle Ravenloft
  'foi-l10',  -- Krezk
  'foi-l7',   -- Vallaki
  'foi-l9',   -- The Amber Temple
  'foi-l5'    -- Gragmaw Castle
);
-- Factions (concluded arcs)
update public.factions set archived = true
where campaign_id = 'fist-of-ilmater' and id in (
  'foi-f2',   -- The Vistani (Barovia)
  'foi-f3',   -- Keepers of the Feather (Barovia wereravens)
  'foi-f8'    -- Trade Off (Kriv dead, arc closed)
);
-- Items (Barovia artifacts, left in the Mists)
update public.items set archived = true
where campaign_id = 'fist-of-ilmater' and id in (
  'foi-i3',   -- Symbol of Ravenkind
  'foi-i2',   -- Tome of Strahd
  'foi-i1',   -- The Sunsword
  'foi-i6'    -- The Mist Talisman
);
-- Lore (Barovia)
update public.lore set archived = true
where campaign_id = 'fist-of-ilmater' and id in (
  'foi-lo2'   -- The Mists and the Domains of Dread
);
-- Resolved quests (completed objectives). Comment out this block if you prefer to
-- keep a visible "completed quests" trophy log on the board.
update public.quests set archived = true
where campaign_id = 'fist-of-ilmater' and status = 'resolved' and id in (
  'foi-q1',   -- Rescue Gundren Rockseeker
  'foi-q2',   -- Save Wom from Trade Off
  'foi-q3',   -- Find the Forge of Spells
  'foi-q4',   -- Defeat Strahd von Zarovich
  'foi-q5',   -- Escape Barovia through the Mists
  'foi-q6'    -- Rescue Theldin the Blacksmith
);
-- ==========================================================================
-- PART 3 - TIER 2, optional / sentimental (uncomment to also archive)
-- Dead or departed party members and marginal set-dressing. Kept active by
-- default because players often like their fallen/retired PCs to stay visible.
-- ==========================================================================

-- update public.people set archived = true
-- where campaign_id = 'fist-of-ilmater' and id in (
--   'foi-p1',   -- Karn (dec. former PC)
--   'foi-p2',   -- Tillem (departed PC)
--   'foi-p21',  -- Wom (departed with Tillem)
--   'foi-p31'   -- Duke Zalto (dead, backstory-only)
-- );
-- update public.items set archived = true
-- where campaign_id = 'fist-of-ilmater' and id = 'foi-i5';   -- Karn's Ruby
-- update public.locations set archived = true
-- where campaign_id = 'fist-of-ilmater' and id in (
--   'foi-l12',  -- Grudd Haug (giants defeated s157)
--   'foi-l3'    -- Longsaddle (early-arc hub)
-- );
-- update public.factions set archived = true
-- where campaign_id = 'fist-of-ilmater' and id = 'foi-f4';   -- Zhentarim (if inactive);
