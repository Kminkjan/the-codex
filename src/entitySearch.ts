import { entityLabel, personTier, type Campaign, type KindKey } from "./data";

// Shared entity search: the command palette and the entity combobox both index
// the campaign and rank substring matches through this one implementation so
// their behavior can't drift. The palette layers two things on top of the
// primary/secondary tiering here: a party-notes pass and the facet-operator
// pre-filter (see searchHits in commandPalette.tsx) — the combobox gets neither.

export type MatchSource = "primary" | "secondary" | "note";

export interface RankedHit {
  id: string;
  kind: KindKey;
  label: string;
  snippet?: string;
  matchSource: MatchSource;
  rank: 0 | 1 | 2 | 3;
  archived?: boolean;
  hidden?: boolean;
}

export const KIND_LABEL: Record<KindKey, string> = {
  people: "Person",
  locations: "Location",
  quests: "Quest",
  goals: "Goal",
  factions: "Faction",
  items: "Item",
  lore: "Lore",
  sessions: "Session",
  arcs: "Arc",
  events: "Event",
};

export interface Indexed {
  id: string;
  kind: KindKey;
  label: string;
  primary: string;
  secondary: string;
  archived?: boolean;
  // DM-only flag: non-DM users never index hidden rows (projected out of the
  // campaign upstream), so this is only ever true for the DM's own view.
  hidden?: boolean;
  // Structured facet values for palette operators (people only, all
  // lowercased). Entries without facets never match an operator query.
  facets?: { tier: string; status?: string; race?: string; factionName?: string };
}

export function joinFields(...parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== "").join(" · ");
}

export function buildIndex(campaign: Campaign): Indexed[] {
  const out: Indexed[] = [];
  const factionNameById = new Map(campaign.factions.map((f) => [f.id, f.name.toLowerCase()]));
  for (const p of campaign.people) {
    out.push({
      id: p.id,
      kind: "people",
      label: entityLabel(p),
      primary: p.name ?? "",
      // tier/status join the plain-text index too (quests already index
      // q.status), so free-typed "dead" matches without operator syntax. The
      // default tier stays out of the text: indexing "major" on every person
      // would make that word match the whole roster, and explicit-major must
      // behave like unset-major everywhere (personTier equates them).
      secondary: joinFields(
        p.epithet, p.race, p.role, p.disposition, p.alignment,
        personTier(p) === "major" ? undefined : personTier(p),
        p.status, p.notes,
      ),
      archived: p.archived,
      hidden: p.hidden,
      facets: {
        tier: personTier(p),
        status: p.status,
        race: p.race?.trim().toLowerCase(),
        factionName: p.faction ? factionNameById.get(p.faction) : undefined,
      },
    });
  }
  for (const l of campaign.locations) {
    out.push({
      id: l.id,
      kind: "locations",
      label: entityLabel(l),
      primary: l.name ?? "",
      secondary: joinFields(l.kind, l.region, l.ruler, l.desc, l.notes),
      archived: l.archived,
      hidden: l.hidden,
    });
  }
  for (const q of campaign.quests) {
    out.push({
      id: q.id,
      kind: "quests",
      label: entityLabel(q),
      primary: q.title ?? "",
      secondary: joinFields(q.status, q.reward, q.desc, q.hooks),
      archived: q.archived,
      hidden: q.hidden,
    });
  }
  for (const g of campaign.goals) {
    out.push({
      id: g.id,
      kind: "goals",
      label: entityLabel(g),
      primary: g.text ?? "",
      secondary: joinFields(g.owner, g.kind, g.status),
      archived: g.archived,
      hidden: g.hidden,
    });
  }
  for (const f of campaign.factions) {
    out.push({
      id: f.id,
      kind: "factions",
      label: entityLabel(f),
      primary: f.name ?? "",
      secondary: joinFields(f.sigil, f.desc, f.allegiance),
      archived: f.archived,
      hidden: f.hidden,
    });
  }
  for (const i of campaign.items) {
    out.push({
      id: i.id,
      kind: "items",
      label: entityLabel(i),
      primary: i.name ?? "",
      secondary: joinFields(i.kind, i.desc),
      archived: i.archived,
      hidden: i.hidden,
    });
  }
  for (const lo of campaign.lore) {
    out.push({
      id: lo.id,
      kind: "lore",
      label: entityLabel(lo),
      primary: lo.title ?? "",
      secondary: lo.text ?? "",
      archived: lo.archived,
      hidden: lo.hidden,
    });
  }
  for (const s of campaign.sessions) {
    out.push({
      id: s.id,
      kind: "sessions",
      label: entityLabel(s),
      primary: s.title ?? "",
      secondary: joinFields(s.date, s.inGameDate, `Session ${s.num}`, s.summary),
    });
  }
  for (const a of campaign.arcs) {
    out.push({
      id: a.id,
      kind: "arcs",
      label: entityLabel(a),
      primary: a.title ?? "",
      secondary: a.summary ?? "",
    });
  }
  for (const ev of campaign.events) {
    out.push({
      id: ev.id,
      kind: "events",
      label: entityLabel(ev),
      primary: ev.title ?? "",
      secondary: joinFields(ev.inGameDate, ev.summary),
    });
  }
  return out;
}

