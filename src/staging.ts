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
