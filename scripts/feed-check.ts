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
// Sibling of scripts/relations-check.ts and scripts/saga-check.ts.
//
// Usage: npx tsx scripts/feed-check.ts   (exits non-zero on any failure)
import {
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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
