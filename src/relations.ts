import type { Campaign } from "./data";

// A single unified read-projection over the two relationship models the app
// keeps: the free-form `connections` table (hand-drawn "strings") and the
// structured FK columns (location/faction/giver). Board yarn, tidy clustering,
// the detail sheet's Relations rail, and the cleanup panel all read edges
// through here so they can't drift apart. Storage is untouched — this is a
// pure derivation.
export type RelationSource = "manual" | "fk";

export interface DerivedEdge {
  // For manual edges these keep the connection row's stored orientation. Note
  // this is NOT load-bearing for deletes: because the manual dedupe below is
  // keyed on an unordered pair, one edge can stand for a mirrored A→B / B→A
  // pair, so deleteConnectionBetween matches either direction and removes the
  // whole set. FK edges point from the entity that carries the field to the
  // entity it references.
  a: string;
  b: string;
  label: string;
  source: RelationSource;
  weight: number;
  // Provenance from the connections row (0031), manual edges only — an FK edge
  // is derived from a column, so it has no draw time, session or author.
  // Because the dedupe below is keyed on an unordered pair, one manual edge can
  // stand for a mirrored A→B / B→A row pair carrying two DIFFERENT timestamps;
  // these report the earliest of that set, so "when was this first drawn" is
  // stable no matter which orientation the (unordered) select returns first.
  // Undefined for FK edges and for rows predating 0031.
  createdAt?: string;
  sessionId?: string;
  author?: string;
  // The account behind `author` (0040). Folds as one unit with it below — a
  // byline whose name came from one row of a mirrored pair and whose uuid came
  // from the other would resolve to a third person entirely.
  authorUserId?: string;
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
 *   against the pair AND are suppressed when any manual edge already covers
 *   that pair — the hand-drawn string wins the visible representation.
 */
export function deriveRelations(campaign: Campaign): DerivedEdge[] {
  const edges: DerivedEdge[] = [];
  const manualPairs = new Set<string>(); // unordered pairs covered by any manual edge
  const manualByKey = new Map<string, DerivedEdge>(); // (pair, label) → emitted edge

  for (const cn of campaign.connections) {
    const { from, to, label } = cn;
    if (!from || !to || from === to) continue;
    const pk = pairKey(from, to);
    manualPairs.add(pk);
    const key = edgeKey(pk, label);
    const seen = manualByKey.get(key);
    if (seen) {
      // A mirrored/duplicate row for an edge already emitted. Fold its
      // provenance in rather than discarding it: keep the earliest createdAt,
      // carrying that row's session and byline with it so all four stay
      // consistent. Date.parse, not string compare — PostgREST's timestamptz
      // text isn't guaranteed lexicographically ordered (fractional digits
      // vary), the same trap sortSessionEvents documents. A row with no
      // createdAt never displaces a known one: unknown isn't earlier.
      if (cn.createdAt && (!seen.createdAt || Date.parse(cn.createdAt) < Date.parse(seen.createdAt))) {
        seen.createdAt = cn.createdAt;
        seen.sessionId = cn.sessionId;
        seen.author = cn.author;
        seen.authorUserId = cn.authorUserId;
      }
      continue;
    }
    const edge: DerivedEdge = {
      a: from, b: to, label, source: "manual", weight: MANUAL_WEIGHT,
      createdAt: cn.createdAt, sessionId: cn.sessionId,
      author: cn.author, authorUserId: cn.authorUserId,
    };
    manualByKey.set(key, edge);
    edges.push(edge);
  }

  const fkSeen = new Set<string>();
  const addFk = (a: string, b: string, label: string, weight: number) => {
    if (!a || !b || a === b) return;
    const pk = pairKey(a, b);
    if (manualPairs.has(pk)) return; // manual string wins the visible edge for this pair
    const key = edgeKey(pk, label);
    if (fkSeen.has(key)) return;
    fkSeen.add(key);
    edges.push({ a, b, label, source: "fk", weight });
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
