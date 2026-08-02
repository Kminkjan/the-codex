// Data-gathering half of the `session-recap` skill: collects everything a
// session left behind into one JSON bundle, publication-filtered, so the
// writing half never has to touch the network or think about `hidden`.
//
//   npx tsx .claude/skills/session-recap/gather.ts --campaign=fendwick --session=5
//   npx tsx .claude/skills/session-recap/gather.ts --campaign=fendwick --session=latest
//
// Reads SUPABASE_SERVICE_ROLE_KEY from .env. That key BYPASSES RLS — every
// hidden row is visible to this script and would otherwise sail straight into
// the public `sessions.summary`. The `hidden` filtering below is the only thing
// standing between DM prep and the players, so it is applied here, once, at the
// source, rather than being left to the model's discretion downstream.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Every table `campaignContext` loads an entity kind from. Ordered as in
// data.ts's KindKey union so the bundle reads in a familiar order.
const KIND_TABLES = [
  "people", "locations", "quests", "goals",
  "factions", "items", "lore", "monsters",
] as const;

// Kinds with no `hidden` column (0018 never gave them one) — asking PostgREST
// for `hidden=eq.false` on these 400s, and `isHidden` is false for them anyway.
const NO_HIDDEN_COLUMN = new Set(["sessions", "arcs", "events"]);

type Row = Record<string, any>;

function arg(name: string, fallback?: string): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  if (fallback !== undefined) return fallback;
  console.error(`missing required --${name}=…`);
  process.exit(1);
}

// Mirrors src/data.ts entityLabel — the primary display field varies by kind.
const entityLabel = (e: any): string => e?.name || e?.title || e?.text || "—";
const isHidden = (e: any): boolean => !!(e && e.hidden);

