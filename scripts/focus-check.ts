// Focus harness: exercises the pure module in src/imageFocus.ts, which sits on
// the boundary between a client-written `text` column and an inline `style`
// attribute. That is the whole reason it exists as a module rather than a
// one-line template string at each of the five render sites.
//
// THE MODEL THESE FIXTURES ENCODE — not "does parsing work", but:
//
//   1. image_focus is UNTRUSTED TEXT BOUND FOR CSS. RLS gates who writes the
//      column, not what they write. So anything that is not exactly the shape
//      serializeFocus produces must parse to `undefined`, and the CSS units must
//      be added on the way OUT, never stored. A value like
//      "50 20; background:url(x)" must not survive to a style attribute.
//   2. AN ABSENT PROPERTY IS THE CONTRACT for "nothing to do", not an explicit
//      default. Callers spread focusImageStyle() into `style`; React omits
//      undefined properties and the stylesheet's own centred, unzoomed rules
//      stand. An explicit "50% 50%" would make every image outrank its theme
//      rules, and an explicit `scale(1)` would create a compositing layer on
//      every card for nothing.
//   3. CLAMP vs REJECT are two different contracts and must not be unified.
//      Live input (a drag, a slider) legitimately runs past the ends of its
//      range → clamp. A stored value out of range can only mean it didn't come
//      from this module → reject. Making parseFocus clamp would launder bad data
//      into plausible data.
//   4. ONE POINT SERVES EVERY CROP BOX. Under `object-fit: cover`,
//      object-position aligns a fraction of the IMAGE with the same fraction of
//      the BOX, so the stored value is box-independent by construction — it is
//      correct in the 1:1 parchment portrait well, the 16:10 Atlas well, the
//      4:3 bestiary plate and the 56px live thumb alike. No function here takes
//      an aspect ratio, and none should: a signature that did would be the
//      first symptom of someone storing crops instead of a point.
//   5. ZOOM AND POSITION SHARE THEIR PERCENTAGES (0037). transform-origin must
//      always equal object-position, because object-position has already put the
//      subject at (X%, Y%) of the element box. Let them drift and zoom silently
//      pulls toward the middle instead of toward the subject — which is why
//      focusImageStyle returns all three properties together and why the tests
//      below assert the pairing rather than each property alone.
//   6. THERE IS EXACTLY ONE STORED SPELLING OF "NOT ZOOMED". The zoom token is
//      omitted at 1x, so every two-token value 0036 wrote is still canonical and
//      "1"/"1.0" are rejected as a second spelling of the same thing.
//
// Sibling of scripts/relations-check.ts and scripts/saga-check.ts.
//
// Usage: npx tsx scripts/focus-check.ts   (exits non-zero on any failure)
import {
  CENTER,
  MAX_ZOOM,
  MIN_ZOOM,
  clampFocus,
  focusFromPoint,
  focusImageStyle,
  isDefaultFocus,
  nudgeFocus,
  parseFocus,
  serializeFocus,
  zoomFocus,
  type Focus,
} from "../src/imageFocus";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const at = (x: number, y: number, z = MIN_ZOOM): Focus => ({ x, y, z });
// Reading these back off the style object asserts, on every case below, that
// focusImageStyle still routes x/y to objectPosition and z to transform.
const objectPositionOf = (raw: string | null | undefined) => focusImageStyle(raw).objectPosition;
const transformOf = (raw: string | null | undefined) => focusImageStyle(raw).transform;

console.log("\nround trip: a serialized focus parses back to itself");
{
  const cases: Focus[] = [
    CENTER, at(0, 0), at(100, 100), at(50, 22), at(7, 93),
    at(50, 20, 1.8), at(0, 0, MAX_ZOOM), at(100, 100, 1.1), at(33, 12, 2),
  ];
  for (const f of cases) {
    const back = parseFocus(serializeFocus(f));
    check(`${JSON.stringify(f)} survives serialize → parse`, eq(back, f),
      { wrote: serializeFocus(f), back });
  }
  check("two tokens when unzoomed", serializeFocus(at(50, 22)) === "50 22", serializeFocus(at(50, 22)));
  check("three tokens when zoomed", serializeFocus(at(50, 22, 1.8)) === "50 22 1.8",
    serializeFocus(at(50, 22, 1.8)));
  // The 0036 → 0037 compatibility guarantee, stated as a test: everything the
  // previous migration could have written is still canonical and still means 1x.
  check("a pre-zoom stored value still parses, at 1x", eq(parseFocus("50 20"), at(50, 20, 1)));
  check("...and re-serializes unchanged", serializeFocus(parseFocus("50 20")!) === "50 20");
}

