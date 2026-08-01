// Unsent-note-draft harness: the module store in src/noteDrafts.ts, which holds
// the text a NoteComposer has typed but not committed.
//
// This store exists because note composers no longer send on focus loss (players
// reported half-typed notes becoming permanent, undeletable records). Every rule
// below is silent when wrong — a draft quietly vanishes, or worse, surfaces in
// the wrong composer and gets pinned to the wrong entity:
//
//   * **Empty means absence.** Clearing a composer must leave no key behind, the
//     same contract as writeListSort's "default is stored as absence". A stored
//     "" would make readDraft return a falsy-but-present value and the caller's
//     is-empty/has-draft class would disagree with the store.
//   * **Eviction drops the OLDEST, never the newest.** The cap is there so a
//     marathon session can't grow the map without bound, but a naive Map
//     insert-and-trim evicts by original insertion order — so re-typing into an
//     old composer would leave it first in line and the note being written right
//     now would be the one thrown away. The model asserted here is "the draft you
//     are currently typing is never the one evicted", not a size number.
//   * **Namespaces and campaigns cannot collide.** Entity ids and session ids are
//     both free-form text PKs from different tables, and a draft leaking across a
//     campaign switch would offer one table's prose to another's composer.
//
// The fixtures are written from those rules as stated, not from what the code
// returns (see the saga-check.ts cautionary tale in CLAUDE.md).
//
// Usage: npx tsx scripts/drafts-check.ts   (exits non-zero on any failure)
import { clearDraft, draftCount, entityDraftKey, liveDraftKey, readDraft, writeDraft } from "../src/noteDrafts";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

// Mirrors MAX_KEYS in src/noteDrafts.ts. Deliberately duplicated rather than
// exported: the harness asserts the behaviour at the documented ceiling, so a
// change to the constant should have to be made here too, on purpose.
const MAX_KEYS = 60;

const C = "campaign-1";

console.log("\nround-trip: a draft comes back under its own key");
{
  const k = entityDraftKey(C, "alaric");
  check("absent key reads as empty string", readDraft(k) === "", JSON.stringify(readDraft(k)));
  writeDraft(k, "the innkeeper is lying");
  check("stored text round-trips", readDraft(k) === "the innkeeper is lying", readDraft(k));
  writeDraft(k, "the innkeeper is lying about the cellar");
  check("re-writing replaces rather than appends",
    readDraft(k) === "the innkeeper is lying about the cellar", readDraft(k));
  clearDraft(k);
  check("clearDraft removes it", readDraft(k) === "", readDraft(k));
}

console.log("\nempty means absence, not a stored empty value");
{
  // draftCount, not readDraft, is the discriminating observation here: readDraft
  // returns "" for an absent key AND for a stored empty string, so "leaves no key
  // behind" is invisible without it. Counting also makes this section independent
  // of what earlier sections left in the map.
  const before = draftCount();
  const k = entityDraftKey(C, "vex");
  writeDraft(k, "something");
  check("a real draft occupies a slot", draftCount() === before + 1, draftCount());
  writeDraft(k, "");
  check("writing \"\" clears the draft", readDraft(k) === "", readDraft(k));
  check("and leaves no key behind", draftCount() === before, draftCount());
  clearDraft(k);
  check("clearDraft on an absent key is a no-op", draftCount() === before, draftCount());
}

console.log("\neviction drops the oldest, and never the draft being typed");
{
  // Own namespace, and no assumption that the map starts empty: anything already
  // in it is OLDER, so it is evicted before these keys — whatever the starting
  // state, filling MAX_KEYS fresh keys leaves exactly those alive.
  const E = "campaign-evict";
  for (let i = 0; i < MAX_KEYS; i++) writeDraft(entityDraftKey(E, `e${i}`), `draft ${i}`);
  check("the cap holds the map at MAX_KEYS", draftCount() === MAX_KEYS, draftCount());
  check("at the ceiling, the oldest of them is still present",
    readDraft(entityDraftKey(E, "e0")) === "draft 0", readDraft(entityDraftKey(E, "e0")));

  // Keep typing into the FIRST composer — the one insertion order would evict
  // next — then overflow the cap by one.
  writeDraft(entityDraftKey(E, "e0"), "still typing here");
  writeDraft(entityDraftKey(E, "overflow"), "the newest note");

  check("the draft being typed survives the overflow",
    readDraft(entityDraftKey(E, "e0")) === "still typing here", readDraft(entityDraftKey(E, "e0")));
  check("the newest write survives the overflow",
    readDraft(entityDraftKey(E, "overflow")) === "the newest note",
    readDraft(entityDraftKey(E, "overflow")));
  check("the least-recently-touched draft is the one evicted",
    readDraft(entityDraftKey(E, "e1")) === "", readDraft(entityDraftKey(E, "e1")));
  check("the cap still holds after the overflow", draftCount() === MAX_KEYS, draftCount());

  clearDraft(entityDraftKey(E, "e0"));
  clearDraft(entityDraftKey(E, "overflow"));
  for (let i = 0; i < MAX_KEYS; i++) clearDraft(entityDraftKey(E, `e${i}`));
  check("the section cleaned up after itself", draftCount() === 0, draftCount());
}

console.log("\nkeys cannot collide across namespace or campaign");
{
  const id = "shared-id";
  check("entity and session namespaces differ",
    entityDraftKey(C, id) !== liveDraftKey(C, id),
    [entityDraftKey(C, id), liveDraftKey(C, id)]);
  check("the same entity in two campaigns differs",
    entityDraftKey("campaign-a", id) !== entityDraftKey("campaign-b", id));

  // And the consequence, not just the string inequality: one composer's text
  // must never be readable from the other.
  writeDraft(entityDraftKey(C, id), "party note");
  writeDraft(liveDraftKey(C, id), "feed note");
  writeDraft(entityDraftKey("campaign-b", id), "other campaign");
  check("entity draft is unaffected by the session draft",
    readDraft(entityDraftKey(C, id)) === "party note", readDraft(entityDraftKey(C, id)));
  check("session draft is unaffected by the entity draft",
    readDraft(liveDraftKey(C, id)) === "feed note", readDraft(liveDraftKey(C, id)));
  check("a campaign switch cannot surface the other campaign's draft",
    readDraft(entityDraftKey("campaign-b", id)) === "other campaign",
    readDraft(entityDraftKey("campaign-b", id)));
}

console.log(failures === 0 ? "\nAll draft-store checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
