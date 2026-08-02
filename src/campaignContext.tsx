import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";
import { AuthContext, useAuth } from "./auth";
import { setActiveCampaignId } from "./activeCampaign";
import { setActiveSessionId } from "./activeSession";
import { parseHash, writeCampaignHash } from "./route";
import { foldFeedbackVotes } from "./feedback";
import {
  projectCampaignForViewers,
  type Campaign,
  type CampaignSummary,
  type BoardPosition,
  type Connection,
  type FeedbackItem,
  type FeedbackVote,
  type KindKey,
  type PartyNote,
  type PresenceUser,
  type SessionEvent,
  type SessionStagingRow,
  type UserProfile,
} from "./data";

interface CampaignContextValue {
  campaign: Campaign | null;
  loading: boolean;
  error: string | null;
  campaigns: CampaignSummary[];
  activeCampaignId: string | null;
  switchCampaign: (id: string) => void;
  // Campaign CRUD (issue #87). The picker list loads once and campaigns
  // aren't list-realtime, so the founding/archiving client patches its own
  // list and moves the active id directly instead of round-tripping the
  // hashchange listener (whose closure only knows already-listed ids).
  adoptCampaign: (summary: CampaignSummary) => void;
  retireCampaign: (id: string) => void;
  // True when the signed-in editor holds the dm role in campaign_members
  // (issue #73 — supersedes campaigns.dm_user_id). Fetched per campaign;
  // campaign_members is deliberately outside the realtime publication, so a
  // membership change lands only when refreshMembership() is called (the RPCs
  // in issue #86 do) or on reload. Membership is self-service since 0022 —
  // invites and the roster RPCs, not the dashboard.
  // Since 0018 this is a UI affordance gate, not the security boundary: RLS
  // decides what actually reaches the client.
  // While viewAsPlayer is on this reads FALSE even for the real DM — it is the
  // effective gate, and flipping it here flips the projection and every DM
  // affordance at once (that's the whole "view as player" mechanism, #71).
  isDm: boolean;
  // The un-flipped DM check. Only for surfaces that must survive view-as-player:
  // the toggle/banner itself, and write paths whose *mutation choice* depends on
  // real DM-ness (SessionPin's feed brackets) — a view toggle must never change
  // what gets persisted.
  isRealDm: boolean;
  // May triage the app-wide feedback board (0041's app_maintainers). NOT a DM
  // check and deliberately not campaign-scoped: the board is app-wide, and
  // deriving this from DM-ness would hand it to anyone who founds a campaign,
  // since sign-ups are open and create_campaign makes its caller a DM.
  isMaintainer: boolean;
  // Confirmed to hold a campaign_members row for this campaign (any role) —
  // since 0023 the precondition for every write. Consumers rarely need this
  // directly: it is already folded into the canEdit that CampaignProvider
  // re-provides (which additionally fails open on a failed lookup).
  isMember: boolean;
  // A signed-in editor CONFIRMED to have no seat at this table: they'd see edit
  // affordances RLS refuses, so the UI explains the gap instead. False while the
  // lookup is pending or failed — neither may cry wolf at a real member — and
  // false for viewers, whose read-only state needs no explaining.
  seatless: boolean;
  // "View as player" (#71): pure client state, reset on campaign switch.
  viewAsPlayer: boolean;
  setViewAsPlayer: (on: boolean) => void;
  // Manual counterpart of realtime for the one deliberately-unpublished
  // table (issue #86): membership RPC callers bump this after a mutation and
  // every membership consumer (isDmMember here, the charter roster) refetches.
  membershipVersion: number;
  refreshMembership: () => void;
  // Who's at the table right now (issue #74) — channel presence on the
  // campaign realtime channel, one entry per signed-in named editor.
  // Occupancy only: the "session is live" fact stays active_session_id.
  presenceUsers: PresenceUser[];
  // Everyone who has ever signed in, by auth uuid (issue #114) — the mirror
  // of editor identity that public.profiles (0020) keeps, so any surface can
  // name a user_id without its own fetch. Distinct from presenceUsers: this
  // covers offline members and carries no liveness; presence covers only
  // online named editors and carries no history. Neither subsumes the other.
  profilesById: Map<string, UserProfile>;
}

export const CampaignContext = createContext<CampaignContextValue>({
  campaign: null,
  loading: true,
  error: null,
  campaigns: [],
  activeCampaignId: null,
  switchCampaign: () => {},
  adoptCampaign: () => {},
  retireCampaign: () => {},
  isDm: false,
  isRealDm: false,
  isMaintainer: false,
  isMember: false,
  seatless: false,
  viewAsPlayer: false,
  setViewAsPlayer: () => {},
  membershipVersion: 0,
  refreshMembership: () => {},
  presenceUsers: [],
  profilesById: new Map(),
});

// The result of the campaign_members lookup (issue #87 follow-up). "unknown"
// is the lookup FAILING, which is not the same as finding no row: it must fail
// open to the account tier, or one dropped request costs a real member every
// edit affordance for the rest of the mount (the effect has no retry).
type Membership =
  | { status: "pending" }
  | { status: "seat"; role: string }
  | { status: "none" }
  | { status: "unknown" };

// --- Channel presence identity (issue #74) ---------------------------------
// Derived, never stored: the presence_users table is gone (0021). Colors are
// the 0001 seed parchment tones plus two theme-consistent extras.
const PRESENCE_PALETTE = ["#8a2a1f", "#3d5536", "#b08228", "#4a6d68", "#5d4a72", "#7a5230"];

const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const colorFor = (userId: string): string => {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return PRESENCE_PALETTE[Math.abs(h) % PRESENCE_PALETTE.length];
};

