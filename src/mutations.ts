import { supabase } from "./utils/supabase";
import { CURRENT_CAMPAIGN_ID, type KindKey, type PartyNote, type BoardPosition } from "./data";

// Realtime subscriptions in campaignContext.tsx reflect writes back into UI
// state, so callers do not need to patch local state (fire-and-forget is fine).

// UI field → DB column for each kind. Only renamed fields are listed;
// others pass through unchanged (name, title, text, desc, hooks, status, kind, etc.).
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
  },
  locations: {},
  goals: {},
  factions: {},
  items: {},
  lore: {},
  sessions: {},
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
    campaign_id: CURRENT_CAMPAIGN_ID,
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
        campaign_id: CURRENT_CAMPAIGN_ID,
        entity_id: entityId,
        x: pos.x,
        y: pos.y,
        rot: pos.rot,
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
    .eq("campaign_id", CURRENT_CAMPAIGN_ID)
    .eq("entity_id", entityId);
  if (error) throw error;
}

// ===== Connections ==========================================================

export async function insertConnection(fromId: string, toId: string, label: string) {
  const { error } = await supabase.from("connections").insert({
    campaign_id: CURRENT_CAMPAIGN_ID,
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
    .eq("campaign_id", CURRENT_CAMPAIGN_ID)
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
    .eq("campaign_id", CURRENT_CAMPAIGN_ID)
    .or(`from_id.eq.${entityId},to_id.eq.${entityId}`);
  if (error) throw error;
}

// ===== Entity CRUD ==========================================================

export async function createEntity(
  kind: KindKey,
  id: string,
  seed: Record<string, unknown>,
) {
  const row = { id, campaign_id: CURRENT_CAMPAIGN_ID, ...toRow(kind, seed) };
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
    .eq("campaign_id", CURRENT_CAMPAIGN_ID);
  if (error) throw error;
}

async function deletePartyNotesFor(entityId: string) {
  const { error } = await supabase
    .from("party_notes")
    .delete()
    .eq("campaign_id", CURRENT_CAMPAIGN_ID)
    .eq("entity_id", entityId);
  if (error) throw error;
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
    .eq("campaign_id", CURRENT_CAMPAIGN_ID);
  if (error) throw error;
}
