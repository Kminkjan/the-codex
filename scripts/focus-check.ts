// Focus harness: exercises the pure module in src/imageFocus.ts, which sits on
// the boundary between a client-written `text` column and an inline `style`
// attribute. That is the whole reason it exists as a module rather than a
// one-line template string at each of the five render sites.
//
// THE MODEL THESE FIXTURES ENCODE — not "does parsing work", but:
//
//   1. image_focus is UNTRUSTED TEXT BOUND FOR CSS. RLS gates who writes the
//      column, not what they write. So anything that is not exactly the shape
//      serializeFocus produces must parse to `undefined`, and the percent signs
//      must be added on the way OUT, never stored. A value like
//      "50 20; background:url(x)" must not survive to a style attribute.
//   2. `undefined` IS THE CONTRACT for "no focal point", not "50% 50%".
//      Callers pass it straight to style={{ objectPosition: … }}; React omits
//      the property and the stylesheet's centred default stands. Substituting
//      an explicit centre would make an inline style override every present and
//      future theme rule for no gain.
//   3. CLAMP vs REJECT are two different contracts and must not be unified.
//      Pointer input legitimately lands outside the image box mid-drag → clamp.
//      A stored value out of range can only mean it didn't come from this
//      module → reject. Making parseFocus clamp would launder bad data into
//      plausible-looking data.
//   4. ONE POINT SERVES EVERY CROP BOX. Under `object-fit: cover`,
//      object-position aligns a fraction of the IMAGE with the same fraction of
//      the BOX, so the stored value is box-independent by construction — it is
//      correct in the 1:1 parchment portrait well, the 16:10 Atlas well, the
//      4:3 bestiary plate and the 56px live thumb alike. No function here takes
//      an aspect ratio, and none should: a signature that did would be the
//      first symptom of someone storing crops instead of a point.
//
// Sibling of scripts/relations-check.ts and scripts/saga-check.ts.
//
// Usage: npx tsx scripts/focus-check.ts   (exits non-zero on any failure)
import {
  CENTER,
  clampFocus,
  focusFromPoint,
  focusToObjectPosition,
  nudgeFocus,
  parseFocus,
  serializeFocus,
} from "../src/imageFocus";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

console.log("\nround trip: a serialized point parses back to itself");
{
  const cases = [CENTER, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 22 }, { x: 7, y: 93 }];
  for (const f of cases) {
    const back = parseFocus(serializeFocus(f));
    check(`${JSON.stringify(f)} survives serialize → parse`,
      back?.x === f.x && back?.y === f.y, { wrote: serializeFocus(f), back });
  }
  check("the stored form is bare integers with one space", serializeFocus({ x: 50, y: 22 }) === "50 22",
    serializeFocus({ x: 50, y: 22 }));
}

console.log("\nrejected stored values parse to undefined (nothing reaches CSS)");
{
  // Every one of these is something a hand-edited row, an older client, or an
  // attacker with an editor's JWT could put in the column. None may produce a
  // style. The DB check constraint in 0033 is the other half of this; neither
  // half is allowed to be the only one.
  const bad: unknown[] = [
    "",                          // empty — and toRow coerces "" → null on write
    "50",                        // one token
    "50 22 7",                   // three tokens
    "50% 22%",                   // CSS — percent signs are NOT stored
    "50%22%",
    "center top",                // CSS keywords
    "red url(evil)",
    "50 20; background:url(x)",  // the injection shape this module exists to stop
    "50 20;",
    "-10 50",                    // out of range: reject, do not clamp
    "50 200",
    "101 50",
    "50.5 22",                   // decimals are not stored (0033 forbids them too)
    "NaN 50",
    "1e3 50",                    // Number() would accept this; the regex must not
    "+50 22",
    " 50 22",                    // stray whitespace
    "50 22 ",
    "50  22",                    // two spaces
    "50\t22",
    "50\n22",
    null,
    undefined,
    42,                          // not a string at all
    {},
    { x: 50, y: 22 },            // a Focus, not its serialization
  ];
  for (const raw of bad) {
    check(`parseFocus(${JSON.stringify(raw) ?? String(raw)}) === undefined`,
      parseFocus(raw as any) === undefined, parseFocus(raw as any));
    check(`...and yields no objectPosition`,
      focusToObjectPosition(raw as any) === undefined, focusToObjectPosition(raw as any));
  }
}

console.log("\nundefined is the contract for 'no focal point', not an explicit centre");
{
  check("focusToObjectPosition(null) === undefined", focusToObjectPosition(null) === undefined);
  check("focusToObjectPosition(undefined) === undefined", focusToObjectPosition(undefined) === undefined);
  // If this ever starts returning "50% 50%", every image in the app gains an
  // inline style that outranks the stylesheet — including the Atlas overrides.
  check("...specifically NOT '50% 50%'", focusToObjectPosition(undefined) !== "50% 50%");
}

