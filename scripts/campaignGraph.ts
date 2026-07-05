// Shared loader for the analysis scripts (ab-clustering, layout-check): reads
// the anon Supabase creds from .env, pulls one campaign's rows, and derives the
// same cards/edges view of the board that the app's Tidy action sees.
//
// The row → campaign field mapping below intentionally mirrors the mappers in
// src/campaignContext.tsx (mapPerson/mapQuest/mapEvent) — only the fields
// deriveRelations reads. If a column rename lands there, update this too.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { deriveRelations, type DerivedEdge } from "../src/relations";
import type { BoardPosition, KindKey } from "../src/data";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TABLES = [
  "people", "locations", "quests", "goals", "factions", "items", "lore",
  "sessions", "events", "connections", "board_positions",
] as const;

export interface CampaignGraph {
  rows: Record<string, any[]>;
  /** Display name per entity id (name ?? title ?? text). */
  name: Map<string, string>;
  /** Non-archived board cards, the way onTidy sees them. */
  cards: { id: string; kind: KindKey; pinned: boolean }[];
  /** Current board positions for those cards. */
  positions: Record<string, BoardPosition>;
  /** Unified relations filtered to edges between board cards. */
  edges: DerivedEdge[];
}

export async function loadCampaignGraph(campaignId: string): Promise<CampaignGraph> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

  const rows: Record<string, any[]> = {};
  await Promise.all(TABLES.map(async (t) => {
    const { data, error } = await supabase.from(t).select("*").eq("campaign_id", campaignId);
    if (error) throw new Error(`${t}: ${error.message}`);
    rows[t] = data ?? [];
  }));

  // Minimal campaign shape — only the fields deriveRelations reads.
  const campaign = {
    people: rows.people.map((r) => ({ id: r.id, faction: r.faction_id ?? undefined, location: r.location_id ?? undefined })),
    quests: rows.quests.map((r) => ({ id: r.id, giver: r.giver_id ?? undefined })),
    events: rows.events.map((r) => ({ id: r.id, location: r.location_id ?? undefined })),
    connections: rows.connections.map((r) => [r.from_id, r.to_id, r.label ?? ""] as [string, string, string]),
  } as any;

  const name = new Map<string, string>();
  const archived = new Set<string>();
  for (const t of TABLES) {
    if (t === "connections" || t === "board_positions") continue;
    for (const r of rows[t]) {
      name.set(r.id, r.name ?? r.title ?? r.text ?? r.id);
      if (r.archived) archived.add(r.id);
    }
  }

  const positions: Record<string, BoardPosition> = {};
  for (const r of rows.board_positions) {
    if (archived.has(r.entity_id)) continue;
    positions[r.entity_id] = { x: r.x, y: r.y, rot: r.rot ?? 0, kind: r.kind as KindKey };
  }
  const cards = Object.keys(positions).map((id) => ({ id, kind: positions[id].kind, pinned: false }));
  const cardIds = new Set(cards.map((c) => c.id));
  const edges = deriveRelations(campaign).filter((e) => cardIds.has(e.a) && cardIds.has(e.b));

  return { rows, name, cards, positions, edges };
}
