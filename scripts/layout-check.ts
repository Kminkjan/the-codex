// Layout quality harness: runs the real computeTidyLayout over a campaign's
// real board data and reports the acceptance metrics for "Tidy board":
// card overlaps (must be 0), determinism (two runs → identical positions),
// bounding box / aspect, and layout time.
//
// Usage: npx tsx scripts/layout-check.ts [campaignId]
import { computeTidyLayout, cardDims } from "../src/boardLayout";
import { loadCampaignGraph } from "./campaignGraph";

const CAMPAIGN = process.argv[2] ?? "fist-of-ilmater";
const { cards, positions, edges } = await loadCampaignGraph(CAMPAIGN);

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
