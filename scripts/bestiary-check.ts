// Bestiary harness: exercises the pure derivations in src/monsters.ts.
//
// Two of them are load-bearing in a way the call sites hide:
//
//   * crToThreat is the ONLY spelling of the CR→band table, and it has two
//     consumers that must never disagree — the detail sheet, which rewrites
//     `threat` when someone edits `cr`, and scripts/generate-foi-bestiary.ts,
//     which stamps the band into migration 0034 for 456 creatures. A band shift
//     of one CR would be invisible in both: the plate still shows *a* badge and
//     the migration still applies. The boundary cases below are written from the
//     table as specified (0-2 / 3-7 / 8-16 / 17+), not from what the code
//     returns — a fixture copied from the implementation would agree with a bug
//     the way saga-check.ts once did (see CLAUDE.md).
//   * parseCr guards a free-text field whose value gets written straight to a
//     numeric column. It must reject rather than coerce: "1/3" is not a 5e
//     rating, and Number("1/3") is NaN, which would land as null and silently
//     clear the CR the DM was trying to correct.
//
// inkedMonsters is covered too, because "the plate is inked" is derived from an
// append-only feed the import now writes 456 rows into: it has to take the
// EARLIEST reveal (the "First met" stamp is a claim about history) and ignore
// reveals belonging to other kinds.
//
// Usage: npx tsx scripts/bestiary-check.ts   (exits non-zero on any failure)
import { crToThreat, crLabel, parseCr, inkedMonsters, creatureTypes } from "../src/monsters";
import type { Campaign, Monster, SessionEvent } from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

console.log("\ncrToThreat: every band boundary, from the specified table");
{
  const cases: Array<[number | undefined | null, string | undefined]> = [
    // 0-2 harmless. CR 0 is a real rating (Crawling Claw, Stomping Foot).
    [0, "harmless"], [0.125, "harmless"], [0.25, "harmless"], [0.5, "harmless"],
    [1, "harmless"], [2, "harmless"],
    // 3-7 risky
    [3, "risky"], [5, "risky"], [7, "risky"],
    // 8-16 deadly
    [8, "deadly"], [12, "deadly"], [16, "deadly"],
    // 17+ legendary, with no upper band
    [17, "legendary"], [21, "legendary"], [23, "legendary"], [30, "legendary"],
  ];
  for (const [cr, want] of cases) {
    check(`CR ${cr} → ${want}`, crToThreat(cr) === want, crToThreat(cr));
  }
  // The one that matters most: unrated must not read as the weakest band.
  check("undefined → undefined (unrated is not harmless)", crToThreat(undefined) === undefined);
  check("null → undefined", crToThreat(null) === undefined);
  check("NaN → undefined", crToThreat(NaN) === undefined);
}

console.log("\ncrLabel: the fractions 5e actually writes");
{
  check("0.125 → 1/8", crLabel(0.125) === "1/8");
  check("0.25 → 1/4", crLabel(0.25) === "1/4");
  check("0.5 → 1/2", crLabel(0.5) === "1/2");
  check("0.75 → 3/4", crLabel(0.75) === "3/4");
  check("0 → 0 (a rating, not blank)", crLabel(0) === "0");
  check("1 → 1", crLabel(1) === "1");
  check("21 → 21", crLabel(21) === "21");
  check("undefined → undefined (so callers can render an em dash)", crLabel(undefined) === undefined);
}

console.log("\nparseCr: accepts what crLabel prints, rejects the rest");
{
  for (const cr of [0, 0.125, 0.25, 0.5, 0.75, 1, 5, 16, 21, 30]) {
    check(`round-trips CR ${cr}`, parseCr(crLabel(cr)!) === cr, parseCr(crLabel(cr)!));
  }
  check("'CR 5' → 5 (the prefix people type)", parseCr("CR 5") === 5);
  check("' 1/2 ' → 0.5 (surrounding space)", parseCr(" 1/2 ") === 0.5);
  check("'' → null (blank clears, it doesn't parse)", parseCr("") === null);
  check("'   ' → null", parseCr("   ") === null);
  check("'abc' → null", parseCr("abc") === null);
  check("'1/3' → null (not a 5e rating — reject, don't round)", parseCr("1/3") === null);
  check("'-1' → null", parseCr("-1") === null);
  check("'99' → null (beyond the column's CHECK)", parseCr("99") === null);
  check("'5 sessions' → null (no partial parse)", parseCr("5 sessions") === null);
}

console.log("\ninkedMonsters: the first reveal wins, and only monsters count");
{
  const monsters = [{ id: "m1", name: "Harpy" }, { id: "m2", name: "Wyvern" }] as Monster[];
  const ev = (over: Partial<SessionEvent>): SessionEvent =>
    ({ id: 0, type: "reveal", createdAt: "2026-01-01T00:00:00Z", ...over } as SessionEvent);
  const campaign = {
    monsters,
    // Feed order IS chronological order — campaignContext sorts by (createdAt,
    // id) before this ever runs, which is why the derivation may trust position.
    sessionEvents: [
      ev({ id: 1, sessionId: "s2", entityId: "m1" }),
      ev({ id: 2, sessionId: "s5", entityId: "p9" }),          // a person, not a plate
      ev({ id: 3, sessionId: "s46", entityId: "m1" }),          // re-reveal, later session
      ev({ id: 4, sessionId: "s7", entityId: "m9" }),           // unknown id (deleted monster)
      ev({ id: 5, type: "note", sessionId: "s3", entityId: "m2" }), // not a reveal
    ],
  } as Campaign;
  const met = inkedMonsters(campaign);
  check("the monster with a reveal is inked", met.has("m1"));
  check("...stamped with its FIRST session, not the latest", met.get("m1")?.firstSessionId === "s2");
  check("a monster with only a note event stays un-inked", !met.has("m2"));
  check("reveals of other kinds are ignored", !met.has("p9"));
  check("a reveal for an unknown id doesn't invent a plate", !met.has("m9"));
  check("map size is the number of met monsters", met.size === 1, met.size);
}

console.log("\ncreatureTypes: the facet the import leaves half-filled on purpose");
{
  const types = creatureTypes([
    { id: "1", name: "A", kind: "Undead" },
    { id: "2", name: "B", kind: "undead" },   // same type, other casing
    { id: "3", name: "C", kind: "  fiend  " },
    { id: "4", name: "D" },                    // no kind — the heuristic gave up
    { id: "5", name: "E", kind: "" },
  ] as Monster[]);
  check("case-insensitive dedupe keeps first-seen casing", types.some((t) => t.label === "Undead"));
  check("whitespace is trimmed", types.some((t) => t.value === "fiend"));
  check("blank and missing kinds add no facet", types.length === 2, types);
  check("values are lowercased for matching", types.every((t) => t.value === t.value.toLowerCase()));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
