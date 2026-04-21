import { createContext, useEffect, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./utils/supabase";
import {
  CURRENT_CAMPAIGN_ID,
  type Campaign,
  type BoardPosition,
  type Connection,
  type KindKey,
  type PartyNote,
} from "./data";

interface CampaignContextValue {
  campaign: Campaign | null;
  loading: boolean;
  error: string | null;
}

export const CampaignContext = createContext<CampaignContextValue>({
  campaign: null,
  loading: true,
  error: null,
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
});

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
    campaignRes, sessionsRes, peopleRes, locationsRes, questsRes, goalsRes,
    factionsRes, itemsRes, loreRes, connectionsRes, boardRes, presenceRes, notesRes,
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

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;

    (async () => {
      try {
        const initial = await fetchCampaign(CURRENT_CAMPAIGN_ID);
        if (cancelled) return;
        setCampaign(initial);
        setLoading(false);

        const filter = `campaign_id=eq.${CURRENT_CAMPAIGN_ID}`;
        channel = supabase.channel(`campaign:${CURRENT_CAMPAIGN_ID}`);

        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "people", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, people: applyArrayChange(c.people, payload.eventType, payload.new ? mapPerson(payload.new) : null, payload.old ? mapPerson(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "locations", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, locations: applyArrayChange(c.locations, payload.eventType, payload.new ? mapLocation(payload.new) : null, payload.old ? mapLocation(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "quests", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, quests: applyArrayChange(c.quests, payload.eventType, payload.new ? mapQuest(payload.new) : null, payload.old ? mapQuest(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "goals", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, goals: applyArrayChange(c.goals, payload.eventType, payload.new ? mapGoal(payload.new) : null, payload.old ? mapGoal(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "factions", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, factions: applyArrayChange(c.factions, payload.eventType, payload.new ? mapFaction(payload.new) : null, payload.old ? mapFaction(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "items", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, items: applyArrayChange(c.items, payload.eventType, payload.new ? mapItem(payload.new) : null, payload.old ? mapItem(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "lore", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, lore: applyArrayChange(c.lore, payload.eventType, payload.new ? mapLore(payload.new) : null, payload.old ? mapLore(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "sessions", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, sessions: applyArrayChange(c.sessions, payload.eventType, payload.new ? mapSession(payload.new) : null, payload.old ? mapSession(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "presence_users", filter },
          (payload: any) => {
            setCampaign((c) => c ? { ...c, presence: applyArrayChange(c.presence, payload.eventType, payload.new ? mapPresence(payload.new) : null, payload.old ? mapPresence(payload.old) : null) } : c);
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "connections", filter },
          () => {
            // Connections have no stable `id` on the client (stored as tuples). Refetch.
            supabase.from("connections").select("*").eq("campaign_id", CURRENT_CAMPAIGN_ID).then(({ data }) => {
              setCampaign((c) => c ? { ...c, connections: (data ?? []).map(mapConnection) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "board_positions", filter },
          () => {
            supabase.from("board_positions").select("*").eq("campaign_id", CURRENT_CAMPAIGN_ID).then(({ data }) => {
              setCampaign((c) => c ? { ...c, board: Object.fromEntries((data ?? []).map(mapBoardPosition)) } : c);
            });
          },
        );
        channel.on(
          "postgres_changes" as any,
          { event: "*", schema: "public", table: "party_notes", filter },
          () => {
            supabase.from("party_notes").select("*").eq("campaign_id", CURRENT_CAMPAIGN_ID).order("created_at").then(({ data }) => {
              const byEntity: Record<string, PartyNote[]> = {};
              (data ?? []).forEach((r: any) => {
                const { entityId, note } = mapPartyNoteRow(r);
                (byEntity[entityId] = byEntity[entityId] || []).push(note);
              });
              setCampaign((c) => c ? { ...c, notes: byEntity } : c);
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
  }, []);

  return (
    <CampaignContext.Provider value={{ campaign, loading, error }}>
      {children}
    </CampaignContext.Provider>
  );
}
