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

// ============================================================================
// The captured route
//
// A report stores the hash the reporter was looking at, which for an open sheet
// is `#/c/<cid>/e/<eid>`. `feedback` is world-readable, so THAT ID MUST NOT BE A
// HIDDEN ENTITY'S: the DM is the likeliest person to file a bug and the likeliest
// to be looking at unreleased prep while doing it, and a stored id would tell
// every player that a hidden thing exists and what its uuid is. What leaks is
// only an unresolvable uuid — RLS (0018) still withholds the row, its
// connections and its board pin — but `hidden` is this app's real secrecy tool
// and a surface that quietly writes hidden ids into an open column erodes it.
//
// So the entity segment is dropped when the entity is hidden, keeping the
// campaign-level route. Hidden-ness is the CALLER's judgment, exactly as it is
// for insertPartyNote's `announce` and insertConnection's visibility check: a
// pure module can't resolve an id, and this one deliberately doesn't try.
//
// Note what this does NOT do: it never drops the segment for a merely deleted
// or unknown id. "The entity is gone" is not a secret, and refusing to record a
// route because the thing has since been struck would lose exactly the context
// a report about a deletion bug needs.
const ENTITY_ROUTE_RE = /^(#\/c\/[^/]+)\/e\/(.+)$/;

export function sanitizeRoute(
  hash: string,
  isHiddenId: (entityId: string) => boolean,
): string | undefined {
  // "" → undefined: no hash is absence, and an empty string in a nullable
  // context column would read as a fact (mutations map it to null for this
  // reason too).
  if (!hash) return undefined;
  const m = ENTITY_ROUTE_RE.exec(hash);
  if (!m) return hash;
  // Decoded before the caller sees it — writeCampaignHash percent-encodes ids,
  // so testing the raw segment would fail to recognise any id needing escaping
  // and would wave the hidden entity straight through.
  let id = m[2];
  try {
    id = decodeURIComponent(id);
  } catch {
    // Malformed percent-encoding: fall through with the raw segment rather than
    // throwing. parseHash does the same, and an unparseable id can't match a
    // real entity, so the conservative read is "not hidden".
  }
  return isHiddenId(id) ? m[1] : hash;
}

// How a stored route is shown: shortened, never resolved and never linked. The
// page it names may not exist any more (that's why 0040 stores it as free
// text), so this is a recognition hint for the maintainer, not navigation.
export function routeHint(route: string): string {
  const m = ENTITY_ROUTE_RE.exec(route);
  // A truncated id, because the full uuid is noise in a one-line meta row and
  // the maintainer resolves it by searching, not by reading.
  if (m) return `entity ${m[2].slice(0, 8)}…`;
  // Strip the campaign prefix every route shares; what's left is the page. The
  // fallback covers the bare `#/c/<cid>` case, which IS the board.
  return route.replace(/^#\/c\/[^/]+\/?/, "") || "the board";
}

// What the sidebar badge counts: work outstanding, so settled items don't
// leave a number sitting there forever. Zero is rendered as no badge by the
// caller — the same "empty means absence" reading the draft store uses.
export function openFeedbackCount(items: FeedbackItem[]): number {
  return items.filter((i) => !isSettled(i.status)).length;
}