console.log("\nrejected stored values parse to undefined (nothing reaches CSS)");
{
  // Every one of these is something a hand-edited row, an older client, or an
  // attacker with an editor's JWT could put in the column. None may produce a
  // style. The DB check constraint in 0037 is the other half of this; neither
  // half is allowed to be the only one.
  const bad: unknown[] = [
    "",                          // empty — and toRow coerces "" → null on write
    "50",                        // one token
    "50 22 1.5 3",               // four tokens
    "50% 22%",                   // CSS — percent signs are NOT stored
    "50%22%",
    "center top",                // CSS keywords
    "red url(evil)",
    "50 20; background:url(x)",  // the injection shape this module exists to stop
    "50 20 scale(9)",
    "50 20;",
    "-10 50",                    // out of range: reject, do not clamp
    "50 200",
    "101 50",
    "50.5 22",                   // decimals on the point are not stored
    "NaN 50",
    "1e3 50",                    // Number() would accept this; the regex must not
    "+50 22",
    " 50 22",                    // stray whitespace
    "50 22 ",
    "50  22",                    // two spaces
    "50\t22",
    "50\n22",
    "50 22 1",                   // a second spelling of "not zoomed" — see note 6
    "50 22 1.0",
    "50 22 0.5",                 // zoom-out is not expressible
    "50 22 0",
    "50 22 -1.5",
    "50 22 2.6",                 // past MAX_ZOOM
    "50 22 3",
    "50 22 10",
    "50 22 1.85",                // two decimals
    "50 22 1.",
    "50 22 .5",
    "50 22 2.5x",                // the unit belongs to CSS, not to the column
    null,
    undefined,
    42,                          // not a string at all
    {},
    { x: 50, y: 22, z: 1 },      // a Focus, not its serialization
  ];
  for (const raw of bad) {
    check(`parseFocus(${JSON.stringify(raw) ?? String(raw)}) === undefined`,
      parseFocus(raw as any) === undefined, parseFocus(raw as any));
    check(`...and yields an empty style`, eq(focusImageStyle(raw as any), {}),
      focusImageStyle(raw as any));
  }
}

console.log("\nan absent property is the contract, not an explicit default");
{
  check("null → {}", eq(focusImageStyle(null), {}));
  check("undefined → {}", eq(focusImageStyle(undefined), {}));
  check("dead centre at 1x → {} (nothing to override)", eq(focusImageStyle("50 50"), {}));
  // If either of these ever starts being emitted, every image in the app gains
  // an inline style that outranks the stylesheet — including the Atlas overrides
  // — and every card gains a compositing layer for a no-op transform.
  check("...specifically NOT objectPosition 50% 50%", objectPositionOf("50 50") !== "50% 50%");
  check("...specifically NOT transform scale(1)", transformOf("50 50") !== "scale(1)");
  // A centred zoom emits the transform and pins its origin, but still omits
  // objectPosition: 50% 50% is that property's CSS initial value, so writing it
  // would buy nothing and cost an override of every present and future theme
  // rule. transformOrigin is pinned anyway — see the pairing block below for why
  // it is unconditional rather than "only when off-centre".
  check("a centred zoom emits transform + origin but not objectPosition",
    eq(focusImageStyle("50 50 1.5"), { transform: "scale(1.5)", transformOrigin: "50% 50%" }),
    focusImageStyle("50 50 1.5"));
}

