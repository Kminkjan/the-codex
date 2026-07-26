import {
  type Arc,
  type Campaign,
  type KindKey,
  type Session,
  entityLabel,
  isArchived,
  isPinned,
  personTier,
  sessionLabel,
} from "./data";
import { deriveRelations } from "./relations";

// Pure read-derivations over the nested `arcs` table (migration 0025): a row
// with no parentId is a saga, its children are its arcs. Everything that needs
// the hierarchy — the Arcs page, the detail sheet's parent picker, the Complete
// Saga wizard — reads it through here, the same way board yarn and cleanup
// suggestions both read edges through relations.ts. Storage is untouched.
//
// Nothing here trusts array order: realtime INSERTs append to campaign.arcs and
// campaign.sessions, so every list is sorted explicitly on the field that
// carries the ordering (orderNum for arcs, num for sessions).

export function isSaga(arc: Arc): boolean {
  return !arc.parentId;
}

export function isCompleted(arc: Arc): boolean {
  return !!arc.completedAt;
}

const byOrder = (a: Arc, b: Arc) => a.orderNum - b.orderNum || a.title.localeCompare(b.title);

export interface SagaNode {
  saga: Arc;
  arcs: Arc[];
}

/**
 * The whole chronicle as sagas each holding their ordered arcs.
 *
 * An arc whose parentId points at a row that isn't loaded (deleted in another
 * tab, or a parent the trigger would reject) is treated as a saga rather than
 * dropped — losing a chunk of the chronicle is a worse failure than showing it
 * at the wrong altitude.
 */
export function sagaTree(campaign: Campaign): SagaNode[] {
  const byId = new Map(campaign.arcs.map((a) => [a.id, a]));
  const children = new Map<string, Arc[]>();
  const roots: Arc[] = [];
  for (const arc of campaign.arcs) {
    if (arc.parentId && byId.has(arc.parentId)) {
      const list = children.get(arc.parentId);
      if (list) list.push(arc);
      else children.set(arc.parentId, [arc]);
    } else {
      roots.push(arc);
    }
  }
  return roots
    .sort(byOrder)
    .map((saga) => ({ saga, arcs: (children.get(saga.id) ?? []).slice().sort(byOrder) }));
}

// The saga an arc belongs to — itself when it already is one. Null only when
// the id doesn't resolve.
export function sagaOf(campaign: Campaign, arcId: string | undefined): Arc | null {
  if (!arcId) return null;
  const arc = campaign.arcs.find((a) => a.id === arcId);
  if (!arc) return null;
  if (!arc.parentId) return arc;
  return campaign.arcs.find((a) => a.id === arc.parentId) ?? arc;
}

export function childArcs(campaign: Campaign, sagaId: string): Arc[] {
  return campaign.arcs.filter((a) => a.parentId === sagaId).sort(byOrder);
}

// A saga plus its arcs, as the set that `sessions.arc_id` / `quests.arc_id` may
// point into. Includes the saga itself: 0025 leaves sessionless quests pointing
// at the saga, and nothing stops a DM from filing a chapter at that altitude.
export function arcSubtreeIds(campaign: Campaign, sagaId: string): Set<string> {
  const ids = new Set<string>([sagaId]);
  for (const arc of campaign.arcs) if (arc.parentId === sagaId) ids.add(arc.id);
  return ids;
}

/**
 * The chapters a saga covers, ascending by num.
 *
 * Primary source is assignment (`session.arc` in the subtree). The start/end
 * session range is a *fallback*, used only when nothing is assigned — that's
 * the state of the five pre-chapter-31 arcs the 0025 seed creates, and of any
 * saga whose range is set before its chapters are filed. Preferring assignment
 * matters because the two can disagree: a DM who moves one chapter out of a
 * saga expects it gone from the roll-up, range notwithstanding.
 */
export function sagaSessions(campaign: Campaign, sagaId: string): Session[] {
  const subtree = arcSubtreeIds(campaign, sagaId);
  const assigned = campaign.sessions.filter((s) => s.arc && subtree.has(s.arc));
  if (assigned.length > 0) return assigned.slice().sort((a, b) => a.num - b.num);

  const saga = campaign.arcs.find((a) => a.id === sagaId);
  if (!saga) return [];
  const byId = new Map(campaign.sessions.map((s) => [s.id, s]));
  const lo = saga.startSession ? byId.get(saga.startSession)?.num : undefined;
  const hi = saga.endSession ? byId.get(saga.endSession)?.num : undefined;
  if (lo === undefined && hi === undefined) return [];
  return campaign.sessions
    .filter((s) => (lo === undefined || s.num >= lo) && (hi === undefined || s.num <= hi))
    .sort((a, b) => a.num - b.num);
}

