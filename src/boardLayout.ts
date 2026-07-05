import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import { packSiblings, packEnclose } from "d3-hierarchy";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { BoardPosition, KindKey } from "./data";
import type { DerivedEdge } from "./relations";

// Card footprints per kind — the single source of truth shared by the board
// renderer (centerOf / findFreeSpot in board.tsx) and the tidy layout, so both
// agree on how much room a card occupies.
export const CARD_SIZE: Record<string, { w: number; h: number }> = {
  people: { w: 220, h: 300 },
  quests: { w: 240, h: 160 },
  locations: { w: 210, h: 200 },
  goals: { w: 200, h: 140 },
  factions: { w: 180, h: 80 },
  items: { w: 170, h: 90 },
  lore: { w: 190, h: 90 },
};
const DEFAULT_SIZE = { w: 200, h: 140 };
export const cardDims = (kind: string) => CARD_SIZE[kind] || DEFAULT_SIZE;

// Top-left margins the layout keeps clear (mirrors findFreeSpot's startX/startY)
// so no card lands under the title banner or off the top-left of the canvas.
const MARGIN_X = 220;
const MARGIN_Y = 260;
const TICKS_PER_CLUSTER = 260;

export type TidyTuning = {
  linkDistance: number;      // rest length of intra-cluster edges
  linkStrengthPerWeight: number; // forceLink strength = this × edge weight (capped)
  charge: number;            // intra-cluster repulsion (spreads a sphere's cards)
  hubPull: number;           // pull members toward their hub (tightness of a sphere)
  collidePad: number;        // breathing room around each card
  clusterGap: number;        // empty space added around each sphere before packing
  louvainResolution: number; // community granularity: lower merges, higher splits
};

// mulberry32 — a tiny seeded PRNG so Louvain's tie-breaking is reproducible
// and "Tidy" stays deterministic run-to-run.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// forceLink strength scales with edge weight so a shared faction (w3) draws
// cards tighter than a shared location/manual string (w2) than a quest-giver
// link (w1); capped so a heavily-linked pair can't collapse to zero distance.
const MAX_LINK_STRENGTH = 0.6;

interface MiniNode extends SimulationNodeDatum {
  id: string;
  w: number;
  h: number;
}
interface MiniLink extends SimulationLinkDatum<MiniNode> {
  weight: number;
}

/**
 * Two-phase "tidy" that arranges the board into **spheres of influence**:
 *
 *  1. Weighted **Louvain** partitions the cards into communities (denser than
 *     connected components, so an FK-enriched graph splits into sub-spheres
 *     instead of merging into one blob); each community's
 *     most-connected entity is its hub. Each community is laid out **internally**
 *     with its own small force sim (weighted links + repulsion + collision + a
 *     pull toward the hub), producing a tight sphere centred on its hub. Isolated
 *     cards are parked in a separate grid so they don't blur the gaps between spheres.
 *  2. The spheres are then **circle-packed** (`d3-hierarchy`), so clusters sit
 *     adjacent and clearly separated with no overlap — deterministic and
 *     compact, without the chaotic tug-of-war of competing global forces.
 *
 * Returns new **top-left** coordinates keyed by entity id (visible cards only).
 * The caller carries over each card's existing `rot`/`kind`. Note: unlike the
 * earlier force layout this repositions every card (including pinned ones) — a
 * packed layout has no room for fixed absolute anchors.
 */
