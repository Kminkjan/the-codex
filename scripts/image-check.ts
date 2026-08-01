// Image harness: exercises the pure arithmetic in src/imageResize.ts, the step
// that stands between a picked file and a permanent public bucket object.
//
// THE MODEL THESE FIXTURES ENCODE — not "does the math work", but:
//
//   1. THE COMPRESSION IS ONE-WAY AND FOREVER. There is no image service in
//      front of `entity-images`; the bytes this module produces are the only
//      copy that will ever exist, served to every viewer on every load. So the
//      rules below are about what may be *destroyed*, and every one of them
//      errs toward keeping what the uploader picked.
//   2. NEVER UPSCALE. fitWithin is a ceiling, not a target. An image already
//      under the cap comes back untouched — blowing a 400px sigil up to 2000px
//      would cost bytes to add interpolated nothing, and it is the easy bug to
//      write when the function is read as "resize to MAX_EDGE".
//   3. THE CANDIDATE MUST EARN ITS PLACE. A resize justifies itself (fewer
//      pixels to decode on every client), but an unresized re-encode has to be
//      a real byte win, not a rounding one. Without that floor, a hand-tuned
//      WebP gets silently traded for a slightly-smaller lossy copy of itself,
//      which loses quality to gain almost nothing.
//   4. ANIMATION AND VECTORS ARE NOT CANDIDATES. A canvas keeps one frame of a
//      GIF and rasterizes an SVG at exactly one size. Both are losses the
//      uploader would notice and did not ask for, so they never enter the
//      pipeline at all — this is a type check, deliberately, not a "did it get
//      smaller" check that an animated GIF would happily pass.
//   5. THE EXTENSION FOLLOWS THE BYTES, NEVER THE PICKED FILENAME. After a
//      re-encode the two disagree, and an object stored as `portrait.png`
//      containing WebP is the kind of thing that works everywhere until some
//      client trusts the extension. extForType maps the type actually being
//      uploaded; upload.ts only falls back to the filename for a type this
//      module doesn't know, which by definition is one it passed through.
//
// The one browser-only function in that module (compressImage) can't run here —
// no canvas, no createImageBitmap. That is exactly why the decisions it makes
// live in pure helpers it calls rather than inline in its body.
//
// Sibling of scripts/focus-check.ts and scripts/bestiary-check.ts.
//
// Usage: npx tsx scripts/image-check.ts   (exits non-zero on any failure)
import {
  MAX_EDGE,
  QUALITY,
  extForType,
  fitWithin,
  isPassthrough,
  isWorthKeeping,
} from "../src/imageResize";
import { pathToSweep, storagePathFromUrl } from "../src/storagePath";

let failures = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.log(`  FAIL ${name}`, extra ?? "");
};

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const box = (width: number, height: number) => ({ width, height });

console.log("\nfitWithin: a ceiling, never a target");
{
  // Note 2. Each of these is already inside the box and must come back
  // byte-identical, including the degenerate and the exactly-at-the-limit case.
  const untouched: Array<[number, number]> = [
    [400, 400], [64, 64], [1, 1], [MAX_EDGE, MAX_EDGE], [MAX_EDGE, 10], [10, MAX_EDGE],
    [1999, 1200], [800, 1999],
  ];
  for (const [w, h] of untouched) {
    check(`${w}x${h} is under the cap and survives untouched`,
      eq(fitWithin(w, h), box(w, h)), fitWithin(w, h));
  }
}

console.log("\nfitWithin: the longest edge lands on the cap, aspect ratio held");
{
  const cases: Array<[number, number, number, number]> = [
    // A 12 MP phone photo, landscape and portrait.
    [4032, 3024, 2000, 1500],
    [3024, 4032, 1500, 2000],
    // Square, and a 4:3 plate scan.
    [4000, 4000, 2000, 2000],
    [3200, 2400, 2000, 1500],
    // One pixel over is still over.
    [2001, 2001, 2000, 2000],
  ];
  for (const [w, h, ew, eh] of cases) {
    const got = fitWithin(w, h);
    check(`${w}x${h} → ${ew}x${eh}`, eq(got, box(ew, eh)), got);
    check(`${w}x${h} keeps its longest edge at the cap`,
      Math.max(got.width, got.height) === MAX_EDGE, got);
  }
}

