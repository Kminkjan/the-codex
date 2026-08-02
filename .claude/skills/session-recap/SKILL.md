---
name: session-recap
description: >
  Distil a played session's live feed into a prose recap in the campaign's own voice, and propose the
  end-of-session goals pass — new goals from threads the night opened, plus existing goals it closed or
  advanced. Reads the feed, party notes, entity sheets and connections the session left behind; drafts
  for review; writes to `sessions.summary` and the `goals` table only after explicit approval.
  Args: `--campaign=<id> --session=<num|latest>` (e.g. "--campaign=fendwick --session=5").
  Use when a session has been played and the Chronicle entry still needs writing.
---

You are writing the Chronicle entry for a session that has already been played. The table's record of
the night — the feed, the notes typed onto sheets, the strings drawn — already exists. Your job is to
turn it into the prose a player would actually want to reread, not to invent events.

## What this is *not*

The app already has a **Draft recap** button ([src/detail.tsx](../../../src/detail.tsx) → `draftRecap`,
over `sessionFeedToMarkdown` in [src/data.ts](../../../src/data.ts)). It appends a deterministic
`### As it happened` bullet list of timestamped rows. It is intentionally AI-free and it is *not* what
this skill produces — do not reimplement it, and do not append your prose in that format. Compare
`### As it happened` against a real hand-written entry (Fendwick S4, "The Recap Is a Retcon") to see the
register you are aiming for: narrative sections with `###` headings, past tense, first-person plural
from the party's side of the table.

If a session already has an `As it happened` digest in `summary`, treat it as source material and
propose *replacing* it with prose, keeping the digest below the prose only if the user asks.

## Step 1 — Gather

```bash
npx tsx .claude/skills/session-recap/gather.ts --campaign=<id> --session=<num|latest>
```

Write the JSON to the scratchpad rather than reading it inline if it is large. The bundle holds
`feed`, `notes`, `connections`, `touchedEntities`, `openGoals`, a `styleExemplar` (the most recent
previous session that has a written summary), and an `excluded` block.

Four things about the bundle that change how you read it:

- **`feed[].text` on `annotate` rows is a bounded excerpt, not the note.** It is truncated with `…`
  ([data.ts](../../../src/data.ts) `noteExcerpt`). The full prose is in `notes`. Recapping from the
  feed alone silently loses the best material — the Billy the Baker beat is three times longer in
  `notes` than in its excerpt. Always write from `notes`.
- **`touchedEntities` carries detail that was never in the feed at all.** The DM types onto sheets
  during play. Percapock Packpillow's `notes` column is where "people have gone crazy in Northmill.
  Guards are searching every crate and sack" lives — it appears nowhere in the feed.
- **`notes[].provenance`** is `session_id` when the row was stamped with the live session, or
  `time-window` when it was recovered by timestamp. Both are in-session. The column under-reports
  because it is stamped from `getActiveSessionId()` at write time
  ([mutations.ts](../../../src/mutations.ts) `insertPartyNote`), which is null whenever the DM's client
  did not have the session marked live.
