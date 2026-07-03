import { supabase } from "./utils/supabase";
import { getActiveCampaignId } from "./activeCampaign";
import { getActiveSessionId } from "./activeSession";
import { type KindKey, type PartyNote, type BoardPosition } from "./data";

// Realtime subscriptions in campaignContext.tsx reflect writes back into UI
// state, so callers do not need to patch local state (fire-and-forget is fine).

// UI field → DB column for each kind. Only renamed fields are listed;
// others pass through unchanged (name, title, text, desc, hooks, status, kind, etc.).
// updated_at is server-managed by the touch_updated_at trigger
// (supabase/migrations/0005_archive_and_pin.sql) — never write it from the client.
const fieldAlias: Record<KindKey, Record<string, string>> = {
  people: {
    location: "location_id",
    faction: "faction_id",
    lastSeen: "last_seen_session_id",
    imageUrl: "image_url",
  },
  quests: {
    giver: "giver_id",
    session: "session_id",
    arc: "arc_id",
  },
  locations: {
    imageUrl: "image_url",
  },
  goals: {},
  factions: {
    imageUrl: "image_url",
  },
  items: {
    imageUrl: "image_url",
  },
  lore: {},
  sessions: {
    imageUrl: "image_url",
    inGameDate: "in_game_date",
    arc: "arc_id",
  },
  arcs: {
    startSession: "start_session_id",
    endSession: "end_session_id",
    orderNum: "order_num",
  },
  events: {
    inGameDate: "in_game_date",
    session: "session_id",
    location: "location_id",
    orderNum: "order_num",
  },
};

function toRow(kind: KindKey, patch: Record<string, unknown>): Record<string, unknown> {
  const alias = fieldAlias[kind];
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = alias[k] ?? k;
    row[col] = v === "" ? null : v;
  }
  return row;
}

// ===== Party notes ==========================================================

export async function insertPartyNote(entityId: string, note: PartyNote) {
  const { error } = await supabase.from("party_notes").insert({
    campaign_id: getActiveCampaignId(),
    entity_id: entityId,
    author: note.author,
    when_label: note.when,
    text: note.text,
    hand: note.hand,
  });
  if (error) throw error;
}

// ===== Board positions ======================================================

export async function upsertBoardPosition(entityId: string, pos: BoardPosition) {
  const { error } = await supabase
    .from("board_positions")
    .upsert(
      {
        campaign_id: getActiveCampaignId(),
        entity_id: entityId,
        // x/y/rot are `int` columns (0001_init.sql). Dragging produces
        // fractional pixels (dx / scale), and PostgREST rejects a non-integer
        // into an int4 column (22P02), which would silently fail the write and
        // snap the card back — so round before persisting.
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        rot: Math.round(pos.rot ?? 0),
        kind: pos.kind,
      },
      { onConflict: "campaign_id,entity_id" },
    );
  if (error) throw error;
}

export async function deleteBoardPosition(entityId: string) {
  const { error } = await supabase
    .from("board_positions")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("entity_id", entityId);
  if (error) throw error;
}

// ===== Connections ==========================================================

export async function insertConnection(fromId: string, toId: string, label: string) {
  const { error } = await supabase.from("connections").insert({
    campaign_id: getActiveCampaignId(),
    from_id: fromId,
    to_id: toId,
    label,
  });
  if (error) throw error;
}

export async function deleteConnection(fromId: string, toId: string, label: string) {
  const { error } = await supabase
    .from("connections")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("from_id", fromId)
    .eq("to_id", toId)
    .eq("label", label);
  if (error) throw error;
}

async function deleteConnectionsFor(entityId: string) {
  // Sweep both directions; from_id/to_id don't have FKs (entities span seven tables).
  const { error } = await supabase
    .from("connections")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .or(`from_id.eq.${entityId},to_id.eq.${entityId}`);
  if (error) throw error;
}