console.log("\nfitWithin: extreme ratios keep a drawable short edge");
{
  // A canvas with a zero dimension throws, and rounding is what would produce
  // one — a 6000x2 panorama scales its short edge to 0.67px.
  const wide = fitWithin(6000, 2);
  check("6000x2 keeps at least 1px of height", wide.height >= 1, wide);
  const tall = fitWithin(2, 6000);
  check("2x6000 keeps at least 1px of width", tall.width >= 1, tall);
  check("a zero dimension yields zeroes rather than NaN",
    eq(fitWithin(0, 500), box(0, 0)), fitWithin(0, 500));
  check("a negative dimension yields zeroes rather than a flip",
    eq(fitWithin(-100, 500), box(0, 0)), fitWithin(-100, 500));
  check("NaN yields zeroes", eq(fitWithin(NaN, 500), box(0, 0)), fitWithin(NaN, 500));
}

console.log("\nfitWithin: always integral, because canvas dimensions are");
{
  for (const [w, h] of [[4033, 3025], [1234.6, 987.4], [3333, 1111]] as Array<[number, number]>) {
    const got = fitWithin(w, h);
    check(`${w}x${h} → integers`,
      Number.isInteger(got.width) && Number.isInteger(got.height), got);
  }
}

console.log("\nisPassthrough: animation and vectors never enter the pipeline");
{
  // Note 4.
  check("animated GIF passes through", isPassthrough("image/gif"));
  check("SVG passes through", isPassthrough("image/svg+xml"));
  check("case is not a way around it", isPassthrough("IMAGE/GIF"));
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/avif", "image/bmp"]) {
    check(`${t} is a compression candidate`, !isPassthrough(t));
  }
}

console.log("\nisWorthKeeping: the candidate must earn its place");
{
  // Note 3. With a resize, breaking even is still a win — fewer pixels to
  // decode and hold in memory on every client, every load.
  check("a resize that halves the bytes is kept", isWorthKeeping(4_000_000, 300_000, true));
  check("a resize that exactly breaks even is kept", isWorthKeeping(500_000, 500_000, true));
  // Fewer pixels that somehow cost more bytes is a pathological encode, not a
  // trade worth taking — the original is smaller AND sharper.
  check("a resize that grows the file is refused", !isWorthKeeping(500_000, 500_001, true));

  // Without a resize the only argument is bytes, and it has to be a real one.
  check("an unresized re-encode saving 50% is kept", isWorthKeeping(400_000, 200_000, false));
  check("an unresized re-encode saving 1% is refused — a tuned source stays",
    !isWorthKeeping(400_000, 396_000, false));
  check("an unresized re-encode saving exactly 10% is refused (strict floor)",
    !isWorthKeeping(400_000, 360_000, false));
  check("an unresized re-encode that grows the file is refused",
    !isWorthKeeping(400_000, 900_000, false));

  // An empty blob is a failed encode wearing a very good disguise: it is
  // smaller than everything, so a pure byte comparison would take it.
  check("a zero-byte candidate is refused even though it is 'smaller'",
    !isWorthKeeping(400_000, 0, true));
  check("a negative candidate is refused", !isWorthKeeping(400_000, -1, true));
}

