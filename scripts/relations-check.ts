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
//   * since 0031 that same unordered dedupe has to FOLD provenance rather than
//     drop it — the two rows of a mirrored pair carry different draw times, and
//     the surviving edge must report the earliest with its own author/session
//     attached, or the UI attributes a string to the wrong person on some
//     refetches and not others.
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
  events: [], eventParticipants: {}, sessionParticipants: {}, sessionAttendance: {},
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
    connections: [{ from: "p1", to: "f1", label: "shield of the guild" }],
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
    connections: [
      { from: "a", to: "b", label: "ally of" },
      { from: "b", to: "a", label: "ally of" },
    ],
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

console.log("\nprovenance folds to the EARLIEST row of a mirrored pair (0031)");
{
  // The mirrored pair again, but with the shape 0031 actually produces: each
  // orientation was inserted separately, so the two rows carry DIFFERENT draw
  // times, sessions and authors. One edge stands for both, and it must report
  // when the pair was FIRST drawn — otherwise "learned in session N" flickers
  // between refetches depending on which row the select happened to return.
  const people = [{ id: "a", name: "A" } as any, { id: "b", name: "B" } as any];
  const rows = [
    { from: "a", to: "b", label: "ally of", createdAt: "2026-07-20T21:00:00.000Z", sessionId: "s2", author: "Late", authorUserId: "u-late" },
    { from: "b", to: "a", label: "ally of", createdAt: "2026-07-18T19:00:00.000Z", sessionId: "s1", author: "First", authorUserId: "u-first" },
  ];
  const fwd = deriveRelations(shell({ people, connections: rows }));
  const rev = deriveRelations(shell({ people, connections: rows.slice().reverse() }));
  check("still collapses to one edge", fwd.length === 1 && rev.length === 1, [fwd, rev]);
  check("reports the earliest draw time", fwd[0]?.createdAt === "2026-07-18T19:00:00.000Z", fwd[0]);
  check("...whichever order the rows arrive in", rev[0]?.createdAt === "2026-07-18T19:00:00.000Z", rev[0]);
  // Provenance must move as a unit: showing the earliest timestamp beside the
  // *other* row's author would attribute the string to the wrong person.
  check("...carrying that row's session and author, not the other's",
    fwd[0]?.sessionId === "s1" && fwd[0]?.author === "First", fwd[0]);
  check("...consistently in both orders",
    rev[0]?.sessionId === "s1" && rev[0]?.author === "First", rev[0]);
  // The byline is two columns since 0042, and they must fold together. A name
  // taken from one row of the pair and a uuid from the other resolves — through
  // authorName's live lookup — to a THIRD person, which is worse than either
  // row's answer and impossible to spot by reading the output.
  check("...and the uuid folds with the name it belongs to",
    fwd[0]?.authorUserId === "u-first" && rev[0]?.authorUserId === "u-first", [fwd[0], rev[0]]);
}

console.log("\nunstamped rows (the pre-0031 back-catalogue) don't poison the fold");
{
  // 0031 deliberately did NOT backfill created_at, so every string seeded by
  // 0011/0012 has none. "Unknown" is not earlier than a known time — it must
  // never displace one, in either row order.
  const people = [{ id: "a", name: "A" } as any, { id: "b", name: "B" } as any];
  const known = { from: "a", to: "b", label: "ally of", createdAt: "2026-07-18T19:00:00.000Z", author: "First", authorUserId: "u-first" };
  const bare = { from: "b", to: "a", label: "ally of" };
  const knownFirst = deriveRelations(shell({ people, connections: [known, bare] }));
  const bareFirst = deriveRelations(shell({ people, connections: [bare, known] }));
  check("a known timestamp survives an unstamped mirror", knownFirst[0]?.createdAt === "2026-07-18T19:00:00.000Z", knownFirst[0]);
  check("...and is adopted when the unstamped row came first", bareFirst[0]?.createdAt === "2026-07-18T19:00:00.000Z", bareFirst[0]);
  check("...bringing its whole byline with it",
    bareFirst[0]?.author === "First" && bareFirst[0]?.authorUserId === "u-first", bareFirst[0]);
  check("a wholly unstamped edge reports undefined, not a fabricated date",
    deriveRelations(shell({ people, connections: [bare] }))[0]?.createdAt === undefined);
}

console.log("\nFK edges have no provenance to show");
{
  // addFk pushes into the same array, so the fields must stay optional: an FK
  // edge is derived from a column and was never "drawn" by anyone.
  const e = deriveRelations(shell({
    people: [{ id: "p1", name: "P", faction: "f1" } as any],
    factions: [{ id: "f1", name: "F" } as any],
  }))[0];
  check("an FK edge carries no createdAt, session or byline",
    e?.source === "fk" && e.createdAt === undefined && e.sessionId === undefined
    && e.author === undefined && e.authorUserId === undefined, e);
}

console.log("\nparallel labels stay independently deletable");
{
  const c = shell({
    people: [{ id: "a", name: "A" } as any, { id: "b", name: "B" } as any],
    connections: [
      { from: "a", to: "b", label: "ally of" },
      { from: "a", to: "b", label: "owes a debt to" },
    ],
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
    connections: [{ from: "p1", to: "f1", label: "shield of the guild" }],
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
    connections: [
      { from: "a", to: "a", label: "self" },
      { from: "", to: "a", label: "empty from" },
      { from: "a", to: "", label: "empty to" },
    ],
  });
  check("self-links and blank endpoints yield no edges", deriveRelations(c).length === 0);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
