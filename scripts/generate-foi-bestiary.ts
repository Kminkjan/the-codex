// Generates supabase/migrations/0034_foi_bestiary.sql: the Fist of Ilmater
// Bestiary, imported from the DM's own ledger of every enemy the party has
// fought, with each creature linked to the sessions it was fought in.
//
// Unlike the notes-driven generators next to this one, this script needs NO
// gitignored source: scripts/foi/enemies.tsv and enemy-totals.tsv are committed,
// so the migration is reproducible from a clean checkout. They were extracted
// once from the DM's Google Doc "Enemies fought" (per-encounter, one row per
// creature per encounter) and the markdown list "List of Enemies" (his running
// aggregate). The doc encodes fate in the CELL BACKGROUND COLOUR — green killed,
// yellow survived, yellow + a trailing '*' killed in a later session — which is
// why enemies.tsv carries a resolved `fate` column instead of the raw colour.
//
// The per-encounter doc is the source of truth. The aggregate list is only ever
// a cross-check, and every disagreement between them has to be listed in
// enemy-fixes.json with a reason or this script fails — the point is that a
// future source edit cannot silently bake a guess into a migration.
//
// What it emits, in order:
//   1. placeholder `sessions` rows for the nums the journal never imported
//      (1-30, the side session 33.5, and 192)
//   2. one `monsters` row per creature, with cr, encountered, a derived threat
//      band and a heuristic creature type
//   3. one `connections` row per (monster, session) the creature was fought in —
//      this is what puts a chip on both sheets, and it's the only relationship
//      model monsters have (they carry no FK columns)
//   4. one `session_events` reveal per monster at its FIRST session, which is
//      what inks the plate (inkedMonsters in src/monsters.ts derives discovery
//      from the feed, so this is the same fact the DM's RELEASE ceremony writes)
//
// Usage: npx tsx scripts/generate-foi-bestiary.ts   (exits non-zero on any
// failed assertion; prints a review report for the DM)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { crToThreat, crLabel } from "../src/monsters";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOI = join(ROOT, "scripts/foi");
const MIGRATION = "supabase/migrations/0034_foi_bestiary.sql";
const CAMPAIGN = "fist-of-ilmater";

// Expected shape of the source, asserted below. A parse regression that changes
// any of these is a failure, not a new number to paste in here: check what
// changed in the ledger first.
// 554 = the doc's rows minus its 15 per-session "Total" subtotals; 454 creatures
// after aliasing; 546 pairs because 8 rows are a second encounter with the same
// creature in the same session; 32 placeholders = nums 1-30, the side session
// 33.5, and 192.
const EXPECT = { rows: 554, monsters: 454, pairs: 546, sessionsMissing: 32 };
// The ledger's own coverage claim ("Updated up to s192"), quoted in the notes.
const LEDGER_THROUGH = 192;

let failures: string[] = [];
const fail = (msg: string) => { failures.push(msg); };

// ── source ──────────────────────────────────────────────────────────────────
type Row = { name: string; amount: number; cr: string; encounter: string; session: string; fate: string };

const tsv = <T,>(file: string): T[] => {
  const lines = readFileSync(join(FOI, file), "utf8").trim().split("\n");
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [head[i], v])) as T);
};

const rawRows = tsv<Record<string, string>>("enemies.tsv");
const totals = tsv<Record<string, string>>("enemy-totals.tsv");
const aliases: Record<string, string> = JSON.parse(readFileSync(join(FOI, "enemy-aliases.json"), "utf8"));
const fixes = JSON.parse(readFileSync(join(FOI, "enemy-fixes.json"), "utf8"));
const kindOverrides: Record<string, string> = existsSync(join(FOI, "enemy-kinds.json"))
  ? JSON.parse(readFileSync(join(FOI, "enemy-kinds.json"), "utf8"))
  : {};

