// ============================================================================
// Remembered list ordering — the ONE piece of view state the overview pages
// keep across visits.
//
// localStorage, deliberately, and note the two things it is NOT:
//
//   * Not `__TWEAKS__` / `__edit_mode_set_keys`. That channel is for state the
//     HOST page owns and re-injects on load (theme, density, presence,
//     campaignId). A sort preference is nobody's business but this browser's;
//     routing it through the parent would widen that contract for nothing. The
//     precedent for a genuinely-local key is src/join.tsx.
//   * Not a table. Viewers are anonymous sessions, so a per-user row would
//     persist nothing for exactly the people most likely to be browsing lists,
//     and it would need a read path outside the realtime one.
//
// SORT ONLY — never the facets or the name query. Coming back to a page in a
// different order hides nothing; coming back to a page with the race facet
// still set and two thirds of the roster missing looks like data loss.
//
// The key is versioned: a future release that renames sort keys bumps :v1
// rather than trying to migrate a preference nobody would miss.
// ============================================================================

const KEY = "codex:list-sort:v1";

type Store = Record<string, string>;

// Every access is wrapped: storage throws outright in some embedded/partitioned
// contexts, and this app runs in an iframe. A sort that doesn't stick is fine;
// a list page that won't render is not.
function readAll(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

export function readListSort(kind: string): string | null {
  const v = readAll()[kind];
  return typeof v === "string" ? v : null;
}

// "default" is stored as absence, so a user who never touches the control
// leaves no key behind and a later change to what "default" means reaches them.
export function writeListSort(kind: string, value: string): void {
  try {
    const next = readAll();
    if (value === "default") delete next[kind];
    else next[kind] = value;
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* best effort — the choice just won't outlive the page */
  }
}
