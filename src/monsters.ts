import type { Campaign, Monster } from "./data";

// Derivations behind the Bestiary (the monsters kind's bespoke page). Pure over
// the campaign object, like saga.ts — no strings that carry UI voice, because a
// pure module can't reach <ThemedLabel>.

// ============================================================================
// Discovery: a plate is "inked" once the party has actually met the creature.
//
// This is DERIVED, not stored. A monster counts as met the moment the DM fires
// RELEASE or ⚡ SHOW NOW on it, because both write a `reveal` row into the
// append-only session feed (see releaseEntity/showEntity in mutations.ts). So
// the ceremony that already exists at the table is the thing that inks the
// plate — no extra table, no extra mutation, nothing for the DM to remember.
// The detail sheet already mines the same rows for its "revealed in" chips.
//
// IMPORTANT — what this is and isn't. Three states compose here:
//
//   hidden                     → the player never receives the row at all
//                                (RLS, migration 0018) — real secrecy.
//   visible, never revealed    → an un-inked frame: the party knows the thing
//                                exists but hasn't met it.
//   revealed at least once     → the full plate, stamped with the session.
//
// The un-inked frame is a PRESENTATION state, not a security boundary. A
// visible monster's artwork and description are already in the client's data
// and reachable through ⌘K or the notice board; un-inking only withholds them
// on this page. A DM who wants a creature genuinely secret uses HIDE, which is
// enforced in the database. Do not "harden" the un-inked state by half-measures
// here — that would imply a guarantee this layer cannot make.
// ============================================================================

export interface Encounter {
  /** Session the creature was first revealed in; may dangle if it was deleted. */
  firstSessionId?: string;
}

/**
 * monster id → first-encounter record, for every monster the party has met.
 * Absence from the map means un-inked.
 *
 * `campaign.sessionEvents` is already kept sorted by (createdAt, id) by
 * sortSessionEvents, so the first reveal we see for an id is the earliest one —
 * no sorting needed here. Reveals whose entity was later re-hidden are already
 * projected out for players upstream (projectCampaignForViewers), so a player
 * and the DM-as-player see the same wall.
 */
export function inkedMonsters(campaign: Campaign): Map<string, Encounter> {
  const monsterIds = new Set(campaign.monsters.map((m) => m.id));
  const met = new Map<string, Encounter>();
  for (const ev of campaign.sessionEvents) {
    if (ev.type !== "reveal" || !ev.entityId) continue;
    if (!monsterIds.has(ev.entityId) || met.has(ev.entityId)) continue;
    met.set(ev.entityId, { firstSessionId: ev.sessionId });
  }
  return met;
}

// ============================================================================
// Filter facets
// ============================================================================

/**
 * The distinct creature types present in the data, deduped case-insensitively
 * with the first-seen casing kept as the label — same treatment KindList gives
 * the people race facet, so the two filter rows behave identically.
 */
export function creatureTypes(monsters: Monster[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const m of monsters) {
    const k = m.kind?.trim();
    if (k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
  }
  return Array.from(seen, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