export function computeTidyLayout(input: {
  cards: { id: string; kind: KindKey; pinned: boolean }[]; // visible cards only
  positions: Record<string, BoardPosition>;                // current (unused here; kept for API stability)
  edges: DerivedEdge[];                                    // visible unified edges (manual + FK)
}, tuneOverride?: Partial<TidyTuning>): Record<string, { x: number; y: number }> {
  const { cards, edges } = input;
  if (cards.length === 0) return {};

  const TUNE: TidyTuning = {
    linkDistance: 55,
    linkStrengthPerWeight: 0.15, // w1→.15, w2→.30 (== old constant), w3→.45
    charge: -200,
    hubPull: 0.5,
    collidePad: 20,
    clusterGap: 140, // whitespace between spheres so they read as distinct
    louvainResolution: 0.9, // stable plateau on both seeded campaigns (see scripts/ab-clustering.ts)
    ...tuneOverride,
  };
  // Isolated cards (no edges) are parked in a tidy grid below the clusters
  // instead of being packed into the gaps between spheres — otherwise they fill
  // exactly the whitespace that separates the clusters and blur them together.
  const SINGLETON_CELL = { w: 250, h: 340 };
  const SINGLETON_TOP_GAP = 320;

  const dims = new Map(cards.map((c) => [c.id, cardDims(c.kind)]));
  const cardIds = new Set(cards.map((c) => c.id));

  // Collapse the unified edges to one weight per unordered card pair (MAX, so a
  // pair's strength stays in the designed w1..w3 band even with parallel manual
  // strings), and count each card's degree over those pairs.
  const degree = new Map<string, number>(cards.map((c) => [c.id, 0]));
  const pairWeight = new Map<string, number>();
  for (const e of edges) {
    if (e.a === e.b || !cardIds.has(e.a) || !cardIds.has(e.b)) continue;
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    pairWeight.set(key, Math.max(pairWeight.get(key) ?? 0, e.weight));
  }
  for (const key of pairWeight.keys()) {
    const [a, b] = key.split("|");
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  const radiusOf = (d: { id: string; w: number; h: number }) =>
    Math.hypot(d.w / 2, d.h / 2) + TUNE.collidePad + Math.min(degree.get(d.id) ?? 0, 10) * 6;

  // Community detection via **weighted Louvain** (modularity optimization over
  // the same weighted pairs the force sim uses). It replaced the earlier
  // hand-rolled label propagation after an A/B on both seeded campaigns
  // (scripts/ab-clustering.ts): label propagation tore semantic groups apart —
  // e.g. it split the party's own guild from its leader and orphaned members
  // into 2-card islands — while Louvain recovered the story's actual spheres at
  // clearly higher modularity. (An earlier pre-#42 Louvain attempt over-split,
  // but that graph was unweighted and sparse; the weighted projection fixed it,
  // and a single low-weight bridge between two dense spheres no longer merges
  // them.) Deterministic: nodes/edges inserted in sorted order + seeded rng.
  const sortedIds = cards.map((c) => c.id).sort();
  const graph = new Graph({ type: "undirected" });
  for (const id of sortedIds) graph.addNode(id);
  for (const [key, w] of [...pairWeight.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const [a, b] = key.split("|");
    graph.addEdge(a, b, { weight: w });
  }
  const assignments = louvain(graph, {
    resolution: TUNE.louvainResolution,
    rng: mulberry32(42),
    getEdgeWeight: "weight",
  });
  const community = new Map<string, string>(sortedIds.map((id) => [id, String(assignments[id])]));

  // Group cards by community label; find each community's hub (highest degree,
  // tie-break smallest id).
  const members = new Map<string, string[]>();
  const hub = new Map<string, string>();
  for (const c of cards) {
    const cm = community.get(c.id)!;
    let arr = members.get(cm);
    if (!arr) { arr = []; members.set(cm, arr); }
    arr.push(c.id);
    const h = hub.get(cm);
    const d = degree.get(c.id) ?? 0;
    if (h === undefined || d > (degree.get(h) ?? 0) || (d === (degree.get(h) ?? 0) && c.id < h)) {
      hub.set(cm, c.id);
    }
  }

  // ---- Phase 1: lay out each community internally into a tight sphere. --------
  type Blob = { r: number; x?: number; y?: number; local: { id: string; lx: number; ly: number; w: number; h: number }[] };
  const blobs: Blob[] = [];

  for (const [cm, ids] of members) {
    let local: { id: string; lx: number; ly: number; w: number; h: number }[];

    if (ids.length === 1) {
      const s = dims.get(ids[0])!;
      local = [{ id: ids[0], lx: 0, ly: 0, w: s.w, h: s.h }];
    } else {
      // Seed on a small deterministic circle so the mini-sim is reproducible.
      const sub: MiniNode[] = ids.map((id, i) => {
        const s = dims.get(id)!;
        return { id, w: s.w, h: s.h, x: Math.cos(i * 2.4) * 40, y: Math.sin(i * 2.4) * 40 };
      });
      const inSub = new Set(ids);
      const subLinks: MiniLink[] = [];
      pairWeight.forEach((w, key) => {
        const [a, b] = key.split("|");
        if (inSub.has(a) && inSub.has(b)) subLinks.push({ source: a, target: b, weight: w });
      });
      const hubId = hub.get(cm)!;
      const byId = new Map(sub.map((n) => [n.id, n]));
      const hubPull = (alpha: number) => {
        const H = byId.get(hubId);
        if (!H) return;
        const k = TUNE.hubPull * alpha;
        for (const n of sub) {
          if (n.id === hubId) continue;
          n.vx = (n.vx ?? 0) + ((H.x ?? 0) - (n.x ?? 0)) * k;
          n.vy = (n.vy ?? 0) + ((H.y ?? 0) - (n.y ?? 0)) * k;
        }
      };
      const sim = forceSimulation<MiniNode>(sub)
        .force("link", forceLink<MiniNode, MiniLink>(subLinks).id((d) => d.id).distance(TUNE.linkDistance).strength((l) => Math.min(MAX_LINK_STRENGTH, TUNE.linkStrengthPerWeight * l.weight)))
        .force("charge", forceManyBody<MiniNode>().strength(TUNE.charge))
        .force("collide", forceCollide<MiniNode>((d) => radiusOf(d)).strength(1).iterations(4))
        .force("hub", hubPull)
        .stop();
      for (let i = 0; i < TICKS_PER_CLUSTER; i++) sim.tick();
      local = sub.map((n) => ({ id: n.id, lx: n.x ?? 0, ly: n.y ?? 0, w: n.w, h: n.h }));
    }

    // Smallest enclosing circle over the members' bounding circles → sphere size.
    const circles = local.map((m) => ({ x: m.lx, y: m.ly, r: Math.hypot(m.w / 2, m.h / 2) + TUNE.collidePad / 2 }));
    const enc = packEnclose(circles) ?? { x: 0, y: 0, r: circles[0].r };
    const recentered = local.map((m) => ({ ...m, lx: m.lx - enc.x, ly: m.ly - enc.y }));
    blobs.push({ r: enc.r + TUNE.clusterGap, local: recentered });
  }

  // ---- Phase 2: circle-pack the real spheres; grid only the true loners. -----
  // A "loner" is a card with NO edges (degree 0). A 1-member community that
  // still has edges — community detection can leave a connected node alone — is
  // packed among the spheres, not exiled to the grid, so its yarn doesn't
  // stretch across the inter-sphere whitespace the grid exists to keep clear.
  const isLoner = (b: Blob) => b.local.length === 1 && (degree.get(b.local[0].id) ?? 0) === 0;
  const clusterBlobs = blobs.filter((b) => !isLoner(b));
  const singletonBlobs = blobs.filter(isLoner);

  const out: Record<string, { x: number; y: number }> = {};

  // Pack the spheres (largest first → compact, centred).
  clusterBlobs.sort((a, b) => b.r - a.r);
  packSiblings(clusterBlobs);
  for (const b of clusterBlobs) {
    for (const m of b.local) {
      out[m.id] = { x: (b.x ?? 0) + m.lx - m.w / 2, y: (b.y ?? 0) + m.ly - m.h / 2 };
    }
  }

  // Bounding box of the packed spheres (center coords), to place the loner grid.
  let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity, cMaxY = -Infinity;
  for (const b of clusterBlobs) {
    cMinX = Math.min(cMinX, (b.x ?? 0) - b.r); cMaxX = Math.max(cMaxX, (b.x ?? 0) + b.r);
    cMinY = Math.min(cMinY, (b.y ?? 0) - b.r); cMaxY = Math.max(cMaxY, (b.y ?? 0) + b.r);
  }
  if (!Number.isFinite(cMinX)) { cMinX = cMaxX = cMinY = cMaxY = 0; }

  // Lay isolated cards out in a neat grid beneath the clusters, roughly as wide
  // as the cluster area so it reads as a separate "unconnected" shelf.
  if (singletonBlobs.length) {
    const spanW = Math.max(cMaxX - cMinX, SINGLETON_CELL.w);
    const cols = Math.max(1, Math.min(singletonBlobs.length, Math.round(spanW / SINGLETON_CELL.w)));
    const startY = cMaxY + SINGLETON_TOP_GAP;
    singletonBlobs.forEach((b, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const cx = cMinX + col * SINGLETON_CELL.w + SINGLETON_CELL.w / 2;
      const cy = startY + row * SINGLETON_CELL.h + SINGLETON_CELL.h / 2;
      const m = b.local[0];
      out[m.id] = { x: cx - m.w / 2, y: cy - m.h / 2 };
    });
  }

  // Normalize so the top-left corner sits at the margin (below the banner).
  let minX = Infinity, minY = Infinity;
  for (const id in out) { minX = Math.min(minX, out[id].x); minY = Math.min(minY, out[id].y); }
  const dx = MARGIN_X - minX, dy = MARGIN_Y - minY;
  for (const id in out) { out[id].x += dx; out[id].y += dy; }
  return out;
}
