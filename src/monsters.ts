import type { Campaign, Monster, MonsterThreat } from "./data";

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
// Challenge rating
//
// `cr` is the datum and `threat` is the reading of it (see the MonsterThreat
// comment in data.ts). The band table lives here, once, because two writers
// depend on it: the detail sheet, which rewrites `threat` whenever someone edits
// `cr`, and scripts/generate-foi-bestiary.ts, which imports this function so a
// seeded plate can't wear a band the app would disagree with.
// ============================================================================

/**
 * CR → threat band: 0–2 harmless, 3–7 risky, 8–16 deadly, 17+ legendary.
 *
 * Undefined in, undefined out — "no CR recorded" must not become a band, or an
 * unrated creature would silently read as harmless. CR 0 is a real rating
 * (Crawling Claw), so only nullish counts as unknown.
 */
export function crToThreat(cr: number | undefined | null): MonsterThreat | undefined {
  if (cr == null || !Number.isFinite(cr)) return undefined;
  if (cr < 3) return "harmless";
  if (cr < 8) return "risky";
  if (cr < 17) return "deadly";
  return "legendary";
}

// The fractions 5e actually uses below CR 1. Kept as an explicit table rather
// than a generic decimal-to-fraction routine: these four are the whole domain,
// and a rounding surprise on a plate is worse than a missing one.
const CR_FRACTIONS: ReadonlyArray<[number, string]> = [
  [0.125, "1/8"],
  [0.25, "1/4"],
  [0.5, "1/2"],
  [0.75, "3/4"],
];

/**
 * CR as the books write it: 0.125 → "1/8", 5 → "5". Undefined for no CR, so
 * callers can distinguish it from "CR 0" — which renders as "0".
 */
export function crLabel(cr: number | undefined | null): string | undefined {
  if (cr == null || !Number.isFinite(cr)) return undefined;
  const frac = CR_FRACTIONS.find(([n]) => n === cr);
  if (frac) return frac[1];
  // Anything else the source might hold (an oddly precise average) prints as-is
  // rather than being rounded into a rating that doesn't exist.
  return String(cr);
}

/**
 * The inverse of crLabel for the editable CR field: accepts "1/8", "0.5", "5",
 * with or without a leading "CR". Returns null for anything it can't read, so
 * the caller can reject the edit instead of storing a guess — including the
 * fractions 5e doesn't use ("1/3"), which are far more likely to be a typo than
 * an intent.
 */
export function parseCr(input: string): number | null {
  const t = input.trim().replace(/^cr\s*/i, "");
  if (!t) return null;
  const frac = CR_FRACTIONS.find(([, label]) => label === t);
  if (frac) return frac[0];
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n <= 40 ? n : null;
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
