import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
  // True when the signed-in editor is this campaign's DM (campaigns.dm_user_id).
  // Derived fresh every render, so it tracks campaign switches and realtime
  // changes of the campaigns row automatically. V1: client-side gate only.
  isDm: boolean;
}

export const CampaignContext = createContext<CampaignContextValue>({
  campaign: null,
  loading: true,
  error: null,
  campaigns: [],
  activeCampaignId: null,
  switchCampaign: () => {},
  isDm: false,
});

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

const mapPresence = (r: any) => ({
  id: r.id,
  name: r.name,
  initials: r.initials,
  color: r.color,
  active: !!r.active,
});

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
    peopleRes,
    locationsRes,
    questsRes,
    goalsRes,
    factionsRes,
    itemsRes,
    loreRes,
    connectionsRes,
    boardRes,
    presenceRes,
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
    supabase.from("people").select("*").eq("campaign_id", id),
    supabase.from("locations").select("*").eq("campaign_id", id),
    supabase.from("quests").select("*").eq("campaign_id", id),
    supabase.from("goals").select("*").eq("campaign_id", id),
    supabase.from("factions").select("*").eq("campaign_id", id),
    supabase.from("items").select("*").eq("campaign_id", id),
    supabase.from("lore").select("*").eq("campaign_id", id),
    supabase.from("connections").select("*").eq("campaign_id", id),
    supabase.from("board_positions").select("*").eq("campaign_id", id),
    supabase.from("presence_users").select("*").eq("campaign_id", id),
    supabase.from("party_notes").select("*").eq("campaign_id", id).order("created_at"),
  ]);

  const first = [
    campaignRes, sessionsRes, arcsRes, eventsRes, participantsRes,
    sessionParticipantsRes, sessionStagingRes, sessionEventsRes, peopleRes,
    locationsRes, questsRes, goalsRes, factionsRes, itemsRes, loreRes,
    connectionsRes, boardRes, presenceRes, notesRes,
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
    sessions: (sessionsRes.data ?? []).map(mapSession),
    arcs: (arcsRes.data ?? []).map(mapArc),
    events: (eventsRes.data ?? []).map(mapEvent),
    eventParticipants: buildParticipants(participantsRes.data ?? []),
    sessionParticipants: buildSessionParticipants(sessionParticipantsRes.data ?? []),
    sessionStaging: (sessionStagingRes.data ?? []).map(mapSessionStaging),
    sessionEvents: (sessionEventsRes.data ?? []).map(mapSessionEvent),
    activeSessionId: campaignRes.data.active_session_id ?? undefined,
    dmUserId: campaignRes.data.dm_user_id ?? undefined,
    people: (peopleRes.data ?? []).map(mapPerson),
    locations: (locationsRes.data ?? []).map(mapLocation),
    quests: (questsRes.data ?? []).map(mapQuest),
    goals: (goalsRes.data ?? []).map(mapGoal),
    factions: (factionsRes.data ?? []).map(mapFaction),
    items: (itemsRes.data ?? []).map(mapItem),
    lore: (loreRes.data ?? []).map(mapLore),
    connections: (connectionsRes.data ?? []).map(mapConnection),
    board: Object.fromEntries((boardRes.data ?? []).map(mapBoardPosition)),
    presence: (presenceRes.data ?? []).map(mapPresence),
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
  if (event === "UPDATE" && newRow) return list.map((item) => (item.id === newRow.id ? newRow : item));
  if (event === "DELETE" && oldRow) return list.filter((item) => item.id !== oldRow.id);
  return list;
}

export function CampaignProvider({ children }: { children: ReactNode }) {
  const { user, canEdit } = useAuth();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // Load the picker list once, then resolve the active id:
  // hash → host-page tweak → first campaign by creation date.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("campaigns")
      .select("id,title,subtitle")
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

    (async () => {
      try {
        const initial = await fetchCampaign(campaignId);
        if (cancelled) return;
        setCampaign(initial);
        setActiveSessionId(initial.activeSessionId ?? null);
        setLoading(false);

        const filter = `campaign_id=eq.${campaignId}`;
        channel = supabase.channel(`campaign:${campaignId}`);

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
            setCampaign((c) => c && c.id === campaignId ? { ...c, activeSessionId: next, dmUserId: payload.new?.dm_user_id ?? undefined, title: payload.new?.title ?? c.title, subtitle: payload.new?.subtitle ?? c.subtitle } : c);
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
          { event: "*", schema: "public", table: "session_staging", filter },
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
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "presence_users", filter },
          (payload: any) => {
            setCampaign((c) => c && c.id === campaignId ? { ...c, presence: applyArrayChange(c.presence, payload.eventType, payload.new ? mapPresence(payload.new) : null, payload.old ? mapPresence(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "connections", filter },
          () => {
            // Connections have no stable `id` on the client (stored as tuples). Refetch.
            supabase.from("connections").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, connections: (data ?? []).map(mapConnection) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "board_positions", filter },
          () => {
            supabase.from("board_positions").select("*").eq("campaign_id", campaignId).then(({ data }) => {
              if (cancelled) return;
              setCampaign((c) => c && c.id === campaignId ? { ...c, board: Object.fromEntries((data ?? []).map(mapBoardPosition)) } : c);
            });
          },
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

        channel.subscribe();
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load campaign");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const isDm = !!campaign && canEdit && !!campaign.dmUserId && user?.id === campaign.dmUserId;

  // The single hidden-entity funnel: non-DM users get a projected campaign
  // with hidden rows (and every reference to them) stripped, so no downstream
  // surface — lists, board, yarn, ⌘K, rails, counts, deep links — can leak one.
  const visibleCampaign = useMemo(
    () => (campaign && !isDm ? projectCampaignForViewers(campaign) : campaign),
    [campaign, isDm],
  );

  return (
    <CampaignContext.Provider value={{ campaign: visibleCampaign, loading, error, campaigns, activeCampaignId: campaignId, switchCampaign, isDm }}>
      {children}
    </CampaignContext.Provider>
  );
}
