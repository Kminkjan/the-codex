// Layout quality harness: runs the real computeTidyLayout over a campaign's
// real board data and reports the acceptance metrics for "Tidy board":
// card overlaps (must be 0), determinism (two runs → identical positions),
// bounding box / aspect, and layout time.
//
// Usage: npx tsx scripts/layout-check.ts [campaignId]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { computeTidyLayout, cardDims } from "../src/boardLayout";
import { deriveRelations } from "../src/relations";
import type { BoardPosition, KindKey } from "../src/data";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN = process.argv[2] ?? "fist-of-ilmater";

const env: Record<string, string> = {};
for (const l of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

const tables = ["people", "locations", "quests", "goals", "factions", "items", "lore", "sessions", "events", "connections", "board_positions"] as const;
const rows: Record<string, any[]> = {};
await Promise.all(tables.map(async (t) => {
  const { data, error } = await sb.from(t).select("*").eq("campaign_id", CAMPAIGN);
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

const archived = new Set<string>();
for (const t of tables) {
  if (t === "connections" || t === "board_positions") continue;
  for (const r of rows[t]) if (r.archived) archived.add(r.id);
}

const positions: Record<string, BoardPosition> = {};
for (const r of rows.board_positions) {
  if (archived.has(r.entity_id)) continue;
  positions[r.entity_id] = { x: r.x, y: r.y, rot: r.rot ?? 0, kind: r.kind as KindKey };
}
const cards = Object.keys(positions).map((id) => ({ id, kind: positions[id].kind, pinned: false }));
const cardIds = new Set(cards.map((c) => c.id));
const edges = deriveRelations(campaign).filter((e) => cardIds.has(e.a) && cardIds.has(e.b));

const t0 = Date.now();
const out = computeTidyLayout({ cards, positions, edges });
const ms = Date.now() - t0;
const out2 = computeTidyLayout({ cards, positions, edges });

let identical = true;
for (const id of Object.keys(out)) {
  if (!out2[id] || out2[id].x !== out[id].x || out2[id].y !== out[id].y) { identical = false; break; }
}

const rect = (id: string) => {
  const d = cardDims(positions[id].kind);
  return { x: out[id].x, y: out[id].y, w: d.w, h: d.h };
};
const ids = Object.keys(out);
let overlaps = 0;
const overlapPairs: string[] = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const A = rect(ids[i]), B = rect(ids[j]);
    const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (ox > 1 && oy > 1) { overlaps++; overlapPairs.push(`${ids[i]} × ${ids[j]} (${Math.round(ox)}×${Math.round(oy)})`); }
  }
}

let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (const id of ids) {
  const R = rect(id);
  minX = Math.min(minX, R.x); minY = Math.min(minY, R.y);
  maxX = Math.max(maxX, R.x + R.w); maxY = Math.max(maxY, R.y + R.h);
}

console.log(`campaign=${CAMPAIGN} cards=${cards.length} placed=${ids.length} time=${ms}ms`);
console.log(`deterministic=${identical} overlaps=${overlaps}`);
for (const p of overlapPairs.slice(0, 8)) console.log(`  overlap: ${p}`);
console.log(`board bbox: ${Math.round(maxX - minX)} × ${Math.round(maxY - minY)} (aspect ${((maxX - minX) / (maxY - minY)).toFixed(2)})`);
