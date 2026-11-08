// The DM's desk: the reading order of a session's staging queue, and the split
// between the queue (work) and the released rows (record).
//
// Pure derivations only — no React, no Supabase, no `window`. Two surfaces
// share them: the live panel's desk (src/livePanel.tsx) and the session sheet's
// prep list (src/detail.tsx). They were two hand-rolled sorts before this
// module existed, which is how they came to disagree about nothing in
// particular; CLAUDE.md tells the same story about the note composers.
//
// Three rules, each silent when wrong:
//
//   * **Queued outranks released, in every order.** A released row is tonight's
//     record, not tonight's work. Letting a timestamp float one above the queue
//     would put a done thing under the DM's cursor mid-sentence, and the verb
//     under that cursor is public and irreversible.
//   * **Unknown `stagedAt` sorts LAST.** Rows staged before migration 0045 carry
//     null, which means "predates the column", never "just now" — the same
//     contract as `connections.createdAt` (0031) and the same tie-break
//     direction listSort.ts applies to every other unknown value here. Sorting
//     nulls first would march the entire seeded back-catalogue to the head of
//     the queue on the night 0045 ships.
//   * **The order must be TOTAL.** Staging rows are fetched unordered (the
//     select carries no .order()), so two rows with equal timestamps — or two
//     nulls, which is the common case right after 0045 — would otherwise sit in
//     whatever order Postgres happened to return, and visibly reshuffle on every
//     refetch. `entity_id` is the final tiebreak because it is the only value
//     here guaranteed unique and stable; the label is not (two entities may
//     share a name, and a rename would reorder the desk under the DM's hand).
//
// Guarded by scripts/staging-check.ts.

import { isShowEvent } from "./data";

// The shape both callers project their rows into. Deliberately structural
// rather than SessionStagingRow + a lookup: the label comes from entityLabel()
// over a resolved entity, which this module must not know about.
export interface StagedItem {
  readonly entityId: string;
  readonly stagedAt: string | null;
  readonly releasedAt: string | null;
  readonly label: string;
}

// Oldest-first within each band. Null is "unknown", which always loses.
const byTime = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

// The desk's reading order:
//   1. queued before released
//   2. queued  → staged oldest first, unknown last   (prep order)
//   3. released → released oldest first              (chronological record)
//   4. label, then entityId, so the order is total and stable across refetches
export function compareStaged(a: StagedItem, b: StagedItem): number {
  const aDone = a.releasedAt !== null;
  const bDone = b.releasedAt !== null;
  if (aDone !== bDone) return aDone ? 1 : -1;

  const t = aDone ? byTime(a.releasedAt, b.releasedAt) : byTime(a.stagedAt, b.stagedAt);
  if (t !== 0) return t;

  const l = a.label.localeCompare(b.label);
  if (l !== 0) return l;
  return a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0;
}

export function orderStaged<T extends StagedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareStaged);
}

// The queue/record split the desk folds on. Both arrays keep compareStaged's
// order, so a caller can render `queued` and, behind a disclosure, `released`
// without sorting again.
export function splitStaged<T extends StagedItem>(
  items: readonly T[],
): { queued: T[]; released: T[] } {
  const ordered = orderStaged(items);
  return {
    queued: ordered.filter((i) => i.releasedAt === null),
    released: ordered.filter((i) => i.releasedAt !== null),
  };
}

// Keyboard navigation on the desk moves through the rows the DM can actually
// see, which is the queue plus — only when the record is expanded — the
// released rows. Centralised here so the list, the arrow keys and the action
// bar can never disagree about what "the next row" means.
export function visibleStaged<T extends StagedItem>(
  items: readonly T[],
  showReleased: boolean,
): T[] {
  const { queued, released } = splitStaged(items);
  return showReleased ? [...queued, ...released] : queued;
}

// Where the selection lands after arrow keys. Returns the entity id to select,
// or null when there is nothing to move to. `from` may be null (nothing
// selected yet) or an id that has since left the list — both start from the
// top for Down and the bottom for Up, so a stale selection can never strand the
// keyboard.
export function stepSelection<T extends StagedItem>(
  visible: readonly T[],
  from: string | null,
  delta: 1 | -1,
): string | null {
  if (visible.length === 0) return null;
  const i = from === null ? -1 : visible.findIndex((v) => v.entityId === from);
  if (i === -1) return (delta === 1 ? visible[0] : visible[visible.length - 1]).entityId;
  const next = Math.min(visible.length - 1, Math.max(0, i + delta));
  return visible[next].entityId;
}

// ===== The control room's monitors (#167) ===================================
// The control room splits the desk into two monitors: PROGRAM, what every
// player's screen was last sent, and PREVIEW, what the DM has selected and is
// about to act on. Both are derived here so the live panel's "now showing" card
// and the control room's Program can never disagree about what is on screen.

// The minimum of a feed row these derivations read. Structural, like
// StagedItem, so this module needs nothing from the feed's renderers.
export interface FeedEventLike {
  readonly sessionId: string;
  readonly type: string;
  readonly text?: string;
  readonly entityId?: string;
}

// What PROGRAM shows: the live session's LATEST show. Quiet releases never
// qualify — a release unhides without pushing anything onto a screen, so
// counting it would claim the table is looking at something it was never sent.
// Other sessions' shows never qualify either: the feed array spans every
// session, and a show from last week is not on anyone's screen tonight.
//
// Returns the event, not the entity: resolving it is the caller's job, and a
// show whose entity has since been deleted or re-hidden must retire the
// monitor rather than leave a ghost on it.
export function latestShow<T extends FeedEventLike>(
  events: readonly T[],
  sessionId: string | null,
): T | undefined {
  if (!sessionId) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.sessionId === sessionId && isShowEvent(e)) return e;
  }
  return undefined;
}

// What PREVIEW says about the entity under the DM's cursor, from loudest to
// quietest. The order is the rule: each state outranks the ones below it.
//
//   * on-screen — it is what PROGRAM shows. Outranks "released": every shown
//     entity is also released, and the DM needs to know it is up right now.
//   * released  — its staging row for this session carries released_at.
//   * hidden    — players cannot see it; releasing will reveal it.
//   * visible   — players can already see it. Releasing only logs a line,
//     which is legal (staging something visible is allowed) but must never be
//     a surprise.
export type PreviewState = "on-screen" | "released" | "hidden" | "visible";

export function previewState(input: {
  onScreen: boolean;
  releasedAt: string | null;
  hidden: boolean;
}): PreviewState {
  if (input.onScreen) return "on-screen";
  if (input.releasedAt !== null) return "released";
  return input.hidden ? "hidden" : "visible";
}

// Whether RELEASE QUIETLY is on offer. Only for a row still queued tonight:
// releasing is the staging queue's verb, and a released row has nothing left
// to release. A visible queued row stays releasable on purpose — the live
// desk has always allowed it, and it is how the DM records "they learned
// this now" for something they could already see.
export function canReleaseQuietly(input: { staged: boolean; releasedAt: string | null }): boolean {
  return input.staged && input.releasedAt === null;
}