console.log("\nthe CSS units are added on the way out, and only there");
{
  check("'50 22' → objectPosition '50% 22%'", objectPositionOf("50 22") === "50% 22%",
    objectPositionOf("50 22"));
  check("'0 100' → '0% 100%'", objectPositionOf("0 100") === "0% 100%");
  check("x comes first (a transposed pair would look plausible and be wrong)",
    objectPositionOf("10 90") === "10% 90%");
  check("'50 20 1.8' → transform 'scale(1.8)'", transformOf("50 20 1.8") === "scale(1.8)",
    transformOf("50 20 1.8"));
  check("...and no zoom means no transform at all", transformOf("50 20") === undefined);
}

console.log("\nzoom and position share their percentages (never let these drift)");
{
  // The invariant, stated exactly: a transform ALWAYS carries an origin at the
  // point's own percentages, and whenever objectPosition is also present the two
  // are identical. objectPosition is absent only in the one case where it would
  // restate its own CSS initial value (dead centre), so "both present ⇒ equal"
  // is the drift guard, and "transform ⇒ origin" is unconditional.
  for (const raw of ["50 20 1.8", "0 0 1.1", "100 100 2.5", "7 93 2", "50 50 1.5"]) {
    const s = focusImageStyle(raw);
    const point = parseFocus(raw)!;
    check(`${raw}: transform carries an origin at the point`,
      s.transformOrigin === `${point.x}% ${point.y}%`, s);
    check(`${raw}: ...and agrees with objectPosition wherever that is set`,
      !s.objectPosition || s.objectPosition === s.transformOrigin, s);
  }
  // The failure this guards is silent and specific: with the CSS default origin
  // (50% 50%) a zoom pulls toward the middle of the well instead of toward the
  // subject, so an off-centre focal point gets *less* accurate the more you zoom.
  const off = focusImageStyle("20 15 2");
  check("an off-centre zoom does NOT fall back to the 50% 50% CSS default",
    off.transformOrigin === "20% 15%", off);
  check("a zoomed focus never emits transform without transformOrigin",
    !("transform" in off) || !!off.transformOrigin, off);
}

console.log("\nclamp (live input) vs reject (stored value) — both directions");
{
  check("clampFocus pulls an out-of-range point to the edge",
    eq(clampFocus(at(-40, 180)), at(0, 100)), clampFocus(at(-40, 180)));
  check("clampFocus rounds the point to the integer grid the column stores",
    eq(clampFocus(at(33.6, 12.2)), at(34, 12)), clampFocus(at(33.6, 12.2)));
  check("clampFocus holds zoom at the 1x floor (there is no zoom-out)",
    clampFocus(at(50, 50, 0.2)).z === MIN_ZOOM, clampFocus(at(50, 50, 0.2)));
  check("clampFocus holds zoom at the MAX_ZOOM ceiling",
    clampFocus(at(50, 50, 99)).z === MAX_ZOOM, clampFocus(at(50, 50, 99)));
  check("clampFocus rounds zoom to one decimal",
    clampFocus(at(50, 50, 1.6449)).z === 1.6, clampFocus(at(50, 50, 1.6449)));
  check("clampFocus falls back to centre/1x on non-finite input",
    eq(clampFocus({ x: NaN, y: Infinity, z: NaN }), CENTER),
    clampFocus({ x: NaN, y: Infinity, z: NaN }));
  // The asymmetry is the point: the same out-of-range value is clamped as input
  // and rejected as storage.
  check("parseFocus REJECTS the point clampFocus would have fixed", parseFocus("-40 180") === undefined);
  check("parseFocus REJECTS the zoom clampFocus would have fixed", parseFocus("50 50 99") === undefined);
  check("serializeFocus can never produce a value parseFocus rejects",
    parseFocus(serializeFocus(at(-40, 180, 99))) !== undefined, serializeFocus(at(-40, 180, 99)));
  check("...including at the zoom floor, where the token must vanish",
    serializeFocus(at(50, 20, 0.1)) === "50 20", serializeFocus(at(50, 20, 0.1)));
}

console.log("\nisDefaultFocus: what Save stores as NULL");
{
  check("dead centre at 1x is default", isDefaultFocus(CENTER));
  check("centre but zoomed is NOT default", !isDefaultFocus(at(50, 50, 1.5)));
  check("off-centre at 1x is NOT default", !isDefaultFocus(at(50, 20)));
  check("a below-floor zoom clamps to 1x and so IS default", isDefaultFocus(at(50, 50, 0.4)));
}