- **`participants` is the cast, and it is the only attendance record there will ever be.**
  Channel Presence expires with the socket (0021 dropped `presence_users`), so nobody can reconstruct
  who was at the table after the night. 0029 treats this junction as "the on-screen party", PCs
  included. **Do not invent an Attendance line from names that appear in the notes.** When
  `pcsNotMarkedPresent` is non-empty the roster is incomplete: report the gap, ask the DM who was
  actually there, and offer to write the junction rows. Do that *before* drafting — attendance is the
  one fact that decays, and writing the rows also fixes `people.last_seen_session_id` for free via the
  `recompute_last_seen` trigger (0013).

  Two failure shapes, both seen on the S5 run, both fixed there:
  - *A PC exists but wasn't marked present.* `pcsNotMarkedPresent` catches this.
  - *A name acts in the notes with no person row at all.* "Eli" took an alias, helped strongarm Billy
    the Baker, and had no row anywhere in `people`. `unmatchedNames` flags candidates — capitalised
    words in the prose matching no entity — ranked by how often each recurs, capped at 25 with the
    remainder counted in `unmatchedNamesTruncated`.

    **Expect roughly half of it to be noise** and skim it anyway; it is cheap and the true positives
    are ones nothing else finds. On S5 it surfaces `Terry` (the Valley's Heart innkeeper, still with no
    row), the `Alvin`/Alivar ambiguity, and three misspellings of PCs already in the codex — `Elfea`,
    `Montegue`, `Faithbreak` — alongside aliases and sentence openers. Misspellings matter beyond
    tidiness: a name the codex can't match is a name future searches and relations will miss.

  Because attendance is fixed before drafting, the campaign's own S5 entry now has a full
  `**Attendance:**` line — do not expect the gap to be present when you re-read that session.
- **`timeline` rows are often cleaner than the feed note that preceded them.** S5's "Group gone
  undercover" event spells the aliases correctly (Glaiveburner, Buick LeSabre) where the live-typed
  feed note does not. Prefer the event's prose where the two disagree.
- **`notesNearWindow`** is the hour either side — prep written before the start row, or a note typed
  after the end. Never fold these in silently. If one looks like it belongs, ask.

If `ambiguousNum` is non-null, two sessions share that `num` (as `foi-s37`/`foi-s37b` do). Stop and ask
which one before writing anything.

If `window.openEnded` is true the session has no `end` row — it is still live, or the DM never closed
it out. The note window runs to now, so late rows are included, but say so in your draft: the night may
not be over, and a recap written mid-session will need rewriting.

## Step 2 — The publication boundary

`sessions.summary` is **public** — it is projected to players, including anonymous viewers.
`gather.ts` runs on the service-role key, which **bypasses RLS entirely**, so the database will not
stop you publishing a secret. The script therefore drops hidden entities and every event, note and
connection touching them before you ever see the bundle, mirroring `sessionFeedToMarkdown`'s rule
(hidden reveals dropped whole, link rows checked on both endpoints, because even a label snapshot
leaks). Check the `excluded` counts and mention them in your draft summary to the user — "3 events
withheld as hidden" is information the DM wants.

Two obligations that stay yours because no filter can enforce them:

- **Write only from the bundle.** Do not import what you happen to know about the campaign from
  elsewhere in the conversation, from DM notes, or from a prior turn. If the bundle does not contain
  it, it does not go in the recap.
- **Do not resolve what the table did not.** If the session ended with Billy the Baker bleeding out,
  the recap ends with him bleeding out. Never write the outcome of a cliffhanger, never name the thing
  behind a mystery, and never smooth over a contradiction in the notes — flag it to the user instead.
- **Notes record actions, not motives. Never supply the reason.** This is the failure that actually
  happened on S5's first draft. The note read *"Party decided that Jo takes Derin while the party goes
  undercover"*, and the draft rendered it as Jo taking Derin *home* — which was wrong: Jo was pursuing
  her own thread and simply had custody of him. The note said what was done, the draft invented why,
  and it was plausible enough that only the DM could catch it. When a note gives you a verb without a
  purpose, write the verb. If the purpose matters to the sentence, ask.

## Step 3 — Draft the prose

Read `styleExemplar.summary` first and match it: heading style, tense, person, length per section,
whether the campaign opens with an **Attendance:** line, whether it code-switches (Fendwick's S4 drops
a Dutch aside). Voice is per-campaign — do not carry Fendwick's register into Fist of Ilmater.

Shape:

- Group the night into 3–6 `###` sections by *scene or thread*, not by timestamp. The feed is
  chronological; prose should be legible.
- Lead with what changed for the party, not with what was revealed to the codex. A `reveal` row is a
  bookkeeping act; the story beat is what the NPC said.