console.log("\nextForType: the extension follows the bytes");
{
  // Note 5.
  const cases: Array<[string, string]> = [
    ["image/webp", "webp"],
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/gif", "gif"],
    ["image/svg+xml", "svg"],
    ["image/avif", "avif"],
  ];
  for (const [type, ext] of cases) {
    check(`${type} → .${ext}`, extForType(type) === ext, extForType(type));
  }
  check("a charset parameter doesn't defeat the match",
    extForType("image/svg+xml; charset=utf-8") === "svg",
    extForType("image/svg+xml; charset=utf-8"));
  check("case is normalized", extForType("Image/JPEG") === "jpg", extForType("Image/JPEG"));
  // "bin" is the signal upload.ts keys off to fall back to the picked filename,
  // so an unknown type must NOT be guessed at.
  check("an unknown type yields bin, not a guess", extForType("image/tiff") === "bin");
  check("an empty type yields bin", extForType("") === "bin");
}

console.log("\nconstants: the two numbers that are judgements, not knobs");
{
  // MAX_EDGE is set by imageFocus's MAX_ZOOM (2.5x, a straight upscale) times a
  // 2x display, not by the well size — see the header of src/imageResize.ts.
  // If this assertion starts failing, the question to answer is whether the
  // zoom ceiling moved, not whether to update the number.
  check("MAX_EDGE clears the largest well at max zoom on a 2x display",
    MAX_EDGE >= 300 * 2.5 * 2, MAX_EDGE);
  check("QUALITY sits above the artifact knee", QUALITY >= 0.75 && QUALITY <= 0.9, QUALITY);
}

// ============================================================================
// storagePath.ts — the URL→path parser whose only consumer is a DELETE.
//
// The asymmetry stated in that module's header is what these fixtures encode:
// a missed sweep leaks a few hundred KB against a 1 GB quota, while a wrong
// match destroys a group's artwork with no undo and no free-tier backup. So
// almost every case below asserts a REFUSAL. If a future change makes this
// parser more permissive, that is the change to justify — not these tests.
// ============================================================================
const BUCKET = "entity-images";
const HOST = "https://nsemknuzupcnvctevgfd.supabase.co";
const PUBLIC = `${HOST}/storage/v1/object/public`;

console.log("\nstoragePathFromUrl: accepts exactly what upload.ts writes");
{
  const good: Array<[string, string]> = [
    [`${PUBLIC}/${BUCKET}/people/abc-123.webp`, "people/abc-123.webp"],
    [`${PUBLIC}/${BUCKET}/monsters/9f2e-1712345678901.jpg`, "monsters/9f2e-1712345678901.jpg"],
    [`${PUBLIC}/${BUCKET}/campaign/camp-1.png`, "campaign/camp-1.png"],
    [`${PUBLIC}/${BUCKET}/sessions/s1.svg`, "sessions/s1.svg"],
  ];
  for (const [url, path] of good) {
    check(`${path} round-trips out of its public URL`,
      storagePathFromUrl(url, BUCKET) === path, storagePathFromUrl(url, BUCKET));
  }
  // A cache-buster or fragment is not part of the object key.
  check("a query string is stripped",
    storagePathFromUrl(`${PUBLIC}/${BUCKET}/people/a-1.webp?t=99`, BUCKET) === "people/a-1.webp");
  check("a fragment is stripped",
    storagePathFromUrl(`${PUBLIC}/${BUCKET}/people/a-1.webp#x`, BUCKET) === "people/a-1.webp");
  // Supabase percent-encodes spaces in returned public URLs.
  check("a percent-encoded name decodes",
    storagePathFromUrl(`${PUBLIC}/${BUCKET}/items/a%20b.webp`, BUCKET) === "items/a b.webp",
    storagePathFromUrl(`${PUBLIC}/${BUCKET}/items/a%20b.webp`, BUCKET));
}

