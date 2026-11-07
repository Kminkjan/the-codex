// DM's-desk harness: the pure derivations in src/staging.ts — the staging
// queue's reading order, the queue/record split the desk folds on, and where
// the keyboard selection lands.
//
// Every rule here is silent when wrong, and the surface it is wrong on carries
// RELEASE and ⚡ SHOW NOW: one-way, public acts that unhide an entity, stamp the
// queue, land in the feed and take over every player's screen. A desk that
// reshuffles between refetches does not look broken — it looks like the DM
// misread a row.
//
//   * **Queued outranks released, in every order.** A released row is a record,
//     not work. The old desk sorted released rows to the bottom and this must
//     keep holding when the timestamps disagree with the bands.
//   * **Unknown stagedAt sorts LAST.** Null means "staged before migration
//     0045", never "just now" — the same contract as connections.createdAt
//     (0031). Sorted first, the entire seeded back-catalogue would march to the
//     head of the queue on the night 0045 ships, which is exactly the shape of
//     bug CLAUDE.md warns about under "a harness fixture can encode the bug".
//   * **The order is TOTAL.** session_staging is fetched with no .order(), and
//     right after 0045 every row's stagedAt is null — so without a unique final
//     tiebreak the desk would visibly reorder on every refetch. The tiebreak is
//     entityId, not the label: labels are neither unique nor stable (a rename
//     would reorder the desk under the DM's hand).
//   * **stepSelection tolerates a stale selection.** Rows leave the desk while
//     the DM is looking at it — an entity is deleted, a row is unstaged, the
//     record is collapsed. An id that is no longer visible must not strand the
//     arrow keys.
//
// The fixtures are written from those rules as stated, not from what the code
// returns (see the saga-check.ts cautionary tale in CLAUDE.md).
//
// Usage: npx tsx scripts/staging-check.ts   (exits non-zero on any failure)
import {
  compareStaged,
  orderStaged,
  splitStaged,
  stepSelection,
  type StagedItem,
} from "../src/staging";

let failures = 0;
function check(what: string, ok: boolean, got?: unknown) {
  if (ok) {
    console.log(`  ok   ${what}`);
  } else {
    failures++;
    console.log(`  FAIL ${what}${got === undefined ? "" : `  (got ${JSON.stringify(got)})`}`);
  }
}

const item = (
  entityId: string,
  label: string,
  stagedAt: string | null,
  releasedAt: string | null = null,
): StagedItem => ({ entityId, label, stagedAt, releasedAt });

const ids = (xs: readonly StagedItem[]) => xs.map((x) => x.entityId);

