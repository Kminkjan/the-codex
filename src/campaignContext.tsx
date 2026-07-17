import { createContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";
import { useAuth } from "./auth";
import { setActiveCampaignId } from "./activeCampaign";
import { setActiveSessionId } from "./activeSession";
import { parseHash, writeCampaignHash } from "./route";
import {
  projectCampaignForViewers,
  type Campaign,
  type CampaignSummary,
  type BoardPosition,
  type Connection,
  type KindKey,
  type PartyNote,
  type PresenceUser,
  type SessionEvent,
  type SessionStagingRow,
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
  // (issue #73 — supersedes campaigns.dm_user_id). Fetched per campaign; a
  // membership change mid-session needs a reload (campaign_members isn't in
  // the realtime publication — deliberate, membership is dashboard-managed).
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
  viewAsPlayer: false,
  setViewAsPlayer: () => {},
  membershipVersion: 0,
  refreshMembership: () => {},
  presenceUsers: [],
});

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
  location: r.location_id ?? undefined,
  faction: r.faction_id ?? undefined,
  lastSeen: r.last_seen_session_id ?? undefined,
  imageUrl: r.image_url ?? undefined,
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
  ...archiveFields(r),
});

const mapItem = (r: any) => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  desc: r.desc ?? undefined,
  imageUrl: r.image_url ?? undefined,
  ...archiveFields(r),
});

const mapLore = (r: any) => ({
  id: r.id,
  title: r.title,
  text: r.text,
  ...archiveFields(r),
});

const mapSession = (r: any) => ({
  id: r.id,
  num: r.num,
  title: r.title,
  date: r.date,
  summary: r.summary ?? undefined,
  imageUrl: r.image_url ?? undefined,
  inGameDate: r.in_game_date ?? undefined,
  arc: r.arc_id ?? undefined,
});

