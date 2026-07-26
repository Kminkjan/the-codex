export type Status = "whispered" | "pursuing" | "resolved" | "lost";

// People-only enums (Status above belongs to quests/goals). Tier is the
// information-overload valve: background folk stay searchable and connectable
// while the list reveal and board-card gating (follow-up PRs) tuck them away.
export type PersonTier = "major" | "supporting" | "background";
export type PersonStatus = "alive" | "dead" | "missing" | "unknown";
export const PERSON_TIER_OPTIONS = ["major", "supporting", "background"] as const;
export const PERSON_STATUS_OPTIONS = ["alive", "dead", "missing", "unknown"] as const;

// Monsters-only: how much of a fight it is. Deliberately not CR — the Bestiary
// is a glossary for artwork and notes, not a statblock, so this is the one
// at-a-glance signal and it stays readable to players.
export type MonsterThreat = "harmless" | "risky" | "deadly" | "legendary";
export const MONSTER_THREAT_OPTIONS = ["harmless", "risky", "deadly", "legendary"] as const;

export type KindKey =
  | "people"
  | "locations"
  | "quests"
  | "goals"
  | "factions"
  | "items"
  | "lore"
  | "monsters"
  | "sessions"
  | "arcs"
  | "events";

export interface Session {
  id: string;
  num: number;
  title: string;
  date: string;
  summary?: string;
  imageUrl?: string;
  inGameDate?: string;
  arc?: string;
}

// Story arcs group sessions and quests. Like sessions they live outside
// buildKinds: no board cards, no archiving, a bespoke page.
//
// Arcs nest exactly one level (migration 0025): a row with no parentId is a
// **saga** ("The Ravenloft Saga"), its children are its arcs ("Vallaki Arc").
// Depth is enforced by trigger, not here — see isSaga/sagaTree in saga.ts for
// the derivations, and never read parentId to build a tree by hand.
// completedAt is stamped by the Complete Saga wizard; it's the one piece of
// arc state that means "this chapter of the campaign is closed".
export interface Arc {
  id: string;
  title: string;
  summary?: string;
  startSession?: string;
  endSession?: string;
  orderNum: number;
  parentId?: string;
  completedAt?: string;
}

// Key moments of the chronicle ("Karn's death"). Named CampaignEvent to dodge
// the DOM Event type. Like sessions/arcs: outside buildKinds, bespoke page.
// inGameDate is free-form text, so orderNum carries the chronology.
export interface CampaignEvent {
  id: string;
  title: string;
  summary?: string;
  inGameDate?: string;
  session?: string;
  location?: string;
  orderNum: number;
}

export interface ArchivableFields {
  archived?: boolean;
  pinned?: boolean;
  // DM-only visibility (issue #64): unlike archived (a declutter flag, still
  // readable by everyone), hidden rows are projected out of the campaign
  // object entirely for non-DM users — see projectCampaignForViewers.
  hidden?: boolean;
  updatedAt?: string;
}

export interface Person extends ArchivableFields {
  id: string;
  name: string;
  epithet?: string;
  race?: string;
  role?: string;
  disposition?: string;
  alignment?: string;
  tier?: PersonTier;
  status?: PersonStatus;
  // Party membership (issue #114). isPc is the roster fact and playerUserId the
  // account fact — they come apart on purpose: imported campaigns have PCs whose
  // players will never hold an account, the DM seeds people before invites are
  // redeemed, and a dead PC stays a PC. Attribution only, never permission:
  // writes are gated by campaign membership (0023), not by this link.
  isPc?: boolean;
  playerUserId?: string;
  location?: string;
  faction?: string;
  lastSeen?: string;
  imageUrl?: string;
  notes?: string;
}

export interface Location extends ArchivableFields {
  id: string;
  name: string;
  kind: string;
  desc?: string;
  region?: string;
  ruler?: string;
  imageUrl?: string;
  notes?: string;
}

export interface Quest extends ArchivableFields {
  id: string;
  title: string;
  status?: Status;
  reward?: string;
  giver?: string;
  session?: string;
  desc?: string;
  hooks?: string;
  arc?: string;
}

