// The focal point of a piece of artwork — where in the image the subject
// actually is. Pure, like monsters.ts and saga.ts, and voice-neutral for the
// same reason: a pure module can't reach <ThemedLabel>.
//
// ============================================================================
// ONE POINT, EVERY CROP BOX. Do not add a per-surface variant.
//
// Under `object-fit: cover`, `object-position: X% Y%` means "align this
// fraction of the IMAGE with this fraction of the BOX". That makes a normalized
// point box-independent by construction — the same stored value frames the
// artwork correctly in all four boxes the app crops to:
//
//   1 / 1    parchment person portrait well   (styles.css .card-poster .portrait)
//   16 / 10  the Atlas override of all three art wells
//   4 / 3    parchment monster plate / bestiary plate
//   56px sq  the live-session spotlight thumb
//
// With tall art in a wide box, Y does the work and X is a no-op; with wide art
// in a tall box, vice versa. Nothing here needs to know which box it is being
// asked about, and a function that took an aspect ratio would be a sign someone
// had started storing crops instead of a point. See migration 0033.
// ============================================================================
//
// ============================================================================
// THE STORED VALUE IS UNTRUSTED TEXT BOUND FOR A STYLE ATTRIBUTE.
//
// image_focus is a client-written `text` column: RLS gates who may write it,
// not what they may write. Its only destination is an inline `style` attribute.
// So this module is the one place the two representations meet, and the
// boundary runs one way:
//
//   stored  "50 22"      bare integers, no CSS tokens, checked by a regex in
//                        the DB and re-checked by parseFocus here
//   used    "50% 22%"    CSS, produced ONLY by focusToObjectPosition
//
// Anything that does not parse yields `undefined`, which callers must pass
// straight to `objectPosition` — React omits an undefined style property, so
// the existing centred CSS default applies and a malformed row degrades to
// today's behaviour instead of injecting anything. Never interpolate a raw
// image_focus value into CSS; never widen parseFocus to be "helpful" about
// values like "50% 22%" or "center top". scripts/focus-check.ts asserts both.
//
// Two different contracts, deliberately:
//   clampFocus   — for POINTER input, which legitimately lands outside the
//                  image box mid-drag. Out of range is pulled to the edge.
//   parseFocus   — for STORED text. Out of range is rejected outright, because
//                  it can only mean the value did not come from this module.
// ============================================================================

/** A focal point in percentages of the image's own width and height. */
export interface Focus {
  /** 0 = left edge, 100 = right edge. Integer. */
  x: number;
  /** 0 = top edge, 100 = bottom edge. Integer. */
  y: number;
}

/** What a null/absent image_focus means, and what CSS already does. */
export const CENTER: Focus = { x: 50, y: 50 };

// Integers only. Sub-percent precision is meaningless — in the tightest
// surface, the 170px detail-sheet portrait, 1% is under two pixels — and it
// keeps the DB constraint (0033) a plain anchored regex rather than a
// parse-and-compare. This pattern must stay in step with that one.
const STORED = /^(100|[0-9]{1,2}) (100|[0-9]{1,2})$/;

/** Pull a point into range. For pointer input, which can land off the image. */
export function clampFocus(f: Focus): Focus {
  const fix = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50);
  return { x: fix(f.x), y: fix(f.y) };
}

/**
 * Stored text → point, or `undefined` if the value is anything other than the
 * exact shape this module writes. Rejects rather than clamps: a stored value
 * out of range didn't come from serializeFocus, so the honest reading is "no
 * focal point", not "some focal point I guessed at".
 */
export function parseFocus(raw: string | null | undefined): Focus | undefined {
  if (typeof raw !== "string") return undefined;
  const m = STORED.exec(raw);
  if (!m) return undefined;
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** Point → stored text. Clamps first, so this can't produce a rejected value. */
export function serializeFocus(f: Focus): string {
  const c = clampFocus(f);
  return `${c.x} ${c.y}`;
}

/**
 * Stored text → a CSS `object-position` value, or `undefined`.
 *
 * The `undefined` is load-bearing: callers pass it straight through to
 * `style={{ objectPosition: … }}`, React omits the property, and the
 * stylesheet's centred default stands. Do not substitute "50% 50%" for it —
 * an inline style would then override any future theme rule for no reason.
 */
export function focusToObjectPosition(raw: string | null | undefined): string | undefined {
  const f = parseFocus(raw);
  return f ? `${f.x}% ${f.y}%` : undefined;
}

/**
 * A pointer position → a focal point, relative to the image element's own box.
 *
 * `rect` must be the rect of the <img> itself, not of a padded container: the
 * reframe editor sizes its image with max-width/max-height and no fixed width
 * (the trick .plate-lightbox-img already uses) precisely so that the element
 * box IS the image box and there is no letterbox arithmetic to get wrong here.
 */
export function focusFromPoint(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): Focus {
  if (!(rect.width > 0) || !(rect.height > 0)) return CENTER;
  return clampFocus({
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
  });
}

/** Keyboard adjustment, in percentage points. Clamped like pointer input. */
export function nudgeFocus(f: Focus, dx: number, dy: number, step = 1): Focus {
  return clampFocus({ x: f.x + dx * step, y: f.y + dy * step });
}
