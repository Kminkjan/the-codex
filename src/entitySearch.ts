import { entityLabel, type Campaign, type KindKey } from "./data";

// Shared entity search: the command palette and the entity combobox both index
// the campaign and rank substring matches through this one implementation so
// their behavior can't drift. The palette layers a party-notes pass on top of
// the primary/secondary tiering here (see searchHits in commandPalette.tsx).

export type MatchSource = "primary" | "secondary" | "note";

export interface RankedHit {
  id: string;
  kind: KindKey;
  label: string;
  snippet?: string;
  matchSource: MatchSource;
  rank: 0 | 1 | 2 | 3;
  archived?: boolean;
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
}

export function joinFields(...parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== "").join(" · ");
}

export function buildIndex(campaign: Campaign): Indexed[] {
  const out: Indexed[] = [];
  for (const p of campaign.people) {
    out.push({
      id: p.id,
      kind: "people",
      label: entityLabel(p),
      primary: p.name ?? "",
      secondary: joinFields(p.epithet, p.race, p.role, p.disposition, p.alignment, p.notes),
      archived: p.archived,
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
      keepBest(best, { id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 0, archived: e.archived });
      continue;
    }
    if (primary.includes(queryLower)) {
      keepBest(best, { id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 1, archived: e.archived });
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
      });
    }
  }
}

export function sortHits(best: Map<string, RankedHit>, limit: number): RankedHit[] {
  return Array.from(best.values())
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, limit);
}

// Combobox ranker: substring tiering over an index, no notes pass. An empty
// query returns the whole list alphabetically so the popover reads like a
// normal dropdown before the user types.
export function rankIndex(index: Indexed[], query: string, limit = 50): RankedHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return index
      .map((e): RankedHit => ({ id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 0, archived: e.archived }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, limit);
  }
  const best = new Map<string, RankedHit>();
  rankEntities(index, q, best);
  return sortHits(best, limit);
}
