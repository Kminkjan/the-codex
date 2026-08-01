// List-ordering harness: the pure derivations in src/listSort.ts, which decide
// what the overview pages' sort control offers and what each choice does.
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
import type { KindKey } from "../src/data";

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

console.log(failures === 0 ? "\nAll list-sort checks passed.\n" : `\n${failures} FAILURE(S).\n`);
process.exit(failures === 0 ? 0 : 1);