- Name entities exactly as `entityLabel` gives them, so links and future searches match.
- Keep the DM's own phrasing where it has voice. Notes are written at speed and contain typos
  ("quote a queue", "feint headache") — fix those silently, but do not rewrite a good line.
- **Never silently normalise a proper noun.** A misspelt common word is a typo; a misspelt name might
  be a different person. S5's feed says *"Alvin gives each of us 10 gp"* one line after Alivar Thalin
  hands over a ring — almost certainly the same man, but "almost certainly" is the DM's call, not
  yours. Pick the reading that fits, and flag it.
- Close with the threads left open. This is the section that feeds Step 4.

Present the full markdown in chat for review. Do not write anything yet.

### Alongside the draft, list what you could not settle

A short numbered section under the prose, separate from it. Each entry names the ambiguity, says which
way you wrote it, and makes the fix a one-liner for the DM. From the S5 run, the four that mattered:
a name that might be two people (Alvin/Alivar); a note whose *timing* changes its meaning (whether
Venice saw the stabbing in town that day or before he fled); a stylistic tic in the exemplar you chose
not to imitate because inventing a table's in-joke isn't yours to do; and anything from
`notesNearWindow` you left out.

Do not fold these into the prose as hedges. The recap should read cleanly and commit to a reading; the
list is where the uncertainty is recorded.

## Step 4 — The goals pass (offer it; skip if the user declines)

Bidirectional, and the second half is the one that gets forgotten:

1. **New goals** from threads the session opened. Phrase them the way the campaign phrases goals —
   check `openGoals[].text` for voice and `owner`/`kind` for the right values.
2. **Existing goals this session resolved or advanced.** Every `openGoals` row still at
   `status: "pursuing"` gets checked against what happened. Worked example, from Fendwick S5: `fw-g1`
   read "Consider Thalin's offer … He gave us the night". The party considered it, took it, and handed
   over a dagger to fake their deaths — but the goal was still sitting at `pursuing` two sessions later,
   because nothing in the write path closes a goal. Nothing ever will. This half is manual by nature.

**Valid statuses are `pursuing`, `whispered`, `resolved`, `lost`** — the ordering `sortEntities` uses
(`src/data.ts`). There is no "achieved"/"done"/"complete"; inventing one writes a value no view sorts.

A goal is a thing the party means to *do*. An open question the night raised — a sound in the forest, a
stranger's half-heard sentence — is not a goal, and forcing it into one distorts both. Those belong in
the recap's closing section. Say so when you leave one out, so the DM can overrule you.

Propose these as a diff — new rows to insert, existing ids to re-status — and let the user edit it.

## Step 5 — Write, on explicit approval only

Only after the user approves the prose and the diff. Never bundle this into the same turn as the draft.

```bash
# summary
curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/sessions?id=eq.<session-id>" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d @summary.json   # {"summary": "…"} — write the body from a file, not inline

# goal re-status
curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/goals?id=eq.<goal-id>" … -d '{"status":"resolved"}'
```

Rules for the write:

- **Build the JSON body in a file** and POST with `-d @file`. Recap prose contains quotes, apostrophes
  and newlines; inlining it into a shell string mangles it.
- **New goal ids are `crypto.randomUUID()`** per the repo convention, even though the seeded Fendwick
  rows use `fw-gN`. Include `campaign_id`.
- **This bypasses [src/mutations.ts](../../../src/mutations.ts) and RLS.** That is acceptable for an
  out-of-band authoring task run by the DM, and it is exactly why Steps 2 and 5 gate on approval.
  Do not extend the pattern to anything the app itself should be doing.
- **`summary` may already have content.** Read it back before writing (the bundle has it) and confirm
  with the user whether you are replacing or appending — the app's own button appends.
- `date` is free text (`"26 July 2026"`), not a date type. Match the format the campaign already uses.
- Confirm the write landed by reading the row back, and report the result plainly.
