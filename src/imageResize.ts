// Shrink an upload before it becomes a permanent public object.
//
// There is no image service in front of the `entity-images` bucket: whatever
// byte-for-byte file the uploader picked is what every viewer downloads, on
// every page load, forever. A phone photo is 4000px and 4 MB; the largest well
// it will ever be drawn into is a few hundred CSS pixels. So the compression
// happens once, in the browser, at the only moment where the original is still
// in hand and nobody has linked to it yet.
//
// ============================================================================
// THE DECISIONS THIS MODULE ENCODES
//
//   1. MAX_EDGE IS SET BY THE ZOOM CEILING, NOT BY THE WELL. src/imageFocus.ts
//      lets a focus zoom to MAX_ZOOM (2.5x) — a straight upscale, since nothing
//      re-renders the source. So the resolution that matters is the biggest
//      well times that ceiling times a 2x display, not the well itself. 2000px
//      clears that with room, and still cuts a 12 MP photo by an order of
//      magnitude. Lowering this is a visible-softening change, not a knob.
//   2. RE-ENCODING IS ALLOWED TO LOSE, RESIZING IS ALLOWED TO FAIL. Every step
//      below degrades to "upload what the user picked" rather than to an error
//      or to a mangled file. An unusual codec, a canvas that won't hand back
//      WebP, an image that decodes to nothing — all fall through to the
//      original. A portrait that is 3 MB is a far smaller problem than a
//      portrait that didn't upload.
//   3. ANIMATION AND VECTORS ARE NOT CANDIDATES. A canvas keeps one frame of a
//      GIF and rasterizes an SVG at one size — both are lossy in a way the
//      uploader would notice and did not ask for. They pass through untouched.
//   4. THE OUTPUT MUST EARN ITS PLACE. If the re-encode comes back no smaller,
//      the original wins. Already-optimized art (a tuned WebP, a flat PNG of a
//      sigil) exists, and replacing it with a bigger lossy copy would be a
//      strict loss on both axes.
//
// Pure, and voice-neutral for the reason monsters.ts and imageFocus.ts are: a
// pure module can't reach <ThemedLabel>. The one browser-only function is
// compressImage, kept at the bottom and behind the pure helpers it uses so
// scripts/image-check.ts can exercise the arithmetic without a DOM.
// ============================================================================

/** Longest edge, in pixels, that survives a resize. See note 1 in the header. */
export const MAX_EDGE = 2000;

/** WebP quality. 0.82 is the knee — visible artifacts start below ~0.75. */
export const QUALITY = 0.82;

/**
 * Types that are never re-encoded. GIF because a canvas would silently keep one
 * frame; SVG because rasterizing throws away the thing that makes it an SVG.
 */
const PASSTHROUGH = new Set(["image/gif", "image/svg+xml"]);

/** True when this file must be uploaded exactly as-is. See note 3. */
export function isPassthrough(type: string): boolean {
  return PASSTHROUGH.has(type.toLowerCase());
}

/**
 * Scale (w, h) to fit inside a `max` box, preserving aspect ratio. Never scales
 * up: an image already smaller than the box is returned unchanged, so a 400px
 * sigil doesn't get blown up to 2000px of interpolated nothing.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / longest;
  // At least 1px on the short edge: a 6000x2 panorama must not round to zero,
  // which canvas would reject outright.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * MIME type → file extension for the storage path.
 *
 * The extension is derived from the type of the bytes actually being uploaded,
 * never from the picked file's name: after a re-encode those two disagree, and
 * an object served as `portrait.png` containing WebP is the kind of thing that
 * works everywhere until it doesn't.
 */
export function extForType(type: string): string {
  switch (type.toLowerCase().split(";")[0].trim()) {
    case "image/webp": return "webp";
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/gif": return "gif";
    case "image/svg+xml": return "svg";
    case "image/avif": return "avif";
    default: return "bin";
  }
}

/**
 * Is the re-encoded candidate worth keeping over the original? See note 4.
 *
 * A resize is its own justification — fewer pixels means less decode work and
 * less memory on every client, even in the rare case where the bytes came out
 * even. Without a resize the only reason to swap is bytes, and it has to be a
 * real win rather than a rounding one, or a tuned source gets quietly traded
 * for a lossy copy of itself.
 */
export function isWorthKeeping(
  originalBytes: number,
  candidateBytes: number,
  didResize: boolean,
): boolean {
  if (candidateBytes <= 0) return false;
  if (didResize) return candidateBytes <= originalBytes;
  return candidateBytes < originalBytes * 0.9;
}

/** What compressImage did, for the caller's log line. */
export interface CompressResult {
  file: File;
  /** False when the original is being returned untouched, for any reason. */
  compressed: boolean;
  originalBytes: number;
  bytes: number;
}

/**
 * Downscale and re-encode an image to WebP, in the browser.
 *
 * Never throws and never returns something the caller couldn't have uploaded
 * anyway: every failure path yields the original file with `compressed: false`.
 * See note 2 — the fallback is the point, not an afterthought.
 */
export async function compressImage(file: File): Promise<CompressResult> {
  const original: CompressResult = {
    file,
    compressed: false,
    originalBytes: file.size,
    bytes: file.size,
  };
  if (isPassthrough(file.type)) return original;

  let bitmap: ImageBitmap;
  try {
    // `from-image` applies EXIF rotation while decoding, so a sideways phone
    // photo lands upright — the canvas has no orientation metadata to carry, so
    // this has to happen here or the rotation is lost. Browsers that don't know
    // the option ignore it and behave exactly as today.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return original;
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    if (!width || !height) return original;
    const didResize = width !== bitmap.width || height !== bitmap.height;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", QUALITY),
    );
    // A browser that can't encode WebP hands back a PNG (or null) instead of
    // refusing, so the type has to be checked rather than assumed. A PNG of a
    // photo is usually larger than the JPEG we started from, which is exactly
    // the trade note 4 exists to refuse.
    if (!blob || blob.type !== "image/webp") return original;
    if (!isWorthKeeping(file.size, blob.size, didResize)) return original;

    const base = file.name.replace(/\.[a-zA-Z0-9]+$/, "") || "image";
    return {
      file: new File([blob], `${base}.webp`, { type: "image/webp" }),
      compressed: true,
      originalBytes: file.size,
      bytes: blob.size,
    };
  } catch {
    return original;
  } finally {
    bitmap.close();
  }
}
