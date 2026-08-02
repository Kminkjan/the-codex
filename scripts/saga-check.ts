// Saga logic harness: exercises the pure derivations in src/saga.ts against a
// synthetic campaign built to hit every branch. There's no test framework here,
// and the rules this checks are the ones the Complete Saga wizard's whole
// promise rests on — above all "a major-tier person is never pre-selected for
// the sweep", which is the DM's own constraint and is easy to break silently
// while refactoring the scope logic.
//
// Synthetic on purpose: it needs a saga with carry-forward cast, pinned and
// archived folk, an orphaned parent pointer and a chapterless range, none of
// which a real campaign reliably has. Sibling of scripts/layout-check.ts, which
// does the same job for the board layout.
//
// Usage: npx tsx scripts/saga-check.ts   (exits non-zero on any failure)
import { sagaTree, sagaSessions, sagaScope, arcSubtreeIds, sagaOf, isSaga } from "../src/saga";
import type { Campaign } from "../src/data";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

const session = (num: number, arc?: string) => ({
  id: `s${num}`, num, title: `Chapter ${num}`, date: `2025-01-${String(num).padStart(2, "0")}`, arc,
});

const campaign: Campaign = {
  id: "c1", title: "Test", subtitle: "",
  // Saga A (chapters 1-4) with two arcs; Saga B (5-6) open, one arc.
  arcs: [
    { id: "sagaA", title: "Saga A", orderNum: 1 },
    { id: "sagaB", title: "Saga B", orderNum: 2 },
    { id: "arcA1", title: "Arc A1", orderNum: 1, parentId: "sagaA" },
    { id: "arcA2", title: "Arc A2", orderNum: 2, parentId: "sagaA" },
    { id: "arcB1", title: "Arc B1", orderNum: 1, parentId: "sagaB" },
    // Orphan: parent not loaded. Must surface as a saga, not vanish.
    { id: "orphan", title: "Orphan", orderNum: 9, parentId: "ghost" },
  ],
  sessions: [
    session(1, "arcA1"), session(2, "arcA1"), session(3, "arcA2"), session(4, "sagaA"),
    session(5, "arcB1"), session(6, "arcB1"),
  ],
  people: [
    // Major, only in saga A → listed, must NOT be suggested.
    { id: "pMajor", name: "Major Mildred", tier: "major" },
    // Supporting, only in saga A → suggested.
    { id: "pSupp", name: "Supporting Sam", tier: "supporting" },
    // Supporting, but also in chapter 5 → carries forward, not suggested.
    { id: "pCarry", name: "Carrying Cass", tier: "supporting" },
    // Background → suggested.
    { id: "pBack", name: "Background Bo", tier: "background" },
    // Pinned background → never offered at all.
    { id: "pPin", name: "Pinned Pim", tier: "background", pinned: true },
    // Already archived → never offered.
    { id: "pArch", name: "Archived Al", tier: "background", archived: true },
    // Only in saga B → out of scope entirely.
    { id: "pLater", name: "Later Lou", tier: "supporting" },
    // Null tier reads as major (personTier default) → not suggested.
    { id: "pNoTier", name: "Untiered Uma" },
  ],
  sessionParticipants: {
    s1: ["pMajor", "pSupp", "pCarry", "pBack", "pPin", "pArch", "pNoTier"],
    s3: ["pSupp"],
    s5: ["pCarry", "pLater"],
  },
  quests: [
    // Open quest in saga A → a loose end.
    { id: "qOpen", title: "Open thread", status: "pursuing", arc: "arcA1" },
    // Resolved in saga A → not a loose end.
    { id: "qDone", title: "Closed thread", status: "resolved", arc: "arcA2" },
    // Open but in saga B → not this saga's loose end.
    { id: "qLater", title: "Next saga thread", status: "pursuing", arc: "arcB1" },
    { id: "qGiver", title: "Given thread", status: "whispered", session: "s1", giver: "pSupp" },
  ],
  goals: [
    // `owner` is FREE TEXT naming whoever holds the aim — never an entity id.
    // These fixtures deliberately spell that out, because the earlier version of
    // this file used person ids here and so agreed with a bug in sagaScope that
    // dropped every goal in every campaign.
    //
    // A goal carries no arc or session, so there is nothing to scope one by:
    // every unresolved goal is a loose end, whoever is named.
    { id: "gOpen", text: "A goal", owner: "The Party", kind: "personal", status: "pursuing" },
    // Names someone who never appears in this saga's cast → still a loose end.
    { id: "gOut", text: "Other goal", owner: "Kael (Ranger)", kind: "personal", status: "pursuing" },
    // Owner left blank → still a loose end.
    { id: "gNoOwner", text: "Unattributed goal", owner: "", kind: "party", status: "whispered" },
    // Closed, so never a loose end — the only status test that survives.
    { id: "gDone", text: "Closed goal", owner: "The Party", kind: "personal", status: "resolved" },
    { id: "gLost", text: "Lost goal", owner: "The Party", kind: "personal", status: "lost" },
    // Pinned and archived are skipped for goals exactly as for every other kind.
    { id: "gPin", text: "Pinned goal", owner: "The Party", kind: "personal", status: "pursuing", pinned: true },
    { id: "gArch", text: "Archived goal", owner: "The Party", kind: "personal", status: "pursuing", archived: true },
  ],
  locations: [
    // Linked only to saga-A folk → offered, never pre-checked.
    { id: "locSaga", name: "Saga Tavern", kind: "tavern" },
    // Linked to someone who carries forward → offered, flagged.
    { id: "locBoth", name: "Shared Road", kind: "road" },
    // Linked to nobody in the saga → not offered.
    { id: "locOut", name: "Far Keep", kind: "keep" },
  ],
  factions: [], items: [], lore: [], monsters: [],
  events: [], eventParticipants: {},
  connections: [
    { from: "pSupp", to: "locSaga", label: "drinks at" },
    { from: "pCarry", to: "locBoth", label: "rides" },
    { from: "pLater", to: "locOut", label: "holds" },
  ],
  // Empty tails, present only to satisfy `Campaign` — nothing in sagaScope
  // reads them. NOTE: `scripts/` is outside tsconfig's `include`, so a field
  // added to `Campaign` does NOT break `npm run build` here and `tsx` doesn't
  // typecheck either — this annotation silently rots. `sessionAttendance`
  // (0039) was already missing before `feedback` (0040) was added; both are
  // filled in now. Check this literal whenever `Campaign` gains a field.
  sessionStaging: [], sessionEvents: [], dmNotes: {},
  board: {}, notes: {},
  sessionAttendance: {}, feedback: [],
};