// ===== Event participants ===================================================
// FK junction writes (event_participants), not free-form connections.

export async function addEventParticipant(eventId: string, personId: string) {
  const { error } = await supabase.from("event_participants").insert({
    campaign_id: getActiveCampaignId(),
    event_id: eventId,
    person_id: personId,
  });
  if (error) throw error;
}

export async function removeEventParticipant(eventId: string, personId: string) {
  const { error } = await supabase
    .from("event_participants")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("event_id", eventId)
    .eq("person_id", personId);
  if (error) throw error;
}

// ===== Active session & seen ================================================
// The shared "we're live in session N" pin lives on the campaigns row and syncs
// to every client via realtime. Seen-tracking writes the session_participants
// junction; a DB trigger keeps people.last_seen_session_id derived from it.

export async function setActiveSession(sessionId: string | null) {
  const { error } = await supabase
    .from("campaigns")
    .update({ active_session_id: sessionId })
    .eq("id", getActiveCampaignId());
  if (error) throw error;
}

export async function markSeen(personId: string) {
  const sessionId = getActiveSessionId();
  if (!sessionId) {
    console.warn("markSeen: no active session — nothing to mark against");
    return;
  }
  // Idempotent: the composite PK is (session_id, person_id), and there's no
  // optimistic UI, so a double-click or a second editor marking the same person
  // would otherwise throw a unique violation. ignoreDuplicates makes it a no-op.
  const { error } = await supabase.from("session_participants").upsert(
    {
      campaign_id: getActiveCampaignId(),
      session_id: sessionId,
      person_id: personId,
    },
    { onConflict: "session_id,person_id", ignoreDuplicates: true },
  );
  if (error) throw error;
}

export async function unmarkSeen(personId: string) {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;
  const { error } = await supabase
    .from("session_participants")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("session_id", sessionId)
    .eq("person_id", personId);
  if (error) throw error;
}

// ===== Entity CRUD ==========================================================

export async function createEntity(
  kind: KindKey,
  id: string,
  seed: Record<string, unknown>,
) {
  const row: Record<string, unknown> = { id, campaign_id: getActiveCampaignId(), ...toRow(kind, seed) };
  // Creation-only auto-link: an event/quest made while a session is live
  // defaults its session_id to that session ("happened this session" /
  // "introduced this session"). Only fills when the caller left it unset, and
  // only on create — editing an old entity never relinks it to today.
  if ((kind === "events" || kind === "quests") && row.session_id == null) {
    const activeSession = getActiveSessionId();
    if (activeSession) row.session_id = activeSession;
  }
  const { error } = await supabase.from(kind).insert(row);
  if (error) throw error;
}

export async function updateEntity(
  kind: KindKey,
  id: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabase
    .from(kind)
    .update(toRow(kind, patch))
    .eq("id", id)
    .eq("campaign_id", getActiveCampaignId());
  if (error) throw error;
}

async function deletePartyNotesFor(entityId: string) {
  const { error } = await supabase
    .from("party_notes")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("entity_id", entityId);
  if (error) throw error;
}

export async function bulkArchive(entries: Array<{ kind: KindKey; id: string }>) {
  // Fire in parallel; each goes through updateEntity so realtime reflects it
  // the same way as any other edit.
  await Promise.all(
    entries.map(({ kind, id }) => updateEntity(kind, id, { archived: true })),
  );
}

export async function deleteEntity(kind: KindKey, id: string) {
  // Sweeps are independent and must all finish before the entity row itself
  // is deleted, so realtime consumers see the cleanup before the parent vanishes.
  await Promise.all([
    deleteBoardPosition(id).catch(() => {}),
    deleteConnectionsFor(id),
    deletePartyNotesFor(id),
  ]);
  const { error } = await supabase
    .from(kind)
    .delete()
    .eq("id", id)
    .eq("campaign_id", getActiveCampaignId());
  if (error) throw error;
}
