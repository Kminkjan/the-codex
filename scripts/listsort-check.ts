// List-ordering harness: the pure derivations in src/listSort.ts, which decide
// what the overview pages' sort control offers and what each choice does — plus
// src/chronicle.ts at the bottom, the Events page's own order/grouping pair
// (it sorts by order_num, not updatedAt, so it can't use the catalogue above).
//
// Three things here are load-bearing and silent when wrong — a list still
// renders, just in the wrong order, which nobody files a bug about:
//
//   * **Unknown sorts last, in every direction.** The natural implementation
//     gets "least recently touched" backwards: a missing updatedAt parses to 0,
//     and ascending-by-time puts every unstamped row at the TOP of the page the
//     user opened to find their most neglected entries. Same shape for an
//     unrated CR and an un-inked plate.
//   * **Pinned/archived precedence holds in every order, not just "default".**
//     This is the behaviour that changed when the Bestiary's local re-sorts
//     moved here, so it's asserted rather than assumed.
//   * **The option catalogue must not offer two spellings of one order.** For
//     locations/factions/items/lore, sortForDisplay's own order IS updatedAt
//     order — offering "most recently touched" alongside the default would be
//     two options producing an identical list.
//
// The fixtures below are written from those rules as stated, not from what the
// code returns (see the saga-check.ts cautionary tale in CLAUDE.md).
//
// Usage: npx tsx scripts/listsort-check.ts   (exits non-zero on any failure)
import { applyListSort, isSortKey, sortOptionsFor, type SortKey } from "../src/listSort";
import { groupByDate, isChronicleOrder, sortEvents } from "../src/chronicle";
import type { CampaignEvent, KindKey } from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

type Row = {
  id: string;
  name?: string;
  title?: string;
  updatedAt?: string;
  archived?: boolean;
  pinned?: boolean;
  cr?: number;
  status?: string;
  lastSeen?: string;
};

const ids = (rows: Row[]) => rows.map((r) => r.id).join(",");
const eids = (rows: CampaignEvent[]) => rows.map((r) => r.id).join(",");
const at = (iso: string) => `${iso}T00:00:00Z`;

console.log("\nsortOptionsFor: no kind offers two spellings of the same order");
{
  for (const kind of ["locations", "factions", "items", "lore"] as KindKey[]) {
    const opts = sortOptionsFor(kind);
    // Their default already IS updatedAt-descending, so a separate "recent"
    // option would produce a byte-identical list.
    check(`${kind}: no separate "recent" beside the updatedAt default`,
      !opts.some((o) => o.value === "recent"), opts.map((o) => o.value));
    check(`${kind}: default is labelled for what it does`,
      opts[0].value === "default" && opts[0].label === "most recently touched", opts[0]);
  }
  // Where the default is NOT updatedAt order, plain recency has to be reachable.
  for (const kind of ["people", "quests", "goals"] as KindKey[]) {
    const opts = sortOptionsFor(kind);
    check(`${kind}: offers "recent" because its default is something else`,
      opts.some((o) => o.value === "recent"), opts.map((o) => o.value));
  }
  check("people: default is labelled 'recently seen', not 'most recently touched'",
    sortOptionsFor("people")[0].label === "recently seen", sortOptionsFor("people")[0]);
  check("quests: default is labelled 'by status'",
    sortOptionsFor("quests")[0].label === "by status", sortOptionsFor("quests")[0]);
  check("monsters: cr and met are offered", (() => {
    const v = sortOptionsFor("monsters").map((o) => o.value);
    return v.includes("cr") && v.includes("met");
  })());
  check("people: cr and met are NOT offered", (() => {
    const v = sortOptionsFor("people").map((o) => o.value);
    return !v.includes("cr") && !v.includes("met");
  })());
  // Every kind must offer a way back, or a stuck sort has no escape hatch.
  for (const kind of ["people", "locations", "quests", "goals", "factions", "items", "lore", "monsters"] as KindKey[]) {
    check(`${kind}: "default" is present and first`, sortOptionsFor(kind)[0]?.value === "default");
  }
}

