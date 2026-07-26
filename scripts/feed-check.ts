// Feed harness: exercises the two pure functions in src/data.ts that decide
// what a session's record shows to whom — projectCampaignForViewers (the
// player-facing strip) and sessionFeedToMarkdown (the recap digest).
//
// Both are if-chains over SessionEventType whose LAST branch is an
// unconditional fallthrough to the plain-note shape. That makes every new event
// type a silent-failure risk: forget a branch and the row still renders, just as
// a bare note dumping its raw `text`. And the two must agree — the digest runs
// on the DM's unprojected campaign but lands in the PUBLIC `sessions.summary`,
// so a hidden entity the projection would have stripped leaks permanently if
// only the projection learned the new type.
//
// The link rows this guards (0031) are the first event type with TWO endpoints,
// so every visibility check that used to read one `entity_id` now has to clear
// both — the exact thing that is easy to half-do.
//
// The annotate rows (0032) are the first to carry a LABEL SNAPSHOT, which is a
// second silent-failure shape: the snapshot is a deletion fallback, so a branch
// that reaches for it before the live lookup would publish a stale name, and a
// branch that reaches for it before the hidden check would publish a name the
// projection exists to strip. Both orderings are asserted below.
//
// Sibling of scripts/relations-check.ts and scripts/saga-check.ts.
//
// Usage: npx tsx scripts/feed-check.ts   (exits non-zero on any failure)
import {
  bothVisible,
  isVisible,
  noteExcerpt,
  projectCampaignForViewers,
  sessionFeedToMarkdown,
  type Campaign,
  type Entity,
  type SessionEvent,
} from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

const shell = (over: Partial<Campaign>): Campaign => ({
  id: "c1", title: "T", subtitle: "",
  people: [], locations: [], quests: [], goals: [], factions: [],
  items: [], lore: [], monsters: [], sessions: [], arcs: [],
  events: [], eventParticipants: {}, sessionParticipants: {},
  connections: [], sessionStaging: [], sessionEvents: [], dmNotes: {},
  board: {}, notes: {},
  ...over,
} as Campaign);

const linkEv = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: 1, sessionId: "s1", type: "link", author: "Kris",
  entityId: "a", entityIdB: "b", text: "ally of",
  createdAt: "2026-07-26T20:00:00.000Z", ...over,
});

// A party note left on an entity sheet mid-session (0032). One endpoint, `text`
// holding the bounded excerpt, `entityLabel` the write-time snapshot.
const annotateEv = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: 2, sessionId: "s1", type: "annotate", author: "Kris",
  entityId: "a", entityLabel: "Ana", text: "she's lying about the ledger",
  createdAt: "2026-07-26T20:05:00.000Z", ...over,
});

console.log("\nviewer projection: a link row needs BOTH endpoints visible");
{
  const people = (aHidden: boolean, bHidden: boolean): any[] => [
    { id: "a", name: "Ana", hidden: aHidden },
    { id: "b", name: "Bel", hidden: bHidden },
  ];
  const project = (a: boolean, b: boolean) =>
    projectCampaignForViewers(shell({ people: people(a, b), sessionEvents: [linkEv()] })).sessionEvents;
  check("both visible → row survives", project(false, false).length === 1);
  // The near/far split is the regression that matters: the pre-0031 filter read
  // only entity_id, so a hidden FAR endpoint would have sailed through.
  check("near endpoint (entityId) hidden → dropped", project(true, false).length === 0, project(true, false));
  check("far endpoint (entityIdB) hidden → dropped", project(false, true).length === 0, project(false, true));
  check("both hidden → dropped", project(true, true).length === 0);
}

console.log("\nrecap markdown: the link branch, and the public-summary leak");
{
  const ents: Record<string, Entity> = {
    a: { id: "a", name: "Ana" } as any,
    b: { id: "b", name: "Bel" } as any,
    h: { id: "h", name: "Secret", hidden: true } as any,
  };
  const resolve = (id?: string | null) => (id ? ents[id] ?? null : null);

  const md = sessionFeedToMarkdown([linkEv()], resolve);
  check("names both endpoints", md.includes("**Ana**") && md.includes("**Bel**"), md);
  check("carries the string's own label", md.includes('"ally of"'), md);
  check("signs the author", md.includes("Kris"), md);
  // If the link branch were missing, the fallthrough would emit
  // "- *hh:mm* — Kris: ally of" — plausible-looking and wrong.
  check("did NOT fall through to the plain-note shape", !md.includes("Kris: ally of"), md);

  const leak = sessionFeedToMarkdown([linkEv({ entityIdB: "h" })], resolve);
  check("a hidden endpoint drops the whole row from the digest",
    !leak.includes("Secret") && !leak.includes("Ana"), leak);

  // The feed is history: rows outlive their entities, and unlike a reveal a
  // link has no label snapshot in `text` to fall back on.
  const dangling = sessionFeedToMarkdown([linkEv({ entityIdB: "gone" })], resolve);
  check("a deleted endpoint degrades rather than vanishing or throwing",
    dangling.includes("**Ana**") && dangling.includes("struck from the codex"), dangling);
}