// presenceState() is presence-key → metas. The key is the default random
// per-connection one, so the same user in two tabs is two entries — dedupe by
// the tracked payload's user id, and sort by name because key iteration order
// is join order, which differs per client.
const flattenPresenceState = (state: Record<string, any[]>): PresenceUser[] => {
  const byId = new Map<string, PresenceUser>();
  for (const metas of Object.values(state)) {
    for (const m of metas) {
      if (m && typeof m.id === "string" && m.name && !byId.has(m.id)) {
        byId.set(m.id, { id: m.id, name: m.name, initials: m.initials ?? "?", color: m.color ?? PRESENCE_PALETTE[0] });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
};

// Map a DB row (snake_case, `desc`) to the app's object shape (camelCase).
const archiveFields = (r: any) => ({
  archived: !!r.archived,
  pinned: !!r.pinned,
  hidden: !!r.hidden,
  updatedAt: r.updated_at ?? undefined,
});

const mapPerson = (r: any) => ({
  id: r.id,
  name: r.name,
  epithet: r.epithet ?? undefined,
  race: r.race ?? undefined,
  role: r.role ?? undefined,
  disposition: r.disposition ?? undefined,
  alignment: r.alignment ?? undefined,
  tier: r.tier ?? undefined,
  status: r.status ?? undefined,
  isPc: !!r.is_pc,
  playerUserId: r.player_user_id ?? undefined,
  location: r.location_id ?? undefined,
  faction: r.faction_id ?? undefined,
  lastSeen: r.last_seen_session_id ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  notes: r.notes ?? undefined,
  ...archiveFields(r),
});

const mapLocation = (r: any) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  desc: r.desc ?? undefined,
  region: r.region ?? undefined,
  ruler: r.ruler ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  notes: r.notes ?? undefined,
  ...archiveFields(r),
});

const mapQuest = (r: any) => ({
  id: r.id,
  title: r.title,
  status: r.status ?? undefined,
  reward: r.reward ?? undefined,
  giver: r.giver_id ?? undefined,
  session: r.session_id ?? undefined,
  desc: r.desc ?? undefined,
  hooks: r.hooks ?? undefined,
  arc: r.arc_id ?? undefined,
  ...archiveFields(r),
});

const mapGoal = (r: any) => ({
  id: r.id,
  text: r.text,
  owner: r.owner,
  kind: r.kind,
  status: r.status ?? undefined,
  ...archiveFields(r),
});

const mapFaction = (r: any) => ({
  id: r.id,
  name: r.name,
  sigil: r.sigil,
  desc: r.desc ?? undefined,
  allegiance: r.allegiance ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  ...archiveFields(r),
});

const mapItem = (r: any) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  desc: r.desc ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  ...archiveFields(r),
});

const mapLore = (r: any) => ({
  id: r.id,
  title: r.title,
  text: r.text,
  ...archiveFields(r),
});

const mapMonster = (r: any) => ({
  id: r.id,
  name: r.name,
  kind: r.kind ?? undefined,
  threat: r.threat ?? undefined,
  habitat: r.habitat ?? undefined,
  desc: r.desc ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  notes: r.notes ?? undefined,
  // Coerce, don't pass through: `cr` is `numeric` (0033), and PostgREST is free
  // to serialise numeric as a string. `?? undefined` alone would let "0.5"
  // reach the UI, where `cr > 7` and sorting would then work only by accident.
  cr: r.cr == null ? undefined : Number(r.cr),
  encountered: r.encountered == null ? undefined : Number(r.encountered),
  ...archiveFields(r),
});

const mapSession = (r: any) => ({
  id: r.id,
  num: r.num,
  title: r.title,
  date: r.date,
  summary: r.summary ?? undefined,
  imageUrl: r.image_url ?? undefined,
  imageFocus: r.image_focus ?? undefined,
  inGameDate: r.in_game_date ?? undefined,
  arc: r.arc_id ?? undefined,
  attendanceTakenAt: r.attendance_taken_at ?? undefined,
});

const mapArc = (r: any) => ({
  id: r.id,
  title: r.title,
  summary: r.summary ?? undefined,
  startSession: r.start_session_id ?? undefined,
  endSession: r.end_session_id ?? undefined,
  orderNum: r.order_num ?? 0,
  parentId: r.parent_id ?? undefined,
  completedAt: r.completed_at ?? undefined,
});

const mapEvent = (r: any) => ({
  id: r.id,
  title: r.title,
  summary: r.summary ?? undefined,
  inGameDate: r.in_game_date ?? undefined,
  session: r.session_id ?? undefined,
  location: r.location_id ?? undefined,
  orderNum: r.order_num ?? 0,
});

const buildParticipants = (rows: any[]): Record<string, string[]> => {
  const byEvent: Record<string, string[]> = {};
  rows.forEach((r: any) => {
    (byEvent[r.event_id] = byEvent[r.event_id] || []).push(r.person_id);
  });
  return byEvent;
};

// session id → person ids seen in that session (session_participants junction).
const buildSessionParticipants = (rows: any[]): Record<string, string[]> => {
  const bySession: Record<string, string[]> = {};
  rows.forEach((r: any) => {
    (bySession[r.session_id] = bySession[r.session_id] || []).push(r.person_id);
  });
  return bySession;
};

// session id → person ids who were at the table (session_attendance, 0039).
// Same shape as the appearance junction above and a different fact — see the
// Campaign type. Kept as its own builder rather than a generic one so the two
// never get wired to the same table by a careless refactor.
const buildSessionAttendance = (rows: any[]): Record<string, string[]> => {
  const bySession: Record<string, string[]> = {};
  rows.forEach((r: any) => {
    (bySession[r.session_id] = bySession[r.session_id] || []).push(r.person_id);
  });
  return bySession;
};

// dm_notes side table (0018, issue #73) → entity id → text map.
const buildDmNotes = (rows: any[]): Record<string, string> =>
  Object.fromEntries(rows.map((r: any) => [r.entity_id, r.text ?? ""]));

const mapSessionStaging = (r: any): SessionStagingRow => ({
  sessionId: r.session_id,
  entityId: r.entity_id,
  releasedAt: r.released_at ?? null,
});

const mapSessionEvent = (r: any): SessionEvent => ({
  id: r.id,
  sessionId: r.session_id,
  type: r.type,
  author: r.author ?? undefined,
  authorUserId: r.author_user_id ?? undefined,
  entityId: r.entity_id ?? undefined,
  entityIdB: r.entity_id_b ?? undefined,
  entityLabel: r.entity_label ?? undefined,
  text: r.text ?? undefined,
  createdAt: r.created_at,
});

// Feed order must be stable (created_at, id tiebreak — issue #66) and splice
// order can't be trusted: bigserial ids are assigned at insert while realtime
// follows commit order, so two concurrent authors can arrive inverted.
// Date.parse rather than string compare — PostgREST's timestamptz text isn't
// guaranteed lexicographically ordered (fractional digits vary).
const sortSessionEvents = (list: SessionEvent[]): SessionEvent[] =>
  list.slice().sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || (a.id - b.id));

