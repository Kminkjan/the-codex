import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";
import { setActiveCampaignId } from "./activeCampaign";
import { parseHash, writeCampaignHash } from "./route";
import {
  type Campaign,
  type CampaignSummary,
  type BoardPosition,
  type Connection,
  type KindKey,
  type PartyNote,
} from "./data";

interface CampaignContextValue {
  campaign: Campaign | null;
  loading: boolean;
  error: string | null;
  campaigns: CampaignSummary[];
  activeCampaignId: string | null;
  switchCampaign: (id: string) => void;
}

export const CampaignContext = createContext<CampaignContextValue>({
  campaign: null,
  loading: true,
  error: null,
  campaigns: [],
  activeCampaignId: null,
  switchCampaign: () => {},
});

// Map a DB row (snake_case, `desc`) to the app's object shape (camelCase).
const archiveFields = (r: any) => ({
  archived: !!r.archived,
  pinned: !!r.pinned,
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
    campaignRes, sessionsRes, arcsRes, eventsRes, participantsRes, peopleRes,
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
function applyArrayChange<T extends { id: string }>(
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
    // the campaign unmounts AppLoaded so nothing can write mid-switch.
    setActiveCampaignId(campaignId);
    setCampaign(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const initial = await fetchCampaign(campaignId);
        if (cancelled) return;
        setCampaign(initial);
        setLoading(false);

        const filter = `campaign_id=eq.${campaignId}`;
        channel = supabase.channel(`campaign:${campaignId}`);

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

  return (
    <CampaignContext.Provider value={{ campaign, loading, error, campaigns, activeCampaignId: campaignId, switchCampaign }}>
      {children}
    </CampaignContext.Provider>
  );
}
