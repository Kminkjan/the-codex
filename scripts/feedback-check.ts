// Feedback-board harness: the pure derivations in src/feedback.ts, which decide
// what the party sees when they open the bug/idea board (migration 0040).
//
// Four rules, every one of them silent when wrong — a wrong order still renders
// a plausible board, and a wrong vote count still renders a number:
//
//   * **Settled items sink, whatever their votes.** The most-wanted idea is
//     also the one most likely to get built first, so votes-only ordering would
//     pin it to the top of the board forever wearing a "done" chip, burying the
//     live items beneath the history of the handled ones.
//   * **Ties have a total order.** Most reports have zero votes, so ties are
//     the common case rather than the edge case. Array.sort is stable, so a
//     comparator that returns 0 leaves the rows in whatever order the two
//     tables came back in — and they're refetched together on every event, so
//     the board would visibly reshuffle. This is the trap the Bestiary hit when
//     454 monsters shared an updated_at.
//   * **The fold is set-valued.** feedback_votes has a composite PK so the
//     database cannot hold a duplicate, but the fold merges two independently
//     fetched arrays and a refetch race must not be able to show 2 for one
//     person's vote. Reports with no votes must fold to an empty array, not to
//     a missing field, so every consumer can count without a null check.
//   * **A missing viewer never counts as a voter.** Anonymous viewers read the
//     board and hold no vote, so hasVoted must answer false for a null/undefined
//     id rather than matching some falsy entry.
//
// The fixtures are written from those rules as stated, not from what the code
// returns (see the saga-check.ts cautionary tale in CLAUDE.md).
//
// Usage: npx tsx scripts/feedback-check.ts   (exits non-zero on any failure)
import {
  FEEDBACK_STATUSES,
  foldFeedbackVotes,
  hasVoted,
  isSettled,
  openFeedbackCount,
  orderFeedback,
  routeHint,
  sanitizeRoute,
  statusLabel,
  voteCount,
} from "../src/feedback";
import type { FeedbackItem, FeedbackStatus, FeedbackVote } from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

// A report with everything defaulted, so each fixture states only the fields
// its rule is about.
const item = (over: Partial<FeedbackItem> & { id: number }): FeedbackItem => ({
  kind: "idea",
  text: `report ${over.id}`,
  author: "someone",
  status: "open",
  createdAt: "2026-08-01T12:00:00Z",
  voters: [],
  ...over,
});

const ids = (list: FeedbackItem[]) => list.map((i) => i.id);

console.log("\nstatus tiers: settled means answered, either way");
{
  check("open is not settled", !isSettled("open"));
  check("planned is not settled", !isSettled("planned"));
  // Both of these are answers. `wontfix` is as settled as `done` — the report
  // has been dealt with, and leaving a declined item in the live tier would
  // make it indistinguishable from one still awaiting a decision.
  check("done is settled", isSettled("done"));
  check("wontfix is settled", isSettled("wontfix"));
  check("every status in the catalogue has a label",
    FEEDBACK_STATUSES.every((s) => statusLabel(s).length > 0));
  check("the catalogue covers exactly the four DB-constrained values",
    FEEDBACK_STATUSES.length === 4
      && (["open", "planned", "done", "wontfix"] as FeedbackStatus[]).every((s) => FEEDBACK_STATUSES.includes(s)),
    FEEDBACK_STATUSES);
}

console.log("\nthe fold: votes become a set on their report");
{
  const reports = [item({ id: 1 }), item({ id: 2 })].map(({ voters: _v, ...rest }) => rest);
  const votes: FeedbackVote[] = [
    { feedbackId: 1, userId: "u-alice" },
    { feedbackId: 1, userId: "u-bob" },
    // The duplicate the database can't hold but two merged fetches can.
    { feedbackId: 1, userId: "u-alice" },
    // An orphan: its report is gone (cascade in flight), so it must be dropped
    // rather than crash the fold or invent a bucket.
    { feedbackId: 99, userId: "u-carol" },
  ];
  const folded = foldFeedbackVotes(reports, votes);
  const one = folded.find((f) => f.id === 1)!;
  const two = folded.find((f) => f.id === 2)!;
  check("every report survives the fold", folded.length === 2, folded.length);
  check("a duplicated vote counts once", voteCount(one) === 2, one.voters);
  check("both distinct voters are present",
    one.voters.includes("u-alice") && one.voters.includes("u-bob"), one.voters);
  check("an unvoted report folds to an empty array, not undefined",
    Array.isArray(two.voters) && two.voters.length === 0, two.voters);
  check("a vote for a missing report is dropped",
    !folded.some((f) => f.voters.includes("u-carol")), folded);
}