const mapBoardPosition = (r: any): [string, BoardPosition] => [
  r.entity_id,
  { x: r.x, y: r.y, rot: r.rot ?? 0, kind: r.kind as KindKey },
];

const mapConnection = (r: any): Connection => ({
  from: r.from_id,
  to: r.to_id,
  label: r.label ?? "",
  // Provenance columns arrived in 0031 and were deliberately NOT backfilled —
  // undefined here means "this string predates the column", not missing data.
  createdAt: r.created_at ?? undefined,
  sessionId: r.session_id ?? undefined,
  author: r.author ?? undefined,
  authorUserId: r.author_user_id ?? undefined,
});

const mapPartyNoteRow = (r: any): { entityId: string; note: PartyNote } => ({
  entityId: r.entity_id,
  note: {
    author: r.author ?? "",
    authorUserId: r.author_user_id ?? undefined,
    when: r.when_label ?? "",
    text: r.text ?? "",
    hand: !!r.hand,
  },
});

// 0040. `voters` is attached by foldFeedbackVotes, not here — a mapper sees one
// table and the votes live in another.
const mapFeedbackRow = (r: any): Omit<FeedbackItem, "voters"> => ({
  id: r.id,
  // The CHECK constraints pin both columns, so no fallback: a value outside the
  // union means the DB and this union have diverged, and defaulting it would
  // hide that behind a row that renders as something it isn't.
  kind: r.kind,
  status: r.status,
  text: r.text ?? "",
  author: r.author ?? "",
  authorUserId: r.author_user_id ?? undefined,
  // Provenance since 0041, and nullable — the campaign it was filed from may
  // since have been deleted.
  campaignId: r.campaign_id ?? undefined,
  route: r.route ?? undefined,
  theme: r.theme ?? undefined,
  createdAt: r.created_at,
});

const mapFeedbackVoteRow = (r: any): FeedbackVote => ({
  feedbackId: r.feedback_id,
  userId: r.user_id,
});

async function fetchCampaign(id: string): Promise<Campaign> {
  const [
    campaignRes,
    sessionsRes,
    arcsRes,
    eventsRes,
    participantsRes,
    sessionParticipantsRes,
    sessionAttendanceRes,
    sessionStagingRes,
    sessionEventsRes,
    dmNotesRes,
    peopleRes,
    locationsRes,
    questsRes,
    goalsRes,
    factionsRes,
    itemsRes,
    loreRes,
    monstersRes,
    connectionsRes,
    boardRes,
    notesRes,
    feedbackRes,
    feedbackVotesRes,
  ] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase.from("sessions").select("*").eq("campaign_id", id).order("num"),
    supabase.from("arcs").select("*").eq("campaign_id", id).order("order_num"),
    supabase.from("events").select("*").eq("campaign_id", id).order("order_num"),
    supabase.from("event_participants").select("*").eq("campaign_id", id),
    supabase.from("session_participants").select("*").eq("campaign_id", id),
    supabase.from("session_attendance").select("*").eq("campaign_id", id),
    supabase.from("session_staging").select("*").eq("campaign_id", id),
    supabase.from("session_events").select("*").eq("campaign_id", id).order("created_at").order("id"),
    // DM-only read policy (0018): returns rows on the DM's client, [] on all others.
    supabase.from("dm_notes").select("*").eq("campaign_id", id),
    supabase.from("people").select("*").eq("campaign_id", id),
    supabase.from("locations").select("*").eq("campaign_id", id),
    supabase.from("quests").select("*").eq("campaign_id", id),
    supabase.from("goals").select("*").eq("campaign_id", id),
    supabase.from("factions").select("*").eq("campaign_id", id),
    supabase.from("items").select("*").eq("campaign_id", id),
    supabase.from("lore").select("*").eq("campaign_id", id),
    // ORDER BY name for the same reason connections gets ORDER BY id below: it
    // had no order at all. That was invisible while the Bestiary held three
    // plates, but the Fist of Ilmater import (0034) writes 454 rows that all
    // share an updated_at, so sortForDisplay's tiebreak can't separate them and
    // Array.sort is stable — the wall would render in physical row order and
    // reshuffle after any single edit.
    supabase.from("monsters").select("*").eq("campaign_id", id).order("name"),
    // ORDER BY id so this select returns a stable order at all; it never had
    // one. deriveRelations' provenance fold does NOT depend on this (it takes
    // the earliest createdAt either way, which relations-check asserts in both
    // row orders) — what this pins down is which orientation of a mirrored pair
    // becomes the surviving edge's a/b, so equal-provenance rows stop reshuffling
    // between refetches. Orientation is still not load-bearing for deletes.
    supabase.from("connections").select("*").eq("campaign_id", id).order("id"),
    supabase.from("board_positions").select("*").eq("campaign_id", id),
    supabase.from("party_notes").select("*").eq("campaign_id", id).order("created_at"),
    // UNFILTERED, unlike every other select here, and that's the point: since
    // 0041 the board is app-wide. A bug is fixed once in the code, so a
    // per-campaign board would show the same repaired bug as still open
    // everywhere else, and would split one bug's votes across N rows.
    // `campaign_id` survives on the row as provenance and is never filtered on.
    //
    // No order: orderFeedback() owns the reading order and it isn't expressible
    // here (it sorts on a vote count that lives in the other table).
    supabase.from("feedback").select("*"),
    supabase.from("feedback_votes").select("feedback_id,user_id"),
  ]);

  const first = [
    campaignRes, sessionsRes, arcsRes, eventsRes, participantsRes,
    sessionParticipantsRes, sessionAttendanceRes, sessionStagingRes, sessionEventsRes, dmNotesRes,
    peopleRes, locationsRes, questsRes, goalsRes, factionsRes, itemsRes,
    loreRes, monstersRes, connectionsRes, boardRes, notesRes,
    feedbackRes, feedbackVotesRes,
  ].find((r) => r.error);
  if (first?.error) throw new Error(first.error.message);

  const notesByEntity: Record<string, PartyNote[]> = {};
  (notesRes.data ?? []).forEach((r: any) => {
    const { entityId, note } = mapPartyNoteRow(r);
    (notesByEntity[entityId] = notesByEntity[entityId] || []).push(note);
  });

  return {
    id: campaignRes.data.id,
    title: campaignRes.data.title,
    subtitle: campaignRes.data.subtitle ?? "",
    imageUrl: campaignRes.data.image_url ?? undefined,
    sessions: (sessionsRes.data ?? []).map(mapSession),
    arcs: (arcsRes.data ?? []).map(mapArc),
    events: (eventsRes.data ?? []).map(mapEvent),
    eventParticipants: buildParticipants(participantsRes.data ?? []),
    sessionParticipants: buildSessionParticipants(sessionParticipantsRes.data ?? []),
    sessionAttendance: buildSessionAttendance(sessionAttendanceRes.data ?? []),
    sessionStaging: (sessionStagingRes.data ?? []).map(mapSessionStaging),
    sessionEvents: (sessionEventsRes.data ?? []).map(mapSessionEvent),
    activeSessionId: campaignRes.data.active_session_id ?? undefined,
    dmNotes: buildDmNotes(dmNotesRes.data ?? []),
    people: (peopleRes.data ?? []).map(mapPerson),
    locations: (locationsRes.data ?? []).map(mapLocation),
    quests: (questsRes.data ?? []).map(mapQuest),
    goals: (goalsRes.data ?? []).map(mapGoal),
    factions: (factionsRes.data ?? []).map(mapFaction),
    items: (itemsRes.data ?? []).map(mapItem),
    lore: (loreRes.data ?? []).map(mapLore),
    monsters: (monstersRes.data ?? []).map(mapMonster),
    connections: (connectionsRes.data ?? []).map(mapConnection),
    board: Object.fromEntries((boardRes.data ?? []).map(mapBoardPosition)),
    notes: notesByEntity,
    feedback: foldFeedbackVotes(
      (feedbackRes.data ?? []).map(mapFeedbackRow),
      (feedbackVotesRes.data ?? []).map(mapFeedbackVoteRow),
    ),
  };
}

