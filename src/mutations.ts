import { supabase } from "./utils/supabase";
import { getActiveCampaignId } from "./activeCampaign";
import { getActiveSessionId } from "./activeSession";
import { SHOW_MARK, type KindKey, type PartyNote, type BoardPosition, type SessionEventType } from "./data";

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

// Batch upsert used by "Tidy board" — one round-trip instead of N. Same row
// shape, rounding, and conflict key as upsertBoardPosition. (Realtime still
// emits one event per row, so the whole-table refetch handler in
// campaignContext runs N times; each refetch is idempotent and converges.)
export async function bulkUpsertBoardPositions(
  updates: { entityId: string; pos: BoardPosition }[],
) {
  if (updates.length === 0) return;
  const cid = getActiveCampaignId();
  const rows = updates.map(({ entityId, pos }) => ({
    campaign_id: cid,
    entity_id: entityId,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    rot: Math.round(pos.rot ?? 0),
    kind: pos.kind,
  }));
  const { error } = await supabase
    .from("board_positions")
    .upsert(rows, { onConflict: "campaign_id,entity_id" });
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

// ===== Live session: staging queue + feed (M5 PR 2, issues #65/#66) ========

export async function stageEntity(sessionId: string, entityId: string) {
  // Merge (NOT ignoreDuplicates, unlike markSeen): re-staging a previously
  // released row must reset released_at to null — "staged" always means
  // queued-and-unreleased. The staging UPDATE policy permits the merge path.
  const { error } = await supabase.from("session_staging").upsert(
    {
      campaign_id: getActiveCampaignId(),
      session_id: sessionId,
      entity_id: entityId,
      released_at: null,
    },
    { onConflict: "session_id,entity_id" },
  );
  if (error) throw error;
}

export async function unstageEntity(sessionId: string, entityId: string) {
  const { error } = await supabase
    .from("session_staging")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("session_id", sessionId)
    .eq("entity_id", entityId);
  if (error) throw error;
}

// The feed is append-only: INSERT is the only verb (no update/delete policies
// exist on session_events). `author` is the caller's display name, same
// signing as party_notes; `entityId` rides on reveal events, `text` carries
// note bodies / reveal flair.
export async function insertSessionEvent(ev: {
  type: SessionEventType;
  sessionId: string;
  author?: string;
  entityId?: string;
  text?: string;
}) {
  const { error } = await supabase.from("session_events").insert({
    campaign_id: getActiveCampaignId(),
    session_id: ev.sessionId,
    type: ev.type,
    author: ev.author ?? null,
    entity_id: ev.entityId ?? null,
    text: ev.text ?? null,
  });
  if (error) throw error;
}

// ===== Live session: one-click release + start/end markers (PR 3, #67/#68) =

// The centerpiece verb: permanent unlock + transient push, one click.
// Ordering is load-bearing: the unhide must COMMIT before the reveal event is
// inserted. All of a campaign's realtime rides one channel in commit order, so
// every client processes the entity UPDATE before the session_events INSERT —
// and the viewer projection (which drops reveal events pointing at still-hidden
// entities) keeps the event by construction. Swap the order and player clients
// could project the reveal away, killing the toast.
export async function releaseEntity(
  kind: KindKey,
  entityId: string,
  sessionId: string,
  opts: { author?: string; label?: string } = {},
) {
  await updateEntity(kind, entityId, { hidden: false });
  const stamp = supabase
    .from("session_staging")
    .update({ released_at: new Date().toISOString() })
    .eq("campaign_id", getActiveCampaignId())
    .eq("session_id", sessionId)
    .eq("entity_id", entityId)
    .then(({ error }) => { if (error) throw error; });
  await Promise.all([
    stamp,
    insertSessionEvent({ type: "reveal", sessionId, author: opts.author, entityId, text: opts.label }),
  ]);
  // A released person has, by definition, shown up on screen. Idempotent and
  // non-fatal — the release itself already succeeded.
  if (kind === "people") markSeen(entityId).catch(console.error);
}

// The loud sibling of releaseEntity ("show now", #69): same permanent unlock,
// but the transient push is a takeover — player clients open the entity's
// sheet the moment the SHOW_MARK-prefixed reveal event lands. Same commit-
// order doctrine as releaseEntity when unhiding. Differences from release:
// - `unhide` is caller-decided (isHidden(entity)): re-showing an already
//   visible entity must not touch the row — updateEntity would bump
//   updated_at and jump it to the top of every sorted list.
// - The staging stamp is scoped to `released_at is null`: showing an
//   already-released row keeps its original release time, and showing a
//   never-staged entity is a clean no-op on the queue.
export async function showEntity(
  kind: KindKey,
  entityId: string,
  sessionId: string,
  opts: { author?: string; label?: string; unhide?: boolean } = {},
) {
  if (opts.unhide) await updateEntity(kind, entityId, { hidden: false });
  const stamp = supabase
    .from("session_staging")
    .update({ released_at: new Date().toISOString() })
    .eq("campaign_id", getActiveCampaignId())
    .eq("session_id", sessionId)
    .eq("entity_id", entityId)
    .is("released_at", null)
    .then(({ error }) => { if (error) throw error; });
  await Promise.all([
    stamp,
    insertSessionEvent({
      type: "reveal",
      sessionId,
      author: opts.author,
      entityId,
      text: SHOW_MARK + (opts.label ?? ""),
    }),
  ]);
  if (kind === "people") markSeen(entityId).catch(console.error);
}

// DM ceremony around the shared pin: moving it also brackets the feed with
// start/end markers. `author` comes from the caller (mutations can't reach
// React context). Non-DM editors keep calling plain setActiveSession — the
// markers are the DM's to write.
export async function startLiveSession(sessionId: string, author?: string) {
  await setActiveSession(sessionId);
  await insertSessionEvent({ type: "start", sessionId, author });
}

export async function endLiveSession(sessionId: string, author?: string) {
  await insertSessionEvent({ type: "end", sessionId, author });
  await setActiveSession(null);
}

// Switching sessions while live must never route the pin through null — that
// would broadcast a transient "not live", closing every client's panel and
// resetting board session-focus for a frame.
export async function switchLiveSession(fromId: string, toId: string, author?: string) {
  await insertSessionEvent({ type: "end", sessionId: fromId, author });
  await setActiveSession(toId);
  await insertSessionEvent({ type: "start", sessionId: toId, author });
}

// session_staging.entity_id spans seven tables so it has no FK (like
// connections) — swept here. session_events rows are deliberately NOT swept:
// the feed is append-only history and reveals should outlive their entity
// (renderers tolerate a dangling entity_id).
async function deleteSessionStagingFor(entityId: string) {
  const { error } = await supabase
    .from("session_staging")
    .delete()
    .eq("campaign_id", getActiveCampaignId())
    .eq("entity_id", entityId);
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
    deleteSessionStagingFor(id),
  ]);
  const { error } = await supabase
    .from(kind)
    .delete()
    .eq("id", id)
    .eq("campaign_id", getActiveCampaignId());
  if (error) throw error;
}