console.log("\nhasVoted: a missing viewer is never a voter");
{
  const voted = item({ id: 1, voters: ["u-alice", "u-bob"] });
  const unvoted = item({ id: 2 });
  check("a voter reads true", hasVoted(voted, "u-alice"));
  check("a non-voter reads false", !hasVoted(voted, "u-carol"));
  // The anonymous-viewer case. These must be false on a report WITH voters —
  // asserting them against an empty list would pass for the wrong reason.
  check("undefined viewer reads false", !hasVoted(voted, undefined));
  check("null viewer reads false", !hasVoted(voted, null));
  check("empty-string viewer reads false", !hasVoted(voted, ""));
  check("an unvoted report reads false for a real viewer", !hasVoted(unvoted, "u-alice"));
}

console.log("\norder: status outranks votes");
{
  // The rule's whole point: the settled item is the MOST voted one, so any
  // comparator that reaches votes first puts it on top.
  const board = [
    item({ id: 1, status: "done", voters: ["a", "b", "c", "d"] }),
    item({ id: 2, status: "open", voters: ["a"] }),
    item({ id: 3, status: "wontfix", voters: ["a", "b", "c"] }),
    item({ id: 4, status: "planned", voters: [] }),
  ];
  const out = orderFeedback(board);
  check("both live items come before both settled ones",
    ids(out).slice(0, 2).every((id) => id === 2 || id === 4), ids(out));
  check("the most-voted item does NOT lead the board just for being popular",
    out[0].id !== 1, ids(out));
  check("within the live tier votes still decide", ids(out).slice(0, 2).join() === "2,4", ids(out));
  // 1 has four votes to 3's three, so it leads WITHIN the settled tier while
  // still sitting below both live items — which is the rule stated twice over.
  check("within the settled tier votes still decide", ids(out).slice(2).join() === "1,3", ids(out));
  // open and planned deliberately share the live tier — the distinction shows
  // in the chip, and spending sort position on it too would demote a popular
  // untouched report beneath a planned one nobody asked for.
  check("planned does not outrank open by status alone",
    ids(orderFeedback([item({ id: 5, status: "planned" }), item({ id: 6, status: "open", voters: ["a"] })]))
      .join() === "6,5");
}

console.log("\norder: votes, then recency, then id — a total order");
{
  const board = [
    item({ id: 1, voters: ["a"] }),
    item({ id: 2, voters: ["a", "b"] }),
    item({ id: 3, voters: [] }),
  ];
  check("more votes first", ids(orderFeedback(board)).join() === "2,1,3", ids(orderFeedback(board)));
}
{
  // Equal votes → newest first.
  const board = [
    item({ id: 1, createdAt: "2026-07-01T00:00:00Z" }),
    item({ id: 2, createdAt: "2026-08-01T00:00:00Z" }),
    item({ id: 3, createdAt: "2026-06-01T00:00:00Z" }),
  ];
  check("equal votes fall back to newest first",
    ids(orderFeedback(board)).join() === "2,1,3", ids(orderFeedback(board)));
}
{
  // Equal votes AND an identical timestamp — the case a bulk insert produces
  // and the one a stable sort cannot resolve on its own. Asserted from BOTH
  // input orders, because agreeing with only one is exactly the bug: a stable
  // sort passes the first while leaving the board free to reshuffle.
  const same = "2026-08-01T09:00:00Z";
  const a = item({ id: 10, createdAt: same });
  const b = item({ id: 11, createdAt: same });
  const c = item({ id: 12, createdAt: same });
  const forward = ids(orderFeedback([a, b, c])).join();
  const reversed = ids(orderFeedback([c, b, a])).join();
  check("identical timestamps break by id, descending", forward === "12,11,10", forward);
  check("and the order is independent of the input order", forward === reversed,
    `${forward} vs ${reversed}`);
}
{
  // The comparator must not mutate or drop rows — the panel renders straight
  // off this array, and `.slice()` inside orderFeedback is what keeps the
  // campaign state it was handed intact.
  const board = [item({ id: 1, voters: ["a"] }), item({ id: 2 })];
  const before = ids(board).join();
  const out = orderFeedback(board);
  check("the input array is left alone", ids(board).join() === before, ids(board));
  check("nothing is dropped", out.length === board.length, out.length);
  check("an empty board orders to an empty board", orderFeedback([]).length === 0);
}