console.log("\nisSortKey: the gate on anything restored from localStorage");
{
  check("accepts a key the kind offers", isSortKey("monsters", "cr"));
  // The cross-kind case is the real one: the store is keyed by kind, so a
  // renamed page or a hand-edited value can hand people a monsters-only key.
  check("rejects a key another kind offers ('cr' on people)", !isSortKey("people", "cr"));
  check("rejects a retired/renamed key", !isSortKey("people", "by-name"));
  check("rejects null (nothing stored)", !isSortKey("people", null));
  check("rejects a non-string", !isSortKey("people", 3));
  check("accepts 'default'", isSortKey("lore", "default"));
}

console.log("\napplyListSort: unknown values sort LAST, never first");
{
  const rows: Row[] = [
    { id: "no-stamp", name: "B" },                      // never recorded
    { id: "old", name: "A", updatedAt: at("2024-01-01") },
    { id: "new", name: "C", updatedAt: at("2026-01-01") },
  ];
  check("oldest: real timestamps ascend, unstamped row last",
    ids(applyListSort(rows, "oldest", { kind: "lore" })) === "old,new,no-stamp",
    ids(applyListSort(rows, "oldest", { kind: "lore" })));
  check("recent: newest first, unstamped row last",
    ids(applyListSort(rows, "recent", { kind: "people" })) === "new,old,no-stamp",
    ids(applyListSort(rows, "recent", { kind: "people" })));

  const beasts: Row[] = [
    { id: "unrated", name: "Swarm" },
    { id: "cr1", name: "Goblin", cr: 1 },
    { id: "cr20", name: "Tarrasque", cr: 20 },
    { id: "cr0", name: "Claw", cr: 0 },   // CR 0 is a real rating, not "unrated"
  ];
  check("cr: worst first, CR 0 outranks unrated",
    ids(applyListSort(beasts, "cr", { kind: "monsters" })) === "cr20,cr1,cr0,unrated",
    ids(applyListSort(beasts, "cr", { kind: "monsters" })));

  const plates: Row[] = [
    { id: "never", name: "A" },
    { id: "s09", name: "B" },
    { id: "s02", name: "C" },
  ];
  const firstMetNum = (id: string) => ({ s09: 9, s02: 2 } as Record<string, number>)[id] ?? Infinity;
  check("met: earliest encounter first, un-inked plates last",
    ids(applyListSort(plates, "met", { kind: "monsters", firstMetNum })) === "s02,s09,never",
    ids(applyListSort(plates, "met", { kind: "monsters", firstMetNum })));

  // TWO un-inked plates, not one — the single-un-inked fixture above can never
  // form the pair that matters. Un-inked resolves to Infinity, so subtracting
  // gives NaN, and a NaN escaping the comparator makes Array.sort treat the
  // pair as equal and skip the updatedAt tiebreaker. The imported bestiary is
  // overwhelmingly un-inked, so that tail is the bulk of the wall, not a
  // corner. Expected: the one inked plate leads, then the rest newest-first.
  const mostlyUninked: Row[] = [
    { id: "uninked-oldest", name: "A", updatedAt: at("2024-01-01") },
    { id: "inked-s02", name: "B", updatedAt: at("2019-01-01") },
    { id: "uninked-newest", name: "C", updatedAt: at("2026-01-01") },
    { id: "uninked-mid", name: "D", updatedAt: at("2025-01-01") },
  ];
  const sparseMet = (id: string) => (id === "inked-s02" ? 2 : Infinity);
  check("met: the un-inked tail still falls through to the updatedAt tiebreaker",
    ids(applyListSort(mostlyUninked, "met", { kind: "monsters", firstMetNum: sparseMet }))
      === "inked-s02,uninked-newest,uninked-mid,uninked-oldest",
    ids(applyListSort(mostlyUninked, "met", { kind: "monsters", firstMetNum: sparseMet })));
  // Nothing inked at all — every pair is Infinity/Infinity, so if the
  // comparator can produce a NaN this ordering collapses to input order.
  check("met: an entirely un-inked wall still orders by updatedAt",
    ids(applyListSort(mostlyUninked, "met", { kind: "monsters", firstMetNum: () => Infinity }))
      === "uninked-newest,uninked-mid,uninked-oldest,inked-s02",
    ids(applyListSort(mostlyUninked, "met", { kind: "monsters", firstMetNum: () => Infinity })));
}