console.log("\nsagaTree / nesting");
const tree = sagaTree(campaign);
check("three top-level nodes (2 sagas + orphan)", tree.length === 3, tree.map((t) => t.saga.id));
check("saga A holds its two arcs in order", JSON.stringify(tree[0].arcs.map((a) => a.id)) === '["arcA1","arcA2"]');
check("orphan surfaces as its own node", tree.some((t) => t.saga.id === "orphan"));
check("isSaga true for sagaA", isSaga(campaign.arcs[0]));
check("sagaOf(arcA2) === sagaA", sagaOf(campaign, "arcA2")?.id === "sagaA");
check("sagaOf(sagaA) === itself", sagaOf(campaign, "sagaA")?.id === "sagaA");
check("subtree includes saga + both arcs", arcSubtreeIds(campaign, "sagaA").size === 3);

console.log("\nsagaSessions roll-up");
const sess = sagaSessions(campaign, "sagaA");
check("saga A rolls up 4 chapters incl. the saga-level one", sess.length === 4, sess.map((s) => s.num));
check("ascending by num", sess.every((s, i) => i === 0 || s.num > sess[i - 1].num));
check("saga B rolls up 2", sagaSessions(campaign, "sagaB").length === 2);

console.log("\nsagaScope — the cast");
const scope = sagaScope(campaign, "sagaA");
const cast = new Map(scope.cast.map((c) => [c.id, c]));
check("last chapter is 4", scope.lastNum === 4);
check("major IS listed", cast.has("pMajor"));
check("major is NOT pre-checked", cast.get("pMajor")?.suggested === false);
// Asserts the meaning, not the wording: the reason must tell the DM this is a
// major that stays on the board. Pinning the exact prose made this fail the
// moment the copy moved to a voice-neutral register (see SweepReason in saga.ts).
check(
  "major's reason explains it stays on the board",
  /major/i.test(cast.get("pMajor")?.reason ?? "") && /board/i.test(cast.get("pMajor")?.reason ?? ""),
  cast.get("pMajor")?.reason,
);
check("null-tier person treated as major, not pre-checked", cast.get("pNoTier")?.suggested === false);
check("supporting IS pre-checked", cast.get("pSupp")?.suggested === true);
check("background IS pre-checked", cast.get("pBack")?.suggested === true);
check("carry-forward person listed but NOT pre-checked", cast.get("pCarry")?.suggested === false);
check("carry-forward flagged + reason names the later chapter", cast.get("pCarry")?.carriesForward === true && /S05/.test(cast.get("pCarry")?.reason ?? ""), cast.get("pCarry")?.reason);
check("pinned person never offered", !cast.has("pPin"));
check("archived person never offered", !cast.has("pArch"));
check("out-of-saga person never offered", !cast.has("pLater"));
check("NO major is ever suggested", scope.cast.every((c) => c.tier !== "major" || !c.suggested));