// Splice a realtime change into an array-valued campaign field keyed by id.
// id is string for entity tables, number for bigserial ones (session_events).
function applyArrayChange<T extends { id: string | number }>(
  list: T[],
  event: "INSERT" | "UPDATE" | "DELETE",
  newRow: T | null,
  oldRow: T | null,
): T[] {
  if (event === "INSERT" && newRow) return [...list, newRow];
  if (event === "UPDATE" && newRow) {
    // Upsert, not replace: under RLS (0018) an UPDATE can be the first event
    // a client is ALLOWED to see for a row — a release flips hidden to false
    // and realtime re-checks visibility per subscriber against the new row.
    // Players never held the hidden row, so an unmatched id must append or
    // the reveal silently vanishes until reload.
    return list.some((item) => item.id === newRow.id)
      ? list.map((item) => (item.id === newRow.id ? newRow : item))
      : [...list, newRow];
  }
  if (event === "DELETE" && oldRow) return list.filter((item) => item.id !== oldRow.id);
  return list;
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  // The whole auth value, because this provider re-provides it below with a
  // membership-narrowed canEdit. Inside THIS component canEdit is still the
  // account tier (the narrowing only applies to children), so read
  // isEditorAccount explicitly here to keep that unambiguous.
  const auth = useAuth();
  const { user, isEditorAccount, displayName, avatarUrl } = auth;
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [viewAsPlayer, setViewAsPlayer] = useState(false);
  // One campaign_members row, four outcomes — "couldn't tell" has to be its own
  // state, distinct from "no seat", because the two must fail in OPPOSITE
  // directions: no seat hides the edit affordances, while a failed lookup keeps
  // them (a network blip must not strip a real member's quill) and leaves RLS
  // to reject anything it shouldn't have allowed.
  const [membership, setMembership] = useState<Membership>({ status: "pending" });
  // App-wide, campaign-independent: see the maintainer lookup below.
  const [isMaintainer, setIsMaintainer] = useState(false);
  const [membershipVersion, setMembershipVersion] = useState(0);
  const refreshMembership = useCallback(() => setMembershipVersion((v) => v + 1), []);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);
  const [profilesById, setProfilesById] = useState<Map<string, UserProfile>>(() => new Map());

  // Channel presence (issue #74). The channel lives inside the campaign
  // effect (keyed on campaignId only — auth changes must NOT refetch the
  // campaign), so track/untrack reaches it through refs. subscribedRef gates
  // every push: track() before the first join throws in realtime-js.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const authRef = useRef({ userId: null as string | null, displayName: null as string | null, canEdit: false });
  authRef.current = { userId: user?.id ?? null, displayName, canEdit: isEditorAccount };

  // Idempotent: safe to call from SUBSCRIBED (fires again on every network
  // rejoin — realtime-js does not re-track by itself) and from auth changes.
  const syncPresence = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || !subscribedRef.current) return;
    const { userId, displayName, canEdit } = authRef.current;
    if (canEdit && userId && displayName) {
      // Fire-and-forget: a push buffered across a disconnect can resolve
      // "timed out" even though the rejoin re-track supersedes it.
      void ch.track({ id: userId, name: displayName, initials: initialsOf(displayName), color: colorFor(userId) });
    } else {
      void ch.untrack(); // anonymous viewers observe without appearing
    }
  }, []);

  // Sign-in, sign-out (→ fresh anonymous session) and display-name edits
  // re-track without touching the channel lifecycle.
  useEffect(() => {
    syncPresence();
  }, [user?.id, displayName, isEditorAccount, syncPresence]);

  // Membership lookup (issue #73 for the dm half): one campaign_members row
  // decides BOTH isRealDm and whether this editor may write here at all —
  // since 0023 RLS requires a membership row for the campaign, so an editor
  // holding no seat has every write rejected. Fetching the role rather than
  // filtering on 'dm' is what lets canEdit tell the truth (see below).
  // Not realtime-synced — campaign_members is deliberately unpublished, so
  // membership RPCs (issue #86) bump membershipVersion to re-run this. While
  // pending the DM renders the player projection (never the other way: a flash
  // of hidden content is the unrecoverable direction), and "pending" also keeps
  // the no-seat notice from flashing at an editor who does hold a seat.
  useEffect(() => {
    setMembership({ status: "pending" });
    if (!campaignId || !user || user.is_anonymous) {
      // Nothing to look up, and nothing to fail open to: an anonymous viewer is
      // already gated by the account tier. "none", not "unknown".
      setMembership({ status: "none" });
      return;
    }
    let cancelled = false;
    supabase
      .from("campaign_members")
      .select("role")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .then(({ data, error: memberErr }) => {
        if (cancelled) return;
        // A failed lookup must not lock an editor out of their own campaign.
        // There is no retry and the deps don't change on their own, so anything
        // that leaves this pending would cost a real member every edit
        // affordance until they reload — hence "unknown", which fails OPEN to
        // the account tier and lets RLS stay the real boundary (a write that
        // shouldn't have been offered is rejected, and the toast explains it).
        if (memberErr) { console.error(memberErr); setMembership({ status: "unknown" }); return; }
        const role = data?.[0]?.role as string | undefined;
        setMembership(role ? { status: "seat", role } : { status: "none" });
      });
    return () => { cancelled = true; };
  }, [campaignId, user?.id, user?.is_anonymous, membershipVersion]);

  // Maintainer lookup (0041): may this account triage the app-wide feedback
  // board — move a report's status, delete a duplicate. NOT keyed on campaignId,
  // which is the whole point: the board is app-wide, so this capability can't
  // come from being some campaign's DM. It used to (0040), and that could not
  // survive going app-wide — sign-ups are open and founding a campaign makes you
  // its DM, so "any DM" would have let a stranger found a throwaway campaign and
  // then edit the whole party's board.
  //
  // Fails CLOSED, unlike the membership lookup above, and the asymmetry is
  // deliberate. Membership fails open because a network blip must not strip a
  // real member of every edit affordance in their own campaign; here the only
  // cost of failing closed is that a status <select> renders as a plain chip
  // until reload, and the safe default for a privileged control is off.
  useEffect(() => {
    setIsMaintainer(false);
    if (!user || user.is_anonymous) return;
    let cancelled = false;
    supabase
      .from("app_maintainers")
      .select("user_id")
      .eq("user_id", user.id)
      .then(({ data, error: maintErr }) => {
        if (cancelled) return;
        if (maintErr) { console.error(maintErr); return; }
        setIsMaintainer((data?.length ?? 0) > 0);
      });
    return () => { cancelled = true; };
  }, [user?.id, user?.is_anonymous]);

  // Profiles lookup (issue #114): auth uuid -> name/avatar, so any surface can
  // name a user without its own fetch. Deliberately its own effect rather than
  // a member of fetchCampaign's Promise.all — profiles has no campaign_id to
  // scope by, and that block is fail-fast for the whole app, so a profiles
  // outage there would blank the journal behind an ErrorSheet and delay first
  // paint. Out here it degrades to "an unnamed adventurer", which is what
  // loadRoster already did.
  //
  // Unpublished like campaign_members, so membershipVersion is the refresh
  // lever (free refresh-on-join). displayName/avatarUrl are deps because
  // AuthProvider's upsertMyProfile is fire-and-forget and this fetch can beat
  // it on a first sign-in; the caller's own row is also seeded from auth below
  // so their name is never missing even if the mirror hasn't caught up.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("profiles")
      .select("user_id,display_name,avatar_url")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error(error); return; }
        const next = new Map<string, UserProfile>();
        for (const p of data ?? []) {
          next.set(p.user_id, {
            userId: p.user_id,
            displayName: p.display_name ?? null,
            avatarUrl: p.avatar_url ?? null,
          });
        }
        if (user && !user.is_anonymous && displayName) {
          next.set(user.id, { userId: user.id, displayName, avatarUrl: avatarUrl ?? null });
        }
        setProfilesById(next);
      });
    return () => { cancelled = true; };
  }, [campaignId, membershipVersion, user?.id, user?.is_anonymous, displayName, avatarUrl]);

  // Load the picker list once, then resolve the active id:
  // hash → host-page tweak → first campaign by creation date.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("campaigns")
      .select("id,title,subtitle")
      .is("archived_at", null) // archived campaigns stay readable, just unlisted (#87)
      .order("created_at")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setLoading(false);
          return;
        }
        const list = (data ?? []) as CampaignSummary[];
        if (list.length === 0) {
          setError("No campaigns found");
          setLoading(false);
          return;
        }
        setCampaigns(list);
        const known = (id?: string) => list.some((c) => c.id === id);
        const fromHash = parseHash().campaignId;
        const fromTweaks = window.__TWEAKS__.campaignId;
        const id = known(fromHash) ? fromHash! : known(fromTweaks) ? fromTweaks! : list[0].id;
        // Normalize a missing or bad campaign hash without adding a history
        // entry. A non-campaign hash (e.g. #access_token from a magic link)
        // is left alone for supabase-js to consume.
        const hash = window.location.hash;
        if (!hash || /^#\/c\//.test(hash)) {
          writeCampaignHash(id, fromHash === id ? parseHash().entityId : undefined, { replace: true });
        }
        setCampaignId(id);
      });
    return () => { cancelled = true; };
  }, []);

  // Hash is the source of truth for the active id: switchCampaign writes it
  // and this listener applies it (also covering back/forward and manual URL
  // edits). adopt/retireCampaign are the two exceptions — they set the id
  // directly because their target isn't in this listener's `campaigns`
  // closure yet/anymore (see commitActiveCampaign below).
  useEffect(() => {
    const onHashChange = () => {
      const { campaignId: id } = parseHash();
      if (id && campaigns.some((c) => c.id === id)) {
        if (id !== campaignId) setCampaignId(id);
      } else if (campaignId && /^#\/c\//.test(window.location.hash)) {
        // Campaign-shaped hash with an unknown id — restore the active one so
        // the URL doesn't lie. Non-campaign hashes are left alone.
        writeCampaignHash(campaignId, null, { replace: true });
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [campaigns, campaignId]);

  // The single hash-write + host-page persistence tail every navigation verb
  // shares. `direct` also moves the React id state without waiting for the
  // hashchange round-trip — needed when the target id isn't (adopt) or is no
  // longer (retire) in the `campaigns` list the listener's closure knows, so
  // the listener would reject it and rewrite the hash back. Setting list and
  // id in the same batch means that by the time the async hashchange fires,
  // the re-registered listener sees a known, already-active id and no-ops.
  const commitActiveCampaign = useCallback((id: string, opts?: { direct?: boolean; replace?: boolean }) => {
    if (opts?.direct) setCampaignId(id);
    writeCampaignHash(id, undefined, { replace: opts?.replace });
    // Persist through the host page, never localStorage.
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { campaignId: id } }, "*");
  }, []);

  const switchCampaign = useCallback((id: string) => {
    if (id === campaignId) return;
    commitActiveCampaign(id); // hashchange listener updates campaignId
  }, [campaignId, commitActiveCampaign]);

  // Founding (#87): append the fresh campaign to the picker list and move to
  // it directly (see commitActiveCampaign for why not via the listener).
  const adoptCampaign = useCallback((summary: CampaignSummary) => {
    setCampaigns((list) => (list.some((c) => c.id === summary.id) ? list : [...list, summary]));
    commitActiveCampaign(summary.id, { direct: true });
  }, [commitActiveCampaign]);

  // Archiving (#87): drop the campaign from the picker; if it was active,
  // move to the first remaining one (same fallback rank as initial load).
  // The DangerZone UI blocks archiving the only campaign, so `remaining` is
  // never empty on that path — if it somehow is, keep state untouched rather
  // than strand the provider on a dead id.
  const retireCampaign = useCallback((id: string) => {
    const remaining = campaigns.filter((c) => c.id !== id);
    if (remaining.length === 0) return;
    setCampaigns(remaining);
    if (id === campaignId) commitActiveCampaign(remaining[0].id, { direct: true, replace: true });
  }, [campaigns, campaignId, commitActiveCampaign]);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    // Trailing refetches, owned by THIS run of the effect. Declared out here
    // rather than inside the async body below so the teardown always clears the
    // map belonging to the run it tears down — a late assignment from an
    // already-cancelled run would otherwise leave a newer run's timers
    // unreachable.
    const burst = new Map<string, ReturnType<typeof setTimeout>>();

    // Synchronous, before any await: mutations read this store, and clearing
    // the campaign unmounts AppLoaded so nothing can write mid-switch. Clear
    // the active-session store too so a stale pin from the previous campaign
    // can't leak into a mutation before the new campaign's value loads.
    setActiveCampaignId(campaignId);
    setActiveSessionId(null);
    setCampaign(null);
    setLoading(true);
    setError(null);
    setViewAsPlayer(false); // a view mode never outlives its campaign
    setPresenceUsers([]); // occupancy is per-channel — no stale-avatar flash

    (async () => {
      try {
        const initial = await fetchCampaign(campaignId);
        if (cancelled) return;
        setCampaign(initial);
        setActiveSessionId(initial.activeSessionId ?? null);
        setLoading(false);

        const filter = `campaign_id=eq.${campaignId}`;
        channel = supabase.channel(`campaign:${campaignId}`);
        channelRef.current = channel;

        // Must be registered BEFORE subscribe(): realtime-js only enables
        // presence in the join payload when a presence binding already
        // exists. `sync` fires after the initial state and every diff, so
        // one handler covers joins, leaves, and expiry (no ghosts).
        channel.on("presence", { event: "sync" }, () => {
          if (cancelled) return;
          setPresenceUsers(flattenPresenceState(channel!.presenceState()));
        });

        // Shared by each table's own handler AND the reveal path below. A
        // release makes connections/board rows that reference the revealed
        // entity newly visible to players (0018 gates them on entity_hidden)
        // WITHOUT any event on those tables — the rows didn't change, the
        // entity did — so the reveal event has to trigger the refetch.
        const refetchConnections = () => {
          supabase.from("connections").select("*").eq("campaign_id", campaignId).order("id").then(({ data }) => {
            if (cancelled) return;
            setCampaign((c) => c && c.id === campaignId ? { ...c, connections: (data ?? []).map(mapConnection) } : c);
          });
        };
        const refetchBoard = () => {
          supabase.from("board_positions").select("*").eq("campaign_id", campaignId).then(({ data }) => {
            if (cancelled) return;
            setCampaign((c) => c && c.id === campaignId ? { ...c, board: Object.fromEntries((data ?? []).map(mapBoardPosition)) } : c);
          });
        };
        // Both refetches above pull a WHOLE table, which is the deliberate v1
        // simplification — but they fire once per row event, and a bulk write
        // can be thousands of events. The Bestiary import (0034) is 546
        // connections plus 454 reveals, and because a reveal ALSO triggers both
        // refetches that's ~1,000 full-table reads per open client from a single
        // migration. Collapse a burst into one trailing read; a lone event still
        // lands within a frame or two, which is invisible at the table.
        const debounce = (name: string, fn: () => void) => () => {
          clearTimeout(burst.get(name));
          burst.set(name, setTimeout(() => { if (!cancelled) fn(); }, 250));
        };
        const refetchConnectionsSoon = debounce("connections", refetchConnections);
        const refetchBoardSoon = debounce("board", refetchBoard);

        // Feedback (0040) refetches the PAIR of tables on a change to either,
        // because the client-side shape is one array with votes folded in and a
        // vote event carries no way to find its report's current row. Both
        // subscriptions share this one debounce slot on purpose: filing a report
        // and voting on it produce events on two tables that must not each
        // trigger their own round trip.
        //
        // The reports table is tiny (tens of rows) and only an open panel is
        // looking, so refetch-the-world is cheaper here than anywhere it's
        // already accepted.
        //
        // Unfiltered since 0041 — app-wide, like the initial load above. This
        // one refetch is therefore NOT campaign-scoped even though it lives on
        // the campaign channel; the setCampaign guard below still keys on
        // campaignId, so a result arriving after a switch is dropped rather than
        // spliced into the wrong campaign's object.
        const refetchFeedback = () => {
          Promise.all([
            supabase.from("feedback").select("*"),
            supabase.from("feedback_votes").select("feedback_id,user_id"),
          ]).then(([itemsRes, votesRes]) => {
            if (cancelled) return;
            // A failed half would fold to "every vote withdrawn" or "the board
            // is empty" — both indistinguishable from the real thing on screen,
            // so leave the last good array in place and let the next event retry.
            if (itemsRes.error || votesRes.error) {
              console.error("feedback refetch failed", itemsRes.error ?? votesRes.error);
              return;
            }
            const next = foldFeedbackVotes(
              (itemsRes.data ?? []).map(mapFeedbackRow),
              (votesRes.data ?? []).map(mapFeedbackVoteRow),
            );
            setCampaign((c) => c && c.id === campaignId ? { ...c, feedback: next } : c);
          });
        };
        const refetchFeedbackSoon = debounce("feedback", refetchFeedback);

        // The shared pin lives on the campaigns row itself, so it's filtered by
        // `id`, not `campaign_id`. Keep both the React state and the module-level
        // store (read by mutations) in sync when another client moves the pin.
        channel.on(
          "postgres_changes" as any,
          { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${campaignId}` },
          (payload: any) => {
            // Guard the module-store write like the async handlers do: a late
            // event from the previous campaign's torn-down channel must not
            // leak a stale active_session_id into the store mutations read.
            if (cancelled) return;
            const next = payload.new?.active_session_id ?? undefined;
            setActiveSessionId(next ?? null);
            // subtitle/imageUrl map null → ""/undefined (not `?? c.x`): the
            // DM clearing them from the charter must propagate, and `??`
            // would swallow the null. title is NOT NULL so falling back to
            // the current value is safe there.
            setCampaign((c) => c && c.id === campaignId ? {
              ...c,
              activeSessionId: next,
              title: payload.new?.title ?? c.title,
              subtitle: payload.new?.subtitle ?? "",
              imageUrl: payload.new?.image_url ?? undefined,
            } : c);
            // Keep the picker's dropdown list fresh for the active campaign.
            // Other campaigns' rows aren't in this realtime filter — their
            // renames still take a reload (pre-existing, acceptable).
            setCampaigns((list) => list.map((s) => s.id === campaignId
              ? { ...s, title: payload.new?.title ?? s.title, subtitle: payload.new?.subtitle ?? null }
              : s));
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "people", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, people: applyArrayChange(c.people, payload.eventType, payload.new ? mapPerson(payload.new) : null, payload.old ? mapPerson(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "locations", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, locations: applyArrayChange(c.locations, payload.eventType, payload.new ? mapLocation(payload.new) : null, payload.old ? mapLocation(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "quests", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, quests: applyArrayChange(c.quests, payload.eventType, payload.new ? mapQuest(payload.new) : null, payload.old ? mapQuest(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "goals", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, goals: applyArrayChange(c.goals, payload.eventType, payload.new ? mapGoal(payload.new) : null, payload.old ? mapGoal(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "factions", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, factions: applyArrayChange(c.factions, payload.eventType, payload.new ? mapFaction(payload.new) : null, payload.old ? mapFaction(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "items", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, items: applyArrayChange(c.items, payload.eventType, payload.new ? mapItem(payload.new) : null, payload.old ? mapItem(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "lore", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, lore: applyArrayChange(c.lore, payload.eventType, payload.new ? mapLore(payload.new) : null, payload.old ? mapLore(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "monsters", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, monsters: applyArrayChange(c.monsters, payload.eventType, payload.new ? mapMonster(payload.new) : null, payload.old ? mapMonster(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "sessions", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, sessions: applyArrayChange(c.sessions, payload.eventType, payload.new ? mapSession(payload.new) : null, payload.old ? mapSession(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "arcs", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, arcs: applyArrayChange(c.arcs, payload.eventType, payload.new ? mapArc(payload.new) : null, payload.old ? mapArc(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "events", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, events: applyArrayChange(c.events, payload.eventType, payload.new ? mapEvent(payload.new) : null, payload.old ? mapEvent(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          // NO server-side campaign_id filter here (see session_staging below).
          // removeEventParticipant() is a hard DELETE and the PK is
          // (event_id, person_id) with default REPLICA IDENTITY, so the
          // old-row payload carries neither campaign_id nor anything else the
          // filter could match — Supabase would drop the event and the removed
          // person would linger in "Those Present" until a reload. Safe because
          // the handler refetches campaign-scoped and guards on the campaign id.
          { event: "*", schema: "public", table: "event_participants" },
          () => {
            // Composite PK, no client-side id — refetch, same as connections.
            supabase.from("event_participants").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, eventParticipants: buildParticipants(data ?? []) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          // NO server-side campaign_id filter here, for the same reason as
          // event_participants above: unmarkSeen() is a hard DELETE and the PK
          // is (session_id, person_id) with default REPLICA IDENTITY, so the
          // old-row payload can't satisfy a campaign_id filter. Without this,
          // an unmark never reaches other clients — the person keeps showing in
          // the sidebar "This Session" roster, the board seen-live-dot and the
          // detail sheet's seen toggle until a reload.
          { event: "*", schema: "public", table: "session_participants" },
          () => {
            // Composite PK, no client-side id — refetch, same as event_participants.
            // (The trigger's downstream people UPDATE arrives via the people handler.)
            supabase.from("session_participants").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, sessionParticipants: buildSessionParticipants(data ?? []) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          // Filterless for the same reason as session_staging below: clearing
          // attendance is a hard DELETE whose old-row payload carries only the
          // composite PK (session_id, person_id), so a campaign_id filter can
          // never match it and the row would linger on other clients until a
          // reload. The refetch is campaign-scoped and campaign-guarded either
          // way. (The stamp's sessions UPDATE arrives via the sessions handler.)
          { event: "*", schema: "public", table: "session_attendance" },
          () => {
            supabase.from("session_attendance").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, sessionAttendance: buildSessionAttendance(data ?? []) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          // NO server-side campaign_id filter here (unlike the other tables).
          // unstageEntity() is a hard DELETE, and session_staging has no
          // REPLICA IDENTITY FULL, so a DELETE's old-row payload carries only
          // the composite PK (session_id, entity_id) — not campaign_id. A
          // `campaign_id=eq.<id>` filter can't match that, so Supabase drops
          // the event and the unstaged row lingers on other clients until a
          // reload. The handler already refetches campaign-scoped and guards on
          // the campaign id, so a filterless subscription is safe: the worst a
          // cross-campaign event does is trigger one redundant scoped refetch.
          { event: "*", schema: "public", table: "session_staging" },
          () => {
            // Composite PK, no client-side id — refetch, same as session_participants.
            supabase.from("session_staging").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, sessionStaging: (data ?? []).map(mapSessionStaging) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "session_events", filter },
          (payload: any) => {
            // INSERT is the live path (the feed is append-only — no UPDATE and
            // no manual DELETE policy exist). We still subscribe to "*" and
            // handle the DELETE splice defensively so that if a delete ever is
            // delivered (e.g. a future REPLICA IDENTITY FULL) it's applied
            // rather than ignored. Note the practical limit: session-delete
            // cascades emit DELETEs whose old-row (default replica identity)
            // carries only the PK, so Supabase can't match the campaign_id
            // filter and drops them — a reload is the backstop for the rare
            // "session deleted mid-feed" case, not this handler.
            setCampaign((c) => c && c.id === campaignId ? { ...c, sessionEvents: sortSessionEvents(applyArrayChange(c.sessionEvents, payload.eventType, payload.new?.id != null ? mapSessionEvent(payload.new) : null, payload.old?.id != null ? mapSessionEvent(payload.old) : null)) } : c);
            // Release side effect (issue #73): the revealed entity's own
            // UPDATE arrives via its table handler, but its connections and
            // board pin become visible without any event of their own.
            // Unconditional (DM clients refetch redundantly but harmlessly —
            // reveals are rare) because isDm isn't in this effect's scope.
            if (payload.eventType === "INSERT" && payload.new?.type === "reveal") {
              refetchConnectionsSoon();
              refetchBoardSoon();
            }
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "dm_notes", filter },
          () => {
            // Composite PK that INCLUDES campaign_id, so unlike
            // session_staging a DELETE's PK-only old-row still matches the
            // server-side filter. Refetch like the other composite-PK tables;
            // RLS returns [] on non-DM clients (the only events that even
            // reach them are unfiltered DELETEs — metadata-only).
            supabase.from("dm_notes").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, dmNotes: buildDmNotes(data ?? []) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "connections", filter },
          // Connections still carry no client-side `id` (mapConnection drops the
          // bigserial), so there's nothing to splice against. Refetch. Since
          // 0031 the row does have a stable id available — converting this to an
          // incremental splice is possible now, just not done.
          refetchConnectionsSoon,
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "board_positions", filter },
          refetchBoardSoon,
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "party_notes", filter },
          () => {
            supabase.from("party_notes").select("*").eq("campaign_id", campaignId).order("created_at").then(({ data }) => {
              if (cancelled) return;
              const byEntity: Record<string, PartyNote[]> = {};
              (data ?? []).forEach((r: any) => {
                const { entityId, note } = mapPartyNoteRow(r);
                (byEntity[entityId] = byEntity[entityId] || []).push(note);
              });
              setCampaign((c) => c && c.id === campaignId ? { ...c, notes: byEntity } : c);
            });
          },
        );
        // Both feedback tables, one debounced handler, and NO `filter` — the
        // board is app-wide (0041), so a campaign_id filter would be wrong here
        // and `feedback_votes` no longer even has the column. Dropping the
        // filter also removes the reason 0040 needed REPLICA IDENTITY FULL (a
        // delete publishing only the PK had no campaign_id for the filter to
        // match, which would have silently lost every un-vote); 0041 keeps the
        // setting anyway so that reintroducing a filter can't quietly bring the
        // bug back.
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "feedback" },
          refetchFeedbackSoon,
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "feedback_votes" },
          refetchFeedbackSoon,
        );

        channel.subscribe((status) => {
          if (cancelled) return;
          // SUBSCRIBED re-fires on every network rejoin; re-tracking there is
          // the only way presence survives a drop (see syncPresence).
          if (status === "SUBSCRIBED") {
            subscribedRef.current = true;
            syncPresence();
          }
        });
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load campaign");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // removeChannel leaves the topic, which emits the presence leave to
      // everyone else — no explicit untrack needed.
      channelRef.current = null;
      subscribedRef.current = false;
      // A trailing refetch that fires after a campaign switch would read the old
      // campaign's tables; `cancelled` already discards the result, but dropping
      // the timer keeps the request itself from going out.
      burst.forEach(clearTimeout);
      if (channel) supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const isMember = membership.status === "seat";
  // DM tools fail CLOSED on "unknown" — unlike the write gate, they open the
  // hidden-entity projection, and a wrong guess there leaks the DM's secrets.
  const isDmMember = membership.status === "seat" && membership.role === "dm";
  const isRealDm = !!campaign && isEditorAccount && isDmMember;
  // The write gate fails OPEN on "unknown": a failed lookup keeps the
  // affordances a member had and lets RLS reject anything it shouldn't have
  // offered, rather than silently disarming a real member for the whole mount.
  const mayWrite = isEditorAccount && (isMember || membership.status === "unknown");
  // A signed-in editor confirmed to hold no seat at this table: RLS will reject
  // every write (0023). Confirmed only — "pending" and "unknown" must not claim
  // this, or the notice cries wolf at an editor who does hold a seat. Editors
  // only: a viewer's read-only state is already explained by the account tier.
  const seatless = isEditorAccount && membership.status === "none";
  // The effective gate: "view as player" (#71) flips this one derivation and
  // the projection below plus every isDm-gated affordance follow — that single
  // choke point IS the feature. Real DM-ness is untouched, so exit is instant.
  const isDm = isRealDm && !viewAsPlayer;

  // The single hidden-entity funnel: non-DM users get a projected campaign
  // with hidden rows (and every reference to them) stripped, so no downstream
  // surface — lists, board, yarn, ⌘K, rails, counts, deep links — can leak one.
  const visibleCampaign = useMemo(
    () => (campaign && !isDm ? projectCampaignForViewers(campaign) : campaign),
    [campaign, isDm],
  );

  // Re-provide auth with canEdit narrowed by membership, so every edit
  // affordance below reflects what RLS will actually accept (see the canEdit
  // doc in auth.tsx). Surfaces that must survive seatlessness — the Topbar's
  // account block, founding a campaign, redeeming an invite — read
  // isEditorAccount, which is passed through untouched.
  const scopedAuth = useMemo(
    () => ({ ...auth, canEdit: mayWrite }),
    [auth, mayWrite],
  );

  return (
    <CampaignContext.Provider value={{ campaign: visibleCampaign, loading, error, campaigns, activeCampaignId: campaignId, switchCampaign, adoptCampaign, retireCampaign, isDm, isRealDm, isMaintainer, isMember, seatless, viewAsPlayer, setViewAsPlayer, membershipVersion, refreshMembership, presenceUsers, profilesById }}>
      <AuthContext.Provider value={scopedAuth}>
        {children}
      </AuthContext.Provider>
    </CampaignContext.Provider>
  );
}