console.log("\napplyListSort: pinned/archived precedence holds in EVERY order");
{
  const rows: Row[] = [
    { id: "z-pinned", name: "Zorath", pinned: true, updatedAt: at("2020-01-01") },
    { id: "a-plain", name: "Aara", updatedAt: at("2026-01-01") },
    { id: "b-archived", name: "Baruk", archived: true, updatedAt: at("2026-06-01") },
    { id: "a-archived-pinned", name: "Aatos", archived: true, pinned: true },
    { id: "c-plain", name: "Corvin", updatedAt: at("2025-01-01") },
  ];
  for (const key of ["name", "recent", "oldest"] as SortKey[]) {
    const out = applyListSort(rows, key, { kind: "locations" });
    // Pinned beats archived in sortForDisplay too — a pinned archived row rides
    // at the top, which is the existing precedence, kept.
    check(`${key}: pinned rows lead`, out[0].pinned === true && out[1].pinned === true, ids(out));
    check(`${key}: archived sinks inside the pinned rank`,
      out[0].id === "z-pinned" && out[1].id === "a-archived-pinned", ids(out));
    check(`${key}: the unarchived plain row precedes the archived one`,
      out.findIndex((r) => r.id === "a-plain") < out.findIndex((r) => r.id === "b-archived"), ids(out));
  }
  // The full precedence, spelled out: pinned-and-live, pinned-but-archived,
  // live, archived — and only THEN A–Z. "Aatos" losing to "Zorath" is the
  // point: archived sinks inside the pinned rank before names are compared, so
  // a pinned-but-archived row can't jump a pinned live one on the strength of
  // its initial. A–Z applies within a rank, which is what a-plain/c-plain show.
  check("name: rank first (pinned → archived), A–Z within the rank",
    ids(applyListSort(rows, "name", { kind: "locations" })) === "z-pinned,a-archived-pinned,a-plain,c-plain,b-archived",
    ids(applyListSort(rows, "name", { kind: "locations" })));
}

console.log("\napplyListSort: 'default' still means sortForDisplay's kind-aware order");
{
  // Quests order by status regardless of stamp — the whole reason the label
  // says "by status" instead of "most recently touched".
  const quests: Row[] = [
    { id: "lost", title: "L", status: "lost", updatedAt: at("2026-06-01") },
    { id: "pursuing", title: "P", status: "pursuing", updatedAt: at("2020-01-01") },
    { id: "resolved", title: "R", status: "resolved", updatedAt: at("2026-06-02") },
    { id: "whispered", title: "W", status: "whispered", updatedAt: at("2019-01-01") },
  ];
  check("quests default: pursuing → whispered → resolved → lost",
    ids(applyListSort(quests, "default", { kind: "quests" })) === "pursuing,whispered,resolved,lost",
    ids(applyListSort(quests, "default", { kind: "quests" })));
  // ...and picking "recent" must actually escape that ordering, or the option
  // is decorative.
  check("quests 'recent' overrides the status ordering",
    ids(applyListSort(quests, "recent", { kind: "quests" })) === "resolved,lost,pursuing,whispered",
    ids(applyListSort(quests, "recent", { kind: "quests" })));

  const people: Row[] = [
    { id: "seen-late", name: "A", lastSeen: "s7" },
    { id: "seen-early", name: "B", lastSeen: "s1" },
    { id: "never-seen", name: "C" },
  ];
  const sessionNum = (id: string) => ({ s7: 7, s1: 1 } as Record<string, number>)[id] ?? 0;
  check("people default: most recently seen first, never-seen last",
    ids(applyListSort(people, "default", { kind: "people", sessionNum })) === "seen-late,seen-early,never-seen",
    ids(applyListSort(people, "default", { kind: "people", sessionNum })));
}