console.log("\nQueue before record");
{
  // The released row was staged FIRST and released long ago; the queued row was
  // staged later. Time says released-first, the band must still win.
  const done = item("a", "Adult Red Dragon", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z");
  const todo = item("b", "Bandit Captain", "2026-01-01T12:00:00Z");
  check("a released row sorts after a queued one even when staged earlier",
    ids(orderStaged([done, todo])), ids(orderStaged([done, todo])));
  check("  → queued first", ids(orderStaged([done, todo]))[0] === "b");
  check("the band wins in the reverse input order too",
    ids(orderStaged([todo, done]))[0] === "b");
  // A released row with NO stagedAt must still sort after a queued one with no
  // stagedAt — the null rule must not be able to overrule the band rule.
  const doneNull = item("c", "Cleric", null, "2026-01-01T11:00:00Z");
  const todoNull = item("d", "Drake", null);
  check("band outranks the unknown-stagedAt rule",
    ids(orderStaged([doneNull, todoNull])) + "" === "d,c",
    ids(orderStaged([doneNull, todoNull])));
}

console.log("\nQueued rows run in prep order, unknowns last");
{
  const rows = [
    item("third", "Animated Broom", "2026-03-01T21:10:00Z"),
    item("legacy", "Adult Oblex", null),
    item("first", "Captain of the Harbour Watch", "2026-03-01T20:00:00Z"),
    item("second", "Adult Red Dragon", "2026-03-01T20:30:00Z"),
  ];
  check("oldest staged first, null last",
    ids(orderStaged(rows)) + "" === "first,second,third,legacy", ids(orderStaged(rows)));
  // The alphabet must NOT be what orders these: "Adult Oblex" and "Adult Red
  // Dragon" would lead alphabetically, and clustering those lookalikes next to
  // each other is the bug 0045 exists to break up.
  check("prep order, not the alphabet, decides",
    ids(orderStaged(rows))[0] === "first", ids(orderStaged(rows))[0]);
  check("two nulls still order deterministically (by label, then id)",
    ids(orderStaged([item("z", "Zombie", null), item("a", "Aboleth", null)])) + "" === "a,z");
}

console.log("\nReleased rows run chronologically");
{
  const rows = [
    item("late", "Bandit Captain", "2026-03-01T20:00:00Z", "2026-03-01T23:30:00Z"),
    item("early", "Adult Red Dragon", "2026-03-01T21:00:00Z", "2026-03-01T21:05:00Z"),
  ];
  check("the record reads oldest reveal first",
    ids(orderStaged(rows)) + "" === "early,late", ids(orderStaged(rows)));
}

console.log("\nThe order is total and stable");
{
  // The common case right after 0045: every row null, several sharing a label.
  const same = [
    item("id-c", "Adult Red Dragon", null),
    item("id-a", "Adult Red Dragon", null),
    item("id-b", "Adult Red Dragon", null),
  ];
  check("identical labels and nulls still have one fixed order",
    ids(orderStaged(same)) + "" === "id-a,id-b,id-c", ids(orderStaged(same)));
  // Shuffling the input must not change the output — that is what "a refetch
  // cannot reshuffle the desk" means.
  const shuffled = [same[2], same[0], same[1]];
  check("a different fetch order yields the same desk",
    ids(orderStaged(shuffled)) + "" === ids(orderStaged(same)) + "");
  check("comparing a row with itself is 0", compareStaged(same[0], same[0]) === 0);
  check("the comparator is antisymmetric",
    compareStaged(same[0], same[1]) === -compareStaged(same[1], same[0]));
}

console.log("\nSplitting queue from record");
{
  const rows = [
    item("q2", "Broom", "2026-03-01T21:00:00Z"),
    item("r1", "Dragon", "2026-03-01T19:00:00Z", "2026-03-01T22:00:00Z"),
    item("q1", "Aboleth", "2026-03-01T20:00:00Z"),
  ];
  const { queued, released } = splitStaged(rows);
  check("queued holds only unreleased rows, in desk order",
    ids(queued) + "" === "q1,q2", ids(queued));
  check("released holds only released rows", ids(released) + "" === "r1", ids(released));
  check("nothing is lost or duplicated", queued.length + released.length === rows.length);
  const empty = splitStaged([]);
  check("an empty desk splits into two empty bands",
    empty.queued.length === 0 && empty.released.length === 0);
}

console.log("\nKeyboard selection survives a changing desk");
{
  const vis = [item("a", "A", null), item("b", "B", null), item("c", "C", null)];
  check("Down from nothing selects the first row", stepSelection(vis, null, 1) === "a");
  check("Up from nothing selects the last row", stepSelection(vis, null, -1) === "c");
  check("Down moves one row", stepSelection(vis, "a", 1) === "b");
  check("Up moves one row", stepSelection(vis, "b", -1) === "a");
  check("Down clamps at the end", stepSelection(vis, "c", 1) === "c");
  check("Up clamps at the start", stepSelection(vis, "a", -1) === "a");
  // The rule that matters: the selected row was deleted, unstaged, or hidden by
  // collapsing the record while the DM was looking at the desk.
  check("a selection that has left the desk does not strand Down",
    stepSelection(vis, "gone", 1) === "a", stepSelection(vis, "gone", 1));
  check("a selection that has left the desk does not strand Up",
    stepSelection(vis, "gone", -1) === "c", stepSelection(vis, "gone", -1));
  check("an empty desk has nowhere to step", stepSelection([], "a", 1) === null);
}

console.log(failures === 0 ? "\nAll staging-desk checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
