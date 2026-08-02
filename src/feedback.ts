// ============================================================================
// Feedback board — the pure derivations behind src/feedbackPanel.tsx.
//
// The party reports bugs and asks for things from inside the codex (migration
// 0040) instead of from a GitHub account nobody has. Two tables back it: one
// row per report, one row per "me too". This module is everything about that
// pair that can be decided without React, Supabase, or a theme — so it is also
// everything scripts/feedback-check.ts can hold to account.
//
// THE PRIORITIZATION IS DELIBERATELY THIN, and that is a design decision worth
// stating because the obvious next step is to thicken it. This is a party of
// about five people who talk to each other every week. A vote here is one bit
// per person per item — no weights, no ranks, no downvotes, no per-item
// discussion. Voting exists to break ties the maintainer can't break by
// looking, not to be the decision procedure; with five voters a 3-2 split is
// noise, so the ORDER this module produces is a reading order, not a verdict.
//
// Two rules in `orderFeedback` are silent when wrong, which is why they're
// here and tested rather than inline in a JSX sort callback:
//
//   * **Settled items sink, whatever their votes.** The most-wanted idea in
//     the campaign is also the one most likely to get built first, and if
//     votes alone decided the order it would then sit at the top of the board
//     forever wearing a "done" chip — burying every live item under the
//     history of the ones already handled. Status outranks votes.
//   * **A tie falls back to newest, then to id.** Most items have zero votes,
//     so ties are the common case, not the edge case: without a total order
//     the board reshuffles between refetches (Array.sort is stable, so it
//     would render in whatever order the two tables came back in). This is the
//     same trap the Bestiary hit when 454 monsters shared an updated_at.
//
// `voters` is a set-by-contract even though it arrives as an array: the PK on
// feedback_votes makes duplicates impossible in the database, but the fold
// below merges two independently-fetched arrays and a refetch race must not be
// able to show a count of 2 for one person's vote.
// ============================================================================

import type { FeedbackItem, FeedbackStatus, FeedbackVote } from "./data";

// Settled means "the maintainer has answered this" — done or declined. Both
// sink; neither is deleted, because the answer is the useful part. An `open`
// item nobody has looked at and a `planned` item both still want attention, so
// they share the live tier rather than being ranked against each other: with
// this few items the distinction is visible in the chip and doesn't need to be
// spent on sort position too.
const SETTLED: ReadonlySet<FeedbackStatus> = new Set<FeedbackStatus>(["done", "wontfix"]);

export function isSettled(status: FeedbackStatus): boolean {
  return SETTLED.has(status);
}

// Voice-neutral by necessity — a pure module can't reach ThemedLabel, so these
// have to read acceptably in both registers (parchment ceremony and Atlas
// function). They're status facts, which is the one category where both
// voices agree anyway.
export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ["open", "planned", "done", "wontfix"];

export function statusLabel(status: FeedbackStatus): string {
  switch (status) {
    case "open": return "Open";
    case "planned": return "Planned";
    case "done": return "Done";
    case "wontfix": return "Won't do";
  }
}

export function voteCount(item: FeedbackItem): number {
  return item.voters.length;
}

// Guarded on a missing viewer id, which is the whole reason this isn't an
// inline `includes`. Anonymous viewers can read the board but never hold a
// vote, and `voters.includes(undefined)` on an array typed as string[] is a
// type error away from being an `any` that answers "yes" for everybody.
export function hasVoted(item: FeedbackItem, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return item.voters.includes(userId);
}

// Fold the two fetched tables into one array. Reports with no votes keep an
// empty `voters` — absence, not a missing field, so every consumer can count
// without a null check.
//
// Votes whose feedback_id matches no report are DROPPED rather than collected
// into an orphan bucket: `on delete cascade` means the only way to see one is
// a refetch that read the votes table after a delete and the reports table
// before it, so the report is genuinely gone and the vote is about to be.
export function foldFeedbackVotes(items: Omit<FeedbackItem, "voters">[], votes: FeedbackVote[]): FeedbackItem[] {
  const byId = new Map<number, Set<string>>();
  for (const item of items) byId.set(item.id, new Set());
  for (const v of votes) byId.get(v.feedbackId)?.add(v.userId);
  return items.map((item) => ({ ...item, voters: [...(byId.get(item.id) ?? new Set<string>())] }));
}

// The board's reading order. See the header for why status outranks votes and
// why the tiebreak chain has to bottom out in something unique.
export function orderFeedback(items: FeedbackItem[]): FeedbackItem[] {
  return items.slice().sort((a, b) => {
    const settled = Number(isSettled(a.status)) - Number(isSettled(b.status));
    if (settled !== 0) return settled;
    const votes = voteCount(b) - voteCount(a);
    if (votes !== 0) return votes;
    // Newest first. String compare is correct for the ISO timestamps Postgres
    // returns and avoids minting Date objects inside a comparator.
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    // Total order. bigserial ids ascend with insertion, so this agrees with
    // "newest first" rather than fighting it.
    return b.id - a.id;
  });
}

// What the sidebar badge counts: work outstanding, so settled items don't
// leave a number sitting there forever. Zero is rendered as no badge by the
// caller — the same "empty means absence" reading the draft store uses.
export function openFeedbackCount(items: FeedbackItem[]): number {
  return items.filter((i) => !isSettled(i.status)).length;
}