console.log("\napplyListSort: does not mutate its input");
{
  const rows: Row[] = [
    { id: "b", name: "B", updatedAt: at("2020-01-01") },
    { id: "a", name: "A", updatedAt: at("2026-01-01") },
  ];
  const before = ids(rows);
  applyListSort(rows, "name", { kind: "items" });
  applyListSort(rows, "default", { kind: "items" });
  check("caller's array is untouched", ids(rows) === before, ids(rows));
}

// --- src/chronicle.ts ------------------------------------------------------
// The Events page orders by order_num rather than updatedAt, so it can't ride
// on the catalogue above — but it's the same job and the same failure mode (a
// page renders, just backwards), so it's asserted here rather than in a tenth
// harness. The rule that needs guarding is the interaction: ordering happens
// BEFORE grouping, so newest-first must reverse the date bands *and* their
// contents. Bands reversed with ascending contents is the incoherent state.

console.log("\nchronicle: sortEvents");
{
  const ev = (id: string, orderNum: number, inGameDate?: string, title = id) =>
    ({ id, title, orderNum, inGameDate });
  const events = [ev("e2", 2, "Midwinter"), ev("e1", 1, "Highharvest"), ev("e3", 3, "Midwinter")];

  check("default is newest first",
    eids(sortEvents(events, "default")) === "e3,e2,e1", eids(sortEvents(events, "default")));
  check("oldest reads forward",
    eids(sortEvents(events, "oldest")) === "e1,e2,e3", eids(sortEvents(events, "oldest")));
  const before = eids(events);
  sortEvents(events, "default");
  check("caller's array is untouched", eids(events) === before, eids(events));

  // Not .reverse() of the ascending sort: the title tiebreak must read A→Z in
  // both directions, or events sharing an orderNum swap for no visible reason.
  const tied = [ev("beta", 4, undefined, "Beta"), ev("alpha", 4, undefined, "Alpha")];
  check("title tiebreak stays A→Z ascending", eids(sortEvents(tied, "oldest")) === "alpha,beta");
  check("title tiebreak stays A→Z descending", eids(sortEvents(tied, "default")) === "alpha,beta",
    eids(sortEvents(tied, "default")));

  check("isChronicleOrder accepts the two keys",
    isChronicleOrder("default") && isChronicleOrder("oldest"));
  check("isChronicleOrder rejects a stale/foreign key",
    !isChronicleOrder("recent") && !isChronicleOrder("") && !isChronicleOrder(undefined));
}

console.log("\nchronicle: groupByDate");
{
  const ev = (id: string, orderNum: number, inGameDate?: string) =>
    ({ id, title: id, orderNum, inGameDate });
  // "Midwinter" recurs at both ends of the chronicle with another date between:
  // a date-keyed group map would merge those two into one band and silently
  // pull e1 and e4 out of chronological order.
  const events = [
    ev("e1", 1, "Midwinter"), ev("e2", 2, "Greengrass"),
    ev("e3", 3, "Greengrass"), ev("e4", 4, "Midwinter"),
    ev("e5", 5),
  ];

  const asc = groupByDate(sortEvents(events, "oldest"));
  check("only consecutive same-date events merge", asc.length === 4, asc.map((g) => g.date));
  check("recurring date does not merge across a gap",
    asc[0].events.length === 1 && asc[3] !== undefined && asc[2].events.map((e) => e.id).join() === "e4");
  check("missing in-game date bands as Undated", asc[3].date === "Undated");
  check("blank/whitespace date also bands as Undated",
    groupByDate([ev("x", 1, "   ")])[0].date === "Undated");

  const desc = groupByDate(sortEvents(events, "default"));
  check("newest-first reverses the bands",
    desc.map((g) => g.date).join("|") === "Undated|Midwinter|Greengrass|Midwinter",
    desc.map((g) => g.date));
  check("newest-first ALSO reverses inside a band",
    desc.map((g) => g.events.map((e) => e.id).join()).join("|") === "e5|e4|e3,e2|e1",
    desc.map((g) => g.events.map((e) => e.id).join()));
  check("no event is lost or duplicated by grouping",
    desc.flatMap((g) => g.events).length === events.length);
}

console.log(failures === 0 ? "\nAll list-sort checks passed.\n" : `\n${failures} FAILURE(S).\n`);
process.exit(failures === 0 ? 0 : 1);