console.log("\nsanitizeRoute: a hidden entity's id never reaches an open column");
{
  const HIDDEN = "hidden-npc";
  const hides = (id: string) => id === HIDDEN;
  const board = "#/c/camp-1";
  const visible = `${board}/e/alaric`;
  const hidden = `${board}/e/${HIDDEN}`;

  // The rule this exists for. `feedback` is world-readable, and the DM is both
  // the likeliest bug reporter and the likeliest person to have unreleased prep
  // open while reporting — so the entity segment has to go, keeping the page.
  check("a hidden entity's segment is dropped", sanitizeRoute(hidden, hides) === board,
    sanitizeRoute(hidden, hides));
  check("the campaign-level route survives that drop",
    sanitizeRoute(hidden, hides)?.startsWith("#/c/camp-1") === true);
  check("a visible entity's route is kept whole", sanitizeRoute(visible, hides) === visible,
    sanitizeRoute(visible, hides));
  check("a plain board route is untouched", sanitizeRoute(board, hides) === board);

  // Percent-encoded ids: writeCampaignHash encodes them, so testing the RAW
  // segment would fail to recognise any id needing escaping and would wave the
  // hidden entity straight through. Asserted with an id that actually encodes.
  const spacey = "hidden npc//2";
  const encoded = `${board}/e/${encodeURIComponent(spacey)}`;
  check("a hidden id is recognised through percent-encoding",
    sanitizeRoute(encoded, (id) => id === spacey) === board, sanitizeRoute(encoded, (id) => id === spacey));

  // Malformed encoding must not throw — parseHash has the same guard, and an
  // unparseable id can't match a real entity, so "not hidden" is the safe read.
  let threw = false;
  let malformed: string | undefined;
  try { malformed = sanitizeRoute(`${board}/e/abc%`, hides); } catch { threw = true; }
  check("malformed percent-encoding doesn't throw", !threw);
  check("and falls through with the route intact", malformed === `${board}/e/abc%`, malformed);

  // Deletion is NOT a secret: refusing to record a route because the entity has
  // since been struck would lose exactly the context a delete-bug report needs.
  check("an unknown id is not treated as hidden",
    sanitizeRoute(`${board}/e/ghost`, hides) === `${board}/e/ghost`);

  // Empty means absence, matching the mutation's "" → null mapping.
  check("an empty hash reads as absence", sanitizeRoute("", hides) === undefined,
    sanitizeRoute("", hides));
}

console.log("\nrouteHint: a recognition hint, never navigation");
{
  check("an entity route is truncated, not resolved",
    routeHint("#/c/camp-1/e/3f2a1b8c-dead-beef-cafe-000000000000") === "entity 3f2a1b8c…",
    routeHint("#/c/camp-1/e/3f2a1b8c-dead-beef-cafe-000000000000"));
  // The bare campaign route IS the board — an empty string here would render a
  // dangling separator in the meta row.
  check("a bare campaign route names the board", routeHint("#/c/camp-1") === "the board",
    routeHint("#/c/camp-1"));
  check("a trailing slash also names the board", routeHint("#/c/camp-1/") === "the board");
}

console.log("\nthe badge counts outstanding work only");
{
  const board = [
    item({ id: 1, status: "open" }),
    item({ id: 2, status: "planned" }),
    item({ id: 3, status: "done" }),
    item({ id: 4, status: "wontfix" }),
  ];
  check("open + planned are counted", openFeedbackCount(board) === 2, openFeedbackCount(board));
  // Zero is what the sidebar renders as no badge at all — "empty means absence",
  // the same reading the draft store uses. A count that included settled rows
  // would leave a number parked there permanently.
  check("a fully settled board counts zero",
    openFeedbackCount(board.filter((i) => isSettled(i.status))) === 0);
  check("an empty board counts zero", openFeedbackCount([]) === 0);
}

console.log(failures === 0 ? "\nAll feedback checks passed.\n" : `\n${failures} failure(s).\n`);
process.exit(failures === 0 ? 0 : 1);