export function makeSnippet(source: string, queryLower: string): string {
  const idx = source.toLowerCase().indexOf(queryLower);
  if (idx < 0) return source.slice(0, 90);
  const start = Math.max(0, idx - 30);
  const end = Math.min(source.length, idx + queryLower.length + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  const core = source.slice(start, end);
  const snippet = `${prefix}${core}${suffix}`;
  return snippet.length > 100 ? `${snippet.slice(0, 97)}…` : snippet;
}

// Keep only the strongest (lowest-rank) hit per entity id.
export function keepBest(best: Map<string, RankedHit>, hit: RankedHit) {
  const prev = best.get(hit.id);
  if (!prev || hit.rank < prev.rank) best.set(hit.id, hit);
}

// Tier every entry by its primary field (startsWith → 0, includes → 1) then its
// secondary field (includes → 2), writing the best hit per id into `best`. The
// caller owns sorting, slicing, and any extra passes (e.g. party notes).
export function rankEntities(index: Indexed[], queryLower: string, best: Map<string, RankedHit>) {
  for (const e of index) {
    const primary = e.primary.toLowerCase();
    if (primary.startsWith(queryLower)) {
      keepBest(best, { id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 0, archived: e.archived, hidden: e.hidden });
      continue;
    }
    if (primary.includes(queryLower)) {
      keepBest(best, { id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 1, archived: e.archived, hidden: e.hidden });
      continue;
    }
    const secondary = e.secondary.toLowerCase();
    if (secondary.includes(queryLower)) {
      keepBest(best, {
        id: e.id,
        kind: e.kind,
        label: e.label,
        snippet: makeSnippet(e.secondary, queryLower),
        matchSource: "secondary",
        rank: 2,
        archived: e.archived,
        hidden: e.hidden,
      });
    }
  }
}

export function sortHits(best: Map<string, RankedHit>, limit: number): RankedHit[] {
  return Array.from(best.values())
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// ===== Palette operators (`tier:background race:halfling gob`) ==============
// Parsed only by the command palette's searchHits — rankIndex (the entity
// combobox) must never see operators, so a relation search for a lore entry
// literally titled "status: unknown" keeps working there.

export type FacetOp = { field: "tier" | "status" | "race" | "faction"; value: string };

const OP_RE = /^(tier|status|race|faction):(.*)$/i;

// Split a raw query into facet operators and the remaining free text. A bare
// "tier:" (empty value) only counts as an operator while it's the final token
// — that's mid-typing, and narrowing to people early feels responsive. Bare
// anywhere else means the colon was literal text ("status: unknown" typed
// with a space must keep searching every kind, not silently filter to people).
export function parseOperators(query: string): { ops: FacetOp[]; rest: string } {
  const ops: FacetOp[] = [];
  const rest: string[] = [];
  const tokens = query.trim().split(/\s+/);
  tokens.forEach((token, i) => {
    const m = token.match(OP_RE);
    if (m && (m[2] !== "" || i === tokens.length - 1)) {
      ops.push({ field: m[1].toLowerCase() as FacetOp["field"], value: m[2].toLowerCase() });
    } else {
      rest.push(token);
    }
  });
  return { ops, rest: rest.join(" ") };
}

// Exact match for the enum facets, substring for the free-text ones
// (faction:zhent). Entries without facets (everything but people) never
// match an operator query.
export function matchesOps(e: Indexed, ops: FacetOp[]): boolean {
  if (ops.length === 0) return true;
  const f = e.facets;
  if (!f) return false;
  return ops.every(({ field, value }) => {
    if (!value) return true; // bare "tier:" — narrow to people, match all
    if (field === "tier") return f.tier === value;
    if (field === "status") return f.status === value;
    if (field === "race") return !!f.race?.includes(value);
    return !!f.factionName?.includes(value);
  });
}

// The whole index as rank-0 hits, alphabetically — the "no query" listing
// shared by the combobox dropdown and the palette's pure-operator results.
export function listAlphabetical(index: Indexed[], limit: number): RankedHit[] {
  return index
    .map((e): RankedHit => ({ id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 0, archived: e.archived, hidden: e.hidden }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, limit);
}

// Combobox ranker: substring tiering over an index, no notes pass. An empty
// query returns the whole list alphabetically so the popover reads like a
// normal dropdown before the user types.
export function rankIndex(index: Indexed[], query: string, limit = 50): RankedHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return listAlphabetical(index, limit);
  }
  const best = new Map<string, RankedHit>();
  rankEntities(index, q, best);
  return sortHits(best, limit);
}
