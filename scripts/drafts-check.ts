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
import { clearDraft, entityDraftKey, liveDraftKey, readDraft, writeDraft } from "../src/noteDrafts";

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
  const k = entityDraftKey(C, "vex");
  writeDraft(k, "something");
  writeDraft(k, "");
  check("writing \"\" clears the draft", readDraft(k) === "", readDraft(k));
  // The observable consequence: a cleared draft must not occupy a slot, or a
  // composer the user emptied would push a real draft out of the map.
  for (let i = 0; i < MAX_KEYS; i++) writeDraft(entityDraftKey(C, `filler-${i}`), `note ${i}`);
  check("a cleared key didn't consume a slot",
    readDraft(entityDraftKey(C, "filler-0")) === "note 0", readDraft(entityDraftKey(C, "filler-0")));
  for (let i = 0; i < MAX_KEYS; i++) clearDraft(entityDraftKey(C, `filler-${i}`));
}

console.log("\neviction drops the oldest, and never the draft being typed");
{
  // Fill exactly to the ceiling, then keep typing into the FIRST composer — the
  // one that would be evicted first by insertion order. It must survive, and the
  // second-oldest must be the one to go.
  for (let i = 0; i < MAX_KEYS; i++) writeDraft(entityDraftKey(C, `e${i}`), `draft ${i}`);
  check("at the ceiling, the oldest is still present",
    readDraft(entityDraftKey(C, "e0")) === "draft 0", readDraft(entityDraftKey(C, "e0")));

  writeDraft(entityDraftKey(C, "e0"), "still typing here");
  writeDraft(entityDraftKey(C, "overflow"), "the newest note");

  check("the draft being typed survives the overflow",
    readDraft(entityDraftKey(C, "e0")) === "still typing here", readDraft(entityDraftKey(C, "e0")));
  check("the newest write survives the overflow",
    readDraft(entityDraftKey(C, "overflow")) === "the newest note",
    readDraft(entityDraftKey(C, "overflow")));
  check("the least-recently-touched draft is the one evicted",
    readDraft(entityDraftKey(C, "e1")) === "", readDraft(entityDraftKey(C, "e1")));

  writeDraft(entityDraftKey(C, "e0"), "");
  writeDraft(entityDraftKey(C, "overflow"), "");
  for (let i = 0; i < MAX_KEYS; i++) writeDraft(entityDraftKey(C, `e${i}`), "");
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