// Chapter count for a saga's roll-up line. Counts what sagaSessions resolves,
// so an arc with a range but no filed chapters honestly reports its span.
export function sagaChapterCount(campaign: Campaign, sagaId: string): number {
  return sagaSessions(campaign, sagaId).length;
}

// ===== Complete Saga: the sweep candidate set ===============================

// Why an entity is being offered (or protected). Rendered verbatim in the
// wizard's reason column.
//
// Written in a deliberately voice-neutral register: this is a pure module, so
// ThemedLabel isn't available to split parchment ceremony from Atlas function,
// and these strings have to read correctly under both. Keep them factual —
// "continues in S05", not "still afoot in S05".
export type SweepReason = string;

export interface SweepCandidate {
  kind: KindKey;
  id: string;
  label: string;
  reason: SweepReason;
  // Pre-checked on open. Majors are never pre-checked and neither is anything
  // that carries forward — see the tier rules below.
  suggested: boolean;
  // Seen in a chapter after this saga ended, so it's already the next saga's
  // business. Surfaced separately because it's the one reason a DM most wants
  // to see spelled out rather than inferred from an unchecked box.
  carriesForward: boolean;
  // people only, for the tier grouping and the majors-are-protected notice.
  tier?: "major" | "supporting" | "background";
}

export interface LooseEnd {
  kind: "quests" | "goals";
  id: string;
  label: string;
  status: string;
}

export interface SagaScope {
  sessions: Session[];
  lastNum: number | null;
  cast: SweepCandidate[];
  things: SweepCandidate[];
  looseEnds: LooseEnd[];
}

/**
 * Everything the Complete Saga wizard offers to sweep, with the reason for each.
 *
 * Three tiers of confidence, and the UI defaults reflect them:
 *
 *   * **Cast** — people are reachable from chapters directly, through the
 *     session_participants junction (`campaign.sessionParticipants`) plus the
 *     lastSeen pointer. Strong signal.
 *   * **Loose ends** — quests/goals filed against the saga (or one of its
 *     chapters) that never resolved. Not archived by this function; the wizard
 *     asks per row.
 *   * **Things** — locations, factions, items, lore and monsters carry no
 *     session link whatsoever, so they can only be reached by association
 *     through deriveRelations(). Same trick the cleanup panel uses for
 *     staleness, and inherently fuzzier — every one of these comes back
 *     `suggested: false`.
 *
 * Archived and pinned entities are skipped throughout: pinned is the DM's
 * explicit "leave this alone", the same contract the cleanup panel honours.
 */
