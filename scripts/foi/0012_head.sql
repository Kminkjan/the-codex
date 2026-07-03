-- ==========================================================================
-- 0012 additive extraction — locations, factions, items, lore introduced in
-- sessions 179–191 (the Starforge climax and the Neverwinter Vecna cult).
-- No session references here, so this block precedes the session inserts.
-- IDs continue the sequences established in scripts/foi/head.sql.
-- ==========================================================================

insert into public.locations (id, campaign_id, name, kind, "desc", region, ruler, notes) values
  ('foi-l15', 'fist-of-ilmater', 'The Starforge',      'Forge',      'An ancient forge on the Shadowfell echo of Mount Hotenow, on an island in a crater lake of acid. Fire giants laboured here on a half-built war machine to rival the Vonindod, driven by the faint voice of Mephistopheles.', 'Shadowfell', null, 'Reached only by climbing the volcano — the lava keeps destroying the paths. Where Theldin was held and Akaanvaerd was slain.'),
  ('foi-l16', 'fist-of-ilmater', 'Evernight',          'City',       'A lively city of the undead beside a sea of lava in the Shadowfell, complete with a corpse market where the bodies of the dead are bought and sold. The mirror-image of Neverwinter across the veil.', 'Shadowfell', null, 'Linked to Neverwinter by the Crevices of Dusk. Its Dolindar tomb lies in the north graveyard.'),
  ('foi-l17', 'fist-of-ilmater', 'Ironslag',           'Giant Forge','Stronghold of the fire giants under Duke Zalto, where the Titan of Death — the Vonindod — was forged. Abandoned to the Shadowfell after Mount Hotenow''s eruption and the coming of Mephistopheles'' voice.', 'near Mount Hotenow', 'Duke Zalto', 'Brimskarda''s last clear memory was working the Vonindod here for her master.'),
  ('foi-l18', 'fist-of-ilmater', 'Waterdeep',          'City',       'The City of Splendors, chosen by the party as the new base of the Shields of the Crying God — a great port where travelers might spread word of the guild.', 'Sword Coast', 'The Open Lord', 'Picked over Helm''s Hold, Baldur''s Gate, Silverymoon and the ever-tempting Sexbierum.'),
  ('foi-l19', 'fist-of-ilmater', 'Neverdeath Graveyard','Graveyard', 'Neverwinter''s vast graveyard, riddled with crypts. The Hallix Mausoleum hides a Vecna-cult sect and a kitchen-crypt linked by a Crevice of Dusk to Evernight.', 'Neverwinter', null, 'Second cult hideout; where Sarcelle Malinosh and Umberto Noblin were held, and where Theothor met the Teeth of Vecna.')
on conflict (id) do nothing;

insert into public.factions (id, campaign_id, name, sigil, "desc", allegiance) values
  ('foi-f9', 'fist-of-ilmater', 'The Undying Cult of Vecna', 'V', 'Cultists beneath Neverwinter who worship Vecna, the lich-god of secrets. Led by Zalryr, they siphon secrets from souls with runic-circle rituals, reducing failed volunteers to necrotic sludge. One of many sects hidden in the city''s catacombs.', 'Hostile')
on conflict (id) do nothing;

insert into public.items (id, campaign_id, name, kind, "desc") values
  ('foi-i7', 'fist-of-ilmater', 'The Bow of Nylea',           'Bow',    'A bow of the goddess of the hunt found by Theothor in the Dolindar tomb. When it looses an arrow the seasons change, and the arrow becomes a living lynx.'),
  ('foi-i8', 'fist-of-ilmater', 'Shield of Missile Attraction','Shield', 'Taken from the hidden passage in Chanelle Hallwinter''s tomb. Cursed — but, the party decided, cursed in a good way.'),
  ('foi-i9', 'fist-of-ilmater', 'Weapon of Certain Death',    'Weapon', 'A gift from the Harpers that reshapes itself to fit its wielder. A creature it damages can''t regain hit points until the wielder''s next turn. Mastery: Vex.')
on conflict (id) do nothing;

insert into public.lore (id, campaign_id, title, text) values
  ('foi-lo4', 'fist-of-ilmater', 'Vecna, the Undying Eye', 'Once a human wizard, Vecna ascended to lichdom and then to godhood — the god of secrets known and feared across many worlds. His symbol is an emaciated hand cradling a single eye. His cultists chant "Y''ai ''ng''ngah, Vecna h''ee" — the same words carved on the obelisks Mephistopheles harvested in Barovia. His link to the archdevil is unknown.'),
  ('foi-lo5', 'fist-of-ilmater', 'The Ordning and the Vonindod', 'Among giants, social rank is everything: storm giants highest, hill giants lowest, all bound in the Ordning. Duke Zalto''s fire giants of Ironslag once forged the Vonindod, the Titan of Death — an ancient Netherese war machine. Now a single voice, Mephistopheles'', unites giants across their kinds and drives them to raise such colossi again.'),
  ('foi-lo6', 'fist-of-ilmater', 'The Crevices of Dusk', 'Portals between the Shadowfell dread domain of Evernight and the Material Plane''s Neverwinter, built atop the old city. The scholar Eldon Keyward names the power behind them Psychoportation — teleportation drawn from Psionic magic, the fourth kind, whose source is the mind. Schematics lie in Candlekeep, and St. Ebenezer takes a quiet interest.')
on conflict (id) do nothing;
