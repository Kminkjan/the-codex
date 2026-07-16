export type Status = "whispered" | "pursuing" | "resolved" | "lost";

// People-only enums (Status above belongs to quests/goals). Tier is the
// information-overload valve: background folk stay searchable and connectable
// while the list reveal and board-card gating (follow-up PRs) tuck them away.
export type PersonTier = "major" | "supporting" | "background";
export type PersonStatus = "alive" | "dead" | "missing" | "unknown";
export const PERSON_TIER_OPTIONS = ["major", "supporting", "background"] as const;
export const PERSON_STATUS_OPTIONS = ["alive", "dead", "missing", "unknown"] as const;
export type KindKey =
  | "people"
  | "locations"
  | "quests"
  | "goals"
  | "factions"
  | "items"
  | "lore"
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
  // DM prep notes (issue #70) — same projection-stripped rule as
  // ArchivableFields.dmNotes; sessions just don't share that mixin.
  dmNotes?: string;
}

// Story arcs group sessions and quests ("Barovia Saga"). Like sessions they
// live outside buildKinds: no board cards, no archiving, a bespoke page.
export interface Arc {
  id: string;
  title: string;
  summary?: string;
  startSession?: string;
  endSession?: string;
  orderNum: number;
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
  // DM-only notes (issue #70): free prose, stripped from the projection for
  // non-DM users like hidden entities — never rendered, indexed, or searched
  // outside the DM's view. Client-gated in V1; RLS is issue #73.
  dmNotes?: string;
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

export const ARCHIVABLE_KINDS: ReadonlyArray<KindKey> = [
  "people", "locations", "quests", "goals", "factions", "items", "lore",
];

export function isArchivableKind(k: KindKey): boolean {
  return ARCHIVABLE_KINDS.includes(k);
}

export type BoardPosition = { x: number; y: number; rot: number; kind: KindKey };

export interface PresenceUser {
  id: string;
  name: string;
  initials: string;
  color: string;
  active: boolean;
}

export interface PartyNote {
  author: string;
  when: string;
  text: string;
  hand: boolean;
}

export type Connection = [string, string, string];

// A DM-staged entity queued for a session (session_staging junction). Rows
// with releasedAt null are "queued"; PR 3's one-click release stamps it.
export interface SessionStagingRow {
  sessionId: string;
  entityId: string;
  releasedAt: string | null;
}

export type SessionEventType = "note" | "reveal" | "start" | "end";

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
  text?: string;
  createdAt: string;
}

export type Entity =
  & (Person | Location | Quest | Goal | Faction | Item | Lore | Session | Arc | CampaignEvent)
  & { _kind?: KindKey; _kindLabel?: string };

export interface Campaign {
  id: string;
  title: string;
  subtitle: string;
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
  // The campaign's DM (campaigns.dm_user_id, an auth user id). One DM per
  // campaign; V1 gating is client-side only.
  dmUserId?: string;
  people: Person[];
  locations: Location[];
  quests: Quest[];
  goals: Goal[];
  factions: Faction[];
  items: Item[];
  lore: Lore[];
  connections: Connection[];
  board: Record<string, BoardPosition>;
  presence: PresenceUser[];
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
  // dm_notes (issue #70) is stripped here too — same central-funnel rule as
  // hidden entities, so no player surface can render it even by accident.
  // Only entities that actually carry dmNotes get a new object; the rest keep
  // their reference so downstream memos don't churn.
  let sawDmNotes = false;
  const stripDmNotes = <T extends { dmNotes?: string }>(e: T): T => {
    if (e.dmNotes === undefined) return e;
    sawDmNotes = true;
    const { dmNotes: _dm, ...rest } = e;
    return rest as T;
  };
  const keep = <T extends { id: string; hidden?: boolean; dmNotes?: string }>(list: T[]): T[] =>
    list
      .filter((e) => {
        if (e.hidden) hiddenIds.add(e.id);
        return !e.hidden;
      })
      .map(stripDmNotes);
  const people = keep(c.people);
  const locations = keep(c.locations);
  const quests = keep(c.quests);
  const goals = keep(c.goals);
  const factions = keep(c.factions);
  const items = keep(c.items);
  const lore = keep(c.lore);
  const sessions = c.sessions.map(stripDmNotes);
  // Identity fast path: when nothing is hidden, nothing is staged AND no
  // dm_notes exist, return the original object so downstream memos keep their
  // referential equality. (The filter/strip passes above still run — what's
  // saved is the memo invalidation, not the scan.) Staging must be part of
  // the condition: a staged-but-visible entity would otherwise leak the DM's
  // prep to viewers; dm_notes likewise would ride through untouched.
  if (hiddenIds.size === 0 && c.sessionStaging.length === 0 && !sawDmNotes) return c;
  const dropHiddenValues = (rec: Record<string, string[]>): Record<string, string[]> =>
    Object.fromEntries(
      Object.entries(rec).map(([k, ids]) => [k, ids.filter((id) => !hiddenIds.has(id))]),
    );
  const dropHiddenKeys = <V>(rec: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(rec).filter(([id]) => !hiddenIds.has(id)));
  return {
    ...c,
    people, locations, quests, goals, factions, items, lore, sessions,
    connections: c.connections.filter(([a, b]) => !hiddenIds.has(a) && !hiddenIds.has(b)),
    board: dropHiddenKeys(c.board),
    eventParticipants: dropHiddenValues(c.eventParticipants),
    sessionParticipants: dropHiddenValues(c.sessionParticipants),
    notes: dropHiddenKeys(c.notes),
    // The whole prep queue is DM-only ("staged-but-unreleased items are
    // visible only to the DM", #65) — nothing player-facing consumes it, the
    // player surface is the feed, so viewers get none of it.
    sessionStaging: [],
    // Defensive: a reveal event normally implies its entity was just unhidden,
    // but a re-hidden entity must not leak back through old feed rows.
    sessionEvents: c.sessionEvents.filter((e) => !e.entityId || !hiddenIds.has(e.entityId)),
  };
}

// Session-end recap (issue #72): a plain deterministic transform of a
// session's feed into a markdown digest the DM appends to the Chronicle.
// No AI — the feed already is the record of the night. It runs on the DM's
// unprojected campaign but the digest lands in the public `summary`, so it
// must mirror the projection's reveal filter: reveals of currently-hidden
// entities (released, then re-hidden) are skipped entirely — even the label
// snapshotted in `text` would leak. Reveals whose entity was deleted fall
// back to that snapshot, same as the live feed's rows.
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
      const label = ent ? entityLabel(ent) : ev.text || "something struck from the codex";
      lines.push(`- *${t}* — 🕯 **${label}** revealed${ev.author ? ` by ${ev.author}` : ""}`);
    } else {
      lines.push(`- *${t}* — ${ev.author || "Anonymous"}: ${ev.text ?? ""}`);
    }
  }
  return `### As it happened\n\n${lines.join("\n")}`;
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
