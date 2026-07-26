// Relations harness: exercises the pure derivation in src/relations.ts, which
// is the single read-projection behind board yarn, the detail sheet's Relations
// rail, tidy clustering and the cleanup panel. Two of its rules are invisible
// at the call site and easy to break silently:
//
//   * `source` is what decides whether a rail chip gets a delete control at
//     all. Mislabel an FK edge as manual and the sheet offers to delete a row
//     that doesn't exist (0 rows → a misleading "wasn't saved" toast).
//   * manual edges dedupe on an UNORDERED pair key, so ONE visible edge can
//     stand for a mirrored A→B / B→A pair. That is the whole reason
//     deleteConnectionBetween matches both directions instead of the row's
//     stored orientation. Narrow it back to two .eq() calls and the delete
//     half-succeeds: count 1 so nothing warns, but the mirror survives and the
//     edge reappears on the next refetch. Nothing else in the repo catches it.
//
// Synthetic on purpose: no real campaign reliably holds a mirrored duplicate
// pair. Sibling of scripts/saga-check.ts and scripts/layout-check.ts.
//
// Usage: npx tsx scripts/relations-check.ts   (exits non-zero on any failure)
import { deriveRelations } from "../src/relations";
import type { Campaign } from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

// Minimal campaign shell; each case overrides only what it needs.
const shell = (over: Partial<Campaign>): Campaign => ({
  id: "c1", title: "Test", subtitle: "",
  people: [], locations: [], quests: [], goals: [], factions: [],
  items: [], lore: [], monsters: [], sessions: [], arcs: [],
  events: [], eventParticipants: {}, sessionParticipants: {},
  connections: [], sessionStaging: [], sessionEvents: [], dmNotes: {},
  board: {}, notes: {},
  ...over,
} as Campaign);

console.log("\nsource: which edges the rail may offer to delete");
{
  // The shipped seed's shape (0011): Theothor carries a faction FK *and* a
  // hand-drawn string to that same faction, plus a location FK with no string.
  const c = shell({
    people: [{ id: "p1", name: "Theothor", faction: "f1", location: "l1" } as any],
    factions: [{ id: "f1", name: "Grey Manes" } as any],
    locations: [{ id: "l1", name: "The Hall" } as any],
    connections: [["p1", "f1", "shield of the guild"]],
  });
  const edges = deriveRelations(c);
  const faction = edges.filter((e) => e.a === "f1" || e.b === "f1");
  const location = edges.filter((e) => e.a === "l1" || e.b === "l1");
  check("the manual string is the pair's only edge (FK yields to it)", faction.length === 1, faction);
  check("...and is source=manual, so the chip gets a delete control", faction[0]?.source === "manual");
  check("...carrying the row's stored orientation", faction[0]?.a === "p1" && faction[0]?.b === "f1");
  check("an FK-only pair stays source=fk, so its chip stays read-only", location[0]?.source === "fk");
}

console.log("\nmirrored pair: why the delete must match both directions");
{
  const c = shell({
    people: [{ id: "a", name: "A" } as any, { id: "b", name: "B" } as any],
    connections: [["a", "b", "ally of"], ["b", "a", "ally of"]],
  });
  const edges = deriveRelations(c);
  // If this ever reports 2, the unordered dedupe changed and
  // deleteConnectionBetween's .or() can be narrowed back to two .eq() calls.
  check("two mirrored rows collapse to ONE visible edge", edges.length === 1, edges);
  check("...so one chip/strand stands for a SET of rows, not a row",
    edges.length < c.connections.length);
  check("...and the surviving orientation is one of the two stored ones",
    edges[0] && ((edges[0].a === "a" && edges[0].b === "b") || (edges[0].a === "b" && edges[0].b === "a")));
}

console.log("\nparallel labels stay independently deletable");
{
  const c = shell({
    people: [{ id: "a", name: "A" } as any, { id: "b", name: "B" } as any],
    connections: [["a", "b", "ally of"], ["a", "b", "owes a debt to"]],
  });
  const edges = deriveRelations(c);
  check("same pair, different labels → two edges", edges.length === 2, edges);
  check("both manual, so both chips get their own control", edges.every((e) => e.source === "manual"));
  check("labels differ, so a label-scoped DELETE hits only one",
    new Set(edges.map((e) => e.label)).size === 2);
}

console.log("\nFK resurrection after a cut (documented, deliberate)");
{
  const withString = deriveRelations(shell({
    people: [{ id: "p1", name: "P", faction: "f1" } as any],
    factions: [{ id: "f1", name: "F" } as any],
    connections: [["p1", "f1", "shield of the guild"]],
  }));
  const afterCut = deriveRelations(shell({
    people: [{ id: "p1", name: "P", faction: "f1" } as any],
    factions: [{ id: "f1", name: "F" } as any],
    connections: [],
  }));
  check("before: one manual edge", withString.length === 1 && withString[0].source === "manual");
  check("after: the FK edge un-suppresses and takes its place",
    afterCut.length === 1 && afterCut[0].source === "fk");
  check("...so the rail section relabels rather than emptying", afterCut[0]?.label === "member of");
}

console.log("\ndegenerate rows are dropped, not rendered as undeletable chips");
{
  const c = shell({
    people: [{ id: "a", name: "A" } as any],
    connections: [["a", "a", "self"], ["", "a", "empty from"], ["a", "", "empty to"]],
  });
  check("self-links and blank endpoints yield no edges", deriveRelations(c).length === 0);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
