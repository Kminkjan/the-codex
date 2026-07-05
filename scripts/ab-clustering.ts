// A/B harness: shipped weighted label-propagation vs weighted Louvain
// (graphology-communities-louvain) over the REAL fist-of-ilmater board graph,
// fed by the same deriveRelations() projection the app uses.
//
// Usage: npx tsx scripts/ab-clustering.ts [campaignId]
//
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from .env (anon key —
// reads are open to anon per RLS). Prints, per algorithm: community count/sizes,
// members by name, weighted modularity, cut edges (edges spanning communities),
// plus a synthetic "low-weight bridge" acceptance test: two dense w3 cliques
// joined by ONE w2 manual string must NOT merge.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { deriveRelations, type DerivedEdge } from "../src/relations";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGN = process.argv[2] ?? "fist-of-ilmater";

// ---------------------------------------------------------------- env / client
const env: Record<string, string> = {};
for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

// ------------------------------------------------------------------ fetch data
const tables = [
  "people", "locations", "quests", "goals", "factions", "items", "lore",
  "sessions", "events", "connections", "board_positions",
] as const;
const rows: Record<string, any[]> = {};
await Promise.all(tables.map(async (t) => {
  const { data, error } = await supabase.from(t).select("*").eq("campaign_id", CAMPAIGN);
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
for (const t of tables) {
  if (t === "connections" || t === "board_positions") continue;
  for (const r of rows[t]) {
    name.set(r.id, r.name ?? r.title ?? r.text ?? r.id);
    if (r.archived) archived.add(r.id);
  }
}

// Board cards the way onTidy sees them: entities with a board position, not archived.
const cards = rows.board_positions
  .filter((r) => !archived.has(r.entity_id))
  .map((r) => ({ id: r.entity_id as string, kind: r.kind as string }));
const cardIds = new Set(cards.map((c) => c.id));

const allEdges = deriveRelations(campaign);
const edges = allEdges.filter((e) => cardIds.has(e.a) && cardIds.has(e.b));

// Collapse to one weight per unordered pair (MAX) — same as boardLayout.ts.
const pairWeight = new Map<string, number>();
for (const e of edges) {
  if (e.a === e.b) continue;
  const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
  pairWeight.set(key, Math.max(pairWeight.get(key) ?? 0, e.weight));
}

console.log(`campaign=${CAMPAIGN}  cards=${cards.length}  derivedEdges=${edges.length} (manual=${edges.filter(e=>e.source==="manual").length} fk=${edges.filter(e=>e.source==="fk").length})  collapsedPairs=${pairWeight.size}`);

// ---------------------------------------------------------------- algorithms
type Pairs = Map<string, number>;

function adjacency(ids: string[], pairs: Pairs) {
  const adj = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  for (const [key, w] of pairs) {
    const [a, b] = key.split("|");
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.set(b, w);
    adj.get(b)!.set(a, w);
  }
  return adj;
}

// Exact copy of the shipped weighted label propagation (boardLayout.ts).
function labelProp(ids: string[], pairs: Pairs): Map<string, string> {
  const adjW = adjacency(ids, pairs);
  const sortedIds = [...ids].sort();
  const community = new Map<string, string>(sortedIds.map((id) => [id, id]));
  for (let round = 0; round < 20; round++) {
    let changed = false;
    for (const id of sortedIds) {
      const nbrs = adjW.get(id)!;
      if (nbrs.size === 0) continue;
      const score = new Map<string, number>();
      for (const [nb, w] of nbrs) {
        const lb = community.get(nb)!;
        score.set(lb, (score.get(lb) ?? 0) + w);
      }
      let best: string | null = null;
      let bestScore = -Infinity;
      for (const [lb, s] of score) {
        if (s > bestScore || (s === bestScore && (best === null || lb < best))) { best = lb; bestScore = s; }
      }
      if (best !== null && best !== community.get(id)) { community.set(id, best); changed = true; }
    }
    if (!changed) break;
  }
  return community;
}

// mulberry32 — deterministic rng for Louvain.
function seededRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function runLouvain(ids: string[], pairs: Pairs, resolution: number): Map<string, string> {
  const g = new Graph({ type: "undirected" });
  for (const id of [...ids].sort()) g.addNode(id);
  for (const [key, w] of [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [a, b] = key.split("|");
    if (g.hasNode(a) && g.hasNode(b)) g.addEdge(a, b, { weight: w });
  }
  const res = louvain(g, {
    resolution,
    rng: seededRng(42),
    getEdgeWeight: "weight",
  });
  return new Map(Object.entries(res).map(([id, c]) => [id, String(c)]));
}

// Weighted modularity of a partition over the collapsed pairs.
function modularity(ids: string[], pairs: Pairs, community: Map<string, string>): number {
  let m2 = 0; // 2m
  const strength = new Map<string, number>();
  for (const [key, w] of pairs) {
    const [a, b] = key.split("|");
    m2 += 2 * w;
    strength.set(a, (strength.get(a) ?? 0) + w);
    strength.set(b, (strength.get(b) ?? 0) + w);
  }
  if (m2 === 0) return 0;
  let q = 0;
  for (const [key, w] of pairs) {
    const [a, b] = key.split("|");
    if (community.get(a) === community.get(b)) q += w / (m2 / 2);
  }
  const byC = new Map<string, number>();
  for (const [id, s] of strength) {
    const c = community.get(id)!;
    byC.set(c, (byC.get(c) ?? 0) + s);
  }
  for (const s of byC.values()) q -= (s / m2) ** 2;
  return q;
}

function report(tag: string, ids: string[], pairs: Pairs, community: Map<string, string>, edgeList: DerivedEdge[]) {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const c = community.get(id) ?? id;
    (groups.get(c) ?? groups.set(c, []).get(c)!).push(id);
  }
  const connected = new Set([...pairs.keys()].flatMap((k) => k.split("|")));
  const real = [...groups.values()].filter((g) => g.length > 1 || connected.has(g[0]));
  const singletonsIsolated = ids.length - real.reduce((n, g) => n + g.length, 0);
  real.sort((a, b) => b.length - a.length);
  console.log(`\n=== ${tag} — ${real.length} communities (sizes: ${real.map((g) => g.length).join(", ")}), isolated=${singletonsIsolated}, modularity=${modularity(ids, pairs, community).toFixed(3)}`);
  for (const g of real) {
    const label = (id: string) => name.get(id) ?? id.slice(0, 8);
    const shown = g.slice(0, 10).map(label).join(" · ");
    console.log(`  [${String(g.length).padStart(2)}] ${shown}${g.length > 10 ? ` … +${g.length - 10}` : ""}`);
  }
  const cut = edgeList.filter((e) => community.get(e.a) !== community.get(e.b));
  console.log(`  cut edges (${cut.length}):`);
  for (const e of cut.slice(0, 15)) {
    console.log(`    ${name.get(e.a) ?? e.a} —"${e.label}"(w${e.weight},${e.source})— ${name.get(e.b) ?? e.b}`);
  }
  if (cut.length > 15) console.log(`    … +${cut.length - 15}`);
}

// -------------------------------------------------------------- real-data A/B
const ids = cards.map((c) => c.id);
report("label propagation (shipped)", ids, pairWeight, labelProp(ids, pairWeight), edges);
for (const r of [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]) {
  report(`louvain resolution=${r}`, ids, pairWeight, runLouvain(ids, pairWeight, r), edges);
}

// Determinism spot-check: run each twice, compare.
const same = (a: Map<string, string>, b: Map<string, string>) => {
  // compare as partitions (labels may differ): canonical signature
  const sig = (m: Map<string, string>) => {
    const byC = new Map<string, string[]>();
    for (const [id, c] of m) (byC.get(c) ?? byC.set(c, []).get(c)!).push(id);
    return [...byC.values()].map((g) => g.sort().join(",")).sort().join(";");
  };
  return sig(a) === sig(b);
};
console.log(`\ndeterminism: labelProp=${same(labelProp(ids, pairWeight), labelProp(ids, pairWeight))} louvain(1.0)=${same(runLouvain(ids, pairWeight, 1.0), runLouvain(ids, pairWeight, 1.0))}`);

// ----------------------------------------------------- bridge acceptance test
// Two dense spheres (w3 cliques, e.g. Zhentarim vs Neverwinter stand-ins)
// joined by ONE w2 manual "rival of" string. Must stay TWO communities.
{
  const A = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const B = ["b1", "b2", "b3", "b4", "b5", "b6"];
  const pairs: Pairs = new Map();
  const clique = (g: string[]) => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) pairs.set(`${g[i]}|${g[j]}`, 3);
  };
  clique(A); clique(B);
  pairs.set("a1|b1", 2); // the low-weight bridge
  const bids = [...A, ...B];
  const check = (tag: string, community: Map<string, string>) => {
    const ca = new Set(A.map((id) => community.get(id)));
    const cb = new Set(B.map((id) => community.get(id)));
    const merged = community.get("a1") === community.get("b1");
    const cohesive = ca.size === 1 && cb.size === 1;
    console.log(`bridge test ${tag}: ${merged ? "MERGED ✗" : "separate ✓"}${cohesive ? "" : " (spheres fragmented!)"}`);
  };
  console.log("");
  check("labelProp", labelProp(bids, pairs));
  for (const r of [0.7, 1.0, 1.5, 2.0]) check(`louvain r=${r}`, runLouvain(bids, pairs, r));
}
