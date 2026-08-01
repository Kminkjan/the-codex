// How a piece of artwork is framed: where the subject sits, and how tightly to
// crop on it. Pure, like monsters.ts and saga.ts, and voice-neutral for the same
// reason: a pure module can't reach <ThemedLabel>.
//
// ============================================================================
// ONE POINT, EVERY CROP BOX. Do not add a per-surface variant.
//
// Under `object-fit: cover`, `object-position: X% Y%` means "align this fraction
// of the IMAGE with this fraction of the BOX". That makes a normalized point
// box-independent by construction — the same stored value frames the artwork
// correctly in all four boxes the app crops to:
//
//   1 / 1    parchment person portrait well   (styles.css .card-poster .portrait)
//   16 / 10  the Atlas override of all three art wells
//   4 / 3    parchment monster plate / bestiary plate
//   56px sq  the live-session spotlight thumb
//
// With tall art in a wide box, Y does the work and X is a no-op; with wide art
// in a tall box, vice versa. Nothing here needs to know which box it is being
// asked about, and a function that took an aspect ratio would be a sign someone
// had started storing crops instead of a point. See migration 0036.
// ============================================================================
//
// ============================================================================
// ZOOM (0037) IS THE SECOND AXIS, AND IT ONLY GOES IN.
//
// A point fixes where the crop sits, not how much of the artwork it takes — a
// full-body illustration can have its face in frame and still be a tenth of a
// 16:10 card. So a focus optionally carries a factor z.
//
// It is applied as `transform: scale(z)` with `transform-origin` at the SAME
// percentages as object-position, and that pairing is the whole trick. Because
// object-position has already aligned the image's (X%, Y%) with the box's
// (X%, Y%), the subject is sitting at exactly (X%, Y%) of the element box — so a
// transform-origin there holds it stationary while everything expands around
// it. Zoom pulls toward the subject on every surface with no per-box arithmetic,
// exactly like the point itself. THIS IS WHY focusImageStyle() RETURNS ALL
// THREE PROPERTIES TOGETHER: set objectPosition at one call site and
// transformOrigin at another and they will eventually disagree, at which point
// zooming quietly drifts off the subject.
//
// z < 1 IS NOT EXPRESSIBLE, by design. `cover` already fills the well, so
// scaling below 1 would expose empty space rather than reveal more artwork.
// There is no zoom-out; the floor is 1 (= no zoom).
//
// The 2.5 ceiling is a resolution judgement, not a taste one: upload.ts stores
// the original file untouched with no image service in front of it, so zoom is a
// straight upscale and a modest upload visibly softens past roughly 2.5x. This
// range must agree with the CHECK constraint in migration 0037.
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
//   stored  "50 22"        bare numbers, no CSS tokens, checked by a regex in
//           "50 22 1.8"    the DB and re-checked by parseFocus here
//   used    "50% 22%"      CSS, produced ONLY by focusImageStyle
//           "scale(1.8)"
//
// Anything that does not parse yields `undefined`, which callers must spread
// straight into `style` — React omits undefined properties, so the existing
// centred, unzoomed CSS applies and a malformed row degrades to the original
// behaviour instead of injecting anything. Never interpolate a raw image_focus
// value into CSS; never widen parseFocus to be "helpful" about values like
// "50% 22%" or "center top". scripts/focus-check.ts asserts both.
//
// Two different contracts, deliberately:
//   clampFocus   — for POINTER/slider input, which legitimately runs past the
//                  ends of its range. Out of range is pulled to the limit.
//   parseFocus   — for STORED text. Out of range is rejected outright, because
//                  it can only mean the value did not come from this module.
// ============================================================================

/** How an image is framed: a focal point, plus how tightly to crop on it. */
export interface Focus {
  /** 0 = left edge, 100 = right edge. Integer. */
  x: number;
  /** 0 = top edge, 100 = bottom edge. Integer. */
  y: number;
  /** Scale factor toward the point. 1 = no zoom. MIN_ZOOM..MAX_ZOOM, 1 decimal. */
  z: number;
}

/** What a null/absent image_focus means, and what CSS already does. */
export const CENTER: Focus = { x: 50, y: 50, z: 1 };

/** `cover` already fills the well, so there is nothing below 1 to express. */
export const MIN_ZOOM = 1;
/** Beyond this a raw upload visibly softens — see the header. Matches 0037. */
export const MAX_ZOOM = 2.5;