console.log("\nstoragePathFromUrl: refuses everything else");
{
  const refused: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["a non-string", 42],
    ["an unrelated http URL", "https://example.com/cat.png"],
    // An editor pasting a link to art hosted elsewhere must never be swept.
    ["an image hosted off-platform", "https://i.imgur.com/abc.png"],
    // A DIFFERENT bucket on the same project is the dangerous near-miss.
    ["a different bucket", `${PUBLIC}/other-bucket/people/a-1.webp`],
    ["a bucket whose name merely starts the same", `${PUBLIC}/entity-images-old/people/a-1.webp`],
    ["the signed-URL shape", `${HOST}/storage/v1/object/sign/${BUCKET}/people/a-1.webp`],
    ["the authenticated-object shape", `${HOST}/storage/v1/object/authenticated/${BUCKET}/people/a-1.webp`],
    ["the render/transform shape", `${HOST}/storage/v1/render/image/public/${BUCKET}/people/a-1.webp`],
    // Path traversal, in both raw and encoded form.
    ["traversal", `${PUBLIC}/${BUCKET}/../secrets/a.webp`],
    ["encoded traversal", `${PUBLIC}/${BUCKET}/%2E%2E/secrets/a.webp`],
    ["a backslash", `${PUBLIC}/${BUCKET}/people/..\\a.webp`],
    // Shape violations: the bucket root, a nested key, a doubled slash.
    ["a bare filename at the bucket root", `${PUBLIC}/${BUCKET}/a.webp`],
    ["a deeper path than upload.ts writes", `${PUBLIC}/${BUCKET}/people/sub/a.webp`],
    ["an empty segment", `${PUBLIC}/${BUCKET}/people//a.webp`],
    ["nothing after the bucket", `${PUBLIC}/${BUCKET}/`],
    // An unknown first segment can't be something this app wrote.
    ["an unknown prefix", `${PUBLIC}/${BUCKET}/avatars/a-1.webp`],
    ["a prefix that is a known kind but not uploadable", `${PUBLIC}/${BUCKET}/quests/a-1.webp`],
    // Malformed percent-encoding must not throw out of the parser.
    ["malformed percent-encoding", `${PUBLIC}/${BUCKET}/people/%E0%A4%A.webp`],
    // The storage route embedded as a SUB-path of some other URL. This one
    // resolves to a real key in our bucket if the marker is matched anywhere
    // rather than anchored to the origin — the reason for the origin check.
    ["the marker embedded mid-path",
      `https://elsewhere.example/x/storage/v1/object/public/${BUCKET}/people/a-1.webp`],
    ["a protocol-relative URL", `//host/storage/v1/object/public/${BUCKET}/people/a-1.webp`],
    ["a bare path with no origin", `/storage/v1/object/public/${BUCKET}/people/a-1.webp`],
  ];
  for (const [name, url] of refused) {
    check(`refuses ${name}`,
      storagePathFromUrl(url as string, BUCKET) === undefined,
      storagePathFromUrl(url as string, BUCKET));
  }
}

console.log("\npathToSweep: never deletes a live image");
{
  const a = `${PUBLIC}/${BUCKET}/people/a-1.webp`;
  const b = `${PUBLIC}/${BUCKET}/people/a-2.webp`;

  check("a genuine replacement sweeps the old object",
    pathToSweep(a, b, BUCKET) === "people/a-1.webp", pathToSweep(a, b, BUCKET));
  check("clearing an image sweeps it", pathToSweep(a, null, BUCKET) === "people/a-1.webp");

  // The two ways a sweep would delete the image still on screen.
  check("an unchanged URL sweeps nothing", pathToSweep(a, a, BUCKET) === undefined);
  check("two URLs resolving to the same object sweep nothing",
    pathToSweep(a, `${a}?t=2`, BUCKET) === undefined, pathToSweep(a, `${a}?t=2`, BUCKET));

  // Nothing to sweep, rather than an error.
  check("no previous image sweeps nothing", pathToSweep(null, b, BUCKET) === undefined);
  check("an undefined previous sweeps nothing", pathToSweep(undefined, b, BUCKET) === undefined);
  check("an off-platform previous sweeps nothing",
    pathToSweep("https://i.imgur.com/abc.png", b, BUCKET) === undefined);
  // The first upload onto an entity that never had art.
  check("empty previous sweeps nothing", pathToSweep("", b, BUCKET) === undefined);
}

console.log(failures === 0 ? "\nAll image checks passed.\n" : `\n${failures} image check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