export interface Goal extends ArchivableFields {
  id: string;
  text: string;
  owner: string;
  kind: string;
  status?: Status;
}

export interface Faction extends ArchivableFields {
  id: string;
  name: string;
  sigil: string;
  desc?: string;
  allegiance?: string;
  imageUrl?: string;
}

export interface Item extends ArchivableFields {
  id: string;
  name: string;
  kind: string;
  desc?: string;
  imageUrl?: string;
}

export interface Lore extends ArchivableFields {
  id: string;
  title: string;
  text: string;
}

// A bestiary plate. `kind` is the creature type ("aberration", "undead"),
// matching the locations/items convention; `desc` carries the lore and `notes`
// the party's own record of fighting the thing.
export interface Monster extends ArchivableFields {
  id: string;
  name: string;
  kind?: string;
  threat?: MonsterThreat;
  habitat?: string;
  desc?: string;
  imageUrl?: string;
  notes?: string;
}

export const ARCHIVABLE_KINDS: ReadonlyArray<KindKey> = [
  "people", "locations", "quests", "goals", "factions", "items", "lore", "monsters",
];

export function isArchivableKind(k: KindKey): boolean {
  return ARCHIVABLE_KINDS.includes(k);
}

export type BoardPosition = { x: number; y: number; rot: number; kind: KindKey };

// Ephemeral channel-presence identity (issue #74) — derived from the auth
// display name and tracked on the campaign realtime channel, never stored.
export interface PresenceUser {
  id: string;
  name: string;
  initials: string;
  color: string;
}