// Position is integers; zoom is one decimal. Sub-percent precision on the point
// is meaningless (in the tightest surface, the 170px detail portrait, 1% is
// under two pixels) and it keeps the DB constraint a plain anchored regex.
//
// The third group deliberately excludes `1` and `1.0`: those are a second
// spelling of the two-token form, and serializeFocus omits the token entirely at
// 1x so that "not zoomed" has exactly one canonical stored form.
// Must stay in step with migration 0037.
const STORED = /^(100|[0-9]{1,2}) (100|[0-9]{1,2})( (1\.[1-9]|2(\.[0-5])?))?$/;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Pull a focus into range. For live input, which can run past the ends. */
export function clampFocus(f: Focus): Focus {
  const pct = (n: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50);
  const zoom = (n: number) =>
    Number.isFinite(n) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, round1(n))) : MIN_ZOOM;
  return { x: pct(f.x), y: pct(f.y), z: zoom(f.z) };
}

/**
 * Stored text → focus, or `undefined` if the value is anything other than the
 * exact shape this module writes. Rejects rather than clamps: a stored value
 * out of range didn't come from serializeFocus, so the honest reading is "no
 * focal point", not "some focal point I guessed at".
 */
export function parseFocus(raw: string | null | undefined): Focus | undefined {
  if (typeof raw !== "string") return undefined;
  const m = STORED.exec(raw);
  if (!m) return undefined;
  // Group 4 is the zoom without its leading space; absent means 1x.
  return { x: Number(m[1]), y: Number(m[2]), z: m[4] ? Number(m[4]) : MIN_ZOOM };
}

/**
 * Focus → stored text. Clamps first, so this can't produce a rejected value.
 * The zoom token is omitted at 1x — see STORED on why that spelling is the only
 * accepted one.
 */
export function serializeFocus(f: Focus): string {
  const c = clampFocus(f);
  return c.z === MIN_ZOOM ? `${c.x} ${c.y}` : `${c.x} ${c.y} ${c.z}`;
}

/** True when this focus asks for nothing that isn't already the CSS default. */
export function isDefaultFocus(f: Focus): boolean {
  const c = clampFocus(f);
  return c.x === CENTER.x && c.y === CENTER.y && c.z === CENTER.z;
}

/** The subset of an inline style a covered `<img>` needs. No React import. */
export interface FocusStyle {
  objectPosition?: string;
  transform?: string;
  transformOrigin?: string;
}

/**
 * Stored text → the inline style for an `object-fit: cover` image.
 *
 * Spread this into `style`; do not pick properties out of it. Every absent
 * property is load-bearing: an unparseable or centred value yields `{}`, React
 * writes no style at all, and the stylesheet's own centred default stands.
 * Substituting an explicit "50% 50%" would make every image outrank its theme
 * rules for no gain, and emitting `scale(1)` would create a compositing layer
 * on every card for nothing.
 *
 * The element MUST be inside a clipping box (`overflow: hidden`), or a zoomed
 * image bleeds outside its well. All four wells clip; see styles.css.
 */
export function focusImageStyle(raw: string | null | undefined): FocusStyle {
  const f = parseFocus(raw);
  if (!f) return {};
  const style: FocusStyle = {};
  if (f.x !== CENTER.x || f.y !== CENTER.y) style.objectPosition = `${f.x}% ${f.y}%`;
  if (f.z !== MIN_ZOOM) {
    style.transform = `scale(${f.z})`;
    // Same percentages as objectPosition, always — see the header. Stated
    // explicitly rather than defaulted, because the CSS default (50% 50%) would
    // silently zoom toward the middle instead of toward the subject.
    style.transformOrigin = `${f.x}% ${f.y}%`;
  }
  return style;
}

/**
 * A pointer position → a focal point, relative to the image element's own box.
 * Zoom is carried through untouched — aiming and zooming are separate gestures.
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
  z: number = MIN_ZOOM,
): Focus {
  if (!(rect.width > 0) || !(rect.height > 0)) return { ...CENTER, z: clampFocus({ ...CENTER, z }).z };
  return clampFocus({
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100,
    z,
  });
}

/** Keyboard adjustment of the point, in percentage points. Clamped like input. */
export function nudgeFocus(f: Focus, dx: number, dy: number, step = 1): Focus {
  return clampFocus({ x: f.x + dx * step, y: f.y + dy * step, z: f.z });
}

/** Keyboard/scroll adjustment of the zoom. Clamped to MIN_ZOOM..MAX_ZOOM. */
export function zoomFocus(f: Focus, delta: number): Focus {
  return clampFocus({ x: f.x, y: f.y, z: f.z + delta });
}
