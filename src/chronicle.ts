import type { CampaignEvent } from "./data";

// ============================================================================
// Ordering for the Chronicle of Events — pure, so the two rules below can be
// asserted (scripts/listsort-check.ts) rather than eyeballed on the page.
//
// Chronology here is `order_num`, NOT a date and NOT `updatedAt`: `in_game_date`
// is a free-form text column ("the third night of Flamerule"), so it can neither
// be parsed nor compared. That's also why this can't ride on listSort.ts —
// those keys sort by `updatedAt` over the nine KindKey tables, and `events`
// is neither of those things.
//
// The default is NEWEST FIRST. A campaign only ever appends to its chronicle,
// so ascending order buries the thing that just happened under every moment
// that preceded it, and the page grows one scroll longer every session. The
// forward read is still one click away, and it's the rarer intent.
// ============================================================================

export type ChronicleOrder = "default" | "oldest";

export interface ChronicleOrderOption {
  value: ChronicleOrder;
  label: string;
}

// Voice-neutral (no ThemedLabel — this module is pure): option text in a
// `.facet-select`, sitting among the lowercase facet labels used elsewhere.
export const CHRONICLE_ORDERS: ChronicleOrderOption[] = [
  { value: "default", label: "newest first" },
  { value: "oldest", label: "oldest first" },
];

// Gate for the persisted value, same contract as isSortKey: a key a later
// release renamed must fall back to the default rather than sort nothing.
export function isChronicleOrder(value: unknown): value is ChronicleOrder {
  return typeof value === "string" && CHRONICLE_ORDERS.some((o) => o.value === value);
}

// Descending is a distinct comparator, not `.reverse()` of the ascending one:
// a reverse would also flip the title tiebreak to Z→A, so two events sharing an
// orderNum would swap for no reason visible on the page.
const byOrder = (a: CampaignEvent, b: CampaignEvent) =>
  a.orderNum - b.orderNum || a.title.localeCompare(b.title);
const byOrderDesc = (a: CampaignEvent, b: CampaignEvent) =>
  b.orderNum - a.orderNum || a.title.localeCompare(b.title);

export function sortEvents(events: CampaignEvent[], order: ChronicleOrder): CampaignEvent[] {
  return events.slice().sort(order === "oldest" ? byOrder : byOrderDesc);
}

export interface DateGroup {
  date: string;
  events: CampaignEvent[];
}

/**
 * Bands the sorted list under its in-game date headers.
 *
 * Only *consecutive* events sharing a date merge, because order_num carries the
 * chronology and a date string is free text — a recurring one ("Midwinter")
 * must never pull two distant events into the same band.
 *
 * This runs AFTER sortEvents and reads whatever order it's handed, which is the
 * point: newest-first reverses the bands and their contents together. Reversing
 * the bands while leaving each band ascending is the incoherent middle case,
 * and it's what you get if grouping is done before ordering.
 */
export function groupByDate(events: CampaignEvent[]): DateGroup[] {
  const groups: DateGroup[] = [];
  events.forEach((ev) => {
    const date = ev.inGameDate?.trim() || "Undated";
    const last = groups[groups.length - 1];
    if (last && last.date === date) last.events.push(ev);
    else groups.push({ date, events: [ev] });
  });
  return groups;
}