console.log("\nfocusFromPoint: percentages of the image element's own box");
{
  const rect = { left: 100, top: 50, width: 200, height: 400 };
  check("centre of the box", eq(focusFromPoint(rect, 200, 250), CENTER), focusFromPoint(rect, 200, 250));
  check("top-left corner", eq(focusFromPoint(rect, 100, 50), at(0, 0)));
  check("bottom-right corner", eq(focusFromPoint(rect, 300, 450), at(100, 100)));
  check("a face near the top of tall art", eq(focusFromPoint(rect, 200, 130), at(50, 20)),
    focusFromPoint(rect, 200, 130));
  check("a drag that leaves the box is clamped, not extrapolated",
    eq(focusFromPoint(rect, -500, 9999), at(0, 100)));
  // Aiming must not silently undo a zoom the editor already chose — a click
  // after zooming moves the point, it does not reset the tightness.
  check("zoom is carried through untouched", focusFromPoint(rect, 200, 130, 1.8).z === 1.8);
  check("...and is clamped like any live input", focusFromPoint(rect, 200, 130, 99).z === MAX_ZOOM);
  check("zoom defaults to 1x when not supplied", focusFromPoint(rect, 200, 130).z === MIN_ZOOM);
  // A zero-height rect happens for one frame if the editor measures before the
  // image has laid out; returning centre beats NaN reaching a style attribute.
  check("a degenerate rect yields centre, not NaN",
    eq(focusFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10), CENTER));
  check("...and still honours the zoom it was given",
    focusFromPoint({ left: 0, top: 0, width: 0, height: 0 }, 10, 10, 1.5).z === 1.5);
}

console.log("\nnudgeFocus / zoomFocus: keyboard adjustment, clamped at the ends");
{
  check("default step is one percentage point", eq(nudgeFocus(CENTER, 0, -1), at(50, 49)));
  check("an explicit step multiplies", eq(nudgeFocus(CENTER, 1, 0, 10), at(60, 50)));
  check("nudging past the edge stops at the edge",
    eq(nudgeFocus(at(2, 98), -1, 1, 10), at(0, 100)), nudgeFocus(at(2, 98), -1, 1, 10));
  check("nudging preserves zoom", nudgeFocus(at(50, 50, 1.7), 0, -1).z === 1.7);
  check("zoomFocus steps by its delta", zoomFocus(CENTER, 0.1).z === 1.1);
  check("zoomFocus stops at the ceiling", zoomFocus(at(50, 50, MAX_ZOOM), 0.1).z === MAX_ZOOM);
  check("zoomFocus stops at the floor", zoomFocus(CENTER, -0.1).z === MIN_ZOOM);
  check("zoomFocus preserves the point", eq(zoomFocus(at(20, 15), 0.5), at(20, 15, 1.5)));
  check("a nudged focus is always storable",
    parseFocus(serializeFocus(nudgeFocus(CENTER, -1, -1, 999))) !== undefined);
  check("a zoomed focus is always storable",
    parseFocus(serializeFocus(zoomFocus(CENTER, 999))) !== undefined,
    serializeFocus(zoomFocus(CENTER, 999)));
}

console.log("\nbox independence: no API here takes an aspect ratio");
{
  // Guards intent, not behaviour. If a reviewer is tempted to add
  // focusImageStyle(raw, aspect), this is the note explaining why the answer is
  // no: object-position and transform-origin under `cover` are already
  // box-relative, so a per-box variant could only diverge from the right answer.
  check("focusImageStyle takes exactly one argument", focusImageStyle.length === 1,
    focusImageStyle.length);
  check("the same stored focus serves every surface unchanged",
    eq(focusImageStyle("50 20 1.8"), focusImageStyle("50 20 1.8")));
  check("MIN_ZOOM is 1 — cover already fills the well, so there is no zoom-out",
    MIN_ZOOM === 1);
  // Bound to the DB constraint in 0037. If someone widens one, this fails and
  // points at the other.
  check("MAX_ZOOM matches the 0037 CHECK constraint's ceiling", MAX_ZOOM === 2.5, MAX_ZOOM);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
