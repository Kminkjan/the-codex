import type { Campaign } from "./data";

// A single unified read-projection over the two relationship models the app
// keeps: the free-form `connections` table (hand-drawn "strings") and the
// structured FK columns (location/faction/giver). Board yarn, tidy clustering,
// the detail sheet's Relations rail, and the cleanup panel all read edges
// through here so they can't drift apart. Storage is untouched — this is a
// pure derivation.
export type RelationSource = "manual" | "fk";

export interface DerivedEdge {
  // For manual edges these keep the connection row's stored orientation, so
  // deleteConnection(from, to, label) can match the exact row. FK edges point
  // from the entity that carries the field to the entity it references.
  a: string;
  b: string;
  label: string;
  source: RelationSource;
  weight: number;
  // True for an FK edge whose pair is also covered by a manual string. The
  // edge is never dropped — the detail sheet's rail must still show a
  // structured relation even when a manual string exists for the same pair —
  // but board yarn (which would otherwise overlap the manual line) should
  // skip suppressed edges. Always false for manual edges.
  suppressed: boolean;
}

// Weights bias both the tidy force layout (link strength) and community
// detection: a shared faction pulls harder than a shared location, which pulls
// harder than a quest-giver link. Manual strings sit at the location tier.
export const FACTION_WEIGHT = 3;
export const LOCATION_WEIGHT = 2;
export const MANUAL_WEIGHT = 2;
export const GIVER_WEIGHT = 1;

// Order-independent key for an entity pair. Exported so consumers that
// aggregate per-pair (boardLayout's weight collapse, the analysis scripts)
// can't drift from the format used here.
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// A NUL char separates pair-key from label so no (id, label) combination can
// collide with another. Built via fromCharCode so the source stays plain text
// (a literal NUL byte would make git treat this file as binary).
const SEP = String.fromCharCode(0);
const edgeKey = (pk: string, label: string) => `${pk}${SEP}${label}`;

/**
 * Union the connections table with the FK-derived edges.
 *
 * - Manual edges (any kind, including sessions/events/goals) dedupe only by
 *   (unordered pair, label) — the table legitimately holds parallel edges
 *   between the same pair with different labels ("ally of" AND "owes a debt
 *   to"), so they must NOT collapse into one.
 * - FK edges (person.faction/location, quest.giver, event.location) dedupe
 *   against the pair and are flagged `suppressed` when any manual edge already
 *   covers that pair — the hand-drawn string wins the *board* line (callers
 *   that render yarn should skip suppressed edges), but the edge itself is
 *   still returned so consumers like the detail sheet's Relations rail can
 *   keep showing the structured relation.
 */
export function deriveRelations(campaign: Campaign): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const manualPairs = new Set<string>(); // unordered pairs covered by any manual edge
  const manualSeen = new Set<string>(); // (pair, label) already emitted as manual

  for (const [from, to, label] of campaign.connections) {
    if (!from || !to || from === to) continue;
    const pk = pairKey(from, to);
    manualPairs.add(pk);
    const key = edgeKey(pk, label);
    if (manualSeen.has(key)) continue;
    manualSeen.add(key);
    edges.push({ a: from, b: to, label, source: "manual", weight: MANUAL_WEIGHT, suppressed: false });
  }

  const fkSeen = new Set<string>();
  const addFk = (a: string, b: string, label: string, weight: number) => {
    if (!a || !b || a === b) return;
    const pk = pairKey(a, b);
    const key = edgeKey(pk, label);
    if (fkSeen.has(key)) return;
    fkSeen.add(key);
    edges.push({ a, b, label, source: "fk", weight, suppressed: manualPairs.has(pk) });
  };

  for (const p of campaign.people) {
    if (p.faction) addFk(p.id, p.faction, "member of", FACTION_WEIGHT);
    if (p.location) addFk(p.id, p.location, "resides at", LOCATION_WEIGHT);
  }
  for (const q of campaign.quests) {
    if (q.giver) addFk(q.id, q.giver, "quest giver", GIVER_WEIGHT);
  }
  for (const ev of campaign.events) {
    if (ev.location) addFk(ev.id, ev.location, "happened at", LOCATION_WEIGHT);
  }

  return edges;
}