console.log("\nsagaScope — loose ends");
const ends = new Set(scope.looseEnds.map((t) => t.id));
check("open quest is a loose end", ends.has("qOpen"));
check("resolved quest is not", !ends.has("qDone"));
check("next-saga quest is not", !ends.has("qLater"));
check("quest reached via its chapter is", ends.has("qGiver"));
// Goals enter unscoped, on purpose. The rule these guard is "who owns it never
// decides", which is what the old cast-membership filter got wrong: `owner` is
// free text, so the filter matched nothing and no goal ever reached the wizard.
check("unresolved goal is a loose end", ends.has("gOpen"));
check("owner naming a non-cast member does NOT exclude it", ends.has("gOut"));
check("blank owner does NOT exclude it", ends.has("gNoOwner"));
check("resolved goal is not", !ends.has("gDone"));
check("lost goal is not", !ends.has("gLost"));
check("pinned goal is never offered", !ends.has("gPin"));
check("archived goal is never offered", !ends.has("gArch"));

console.log("\nsagaScope — places & things");
const things = new Map(scope.things.map((c) => [c.id, c]));
check("saga-only location offered", things.has("locSaga"));
check("things are NEVER pre-checked", scope.things.every((c) => !c.suggested));
check("location shared with an open thread is flagged", things.get("locBoth")?.carriesForward === true);
check("unrelated location not offered", !things.has("locOut"));

console.log("\nsagaSessions fallback (range set, no chapters filed — the 0025 pre-31 arcs)");
const ranged: Campaign = {
  ...campaign,
  arcs: [
    // A saga whose span is declared by start/end but whose chapters are filed
    // nowhere — exactly the five arcs 0025 seeds for chapters 1-30.
    { id: "sagaR", title: "Ranged Saga", orderNum: 1, startSession: "s2", endSession: "s5" },
    { id: "sagaEmpty", title: "Empty Saga", orderNum: 2 },
  ],
  sessions: campaign.sessions.map((s) => ({ ...s, arc: undefined })),
};
const fb = sagaSessions(ranged, "sagaR");
check("falls back to the num range", fb.length === 4, fb.map((s) => s.num));
check("range is inclusive of both ends", fb[0]?.num === 2 && fb[3]?.num === 5);
check("no range and no chapters yields nothing", sagaSessions(ranged, "sagaEmpty").length === 0);
const halfOpen: Campaign = { ...ranged, arcs: [{ id: "sagaH", title: "Half", orderNum: 1, endSession: "s3" }] };
check("end-only range means everything up to it", sagaSessions(halfOpen, "sagaH").map((s) => s.num).join() === "1,2,3");
const noFk: Campaign = { ...ranged, arcs: [{ id: "sagaN", title: "No FK", orderNum: 1, startSession: "ghost", endSession: "ghost" }] };
check("unresolvable session FKs yield nothing, not everything", sagaSessions(noFk, "sagaN").length === 0);

// A declared range must never annex a chapter that already names another arc.
// Without this the range fallback pulls a neighbouring saga's chapters into the
// roll-up — and from there into the sweep candidate set.
const contested: Campaign = {
  ...campaign,
  arcs: [
    { id: "sagaOwner", title: "Owner", orderNum: 1 },
    { id: "sagaClaimer", title: "Claimer", orderNum: 2, startSession: "s1", endSession: "s6" },
  ],
  // s1–s3 belong to the other saga; s4–s6 are unclaimed.
  sessions: campaign.sessions.map((s) => ({ ...s, arc: s.num <= 3 ? "sagaOwner" : undefined })),
};
const claimed = sagaSessions(contested, "sagaClaimer").map((s) => s.num);
check("range fallback skips chapters owned by another arc", claimed.join() === "4,5,6", claimed);
check("the owning saga still reports its own", sagaSessions(contested, "sagaOwner").map((s) => s.num).join() === "1,2,3");
const claimerScope = sagaScope(contested, "sagaClaimer");
check("and the annexed chapters stay out of the sweep scope", claimerScope.sessions.every((s) => s.num >= 4));
console.log("\nsagaScope on a chapterless saga (the wizard must refuse to seal)");
const chapterless = sagaScope(ranged, "sagaEmpty");
check("no chapters → no cast offered", chapterless.cast.length === 0);
check("no chapters → lastNum is null", chapterless.lastNum === null);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
