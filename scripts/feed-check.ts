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
// The byline (0042) is a THIRD silent-failure shape, and the inverse of the
// label snapshot above: here the stored string is the fallback and the live
// lookup is the answer, so a branch that reads ev.author directly still renders
// something plausible — just the pre-rename name, forever, with nothing on
// screen to say it's stale. authorName's own fallback ladder is asserted here
// too, because every rung is a real row: pre-0042 rows have no uuid, a uuid can
// outlive its profile, and an editor can have no display name at all.
//
// Sibling of scripts/relations-check.ts and scripts/saga-check.ts.
//
// Usage: npx tsx scripts/feed-check.ts   (exits non-zero on any failure)
import {
  authorName,
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
  events: [], eventParticipants: {}, sessionParticipants: {}, sessionAttendance: {},
  connections: [], sessionStaging: [], sessionEvents: [], dmNotes: {},
  board: {}, notes: {},
  ...over,
} as Campaign);

const linkEv = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: 1, sessionId: "s1", type: "link", author: "Kris", authorUserId: "u1",
  entityId: "a", entityIdB: "b", text: "ally of",
  createdAt: "2026-07-26T20:00:00.000Z", ...over,
});

// A party note left on an entity sheet mid-session (0032). One endpoint, `text`
// holding the bounded excerpt, `entityLabel` the write-time snapshot.
const annotateEv = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: 2, sessionId: "s1", type: "annotate", author: "Kris", authorUserId: "u1",
  entityId: "a", entityLabel: "Ana", text: "she's lying about the ledger",
  createdAt: "2026-07-26T20:05:00.000Z", ...over,
});

// The byline resolver for the sections that are about something else. Explicit
// rather than defaulted: sessionFeedToMarkdown requires it precisely so nobody
// publishes stale names by forgetting, and a harness that quietly opted out
// would be asserting a signature the app can no longer produce. "Knows nobody"
// is also a real state — a viewer whose profiles fetch hasn't landed.
const noNames = () => undefined;