console.log("\nviewer projection: an annotate row rides the single-endpoint filter");
{
  // 0032 adds no projection code — the claim is that the existing entityId
  // clause already covers the new type. That claim is the thing under test: if
  // someone ever narrows the filter to specific types, this fails loudly.
  const project = (hidden: boolean) =>
    projectCampaignForViewers(shell({
      people: [{ id: "a", name: "Ana", hidden } as any],
      sessionEvents: [annotateEv()],
    })).sessionEvents;
  check("visible entity → row survives", project(false).length === 1);
  check("hidden entity → dropped", project(true).length === 0, project(true));
  // The snapshot must not become a bypass: the row is stripped whole, so the
  // label never reaches a player even though the row carries it in plain text.
  check("the label snapshot does not survive the strip",
    JSON.stringify(project(true)).indexOf("Ana") === -1, project(true));
}

console.log("\nrecap markdown: the annotate branch");
{
  const ents: Record<string, Entity> = {
    a: { id: "a", name: "Ana" } as any,
    // Renamed since the note was left — the live lookup must win over the
    // snapshot, or the digest prints a name that is no longer anyone's.
    r: { id: "r", name: "Ana Maerwyn" } as any,
    h: { id: "h", name: "Secret", hidden: true } as any,
  };
  const resolve = (id?: string | null) => (id ? ents[id] ?? null : null);

  const md = sessionFeedToMarkdown([annotateEv()], resolve);
  check("names the annotated entity", md.includes("**Ana**"), md);
  check("carries the note excerpt", md.includes('"she\'s lying about the ledger"'), md);
  check("signs the author", md.includes("Kris"), md);
  // Without the branch the fallthrough emits "- *hh:mm* — Kris: she's lying…",
  // which looks like a composer note and loses the entity entirely.
  check("did NOT fall through to the plain-note shape",
    !md.includes("Kris: she's lying"), md);

  const renamed = sessionFeedToMarkdown([annotateEv({ entityId: "r" })], resolve);
  check("live label beats the stale snapshot",
    renamed.includes("**Ana Maerwyn**") && !renamed.includes("**Ana**"), renamed);

  const leak = sessionFeedToMarkdown([annotateEv({ entityId: "h", entityLabel: "Secret" })], resolve);
  check("a hidden entity drops the whole row from the public digest",
    !leak.includes("Secret") && !leak.includes("ledger"), leak);

  // The feed is history: rows outlive their entities. This is what the snapshot
  // is FOR — a struck entity still names itself.
  const struck = sessionFeedToMarkdown([annotateEv({ entityId: "gone" })], resolve);
  check("a deleted entity degrades to its label snapshot",
    struck.includes("**Ana**") && !struck.includes("struck from the codex"), struck);

  // Pre-0032 rows carry no snapshot, so the stock phrase is still reachable.
  const noSnap = sessionFeedToMarkdown([annotateEv({ entityId: "gone", entityLabel: undefined })], resolve);
  check("no snapshot and no entity → the stock phrase, no throw",
    noSnap.includes("struck from the codex"), noSnap);
}

console.log("\nnoteExcerpt: bounded, and never mid-word");
{
  check("short text passes through untouched",
    noteExcerpt("she's lying") === "she's lying", noteExcerpt("she's lying"));
  // A contentEditable note arrives with newlines and runs of spaces that would
  // blow out a one-line feed row.
  check("collapses newlines and runs of whitespace",
    noteExcerpt("  two\n\nlines   here ") === "two lines here", noteExcerpt("  two\n\nlines   here "));

  const long = "she is lying about the ledger and the dates on the manifest do not line up at all";
  const cut = noteExcerpt(long);
  check("long text is truncated", cut.length < long.length, cut);
  check("truncation is marked with an ellipsis", cut.endsWith("…"), cut);
  check("truncation lands on a word boundary",
    long.startsWith(cut.slice(0, -1)) && !cut.slice(0, -1).endsWith(" "), cut);
  check("stays a prefix of the collapsed original", long.startsWith(cut.slice(0, -1)), cut);

  // A single unbroken word longer than the cap has no space to back off to —
  // trimming to the boundary anyway would leave a row reading only "…".
  const wall = "x".repeat(200);
  const wallCut = noteExcerpt(wall);
  check("an unbroken wall of text still yields visible characters",
    wallCut.length > 1 && wallCut.endsWith("…"), wallCut);
}

console.log("\nisVisible / bothVisible agree (0032 extracted the one-endpoint form)");
{
  const vis = { id: "a", name: "Ana" } as any as Entity;
  const hid = { id: "h", name: "Secret", hidden: true } as any as Entity;
  // A kind with no `hidden` column (sessions/arcs/events) reads visible.
  const sess = { id: "s1", title: "Session 9" } as any as Entity;
  check("a visible entity is visible", isVisible(vis));
  check("a hidden entity is not", !isVisible(hid));
  check("a kind without a hidden column reads visible", isVisible(sess));
  // The edge that matters for announce: a dangling id must NOT announce.
  check("null is not visible", !isVisible(null));
  check("bothVisible === isVisible ∧ isVisible", [vis, hid, sess, null].every((a) =>
    [vis, hid, sess, null].every((b) =>
      bothVisible(a as Entity | null, b as Entity | null) === (isVisible(a as Entity | null) && isVisible(b as Entity | null)))));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