const mapArc = (r: any) => ({
  id: r.id,
  title: r.title,
  summary: r.summary ?? undefined,
  startSession: r.start_session_id ?? undefined,
  endSession: r.end_session_id ?? undefined,
  orderNum: r.order_num ?? 0,
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
  entityId: r.entity_id ?? undefined,
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

const mapConnection = (r: any): Connection => [r.from_id, r.to_id, r.label ?? ""];

const mapPartyNoteRow = (r: any): { entityId: string; note: PartyNote } => ({
  entityId: r.entity_id,
  note: {
    author: r.author ?? "",
    when: r.when_label ?? "",
    text: r.text ?? "",
    hand: !!r.hand,
  },
});

async function fetchCampaign(id: string): Promise<Campaign> {
  const [
    campaignRes,
    sessionsRes,
    arcsRes,
    eventsRes,
    participantsRes,
    sessionParticipantsRes,
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
    connectionsRes,
    boardRes,
    notesRes,
  ] = await Promise.all([
    supabase.from("campaigns").select("*").eq("id", id).single(),
    supabase.from("sessions").select("*").eq("campaign_id", id).order("num"),
    supabase.from("arcs").select("*").eq("campaign_id", id).order("order_num"),
    supabase.from("events").select("*").eq("campaign_id", id).order("order_num"),
    supabase.from("event_participants").select("*").eq("campaign_id", id),
    supabase.from("session_participants").select("*").eq("campaign_id", id),
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
    supabase.from("connections").select("*").eq("campaign_id", id),
    supabase.from("board_positions").select("*").eq("campaign_id", id),
    supabase.from("party_notes").select("*").eq("campaign_id", id).order("created_at"),
  ]);

  const first = [
    campaignRes, sessionsRes, arcsRes, eventsRes, participantsRes,
    sessionParticipantsRes, sessionStagingRes, sessionEventsRes, dmNotesRes,
    peopleRes, locationsRes, questsRes, goalsRes, factionsRes, itemsRes,
    loreRes, connectionsRes, boardRes, notesRes,
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
    connections: (connectionsRes.data ?? []).map(mapConnection),
    board: Object.fromEntries((boardRes.data ?? []).map(mapBoardPosition)),
    notes: notesByEntity,
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
  const { user, canEdit, displayName } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [viewAsPlayer, setViewAsPlayer] = useState(false);
  const [isDmMember, setIsDmMember] = useState(false);
  const [membershipVersion, setMembershipVersion] = useState(0);
  const refreshMembership = useCallback(() => setMembershipVersion((v) => v + 1), []);
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

  // Channel presence (issue #74). The channel lives inside the campaign
  // effect (keyed on campaignId only — auth changes must NOT refetch the
  // campaign), so track/untrack reaches it through refs. subscribedRef gates
  // every push: track() before the first join throws in realtime-js.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);
  const authRef = useRef({ userId: null as string | null, displayName: null as string | null, canEdit: false });
  authRef.current = { userId: user?.id ?? null, displayName, canEdit };

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
  }, [user?.id, displayName, canEdit, syncPresence]);

  // DM membership lookup (issue #73): one campaign_members row decides
  // isRealDm. Not realtime-synced — campaign_members is deliberately
  // unpublished, so membership RPCs (issue #86) bump membershipVersion to
  // re-run this. Until it resolves the DM briefly renders the player
  // projection (no flash of hidden content the other way around).
  useEffect(() => {
    setIsDmMember(false);
    if (!campaignId || !user || user.is_anonymous) return;
    let cancelled = false;
    supabase
      .from("campaign_members")
      .select("role")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .eq("role", "dm")
      .then(({ data }) => {
        if (!cancelled) setIsDmMember((data ?? []).length > 0);
      });
    return () => { cancelled = true; };
  }, [campaignId, user?.id, user?.is_anonymous, membershipVersion]);

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

  // One code path updates the active id: picker clicks write the hash,
  // and this listener also covers back/forward and manual URL edits.
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

  const switchCampaign = useCallback((id: string) => {
    if (id === campaignId) return;
    writeCampaignHash(id); // hashchange listener updates campaignId
    // Persist through the host page, never localStorage.
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { campaignId: id } }, "*");
  }, [campaignId]);

  // Founding (#87): the new campaign isn't in `campaigns` yet, so routing the
  // switch through writeCampaignHash alone would race the hashchange listener
  // (its closure rejects unknown ids and rewrites the hash back). List append
  // and id move land in the same batch; by the time the async hashchange
  // fires, the re-registered listener sees a known, already-active id.
  const adoptCampaign = useCallback((summary: CampaignSummary) => {
    setCampaigns((list) => (list.some((c) => c.id === summary.id) ? list : [...list, summary]));
    setCampaignId(summary.id);
    writeCampaignHash(summary.id, undefined, { replace: false });
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { campaignId: summary.id } }, "*");
  }, []);

  // Archiving (#87): drop the campaign from the picker; if it was active,
  // move to the first remaining one (same fallback rank as initial load).
  // The DangerZone UI blocks archiving the only campaign, so `remaining` is
  // never empty on that path — if it somehow is, keep state untouched rather
  // than strand the provider on a dead id.
  const retireCampaign = useCallback((id: string) => {
    const remaining = campaigns.filter((c) => c.id !== id);
    if (remaining.length === 0) return;
    setCampaigns(remaining);
    if (id === campaignId) {
      setCampaignId(remaining[0].id);
      writeCampaignHash(remaining[0].id, undefined, { replace: true });
      window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { campaignId: remaining[0].id } }, "*");
    }
  }, [campaigns, campaignId]);

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

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
          supabase.from("connections").select("*").eq("campaign_id", campaignId).then(({ data }) => {
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
          { event: "*", schema: "public", table: "event_participants", filter },
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
          { event: "*", schema: "public", table: "session_participants", filter },
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
              refetchConnections();
              refetchBoard();
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
          // Connections have no stable `id` on the client (stored as tuples). Refetch.
          refetchConnections,
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "board_positions", filter },
          refetchBoard,
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
      if (channel) supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const isRealDm = !!campaign && canEdit && isDmMember;
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

  return (
    <CampaignContext.Provider value={{ campaign: visibleCampaign, loading, error, campaigns, activeCampaignId: campaignId, switchCampaign, adoptCampaign, retireCampaign, isDm, isRealDm, viewAsPlayer, setViewAsPlayer, membershipVersion, refreshMembership, presenceUsers }}>
      {children}
    </CampaignContext.Provider>
  );
}