// A plain composer row — the fallthrough branch, and the only one whose byline
// is load-bearing enough to have its own "Anonymous" wording.
const noteEv = (over: Partial<SessionEvent> = {}): SessionEvent => ({
  id: 3, sessionId: "s1", type: "note", author: "Kris", authorUserId: "u1",
  text: "the ledger is a forgery", createdAt: "2026-07-26T20:10:00.000Z", ...over,
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

  const md = sessionFeedToMarkdown([linkEv()], resolve, noNames);
  check("names both endpoints", md.includes("**Ana**") && md.includes("**Bel**"), md);
  check("carries the string's own label", md.includes('"ally of"'), md);
  check("signs the author", md.includes("Kris"), md);
  // If the link branch were missing, the fallthrough would emit
  // "- *hh:mm* — Kris: ally of" — plausible-looking and wrong.
  check("did NOT fall through to the plain-note shape", !md.includes("Kris: ally of"), md);

  const leak = sessionFeedToMarkdown([linkEv({ entityIdB: "h" })], resolve, noNames);
  check("a hidden endpoint drops the whole row from the digest",
    !leak.includes("Secret") && !leak.includes("Ana"), leak);

  // The feed is history: rows outlive their entities, and unlike a reveal a
  // link has no label snapshot in `text` to fall back on.
  const dangling = sessionFeedToMarkdown([linkEv({ entityIdB: "gone" })], resolve, noNames);
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

  const md = sessionFeedToMarkdown([annotateEv()], resolve, noNames);
  check("names the annotated entity", md.includes("**Ana**"), md);
  check("carries the note excerpt", md.includes('"she\'s lying about the ledger"'), md);
  check("signs the author", md.includes("Kris"), md);
  // Without the branch the fallthrough emits "- *hh:mm* — Kris: she's lying…",
  // which looks like a composer note and loses the entity entirely.
  check("did NOT fall through to the plain-note shape",
    !md.includes("Kris: she's lying"), md);

  const renamed = sessionFeedToMarkdown([annotateEv({ entityId: "r" })], resolve, noNames);
  check("live label beats the stale snapshot",
    renamed.includes("**Ana Maerwyn**") && !renamed.includes("**Ana**"), renamed);

  const leak = sessionFeedToMarkdown([annotateEv({ entityId: "h", entityLabel: "Secret" })], resolve, noNames);
  check("a hidden entity drops the whole row from the public digest",
    !leak.includes("Secret") && !leak.includes("ledger"), leak);

  // The feed is history: rows outlive their entities. This is what the snapshot
  // is FOR — a struck entity still names itself.
  const struck = sessionFeedToMarkdown([annotateEv({ entityId: "gone" })], resolve, noNames);
  check("a deleted entity degrades to its label snapshot",
    struck.includes("**Ana**") && !struck.includes("struck from the codex"), struck);

  // Pre-0032 rows carry no snapshot, so the stock phrase is still reachable.
  const noSnap = sessionFeedToMarkdown([annotateEv({ entityId: "gone", entityLabel: undefined })], resolve, noNames);
  check("no snapshot and no entity → the stock phrase, no throw",
    noSnap.includes("struck from the codex"), noSnap);
}

console.log("\nauthorName: the live name wins, the snapshot catches everything else");
{
  // u1 renamed themselves after writing all of the above; u2 holds an account
  // with no display name; u3's profile row is simply absent (deleted account,
  // or the profiles fetch hasn't landed — it loads outside fetchCampaign's
  // Promise.all, so an early render legitimately sees an empty map).
  const names: Record<string, string | null> = { u1: "Kris Minkjan", u2: null };
  const resolveName = (id: string) => names[id];

  check("the live name beats the write-time snapshot",
    authorName({ author: "Kris", authorUserId: "u1" }, resolveName) === "Kris Minkjan");
  // The regression this whole column exists to prevent.
  check("...so a renamed editor is not two people in their own chronicle",
    authorName({ author: "Kris", authorUserId: "u1" }, resolveName) !== "Kris");
  check("a pre-0042 row with no uuid keeps its snapshot",
    authorName({ author: "Kris" }, resolveName) === "Kris");
  check("an unresolvable uuid falls back to the snapshot, never prints the uuid",
    authorName({ author: "Kris", authorUserId: "u3" }, resolveName) === "Kris");
  check("an account with no display name falls back to the snapshot",
    authorName({ author: "Kris", authorUserId: "u2" }, resolveName) === "Kris");
  check("nothing at all is undefined, not an empty byline",
    authorName({}, resolveName) === undefined);
  // mapPartyNoteRow coerces a NULL author column to "", so the empty string is
  // a real stored value and must not render as a blank dash.
  check("an empty snapshot reads as absent, not as a name",
    authorName({ author: "   ", authorUserId: "u3" }, resolveName) === undefined);
}

console.log("\nrecap markdown: bylines resolve live in the PUBLIC digest");
{
  const resolve = (id?: string | null) => (id ? ({ id, name: "Ana" } as any) : null);
  const resolveName = (id: string) => (id === "u1" ? "Kris Minkjan" : undefined);

  // Each branch that prints a byline gets its own case: they use three
  // different wordings ("by X", "(X)", "X:"), so a missed one is invisible in
  // the others' output.
  const reveal = sessionFeedToMarkdown(
    [{ id: 4, sessionId: "s1", type: "reveal", author: "Kris", authorUserId: "u1",
       entityId: "a", createdAt: "2026-07-26T20:00:00.000Z" }], resolve, resolveName);
  check("reveal rows sign with the live name", reveal.includes("by Kris Minkjan"), reveal);

  const link = sessionFeedToMarkdown([linkEv()], resolve, resolveName);
  check("link rows sign with the live name", link.includes("(Kris Minkjan)"), link);

  const annotate = sessionFeedToMarkdown([annotateEv()], resolve, resolveName);
  check("annotate rows sign with the live name", annotate.includes("(Kris Minkjan)"), annotate);

  const note = sessionFeedToMarkdown([noteEv()], resolve, resolveName);
  check("plain note rows sign with the live name", note.includes("Kris Minkjan:"), note);

  // The digest is frozen text in a public column, so a stale name published
  // there can't be corrected later by a rename. All four branches, one assert.
  const all = sessionFeedToMarkdown([linkEv(), annotateEv(), noteEv()], resolve, resolveName);
  check("no branch leaks the stale snapshot into the published digest",
    !/\bKris\b(?! Minkjan)/.test(all), all);

  // A resolver that knows nobody is a real state, not a degenerate one: the
  // profiles map loads outside fetchCampaign's Promise.all, so an early render
  // legitimately has it empty. It must print the stored snapshot rather than
  // "undefined" or a bare colon.
  const unknown = sessionFeedToMarkdown([noteEv()], resolve, noNames);
  check("a resolver that knows nobody still prints the stored snapshot",
    unknown.includes("Kris:") && !unknown.includes("undefined"), unknown);

  // The fallthrough branch is the only one that words the empty case, and it
  // must not degrade to a bare colon.
  const anon = sessionFeedToMarkdown(
    [noteEv({ author: undefined, authorUserId: undefined })], resolve, resolveName);
  check("an unsigned plain note reads as Anonymous", anon.includes("Anonymous:"), anon);
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
