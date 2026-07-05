// A/B harness: shipped weighted label-propagation vs weighted Louvain
// (graphology-communities-louvain) over a REAL campaign's board graph, fed by
// the same deriveRelations() projection the app uses.
//
// Usage: npx tsx scripts/ab-clustering.ts [campaignId]
//
// Prints, per algorithm: community count/sizes, members by name, weighted
// modularity, cut edges (edges spanning communities), plus a synthetic
// "low-weight bridge" acceptance test: two dense w3 cliques joined by ONE w2
// manual string must NOT merge.
//
// Outcome (2026-07-05, campaigns fist-of-ilmater + fendwick): Louvain at
// resolution 0.9 won — label propagation tore semantic groups apart (split the
// party's guild from its own leader, orphaned members into 2-card islands) at
// clearly lower modularity. boardLayout.ts ships Louvain accordingly; this
// harness stays for re-evaluating on future data.

import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { pairKey, type DerivedEdge } from "../src/relations";
import { mulberry32 } from "../src/boardLayout";
import { loadCampaignGraph } from "./campaignGraph";

const CAMPAIGN = process.argv[2] ?? "fist-of-ilmater";
const { name, cards, edges } = await loadCampaignGraph(CAMPAIGN);

// Collapse to one weight per unordered pair (MAX) — same as boardLayout.ts.
const pairWeight = new Map<string, number>();
for (const e of edges) {
  if (e.a === e.b) continue;
  const key = pairKey(e.a, e.b);
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

// Copy of the weighted label propagation that shipped before Louvain replaced
// it (kept here as the A/B baseline).
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

function runLouvain(ids: string[], pairs: Pairs, resolution: number): Map<string, string> {
  const g = new Graph({ type: "undirected" });
  for (const id of [...ids].sort()) g.addNode(id);
  for (const [key, w] of [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [a, b] = key.split("|");
    if (g.hasNode(a) && g.hasNode(b)) g.addEdge(a, b, { weight: w });
  }
  const res = louvain(g, {
    resolution,
    rng: mulberry32(42),
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
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(id);
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
report("label propagation (baseline)", ids, pairWeight, labelProp(ids, pairWeight), edges);
for (const r of [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]) {
  report(`louvain resolution=${r}`, ids, pairWeight, runLouvain(ids, pairWeight, r), edges);
}

// Determinism spot-check: run each twice, compare as partitions (labels may
// differ; canonical signature makes the comparison label-agnostic).
const same = (a: Map<string, string>, b: Map<string, string>) => {
  const sig = (m: Map<string, string>) => {
    const byC = new Map<string, string[]>();
    for (const [id, c] of m) {
      if (!byC.has(c)) byC.set(c, []);
      byC.get(c)!.push(id);
    }
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