// ── name normalisation ──────────────────────────────────────────────────────
// Matching key only. Display names keep their real characters (Mwaxanaré, the
// curly apostrophe in Baba Lysaga's) — the two sources differ in punctuation far
// more often than in spelling, and folding that into the stored name would
// change what the DM reads on the plate.
const key = (s: string) =>
  s.normalize("NFC")
    .replace(/[‘’]/g, "'")
    .split("\\").join("")        // the markdown list escapes '!' as '\!'
    .replace(/\*+$/, "")         // the "killed later" mark is fate, not name
    .replace(/\s+/g, " ")
    .trim();

const usedAliases = new Set<string>();
const canonical = (raw: string) => {
  const k = key(raw);
  const hit = aliases[k];
  if (hit === undefined) return k;
  usedAliases.add(k);
  if (aliases[key(hit)] !== undefined) fail(`alias chain: ${k} → ${hit} → …`);
  return key(hit);
};

// ── session resolution ──────────────────────────────────────────────────────
// Session ids are text, and half-sessions already have a convention in this
// repo: 0011 seeded ('foi-s37b', num 37) for the side session between 37 and 38,
// via generate-foi-seed.ts's `.5 → b`. The ledger writes those with a Dutch
// decimal comma and a saga prefix, e.g. "S4/37,5" = the side session at 37.5,
// which is foi-s37b. Anything this can't read is a hard failure rather than a
// dangling chip in the app.
const HALF = /^S\d+\/(\d+),(\d+)$/;
const PLAIN = /^S?(\d+)$/;
const halfNotes: string[] = [];

const resolveSession = (cell: string): { id: string; num: number; label: string } | null => {
  const t = cell.trim();
  const plain = PLAIN.exec(t);
  if (plain) {
    const num = Number(plain[1]);
    return { id: `foi-s${num}`, num, label: String(num) };
  }
  const half = HALF.exec(t);
  if (half) {
    if (half[2] !== "5") { fail(`session cell "${cell}": only ",5" side sessions exist`); return null; }
    const num = Number(half[1]);
    return { id: `foi-s${num}b`, num, label: `${num}.5` };
  }
  fail(`unparseable session cell: "${cell}"`);
  return null;
};