function loadEnv(): { url: string; key: string } {
  const root = resolve(import.meta.dirname, "../../..");
  let raw: string;
  try {
    raw = readFileSync(resolve(root, ".env"), "utf8");
  } catch {
    console.error(`no .env at ${root} — worktrees need it copied from the main checkout`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }
  return { url, key };
}

const { url, key } = loadEnv();

async function q(path: string): Promise<Row[]> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    console.error(`GET ${path} → ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json() as Promise<Row[]>;
}

// ===== resolve the session ==================================================

const campaignId = arg("campaign");
const which = arg("session", "latest");

const campaign = (await q(`campaigns?id=eq.${campaignId}&select=*`))[0];
if (!campaign) {
  console.error(`no campaign "${campaignId}"`);
  process.exit(1);
}

const sessions = await q(
  `sessions?campaign_id=eq.${campaignId}&select=*&order=num.desc`,
);
const session = which === "latest"
  ? sessions[0]
  : sessions.find((s) => String(s.num) === which);
if (!session) {
  console.error(`no session ${which} in ${campaignId}`);
  process.exit(1);
}
// `num` is not unique (foi-s37 / foi-s37b both sit at 37), so a numeric lookup
// can be ambiguous. Say so rather than silently recapping one of the two.
const sameNum = sessions.filter((s) => s.num === session.num);
const ambiguousNum = sameNum.length > 1 ? sameNum.map((s) => s.id) : null;

const previous = sessions.find((s) => s.num < session.num && (s.summary ?? "").trim());

// ===== the feed =============================================================

const events = await q(
  `session_events?session_id=eq.${session.id}&select=*&order=created_at`,
);

// The session's wall-clock window, from its own start/end rows. This is what
// rescues party notes whose `session_id` is null — see below.
const startEv = events.find((e) => e.type === "start");
const endEv = [...events].reverse().find((e) => e.type === "end");
const windowStart = startEv?.created_at ?? null;
// A session still live (or one the DM never pressed End on) has no end row.
// Leaving the window half-open would silently disable the note recovery below,
// so run it to now and tell the caller the session hasn't been closed out.
const openEnded = !!windowStart && !endEv;
const windowEnd = endEv?.created_at ?? (openEnded ? new Date().toISOString() : null);

// ===== entities =============================================================

const byId = new Map<string, Row & { _kind: string }>();
const hiddenIds = new Set<string>();
for (const table of KIND_TABLES) {
  for (const row of await q(`${table}?campaign_id=eq.${campaignId}&select=*`)) {
    if (isHidden(row)) { hiddenIds.add(row.id); continue; }
    byId.set(row.id, { ...row, _kind: table });
  }
}

const describe = (id?: string | null) => {
  if (!id) return null;
  const e = byId.get(id);
  return e ? { id, kind: e._kind, label: entityLabel(e) } : { id, kind: null, label: null };
};

// ===== publication filter ===================================================
//
// Mirrors sessionFeedToMarkdown (src/data.ts): a reveal or annotation of a
// currently-hidden entity is dropped WHOLE — the label snapshotted in `text`
// would leak it just as surely as the row would. Link rows are checked on BOTH
// endpoints. An entity that was deleted rather than hidden still prints,
// degraded to its snapshot: the feed is history.
let droppedEvents = 0;
const feed = events.filter((ev) => {
  const touches = [ev.entity_id, ev.entity_id_b].filter(Boolean) as string[];
  if (touches.some((id) => hiddenIds.has(id))) { droppedEvents++; return false; }
  return true;
}).map((ev) => ({
  at: ev.created_at,
  type: ev.type,
  author: ev.author,
  // For annotate rows this is a BOUNDED EXCERPT, not the note. The full prose
  // is in `notes` below, matched on entity + timestamp. Never recap from this.
  text: ev.text,
  entity: describe(ev.entity_id),
  entityB: describe(ev.entity_id_b),
  labelSnapshot: ev.entity_label,
}));

// ===== party notes ==========================================================
//
// `session_id` is stamped from getActiveSessionId() at write time (mutations.ts),
// which is null whenever the DM's client didn't have the session marked live —
// so it under-reports. Fendwick S5 lost two notes that way. Union the column
// match with a created_at window match, and surface anything just outside the
// window separately rather than guessing.
const allNotes = await q(
  `party_notes?campaign_id=eq.${campaignId}&select=*&order=created_at`,
);

const inWindow = (ts: string) =>
  !!windowStart && !!windowEnd && ts >= windowStart && ts <= windowEnd;

// An hour either side of the session — prep written just before play, or a
// note typed after the end row. Reported, never auto-included.
const NEAR_MS = 60 * 60 * 1000;
const near = (ts: string) => {
  if (!windowStart || !windowEnd) return false;
  const t = Date.parse(ts);
  return (t >= Date.parse(windowStart) - NEAR_MS && t < Date.parse(windowStart))
    || (t > Date.parse(windowEnd) && t <= Date.parse(windowEnd) + NEAR_MS);
};

let droppedNotes = 0;
const shapeNote = (n: Row, provenance: string) => ({
  at: n.created_at,
  author: n.author,
  text: n.text,
  entity: describe(n.entity_id),
  provenance,
});

const notes: ReturnType<typeof shapeNote>[] = [];
const notesNearWindow: ReturnType<typeof shapeNote>[] = [];
for (const n of allNotes) {
  if (n.entity_id && hiddenIds.has(n.entity_id)) { droppedNotes++; continue; }
  const tagged = n.session_id === session.id;
  if (tagged || inWindow(n.created_at)) {
    notes.push(shapeNote(n, tagged ? "session_id" : "time-window"));
  } else if (near(n.created_at)) {
    notesNearWindow.push(shapeNote(n, "near-window"));
  }
}

// ===== connections ==========================================================

const connections = (await q(
  `connections?campaign_id=eq.${campaignId}&session_id=eq.${session.id}&select=*`,
))
  .filter((c) => !hiddenIds.has(c.from_id) && !hiddenIds.has(c.to_id))
  .map((c) => ({ at: c.created_at, label: c.label, from: describe(c.from_id), to: describe(c.to_id) }));

// ===== entities this session actually touched ===============================
//
// Full records, because the richest material is often typed onto a sheet during
// play rather than into the feed — Percapock's "people have gone crazy in
// Northmill" exists only in his `notes` column.
const touchedIds = new Set<string>();
for (const ev of feed) {
  if (ev.entity?.id) touchedIds.add(ev.entity.id);
  if (ev.entityB?.id) touchedIds.add(ev.entityB.id);
}
for (const n of notes) if (n.entity?.id) touchedIds.add(n.entity.id);

const touched = [...touchedIds]
  .map((id) => byId.get(id))
  .filter(Boolean)
  .map((e) => {
    const { campaign_id, _kind, ...rest } = e as Row;
    return { kind: _kind, ...rest };
  });

// ===== cast =================================================================
//
// session_participants is the junction 0013 recomputes people.last_seen_session_id
// from, and 0029 treats it as "the on-screen party" — PCs included, not just the
// NPCs a reveal happened to touch. It is the ONLY record of who was at the table:
// channel Presence is occupancy and expires with the socket (0021 dropped
// presence_users), so if this is thin the attendance line is unrecoverable later.
const participants = (await q(
  `session_participants?session_id=eq.${session.id}&select=person_id`,
))
  .map((r) => byId.get(r.person_id))
  .filter(Boolean)
  .map((p: any) => ({ id: p.id, name: p.name, isPc: !!p.is_pc, status: p.status }));

const pcRoster = [...byId.values()]
  .filter((e: any) => e._kind === "people" && e.is_pc)
  .map((p: any) => ({ id: p.id, name: p.name, status: p.status }));

// ===== timeline =============================================================
//
// `events` (0009) is the first-class timeline the Events page groups by
// in_game_date. Rows written for this session are DM-authored prose and are
// often cleaner than the feed note that preceded them — S5's "Group gone
// undercover" event has the aliases spelled correctly where the feed does not.
const timeline = (await q(
  `events?session_id=eq.${session.id}&select=*&order=order_num`,
)).map((e) => ({
  id: e.id, title: e.title, summary: e.summary,
  inGameDate: e.in_game_date, orderNum: e.order_num,
  location: describe(e.location_id),
}));

const arc = session.arc_id
  ? (await q(`arcs?id=eq.${session.arc_id}&select=id,title,summary`))[0] ?? null
  : null;

// ===== unmatched names ======================================================
//
// A rough pass at "somebody acted tonight and has no row". S5 lost Eli that way
// — aliased, active in two scenes, absent from `people` entirely — and no
// structural check can catch it, because the only trace is a capitalised word
// in prose. Deliberately a prompt to look, not an answer: aliases, place names
// and sentence-initial words all land here as false positives. Cheap to skim,
// and the one true positive is worth the noise.
const known = new Set<string>();
for (const e of byId.values()) {
  for (const part of entityLabel(e).split(/[\s,'’\-—/]+/)) {
    if (part.length > 2) known.add(part.toLowerCase());
  }
}
// Words that open a sentence or are simply capitalised English — not names.
const STOPWORDS = new Set([
  "the", "a", "an", "he", "she", "they", "we", "it", "there", "this", "that",
  "his", "her", "their", "our", "and", "but", "if", "when", "then", "party",
  "group", "someone", "somebody", "half", "orc", "elf", "human", "gnome",
  "halfling", "guards", "guard", "mother", "man", "woman", "men", "women",
  "innkeeper", "also", "named", "now", "very", "just", "seems", "one", "two",
  "north", "south", "east", "west", "northern", "eastern", "western",
  // Sentence openers. Position-based filtering is NOT used — "Alvin gives each
  // of us 10 gp" and "Eli, Montague and Berend strongarmed…" both begin their
  // note, so skipping sentence-initial words discards precisely the names this
  // exists to surface. Carrying a stopword list instead means more noise and no
  // blind spot, which is the right trade for a list the DM only skims.
  "absolutely", "these", "those", "what", "who", "where", "why", "how",
  "after", "before", "during", "while", "with", "without", "from", "into",
  "everyone", "nobody", "both", "each", "some", "many", "next", "last",
  "first", "second", "third", "another", "other", "same", "such", "only",
  "still", "again", "once", "twice", "here", "yes", "not", "was", "were",
  "has", "have", "had", "did", "does", "will", "would", "could", "should",
]);

// Both sources: party notes AND plain `note` rows in the feed. The S5 case that
// motivated this ("Alvin gives each of us 10 gp", one line after Alivar Thalin
// hands over a ring) is a feed row, not a sheet note.
const prose: string[] = [
  ...notes.map((n) => n.text ?? ""),
  ...feed.filter((e) => e.type === "note").map((e) => e.text ?? ""),
];

const nameHits = new Map<string, { count: number; contexts: string[] }>();
for (const text of prose) {
  for (const m of text.matchAll(/\b([A-Z][a-z]{2,})\b/g)) {
    const word = m[1];
    const lower = word.toLowerCase();
    if (known.has(lower) || STOPWORDS.has(lower)) continue;
    // "Doesn" out of "Doesn't" and friends — an apostrophe artefact, never a name.
    if (text[m.index! + word.length] === "'" || text[m.index! + word.length] === "’") continue;
    const hit = nameHits.get(word) ?? { count: 0, contexts: [] };
    hit.count++;
    if (hit.contexts.length < 3) hit.contexts.push(text.slice(0, 100));
    nameHits.set(word, hit);
  }
}
// Ranked by how often the word recurs: a name someone actually used repeatedly
// outranks a one-off sentence opener. Capped, because a long session's prose can
// yield fifty candidates and an unskimmable list gets skipped entirely — but the
// cap is REPORTED, never silent.
const NAME_CAP = 25;
const rankedNames = [...nameHits.entries()]
  .map(([name, h]) => ({ name, count: h.count, contexts: h.contexts }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
const unmatchedNames = rankedNames.slice(0, NAME_CAP);
const unmatchedNamesTruncated = Math.max(0, rankedNames.length - NAME_CAP);

// ===== goals ================================================================
//
// Both directions: new goals to propose, and open ones this session may have
// closed. Fendwick S5 resolved fw-g1 (Thalin's offer) and left it `pursuing`.
const openGoals = (await q(
  `goals?campaign_id=eq.${campaignId}&archived=is.false&select=*`,
))
  .filter((g) => !isHidden(g))
  .map((g) => ({ id: g.id, text: g.text, owner: g.owner, kind: g.kind, status: g.status }));

// ===== bundle ===============================================================

console.log(JSON.stringify({
  campaign: { id: campaign.id, title: campaign.title, subtitle: campaign.subtitle },
  session: {
    id: session.id, num: session.num, title: session.title,
    date: session.date, arcId: session.arc_id,
    hasSummary: !!(session.summary ?? "").trim(),
    summary: session.summary ?? null,
  },
  ambiguousNum,
  styleExemplar: previous
    ? { num: previous.num, title: previous.title, summary: previous.summary }
    : null,
  window: { start: windowStart, end: windowEnd, openEnded },
  arc,
  // `participants` is the cast; `pcRoster` is every PC in the campaign. A
  // roster PC absent from participants is the attendance gap — see SKILL.md.
  participants,
  pcRoster,
  pcsNotMarkedPresent: pcRoster.filter((p) => !participants.some((q) => q.id === p.id)),
  timeline,
  unmatchedNames,
  unmatchedNamesTruncated,
  feed,
  notes,
  notesNearWindow,
  connections,
  touchedEntities: touched,
  openGoals,
  excluded: {
    hiddenEntitiesInCampaign: hiddenIds.size,
    eventsDroppedAsHidden: droppedEvents,
    notesDroppedAsHidden: droppedNotes,
  },
}, null, 2));
