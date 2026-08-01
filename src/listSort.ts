import { entityLabel, sortForDisplay, type KindKey } from "./data";

// ============================================================================
// List ordering — the sort keys the overview pages offer, and the comparator
// behind them. Pure and voice-neutral (no ThemedLabel here): the labels below
// are option text in a `.facet-select`, sitting among the lowercase filter
// labels its neighbours already use.
//
// "default" is not a sort of its own — it delegates to sortForDisplay, the
// kind-aware order every other surface in the app shows (board cards, rails,
// the palette). Everything else re-sorts on top of the SAME pinned-then-
// archived precedence, so choosing "by name" never buries a pinned card in the
// middle of the alphabet or floats an archived one out of the tail.
//
// Missing values sort LAST in every direction — an unrated CR, an un-inked
// plate, a row with no updatedAt. That's the rule that needs stating because
// the natural implementation gets "least recently touched" wrong: a missing
// updatedAt reads as epoch 0, which is not "the oldest thing here", it's
// "unknown", and unknown at the top of the list is noise where the user asked
// for their most neglected entries.
// ============================================================================

export type SortKey = "default" | "name" | "recent" | "oldest" | "cr" | "met";

export interface SortOption {
  value: SortKey;
  label: string;
}

// What sortForDisplay's own order actually MEANS, per kind — it varies, so a
// single "default order" label would be a lie on two thirds of the pages. A
// kind absent from this map falls through to plain updatedAt ordering, which
// is exactly what RECENT offers, hence the "don't offer both" rule below.
const DEFAULT_LABEL: Partial<Record<KindKey, string>> = {
  people: "recently seen",
  quests: "by status",
  goals: "by status",
};

const RECENT_LABEL = "most recently touched";

export function sortOptionsFor(kind: KindKey): SortOption[] {
  const opts: SortOption[] = [
    { value: "default", label: DEFAULT_LABEL[kind] ?? RECENT_LABEL },
    { value: "name", label: "by name" },
  ];
  // Only offer "most recently touched" where it differs from the default. For
  // locations/factions/items/lore the default IS updatedAt order, and two
  // options that produce an identical list read as a bug.
  if (DEFAULT_LABEL[kind]) opts.push({ value: "recent", label: RECENT_LABEL });
  opts.push({ value: "oldest", label: "least recently touched" });
  if (kind === "monsters") {
    opts.push({ value: "cr", label: "by CR, worst first" });
    opts.push({ value: "met", label: "by when first met" });
  }
  return opts;
}

// Gate for anything read back out of storage: a persisted key that a later
// release renamed, or that belongs to a different kind ("cr" restored onto the
// people page), must fall back to the default rather than silently produce an
// unsorted list.
export function isSortKey(kind: KindKey, value: unknown): value is SortKey {
  return typeof value === "string" && sortOptionsFor(kind).some((o) => o.value === value);
}

export interface SortContext {
  kind: KindKey;
  /** people: resolves `lastSeen` (a session id) to its sequential number. */
  sessionNum?: (sessionId: string) => number;
  /** monsters: the session number a plate was first inked in, Infinity if never. */
  firstMetNum?: (id: string) => number;
}

type Sortable = { id: string; updatedAt?: string; archived?: boolean; pinned?: boolean };

export function applyListSort<T extends Sortable>(items: T[], key: SortKey, ctx: SortContext): T[] {
  if (key === "default") return sortForDisplay(items, { kind: ctx.kind, sessionNum: ctx.sessionNum });
  const time = (e: T): number => (e.updatedAt ? Date.parse(e.updatedAt) || 0 : 0);
  const chosen = (a: T, b: T): number => {
    switch (key) {
      case "name":
        return entityLabel(a).localeCompare(entityLabel(b));
      case "recent":
        return time(b) - time(a); // 0 (unknown) sinks on its own here
      case "oldest": {
        const ta = time(a);
        const tb = time(b);
        // Unknown last, not first — see the header note.
        if (!ta || !tb) return (ta ? 0 : 1) - (tb ? 0 : 1);
        return ta - tb;
      }
      case "cr":
        // Unrated last rather than first: "the worst thing we ever fought"
        // should not open on the creatures nobody has rated.
        return ((b as any).cr ?? -1) - ((a as any).cr ?? -1);
      case "met":
        return (ctx.firstMetNum?.(a.id) ?? Infinity) - (ctx.firstMetNum?.(b.id) ?? Infinity);
      default:
        return 0;
    }
  };
  return items.slice().sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const aa = a.archived ? 1 : 0;
    const ab = b.archived ? 1 : 0;
    if (aa !== ab) return aa - ab;
    const c = chosen(a, b);
    if (c !== 0) return c;
    return time(b) - time(a); // same final tiebreaker as sortForDisplay
  });
}