// Ids the journal already holds, read out of the applied seeds. Resolving to
// anything outside this set (plus the stubs below) means a mis-parsed cell, and
// connections.session_id / session_events.session_id would fail their FK anyway.
const knownSessionIds = new Set<string>();
const knownNums = new Set<number>();
for (const f of ["0011_seed_fist_of_ilmater_content.sql", "0012_seed_fist_of_ilmater_sessions_179_191.sql"]) {
  const sql = readFileSync(join(ROOT, "supabase/migrations", f), "utf8");
  for (const m of sql.matchAll(/\('(foi-s\d+b?)',\s*'fist-of-ilmater',\s*(\d+),/g)) {
    knownSessionIds.add(m[1]);
    knownNums.add(Number(m[2]));
  }
}
if (knownSessionIds.size < 150) fail(`only ${knownSessionIds.size} existing session ids found — did a seed move?`);

// ── parse and aggregate ─────────────────────────────────────────────────────
type Agg = {
  name: string;
  crs: Set<string>;
  encountered: number;
  encounters: number;
  sessions: Map<string, { num: number; label: string }>;
  fates: Set<string>;
  fateSession: Map<string, string>; // fate → the label of the session it happened in
};
const byName = new Map<string, Agg>();
const rows: Array<Row & { canon: string; session: { id: string; num: number; label: string } }> = [];

for (const r of rawRows) {
  const canon = canonical(r.name);
  const session = resolveSession(r.session);
  if (!session) continue;
  const amount = Number(r.amount);
  if (!Number.isInteger(amount) || amount < 1) fail(`bad amount for ${canon}: "${r.amount}"`);
  rows.push({ ...(r as unknown as Row), amount, canon, session });

  let a = byName.get(canon);
  if (!a) {
    a = { name: canon, crs: new Set(), encountered: 0, encounters: 0, sessions: new Map(), fates: new Set(), fateSession: new Map() };
    byName.set(canon, a);
  }
  a.crs.add(r.cr.trim());
  a.encountered += amount;
  a.encounters++;
  a.sessions.set(session.id, { num: session.num, label: session.label });
  a.fates.add(r.fate);
  if (!a.fateSession.has(r.fate)) a.fateSession.set(r.fate, session.label);
}

// Every resolved session must exist, or be one we're about to create.
const missingNums = [...Array(LEDGER_THROUGH).keys()].map((i) => i + 1).filter((n) => !knownNums.has(n));
const stubs: Array<{ id: string; num: number; title: string; side?: boolean }> = [
  ...missingNums.map((n) => ({ id: `foi-s${n}`, num: n, title: `Session ${n}` })),
];
for (const r of rows) {
  if (knownSessionIds.has(r.session.id) || stubs.some((s) => s.id === r.session.id)) continue;
  // A side session the ledger knows about and the journal doesn't (33.5).
  stubs.push({ id: r.session.id, num: r.session.num, title: `Session ${r.session.label}`, side: true });
}
stubs.sort((a, b) => a.num - b.num || a.id.localeCompare(b.id));
for (const r of rows) {
  const known = knownSessionIds.has(r.session.id) || stubs.some((s) => s.id === r.session.id);
  if (!known) fail(`${r.canon}: session ${r.session.id} is neither seeded nor stubbed`);
}
for (const r of rawRows) {
  const t = r.session.trim();
  if (HALF.test(t)) {
    const s = resolveSession(t)!;
    const note = `${t} → ${s.id} (${knownSessionIds.has(s.id) ? "already seeded" : "new placeholder"})`;
    if (!halfNotes.includes(note)) halfNotes.push(note);
  }
}

// ── CR, threat, cross-checks ────────────────────────────────────────────────
const crOverrides: Record<string, number> = fixes.cr ?? {};
const crOf = new Map<string, number | undefined>();
for (const [name, a] of byName) {
  const distinct = [...a.crs].filter((c) => c !== "");
  const parsed = [...new Set(distinct.map(Number))];
  if (parsed.some((n) => !Number.isFinite(n))) fail(`${name}: unreadable CR ${distinct.join("/")}`);
  if (parsed.length > 1) {
    const fix = crOverrides[name];
    if (fix === undefined) {
      fail(`${name}: the ledger disagrees with itself about CR (${distinct.join(" vs ")}) — resolve it in enemy-fixes.json`);
    }
    crOf.set(name, fix);
  } else {
    crOf.set(name, parsed.length ? parsed[0] : undefined);
    if (crOverrides[name] !== undefined && crOverrides[name] !== parsed[0]) {
      fail(`enemy-fixes.json overrides CR for ${name}, but the ledger no longer conflicts — drop the entry`);
    }
  }
}

const totalsByName = new Map<string, { amount: number; cr: number }>();
for (const t of totals) {
  const canon = canonical(t.name);
  if (totalsByName.has(canon)) fail(`the aggregate list lists ${canon} twice`);
  totalsByName.set(canon, { amount: Number(t.amount), cr: Number(t.cr) });
}

const allow = (list: string[] | undefined, name: string) => (list ?? []).includes(name);
const docOnly = [...byName.keys()].filter((n) => !totalsByName.has(n));
const totalsOnly = [...totalsByName.keys()].filter((n) => !byName.has(n));
const amountMismatch: string[] = [];
const crMismatch: string[] = [];
for (const [name, a] of byName) {
  const t = totalsByName.get(name);
  if (!t) continue;
  if (t.amount !== a.encountered) amountMismatch.push(`${name}: ledger=${a.encountered} list=${t.amount}`);
  const cr = crOf.get(name);
  if (cr !== undefined && t.cr !== cr) crMismatch.push(`${name}: ledger=${crLabel(cr)} list=${crLabel(t.cr)}`);
}
for (const n of docOnly) if (!allow(fixes.allowDocOnly, n)) fail(`${n} is in the ledger but not the aggregate list — allow it in enemy-fixes.json`);
for (const n of totalsOnly) if (!allow(fixes.allowTotalsOnly, n)) fail(`${n} is in the aggregate list but was never fought — allow it in enemy-fixes.json`);
for (const m of amountMismatch) if (!allow(fixes.allowAmountMismatch, m.split(":")[0])) fail(`amount disagreement not allowed: ${m}`);
for (const m of crMismatch) if (!allow(fixes.allowCrMismatch, m.split(":")[0])) fail(`CR disagreement not allowed: ${m}`);
for (const a of Object.keys(aliases)) {
  if (a.startsWith("_")) continue;
  if (!usedAliases.has(key(a))) fail(`unused alias "${a}" — the source was corrected upstream, drop it`);
}
// A typo'd override would silently do nothing, which is the failure mode this
// whole file exists to avoid.
for (const k of Object.keys(kindOverrides)) {
  if (k.startsWith("_")) continue;
  if (!byName.has(k)) fail(`enemy-kinds.json has a creature type for "${k}", which is not a creature in the ledger`);
}

// ── ids ─────────────────────────────────────────────────────────────────────
// Slugs, not foi-m1..foi-m456. Sequential ids drawn from a sorted name list are
// not stable under insertion: add one enemy next year, regenerate, and every id
// after it names a different creature — while `on conflict do nothing` keeps the
// old rows and the fresh connections point at the wrong monster. Silent, and
// only findable by hand. The cost of slugs is that RENAMING a monster changes
// its id, so a name correction is an `update public.monsters set name = ...`
// plus an alias entry here, never a re-slug (that would orphan the old row's
// connections and leave a duplicate plate).
const slug = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "")   // Mwaxanaré → mwaxanare
    .replace(/['’]/g, "")                                   // Lysaga's → lysagas, not lysaga-s
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idOf = new Map<string, string>();
const slugSeen = new Map<string, string>();
for (const name of [...byName.keys()].sort((a, b) => a.localeCompare(b))) {
  const s = slug(name);
  if (!s) { fail(`${name} slugs to nothing`); continue; }
  const clash = slugSeen.get(s);
  if (clash) fail(`slug collision: "${name}" and "${clash}" both slug to ${s} — alias one onto the other`);
  slugSeen.set(s, name);
  idOf.set(name, `foi-m-${s}`);
}

// ── creature type heuristic ─────────────────────────────────────────────────
// First match wins, so the ORDER is the design: "Giant Spider" is a beast, not a
// giant, and a Dracolich is undead, not a dragon. Deliberately conservative —
// a wrong type pollutes the Bestiary's facet permanently, while a null one
// simply doesn't appear, so anything it can't place stays empty for the DM to
// fill in through enemy-kinds.json (or the app).
const KIND_RULES: ReadonlyArray<[RegExp, string]> = [
  [/\bgiant (spider|rat|bat|centipede|toad|frog|crab|wasp|boar|elk|scorpion|ape|eagle|owl|goat|lizard|weasel|badger|hyena|shark|octopus|snail|vulture|constrictor|poisonous|venomous|fire beetle|lightning eel|wolf spider)\b/, "beast"],
  [/dracolich/, "undead"],
  [/dragon|wyrmling|\bwyrm\b|dracon|tiamat/, "dragon"],
  [/zombie|skeleton|skeletal|ghost|ghoul|ghast|\bwight\b|vampir|\blich\b|spect(re|er)|wraith|banshee|mumm(y|ies)|revenant|will-?o|crawling claw|boneless|deathlock|bodak|sorrowsworn|coldlight walker|shatter corpse|corpse|husk|returned|undead|undying|haze wight|mask wight|spawn of kyuss/, "undead"],
  [/demon|devil|\bimp\b|quasit|barlgura|hezrou|glabrezu|nalfeshnee|marilith|balor|vrock|succub|incubus|erinyes|cambion|yugoloth|arcanaloth|nycaloth|alkilith|bulezau|dretch|nupperibo|maw demon|shoosuva|yochlol|fiend|hellion|manes|molydeus/, "fiend"],
  [/angel|deva|planetar|\bsolar\b|couatl|unicorn|pegasus|ki-?rin/, "celestial"],
  [/elemental|salamander|\bazer\b|invisible stalker|gargoyle|water weird|mephit|\bdao\b|\bmarid\b|\befreeti\b|\bdjinni\b|magmin|blaze|fire snake|weird\b/, "elemental"],
  [/golem|animated|homunculus|modron|scarecrow|shield guardian|helmed horror|\bdrone\b|clockwork|nimblewright|robot|terracotta|carionette|living doll|flying sword|guardian portrait|skeleton key/, "construct"],
  [/\booze\b|slime|pudding|jelly|\bmimic\b|oblex|gray ooze|demon ichor|vampiric mist|acidic mist/, "ooze"],
  [/shambling mound|treant|\bblight\b|dryad|\bvine\b|myconid|fungus|shrieker|spore servant|violet fungus|gas spore|ordeal tree|corpse flower|razorvine|assassin vine|yellow musk/, "plant"],
  [/\bfey\b|satyr|sprite|pixie|redcap|\bhag\b|darkling|korred|boggle|quickling|lampad|hamadryad|eidolon|\bnilbog\b|booyahg|inkling/, "fey"],
  [/\bgiant\b|\bogre\b|ogrillon|troll|ettin|cyclops|fomorian|\boni\b|firbolg|\byeti\b/, "giant"],
  [/aboleth|beholder|mind flayer|\bslaad\b|chuul|otyugh|flumph|nothic|gibbering|intellect devourer|star spawn|elder brain|cloaker|\bgrick\b|choker|ceremorph|aberrant|orthoclath|phaerimm|flesh meld|oculo|mutate|hybrid|larva mage/, "aberration"],
  [/goblin|hobgoblin|bugbear|kobold|\borcs?\b|\borog\b|\bdrow\b|duergar|derro|svirfneblin|deep gnome|gnoll|lizardfolk|kuo-?toa|sahuagin|yuan-?ti|grippli|tabaxi|kalashtar|aarakocra|chitine|choldrith|troglodyte|koalinth|grimlock|\bbandit\b|cultist|\bcult\b|\bguard\b|\bthug\b|veteran|knight|priest|\bmage\b|wizard|archer|assassin|berserker|\bscout\b|\bnoble\b|commoner|acolyte|warrior|soldier|servant|captain|hunter|\bspy\b|gladiator|\bdruid\b|monk\b|initiate|\bmonarch\b|pirate|vampirate|sentry|drifter|minstrel|worker|dwarf|dwarven|felbarren|shield dwarf|wolf reaver|ashen heir|iron consul|master thief|night blade|reckoner|illusionist|performer|pledgemage|professor|exorcist|iconoclast|blood mage|gunslinger|ruffian|sacred stone|feathergale|howling hatred|black earth|fist of bane|black gauntlet|doom lord|warlord|hierophant|eldritch|precognitive|thought spy|urban ranger|skulk|kraken priest/, "humanoid"],
  [/\bwolf\b|wolves|\bbear\b|\bboar\b|\brat\b|\bbat\b|spider|\bsnake\b|serpent|\bape\b|\belk\b|horse|hound|\bshark\b|crocodile|rhinoceros|\broc\b|vulture|stirge|piercer|swarm of|reef|\bcrab\b|\bwasp\b|\bdog\b/, "beast"],
  [/chimera|manticore|owlbear|griffon|hydra|basilisk|cockatrice|harpy|minotaur|roper|rust monster|kruthik|purple worm|displacer|hook horror|peryton|remorhaz|winter wolf|werewolf|wereboar|werebat|werefox|wolfwere|ettercap|cave fisher|ankheg|death dog|gorgon|phase spider|sword spider|wyvern|banderhobb|amphisbaena|doppelganger|nagpa|shadow mastiff|barghest|sorrowsworn/, "monstrosity"],
];
const kindOf = (name: string): string | undefined => {
  const manual = kindOverrides[name];
  if (manual !== undefined) return manual || undefined;
  const l = name.toLowerCase();
  return KIND_RULES.find(([re]) => re.test(l))?.[1];
};

// ── the party's record (notes) ───────────────────────────────────────────────
const listSessions = (labels: string[]) => {
  if (labels.length === 1) return `in session ${labels[0]}`;
  if (labels.length <= 6) return `in sessions ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `across sessions ${labels[0]}–${labels[labels.length - 1]}`;
};
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

const notesFor = (a: Agg) => {
  const labels = [...a.sessions.values()].sort((x, y) => x.num - y.num).map((s) => s.label);
  const parts = [`Fought ${times(a.encounters)} — ${listSessions(labels)}.`];
  // Only worth saying when it adds something: one creature per fight is already
  // implied by the fight count.
  if (a.encountered !== a.encounters) parts.push(`${a.encountered} in all.`);
  if (a.fates.has("killed-later")) {
    parts.push(`One got away in session ${a.fateSession.get("killed-later")}, and was hunted down later.`);
  } else if (a.fates.has("survived")) {
    parts.push(`At least one was still standing when the party left (session ${a.fateSession.get("survived")}).`);
  } else {
    parts.push(a.encountered === 1 ? "The party put it down." : "The party put every one of them down.");
  }
  // Provenance, so nobody mistakes generated prose for something they wrote.
  return `${parts.join(" ")}\n— from the DM's tally of enemies fought (sessions 1–${LEDGER_THROUGH}).`;
};

// ── assertions on the aggregate ─────────────────────────────────────────────
const monsters = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
const pairs: Array<{ monster: string; sessionId: string; num: number }> = [];
for (const a of monsters) {
  for (const [sessionId, s] of a.sessions) pairs.push({ monster: a.name, sessionId, num: s.num });
}
const reveals = monsters.map((a) => {
  const first = [...a.sessions.entries()].sort((x, y) => x[1].num - y[1].num)[0];
  return { monster: a.name, sessionId: first[0], num: first[1].num };
});

if (rows.length !== EXPECT.rows) fail(`expected ${EXPECT.rows} encounter rows, parsed ${rows.length}`);
if (monsters.length !== EXPECT.monsters) fail(`expected ${EXPECT.monsters} creatures, aggregated ${monsters.length}`);
if (pairs.length !== EXPECT.pairs) fail(`expected ${EXPECT.pairs} (monster, session) pairs, built ${pairs.length}`);
if (stubs.length !== EXPECT.sessionsMissing) fail(`expected ${EXPECT.sessionsMissing} placeholder sessions, built ${stubs.length}`);
if (reveals.length !== monsters.length) fail(`every creature needs exactly one reveal (${reveals.length} vs ${monsters.length})`);

// ── emit ────────────────────────────────────────────────────────────────────
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qn = (s: string | undefined | null) => (s == null || s === "" ? "null" : q(s));
const nn = (n: number | undefined | null) => (n == null ? "null" : String(n));

const STUB_SUMMARY =
  "*No play notes were ever imported for this session. It is recorded here so the " +
  "Bestiary can point at the creatures the party fought in it — see migration 0034.*";
const STUB_SUMMARY_SIDE =
  "*A side session. No play notes were ever imported for it; it is recorded here so the " +
  "Bestiary can point at the creatures the party fought in it — see migration 0034.*";

const sessionSql =
  `insert into public.sessions (id, campaign_id, num, title, summary) values\n` +
  stubs
    .map((s) => `  (${q(s.id)}, ${q(CAMPAIGN)}, ${s.num}, ${q(s.title)}, ${q(s.side ? STUB_SUMMARY_SIDE : STUB_SUMMARY)})`)
    .join(",\n") +
  `\non conflict (id) do nothing;`;

const monsterSql =
  `insert into public.monsters (id, campaign_id, name, kind, threat, cr, encountered, notes) values\n` +
  monsters
    .map((a) => {
      const cr = crOf.get(a.name);
      return `  (${q(idOf.get(a.name)!)}, ${q(CAMPAIGN)}, ${q(a.name)}, ${qn(kindOf(a.name))}, ` +
        `${qn(crToThreat(cr))}, ${nn(cr)}, ${nn(a.encountered)}, ${q(notesFor(a))})`;
    })
    .join(",\n") +
  `\non conflict (id) do nothing;`;

const connectionSql =
  `insert into public.connections (campaign_id, from_id, to_id, label)\n` +
  `select v.campaign_id, v.from_id, v.to_id, v.label\n` +
  `from (values\n` +
  pairs
    .sort((a, b) => a.monster.localeCompare(b.monster) || a.num - b.num)
    .map((p) => `  (${q(CAMPAIGN)}, ${q(idOf.get(p.monster)!)}, ${q(p.sessionId)}, 'fought in')`)
    .join(",\n") +
  `\n) as v(campaign_id, from_id, to_id, label)\n` +
  `where not exists (\n` +
  `  select 1 from public.connections c\n` +
  `  where c.campaign_id = v.campaign_id and c.from_id = v.from_id\n` +
  `    and c.to_id = v.to_id and c.label = v.label\n` +
  `);`;

const revealSql =
  `insert into public.session_events (campaign_id, session_id, type, entity_id, text, created_at)\n` +
  `select v.campaign_id, v.session_id, v.type, v.entity_id, v.text, v.created_at\n` +
  `from (values\n` +
  reveals
    .sort((a, b) => a.num - b.num || a.monster.localeCompare(b.monster))
    .map((r) =>
      `  (${q(CAMPAIGN)}, ${q(r.sessionId)}, 'reveal', ${q(idOf.get(r.monster)!)}, ${q(r.monster)}, ` +
      `timestamptz '2000-01-01 00:00:00+00' + interval '${r.num} days')`)
    .join(",\n") +
  `\n) as v(campaign_id, session_id, type, entity_id, text, created_at)\n` +
  `where not exists (\n` +
  `  select 1 from public.session_events e\n` +
  `  where e.campaign_id = v.campaign_id and e.session_id = v.session_id\n` +
  `    and e.type = v.type and e.entity_id = v.entity_id\n` +
  `);`;

const stubRanges = (() => {
  const nums = stubs.map((s) => s.title.replace("Session ", ""));
  return `${nums[0]}–${nums[nums.length - 1]} (${stubs.length} rows)`;
})();

const migration = `-- The Fist of Ilmater Bestiary: every creature the party has fought, imported
-- from the DM's ledger of enemies (sessions 1–${LEDGER_THROUGH}), each one linked to the
-- sessions it was fought in.
--
-- Generated by scripts/generate-foi-bestiary.ts from the committed
-- scripts/foi/enemies.tsv (one row per creature per encounter, with fate decoded
-- from the ledger's cell colours), cross-checked against enemy-totals.tsv.
-- Do not edit by hand — regenerate.
--
-- Requires 0033 for monsters.cr / monsters.encountered.
--
-- ${monsters.length} monsters · ${pairs.length} monster→session strings · ${reveals.length} reveals · ${stubs.length} placeholder sessions
--
-- Four things worth knowing before changing anything here:
--
--   * THREAT IS DERIVED FROM CR by crToThreat() in src/monsters.ts, which this
--     generator imports so a seeded band can't disagree with the app's. Editing
--     a threat value below without its cr makes the row lie.
--   * THE REVEAL ROWS ARE WHAT INK THE PLATES. Discovery is derived from the
--     session feed (inkedMonsters), not stored, so one reveal per creature at
--     its FIRST session is what produces "First met — Session N". The
--     monster→session strings are the separate, complete record: a creature
--     fought in sessions 2 and 46 gets a chip for both.
--   * connections.created_at / session_id / author are left NULL on purpose.
--     0031 defines null created_at as "predates the column" — true here — and
--     session_id means "drawn while that session was live", which an import
--     wasn't; the far endpoint already IS the session.
--   * THE PLACEHOLDER SESSIONS ARE PLACEHOLDERS: nums ${stubRanges} whose play
--     notes were never imported. They carry a null date so they can't reach the
--     charter's LAST PLAYED tile. Because every seed inserts sessions with
--     "on conflict do nothing", importing the real notes later must be an
--     UPDATE — an insert would silently do nothing. Same warning in
--     supabase/migrations/README.md.
--
-- Every statement is idempotent: a re-apply is a no-op. That also means a
-- regenerated 0034 CANNOT correct a row already in prod — corrections go in a
-- later migration as explicit updates, never by switching these to
-- "on conflict do update", which would clobber the DM's own edits.

-- ==========================================================================
-- Placeholder sessions for the nums the journal never imported
-- ==========================================================================

${sessionSql}

-- ==========================================================================
-- The plates
-- ==========================================================================

${monsterSql}

-- ==========================================================================
-- Fought in — one string per (creature, session)
-- ==========================================================================

${connectionSql}

-- ==========================================================================
-- Reveals — one per creature, at the session it was first fought in
-- ==========================================================================

${revealSql}
`;

// ── report ──────────────────────────────────────────────────────────────────
const hist = (pick: (a: Agg) => string | undefined) => {
  const m = new Map<string, number>();
  for (const a of monsters) m.set(pick(a) ?? "(none)", (m.get(pick(a) ?? "(none)") ?? 0) + 1);
  return [...m].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}=${v}`).join("  ");
};
const nullKinds = monsters.filter((a) => !kindOf(a.name)).map((a) => a.name);

console.log(`\nsource`);
console.log(`  ${rawRows.length} encounter rows · ${monsters.length} creatures · ${totals.length} rows in the aggregate list`);
console.log(`  ${pairs.length} (creature, session) pairs · ${reveals.length} reveals · ${stubs.length} placeholder sessions`);

console.log(`\nhalf sessions`);
for (const n of halfNotes) console.log(`  ${n}`);

console.log(`\naliases applied`);
for (const [k, v] of Object.entries(aliases)) {
  if (k.startsWith("_")) continue;
  console.log(`  ${usedAliases.has(key(k)) ? "ok  " : "UNUSED"} ${k} → ${v}`);
}

console.log(`\nledger vs aggregate list`);
console.log(`  only in the ledger: ${docOnly.join(", ") || "—"}`);
console.log(`  only in the list:   ${totalsOnly.join(", ") || "—"}`);
for (const m of amountMismatch) console.log(`  amount  ${m}`);
for (const m of crMismatch) console.log(`  CR      ${m}`);

console.log(`\nthreat  ${hist((a) => crToThreat(crOf.get(a.name)))}`);
console.log(`kind    ${hist((a) => kindOf(a.name))}`);
console.log(`\n${nullKinds.length} creatures with no creature type (${Math.round((1 - nullKinds.length / monsters.length) * 100)}% placed).`);
console.log(`Fill any you care about into scripts/foi/enemy-kinds.json:`);
for (const n of nullKinds) console.log(`  ${n}`);

const top = (label: string, pick: (a: Agg) => number, fmt: (a: Agg) => string) => {
  console.log(`\ntop 20 by ${label}`);
  for (const a of [...monsters].sort((x, y) => pick(y) - pick(x)).slice(0, 20)) console.log(`  ${fmt(a)}`);
};
top("creatures fought", (a) => a.encountered, (a) => `${String(a.encountered).padStart(4)}  ${a.name}`);
top("CR", (a) => crOf.get(a.name) ?? -1, (a) => `  CR ${(crLabel(crOf.get(a.name)) ?? "—").padEnd(4)} ${a.name}`);

if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S) — nothing written:`);
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}

writeFileSync(join(ROOT, MIGRATION), migration);
console.log(`\nwrote ${MIGRATION} — ${(migration.length / 1024).toFixed(0)} KB, 4 statements`);