export function sagaScope(campaign: Campaign, sagaId: string): SagaScope {
  const sessions = sagaSessions(campaign, sagaId);
  const sagaSessionIds = new Set(sessions.map((s) => s.id));
  const lastNum = sessions.length > 0 ? sessions[sessions.length - 1].num : null;
  const sessionNum = new Map(campaign.sessions.map((s) => [s.id, s.num]));

  // Chapters after this saga. An entity appearing in one of them carries
  // forward and is never pre-checked, whatever its tier.
  const laterSessionIds = new Set(
    lastNum === null
      ? []
      : campaign.sessions.filter((s) => s.num > lastNum).map((s) => s.id),
  );

  // Invert the junction once: person id → the chapter numbers they appeared in,
  // unordered (callers take the max). Scanning sessionParticipants per person would be
  // people × chapters, and this runs on every realtime event while the wizard is
  // open — on a 190-chapter campaign that's the difference between free and
  // felt. Split by side of the saga boundary so both lookups are O(1).
  const inSagaNums = new Map<string, number[]>();
  const laterNums = new Map<string, number[]>();
  for (const [sid, ids] of Object.entries(campaign.sessionParticipants)) {
    const bucket = sagaSessionIds.has(sid) ? inSagaNums : laterSessionIds.has(sid) ? laterNums : null;
    if (!bucket) continue;
    const n = sessionNum.get(sid);
    if (n === undefined) continue;
    for (const pid of ids) {
      const seen = bucket.get(pid);
      if (seen) seen.push(n); else bucket.set(pid, [n]);
    }
  }
  // Latest chapter they were present for, on the given side of the boundary.
  const lastAppearance = (bucket: Map<string, number[]>, personId: string): number | null => {
    const nums = bucket.get(personId);
    return nums && nums.length > 0 ? Math.max(...nums) : null;
  };

  const skip = (e: any) => isArchived(e) || isPinned(e);

  // ---- Cast ---------------------------------------------------------------
  const cast: SweepCandidate[] = [];
  for (const p of campaign.people) {
    if (skip(p)) continue;
    const inSaga = lastAppearance(inSagaNums, p.id);
    const seenHere = inSaga !== null || (p.lastSeen && sagaSessionIds.has(p.lastSeen));
    if (!seenHere) continue;

    const laterNum = lastAppearance(laterNums, p.id);
    const lastSeenLater = p.lastSeen && laterSessionIds.has(p.lastSeen);
    const carriesForward = laterNum !== null || !!lastSeenLater;
    const tier = personTier(p);

    let reason: string;
    if (carriesForward) {
      const n = laterNum ?? (p.lastSeen ? sessionNum.get(p.lastSeen) : undefined);
      reason = n !== undefined ? `continues in ${sessionLabel(n)}` : "continues after this saga";
    } else if (tier === "major") {
      reason = "major — stays on the board";
    } else {
      const n = inSaga ?? (p.lastSeen ? sessionNum.get(p.lastSeen) : undefined);
      reason = n !== undefined ? `last seen ${sessionLabel(n)}` : "no chapter recorded";
    }

    cast.push({
      kind: "people",
      id: p.id,
      label: entityLabel(p),
      reason,
      // The DM's rule, encoded as a default rather than a wall: majors are
      // never pre-checked, and neither is anyone still walking the story.
      suggested: !carriesForward && tier !== "major",
      carriesForward,
      tier,
    });
  }

  // ---- Loose ends ---------------------------------------------------------
  const subtree = arcSubtreeIds(campaign, sagaId);
  const inSagaByArcOrSession = (e: { arc?: string; session?: string }) =>
    (e.arc && subtree.has(e.arc)) || (e.session && sagaSessionIds.has(e.session));

  const looseEnds: LooseEnd[] = [];
  const sagaQuestIds = new Set<string>();
  for (const q of campaign.quests) {
    if (!inSagaByArcOrSession(q)) continue;
    sagaQuestIds.add(q.id);
    if (skip(q)) continue;
    if (q.status === "resolved" || q.status === "lost") continue;
    looseEnds.push({ kind: "quests", id: q.id, label: entityLabel(q), status: q.status ?? "unknown" });
  }
  // Goals have no arc or session column, so they enter through their owner:
  // a goal is this saga's business when the person who holds it is.
  const castIds = new Set(cast.map((c) => c.id));
  for (const g of campaign.goals) {
    if (skip(g)) continue;
    if (g.status === "resolved" || g.status === "lost") continue;
    if (!g.owner || !castIds.has(g.owner)) continue;
    looseEnds.push({ kind: "goals", id: g.id, label: entityLabel(g), status: g.status ?? "unknown" });
  }

  // ---- Things (by association only) --------------------------------------
  const neighbours = new Map<string, Set<string>>();
  for (const { a, b } of deriveRelations(campaign)) {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  }
  // Anchors: everyone who appeared in the saga, its quests, and its events.
  const anchors = new Set<string>([...castIds, ...sagaQuestIds]);
  for (const ev of campaign.events) {
    if (ev.session && sagaSessionIds.has(ev.session)) anchors.add(ev.id);
  }
  // Anchors of the *rest* of the chronicle — anything touching one of these is
  // still in play and must not be offered.
  const futureAnchors = new Set<string>();
  for (const c of cast) if (c.carriesForward) futureAnchors.add(c.id);
  for (const q of campaign.quests) {
    if (sagaQuestIds.has(q.id)) continue;
    if (q.status !== "resolved" && q.status !== "lost") futureAnchors.add(q.id);
  }
  for (const ev of campaign.events) {
    const n = ev.session ? sessionNum.get(ev.session) : undefined;
    if (n !== undefined && lastNum !== null && n > lastNum) futureAnchors.add(ev.id);
  }

  const thingKinds: Array<[KindKey, any[]]> = [
    ["locations", campaign.locations],
    ["factions", campaign.factions],
    ["items", campaign.items],
    ["lore", campaign.lore],
    ["monsters", campaign.monsters],
  ];
  const things: SweepCandidate[] = [];
  for (const [kind, list] of thingKinds) {
    for (const e of list) {
      if (skip(e)) continue;
      const linked = neighbours.get(e.id);
      if (!linked) continue;
      let touchesSaga = false;
      let touchesFuture = false;
      for (const n of linked) {
        if (anchors.has(n)) touchesSaga = true;
        if (futureAnchors.has(n)) touchesFuture = true;
      }
      if (!touchesSaga) continue;
      things.push({
        kind,
        id: e.id,
        label: entityLabel(e),
        reason: touchesFuture ? "also tied to open threads" : "only tied to this saga",
        // Never pre-checked: reached by association, not by record.
        suggested: false,
        carriesForward: touchesFuture,
      });
    }
  }

  return { sessions, lastNum, cast, things, looseEnds };
}