// Mirrored editor identity from public.profiles (0020) — the durable
// counterpart to PresenceUser above, covering members whether or not they're
// online. Written only by upsertMyProfile for the caller's own row.
export interface UserProfile {
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface PartyNote {
  author: string;
  when: string;
  text: string;
  hand: boolean;
}

// One row of the free-form `connections` table (a hand-drawn "string"). Was a
// positional [from, to, label] tuple until 0031 added provenance; the object
// form is what lets a reader ask WHEN a string was drawn.
export interface Connection {
  from: string;
  to: string;
  label: string;
  // Null for every row predating 0031 — the seeded back-catalogue genuinely
  // does not know when it was drawn (0031 deliberately did not backfill a
  // fake timestamp). Never substitute a fallback date: "unknown" is the fact.
  createdAt?: string;
  // Set only when the string was drawn while a session was live; prep-time
  // strings legitimately have none.
  sessionId?: string;
  author?: string;
}

// A DM-staged entity queued for a session (session_staging junction). Rows
// with releasedAt null are "queued"; PR 3's one-click release stamps it.
export interface SessionStagingRow {
  sessionId: string;
  entityId: string;
  releasedAt: string | null;
}

export type SessionEventType = "note" | "reveal" | "start" | "end" | "link" | "annotate";

// One row of the append-only live-session feed (session_events). INSERT-only
// by construction — rows are never edited, so one author per row and inserts
// commute across clients.
export interface SessionEvent {
  id: number;
  sessionId: string;
  type: SessionEventType;
  author?: string;
  // Cross-kind entity ref with no FK; events outlive entity deletion (the
  // feed is history), so this may dangle — renderers must findEntity and
  // tolerate null.
  entityId?: string;
  // The far endpoint of a 'link' event (0031). Only link rows set it, and it
  // dangles on entity deletion exactly like entityId. Every filter that gates
  // on entityId's visibility must gate on this one too, or a re-hidden entity
  // leaks back through an old link row.
  entityIdB?: string;
  // Snapshot of the entity's label at write time (0032). Set by 'annotate'
  // rows, whose `text` is already spent on the note excerpt — so unlike a
  // reveal, which snapshots its label INTO text, this needs its own slot. NULL
  // on every pre-0032 row, so renderers must fall through to the stock phrase.
  // Never trusted over a live lookup: it's the deletion fallback, not the
  // display name.
  entityLabel?: string;
  text?: string;
  createdAt: string;
}

// How much of a party note rides along in its feed row (0032, issue #127).
// A pointer with enough prose to recognise the moment, not a second copy of
// the note: the row links through to the sheet, and this excerpt is what the
// public recap digest prints, so it stays bounded on purpose.
const NOTE_EXCERPT_MAX = 72;

export function noteExcerpt(text: string): string {
  // Collapse first — a note is written in a contentEditable, so it arrives with
  // newlines and runs of spaces that would blow out a one-line feed row.
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= NOTE_EXCERPT_MAX) return flat;
  const cut = flat.slice(0, NOTE_EXCERPT_MAX);
  // Back off to the last word boundary so the excerpt doesn't sever a word.
  // Guarded: a single word longer than the cap has no space to back off to, and
  // trimming to nothing would leave a row that reads only "…".
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// "Show now" (#69) rides a 'reveal' row with this sentinel prefixed to `text`:
// the 0016 CHECK constraint pins type to note/reveal/start/end, so a dedicated
// 'show' type needs a migration (planned for 0017). Zero-width space + bolt —
// nothing a user would type into a label, so plain reveals can't collide.
// Data-as-flag caveat: EVERY renderer of a reveal event's `text` must go
// through stripShowMark, or the invisible sentinel leaks into the UI/exports.
export const SHOW_MARK = "\u200b⚡";

export function isShowEvent(e: SessionEvent): boolean {
  return e.type === "reveal" && !!e.text?.startsWith(SHOW_MARK);
}

export function stripShowMark(text: string | undefined): string | undefined {
  return text?.startsWith(SHOW_MARK) ? text.slice(SHOW_MARK.length) : text;
}

export type Entity =
  & (Person | Location | Quest | Goal | Faction | Item | Lore | Monster | Session | Arc | CampaignEvent)
  & { _kind?: KindKey; _kindLabel?: string };

export interface Campaign {
  id: string;
  title: string;
  subtitle: string;
  // Optional crest/cover image for the charter (campaigns.image_url, 0020).
  imageUrl?: string;
  sessions: Session[];
  arcs: Arc[];
  events: CampaignEvent[];
  // event id → participating person ids (event_participants junction).
  eventParticipants: Record<string, string[]>;
  // session id → person ids seen in that session (session_participants junction).
  sessionParticipants: Record<string, string[]>;
  // DM prep queue (session_staging). Projected to [] for non-DM viewers.
  sessionStaging: SessionStagingRow[];
  // Append-only live feed (session_events), sorted by (createdAt, id).
  sessionEvents: SessionEvent[];
  // The shared "we're live in session N" pin (campaigns.active_session_id).
  activeSessionId?: string;
  // DM-only prep notes (issues #70/#73), entity id → text. Lives in the
  // dm_notes side table with a DM-only read policy, so this map is populated
  // only on the DM's client — RLS returns zero rows to everyone else.
  dmNotes: Record<string, string>;
  people: Person[];
  locations: Location[];
  quests: Quest[];
  goals: Goal[];
  factions: Faction[];
  items: Item[];
  lore: Lore[];
  monsters: Monster[];
  connections: Connection[];
  board: Record<string, BoardPosition>;
  notes: Record<string, PartyNote[]>;
}

// Lightweight row for the campaign picker (full data loads per-campaign).
export interface CampaignSummary {
  id: string;
  title: string;
  subtitle: string | null;
}

export interface KindDef {
  key: KindKey;
  label: string;
  plural: string;
  list: () => any[];
  color: string;
}

export function buildKinds(campaign: Campaign): KindDef[] {
  return [
    { key: "people",    label: "Known People",  plural: "people",    list: () => campaign.people,    color: "var(--bloodred)" },
    { key: "locations", label: "Locations",     plural: "locations", list: () => campaign.locations, color: "var(--teal-deep)" },
    { key: "quests",    label: "Quests",        plural: "quests",    list: () => campaign.quests,    color: "var(--mustard)" },
    { key: "goals",     label: "Goals",         plural: "goals",     list: () => campaign.goals,     color: "var(--forest)" },
    { key: "factions",  label: "Factions",      plural: "factions",  list: () => campaign.factions,  color: "var(--slate)" },
    { key: "items",     label: "Items",         plural: "items",     list: () => campaign.items,     color: "var(--gold-antique)" },
    { key: "lore",      label: "Lore",          plural: "lore",      list: () => campaign.lore,      color: "var(--forest-pale)" },
    { key: "monsters",  label: "Bestiary",      plural: "monsters",  list: () => campaign.monsters,  color: "var(--plum)" },
  ];
}

export function findEntity(
  campaign: Campaign,
  id: string | null | undefined,
): (Entity & Record<string, any>) | null {
  if (!id) return null;
  const kinds = buildKinds(campaign);
  for (const k of kinds) {
    const found = k.list().find((e: any) => e.id === id);
    if (found) return { ...found, _kind: k.key, _kindLabel: k.label };
  }
  const sess = campaign.sessions.find((s) => s.id === id);
  if (sess) return { ...sess, _kind: "sessions", _kindLabel: "Sessions", name: sess.title } as any;
  const arc = campaign.arcs.find((a) => a.id === id);
  if (arc) return { ...arc, _kind: "arcs", _kindLabel: "Arcs", name: arc.title } as any;
  const ev = campaign.events.find((e) => e.id === id);
  if (ev) return { ...ev, _kind: "events", _kindLabel: "Events", name: ev.title } as any;
  return null;
}

export function entityLabel(e: any): string {
  return e?.name || e?.title || e?.text || "—";
}

// The one place the "S07" session code is spelled — every surface (sidebar,
// arcs page, board select, cards, detail stats) must agree on the format.
export function sessionLabel(num: number): string {
  return `S${String(num).padStart(2, "0")}`;
}

export function isArchived(e: any): boolean {
  return !!(e && e.archived);
}

export function isPinned(e: any): boolean {
  return !!(e && e.pinned);
}

export function isHidden(e: any): boolean {
  return !!(e && e.hidden);
}

export function isPc(e: any): boolean {
  return !!(e && e.isPc);
}

// Player-facing projection: strips DM-hidden entities and every reference to
// them (connections, board positions, participant ids, party notes), so every
// downstream surface — findEntity (deep links, detail sheet, relation rails),
// buildKinds (lists, counts), buildIndex (⌘K, comboboxes), deriveRelations
// (board yarn), rosters — is clean by construction rather than by per-surface
// filtering. FK fields on visible entities (e.g. a person whose faction is
// hidden) are left alone: consumers resolve them via findEntity and skip
// nulls, and rewriting them here would risk write-back corruption.
export function projectCampaignForViewers(c: Campaign): Campaign {
  const hiddenIds = new Set<string>();
  const keep = <T extends { id: string; hidden?: boolean }>(list: T[]): T[] =>
    list.filter((e) => {
      if (e.hidden) hiddenIds.add(e.id);
      return !e.hidden;
    });
  const people = keep(c.people);
  const locations = keep(c.locations);
  const quests = keep(c.quests);
  const goals = keep(c.goals);
  const factions = keep(c.factions);
  const items = keep(c.items);
  const lore = keep(c.lore);
  const monsters = keep(c.monsters);
  // Since 0018 (issue #73) RLS already keeps hidden rows, staging and
  // dm_notes off non-DM clients — for players this projection is normally the
  // identity. It still must exist and still must strip everything: it is the
  // "view as player" mechanism (#71), where the DM's own client (whose JWT
  // receives everything) flips isDm off without changing what's loaded.
  //
  // Identity fast path: when nothing is hidden, nothing is staged AND no
  // dm_notes exist, return the original object so downstream memos keep their
  // referential equality. (The filter passes above still run — what's saved
  // is the memo invalidation, not the scan.) Staging must be part of the
  // condition: a staged-but-visible entity would otherwise leak the DM's
  // prep to viewers; dm_notes likewise would ride through untouched.
  let hasDmNotes = false;
  for (const _ in c.dmNotes) { hasDmNotes = true; break; }
  if (hiddenIds.size === 0 && c.sessionStaging.length === 0 && !hasDmNotes) return c;
  const dropHiddenValues = (rec: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(rec).map(([k, ids]) => [k, ids.filter((id) => !hiddenIds.has(id))]),
    );
  const dropHiddenKeys = <V>(rec: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(rec).filter(([id]) => !hiddenIds.has(id)));
  return {
    ...c,
    people, locations, quests, goals, factions, items, lore, monsters,
    // DM's eyes only — emptied for the player view (issue #70/#73).
    dmNotes: {},
    connections: c.connections.filter((cn) => !hiddenIds.has(cn.from) && !hiddenIds.has(cn.to)),
    board: dropHiddenKeys(c.board),
    eventParticipants: dropHiddenValues(c.eventParticipants),
    sessionParticipants: dropHiddenValues(c.sessionParticipants),
    notes: dropHiddenKeys(c.notes),
    // The whole prep queue is DM-only ("staged-but-unreleased items are
    // visible only to the DM", #65) — nothing player-facing consumes it, the
    // player surface is the feed, so viewers get none of it.
    sessionStaging: [],
    // Defensive: a reveal event normally implies its entity was just unhidden,
    // but a re-hidden entity must not leak back through old feed rows. Link
    // rows (0031) carry two endpoints and BOTH have to clear, else re-hiding
    // one end of a string still announces the other end's relationship.
    //
    // This is also what covers 'annotate' rows (0032) with no change of its
    // own: a party note has ONE endpoint, so the entityId clause already drops
    // it. Note what that leans on — the row's `entity_label` snapshot never
    // reaches a player, because the row itself is gone before anything reads it.
    // Any future event type carrying an entity ref in some THIRD field has to
    // extend this filter; the pre-0031 version read only entityId and that is
    // exactly how the far endpoint of a link row nearly leaked.
    sessionEvents: c.sessionEvents.filter(
      (e) => (!e.entityId || !hiddenIds.has(e.entityId))
        && (!e.entityIdB || !hiddenIds.has(e.entityIdB)),
    ),
  };
}

// Session-end recap (issue #72): a plain deterministic transform of a
// session's feed into a markdown digest the DM appends to the Chronicle.
// No AI — the feed already is the record of the night. It runs on the DM's
// unprojected campaign but the digest lands in the public `summary`, so it
// must mirror the projection's reveal filter: reveals of currently-hidden
// entities (released, then re-hidden) are skipped entirely — even the label
// snapshotted in `text` would leak. Reveals whose entity was deleted fall
// back to that snapshot, same as the live feed's rows. Link rows (0031) follow
// the same rule on both of their endpoints.
export function sessionFeedToMarkdown(
  events: SessionEvent[],
  resolveEntity: (id?: string | null) => Entity | null,
): string {
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const lines: string[] = [];
  for (const ev of events) {
    const t = fmtTime(ev.createdAt);
    if (ev.type === "start" || ev.type === "end") {
      lines.push(`- *${t}* — ✦ the session ${ev.type === "start" ? "begins" : "ends"} ✦`);
    } else if (ev.type === "reveal") {
      const ent = resolveEntity(ev.entityId);
      if (isHidden(ent)) continue;
      // Show rows (#69) carry the SHOW_MARK sentinel in text — strip it from
      // the label snapshot and word them as the louder verb they were.
      const label = ent ? entityLabel(ent) : stripShowMark(ev.text) || "something struck from the codex";
      const verb = isShowEvent(ev) ? "⚡ **" + label + "** shown to the table" : "🕯 **" + label + "** revealed";
      lines.push(`- *${t}* — ${verb}${ev.author ? ` by ${ev.author}` : ""}`);
    } else if (ev.type === "link") {
      // Same hidden rule as the reveal branch, on BOTH endpoints — this digest
      // lands in the public `summary`, so a re-hidden end must drop the row
      // entirely. isHidden(null) is false, so a *deleted* endpoint still
      // prints, degraded to the fallback phrase (the feed is history).
      const ea = resolveEntity(ev.entityId);
      const eb = resolveEntity(ev.entityIdB);
      if (isHidden(ea) || isHidden(eb)) continue;
      const la = ea ? entityLabel(ea) : "something struck from the codex";
      const lb = eb ? entityLabel(eb) : "something struck from the codex";
      const tie = ev.text ? ` — "${ev.text}"` : "";
      lines.push(`- *${t}* — ⛓ **${la}** and **${lb}** are connected${tie}${ev.author ? ` (${ev.author})` : ""}`);
    } else if (ev.type === "annotate") {
      // A party note left on an entity sheet at the table (0032). Same hidden
      // rule as the two branches above and for the same reason — this digest is
      // published into `summary`, so a re-hidden entity drops the row whole.
      const ent = resolveEntity(ev.entityId);
      if (isHidden(ent)) continue;
      // Live label first, then the snapshot taken at write time, then the stock
      // phrase for pre-0032 rows that have no snapshot. The residual edge is
      // inherited from the reveal branch rather than new: an entity re-hidden
      // AND THEN deleted resolves to null, isHidden(null) is false, so the
      // snapshotted label prints — exactly what reveal's stripShowMark(ev.text)
      // fallback already does.
      const label = ent ? entityLabel(ent) : ev.entityLabel || "something struck from the codex";
      // `text` is the bounded excerpt, not the note — the full prose stays on
      // the sheet, which is the whole reason this is an excerpt (issue #127).
      const quote = ev.text ? ` — "${ev.text}"` : "";
      lines.push(`- *${t}* — 📝 a note on **${label}**${quote}${ev.author ? ` (${ev.author})` : ""}`);
    } else {
      lines.push(`- *${t}* — ${ev.author || "Anonymous"}: ${ev.text ?? ""}`);
    }
  }
  return `### As it happened\n\n${lines.join("\n")}`;
}

// Whether this entity is something the players can already make sense of, and
// so whether an action touching it announces itself in the live feed: a note
// left on an unreleased entity is DM prep, not a story beat (0032).
//
// Two deliberate edges: kinds with no `hidden` column (sessions/arcs/events)
// always read visible, and a null entity — an id that resolves to nothing, so
// either deleted or projected away — is NOT treated as visible.
export function isVisible(e: Entity | null): boolean {
  return !!e && !isHidden(e);
}

// The two-endpoint form, for a hand-drawn string (0031): both ends have to be
// visible before it means anything to the table. Shares isVisible so the two
// can't drift on those edge cases.
export function bothVisible(a: Entity | null, b: Entity | null): boolean {
  return isVisible(a) && isVisible(b);
}

// Null tier reads as major: existing rows predate the column and every curated
// person should count as major without a backfill. Always read tier through
// this helper, never `p.tier` directly.
export function personTier(p: { tier?: PersonTier }): PersonTier {
  return p.tier ?? "major";
}

// Quest/goal status ordering: active work floats up, abandoned sinks. Unknown
// status sits between the open states and the finished ones.
const STATUS_RANK: Record<string, number> = { pursuing: 0, whispered: 1, resolved: 3, lost: 4 };
const STATUS_RANK_UNKNOWN = 2;

// Sort: pinned first, then active, then a kind-aware recency key, then archived at
// the bottom. The recency key varies by kind (opts.kind):
//   - people: most recently *seen* in a session first (lastSeen is a session id,
//     so the caller passes sessionNum to resolve it to the sequential number).
//   - quests/goals: by status (pursuing → whispered → resolved → lost).
//   - everything else: falls straight through to updatedAt (most recently edited).
// updatedAt is always the final tiebreaker.
export function sortForDisplay<T extends { id: string; updatedAt?: string; archived?: boolean; pinned?: boolean }>(
  items: T[],
  opts?: { kind?: KindKey; sessionNum?: (sessionId: string) => number },
): T[] {
  const kind = opts?.kind;
  const statusRank = (e: any): number => {
    if (kind !== "quests" && kind !== "goals") return 0;
    const s = e.status as string | undefined;
    return s && s in STATUS_RANK ? STATUS_RANK[s] : STATUS_RANK_UNKNOWN;
  };
  const seenNum = (e: any): number =>
    kind === "people" && e.lastSeen && opts?.sessionNum ? opts.sessionNum(e.lastSeen) : 0;
  return items.slice().sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const aa = a.archived ? 1 : 0;
    const ab = b.archived ? 1 : 0;
    if (aa !== ab) return aa - ab;
    const ra = statusRank(a);
    const rb = statusRank(b);
    if (ra !== rb) return ra - rb; // lower rank = more active = higher up
    const sa = seenNum(a);
    const sb = seenNum(b);
    if (sa !== sb) return sb - sa; // higher session number = seen more recently
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return tb - ta;
  });
}