console.log("\nthe percent signs are added on the way out, and only there");
{
  check("'50 22' → '50% 22%'", focusToObjectPosition("50 22") === "50% 22%",
    focusToObjectPosition("50 22"));
  check("'0 100' → '0% 100%'", focusToObjectPosition("0 100") === "0% 100%");
  check("x comes first (a transposed pair would look plausible and be wrong)",
    focusToObjectPosition("10 90") === "10% 90%");
}

console.log("\nclamp (pointer input) vs reject (stored value) — both directions");
{
  check("clampFocus pulls an out-of-range point to the edge",
    JSON.stringify(clampFocus({ x: -40, y: 180 })) === JSON.stringify({ x: 0, y: 100 }),
    clampFocus({ x: -40, y: 180 }));
  check("clampFocus rounds to the integer grid the column stores",
    JSON.stringify(clampFocus({ x: 33.6, y: 12.2 })) === JSON.stringify({ x: 34, y: 12 }),
    clampFocus({ x: 33.6, y: 12.2 }));
  check("clampFocus falls back to centre on a non-finite coordinate",
    JSON.stringify(clampFocus({ x: NaN, y: Infinity })) === JSON.stringify(CENTER),
    clampFocus({ x: NaN, y: Infinity }));
  // The asymmetry is the point: the same out-of-range pair is clamped as input
  // and rejected as storage.
  check("parseFocus REJECTS what clampFocus would have fixed", parseFocus("-40 180") === undefined);
  check("serializeFocus can never produce a value parseFocus rejects",
    parseFocus(serializeFocus({ x: -40, y: 180 })) !== undefined,
    serializeFocus({ x: -40, y: 180 }));
}

console.log("\nfocusFromPoint: percentages of the image element's own box");
{
  const rect = { left: 100, top: 50, width: 200, height: 400 };
  check("centre of the box", JSON.stringify(focusFromPoint(rect, 200, 250)) === JSON.stringify(CENTER),
    focusFromPoint(rect, 200, 250));
  check("top-left corner",
    JSON.stringify(focusFromPoint(rect, 100, 50)) === JSON.stringify({ x: 0, y: 0 }));
  check("bottom-right corner",
    JSON.stringify(focusFromPoint(rect, 300, 450)) === JSON.stringify({ x: 100, y: 100 }));
  check("a face near the top of tall art",
    JSON.stringify(focusFromPoint(rect, 200, 130)) === JSON.stringify({ x: 50, y: 20 }),
    focusFromPoint(rect, 200, 130));
  check("a drag that leaves the box is clamped, not extrapolated",
    JSON.stringify(focusFromPoint(rect, -500, 9999)) === JSON.stringify({ x: 0, y: 100 }));
  // A zero-height rect happens for one frame if the editor measures before the
  // image has laid out; returning centre beats NaN reaching a style attribute.
  check("a degenerate rect yields centre, not NaN",
    JSON.stringify(focusFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)) === JSON.stringify(CENTER));
}

console.log("\nnudgeFocus: keyboard adjustment, clamped at the edges");
{
  check("default step is one percentage point",
    JSON.stringify(nudgeFocus(CENTER, 0, -1)) === JSON.stringify({ x: 50, y: 49 }));
  check("an explicit step multiplies",
    JSON.stringify(nudgeFocus(CENTER, 1, 0, 10)) === JSON.stringify({ x: 60, y: 50 }));
  check("nudging past the edge stops at the edge",
    JSON.stringify(nudgeFocus({ x: 2, y: 98 }, -1, 1, 10)) === JSON.stringify({ x: 0, y: 100 }),
    nudgeFocus({ x: 2, y: 98 }, -1, 1, 10));
  check("a nudged point is always storable", parseFocus(serializeFocus(nudgeFocus(CENTER, -1, -1, 999))) !== undefined);
}

console.log("\nbox independence: no API here takes an aspect ratio");
{
  // Guards intent, not behaviour. If a reviewer is tempted to add
  // focusToObjectPosition(raw, aspect), this is the note explaining why the
  // answer is no: object-position under `cover` is already box-relative, so a
  // per-box variant could only diverge from the correct answer.
  check("focusToObjectPosition takes exactly one argument", focusToObjectPosition.length === 1,
    focusToObjectPosition.length);
  check("the same stored point serves every surface unchanged",
    focusToObjectPosition("50 20") === "50% 20%" && focusToObjectPosition("50 20") === focusToObjectPosition("50 20"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
