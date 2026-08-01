// Public storage URL → the object path inside the bucket, or nothing.
//
// Pure, and voice-neutral for the reason imageFocus.ts is: a pure module can't
// reach <ThemedLabel>. It exists as a module rather than a regex at the call
// site for one reason, stated as plainly as possible:
//
// ============================================================================
// THE ONLY CONSUMER OF THIS VALUE IS A DELETE. IT MUST FAIL CLOSED.
//
// The bucket is flat and public, and `storage.remove()` takes whatever path it
// is handed. So a parser that is "helpful" about a URL it doesn't recognise
// doesn't degrade to a missed cleanup — it degrades to deleting some OTHER
// campaign's artwork. Every branch below therefore returns `undefined` rather
// than a best guess, and callers treat `undefined` as "leave it alone".
//
// Leaving an orphan costs a few hundred KB against a 1 GB quota. Deleting the
// wrong object destroys a piece of a group's campaign with no undo and no
// backup on the free tier. Those are not close, and that asymmetry is the whole
// design: this function's job is to REFUSE, and only incidentally to parse.
//
// Concretely it refuses anything that isn't exactly the shape upload.ts writes:
//
//   https://<ref>.supabase.co/storage/v1/object/public/entity-images/people/<id>-<ts>.webp
//   └────────── ignored ──────────┘└─ required marker ─┘└ bucket ┘└──── path ────┘
//
//   - a URL for a different bucket, host path, or storage API shape
//   - a path whose first segment isn't one of the prefixes upload.ts uses, so
//     a URL pointing anywhere else in the bucket can't be turned into a delete
//   - traversal (`..`), absolute paths, backslashes, empty segments
//   - anything that fails to percent-decode
//
// A hand-typed image_url — nothing stops an editor pasting a link to an image
// hosted elsewhere — lands in the first case and is correctly left alone.
//
// THIS IS NOT HYPOTHETICAL. Of the 102 image_url values in the live campaign
// when this was written, 31 are shapes the app never wrote and this function
// refuses, every one of them correctly:
//
//   * 30 seeded session images under `entity-images/foi/…`, bulk-uploaded
//     alongside the Fist of Ilmater seed migrations rather than through
//     upload.ts. Right shape, unknown prefix.
//   * one person portrait in a DIFFERENT bucket (`portraits/…`), left over
//     from before 0004 created entity-images.
//   * the campaign crest, which is a `cdn.discordapp.com` URL.
//
// `foi/` is the tempting one: those objects are in our bucket, and today they
// happen to be referenced 1:1 by sessions, so whitelisting the prefix would
// sweep them. Don't. They are hand-curated seed assets with no guarantee of
// staying 1:1, and widening this list to reach content the app didn't upload is
// precisely the "be helpful" move the header argues against. Thirty orphans
// that only materialize if someone deletes a seeded session is the cheaper bet.
// ============================================================================

/** Where public objects live in the Storage REST API. Not configurable. */
const MARKER = "/storage/v1/object/public/";

/**
 * The path prefixes upload.ts writes, and therefore the only ones that may be
 * swept. Mirrors `UploadableKind | "campaign"`; kept here rather than imported
 * so this module stays free of upload.ts (which pulls in the Supabase client
 * and can't be loaded by the harness).
 */
const PREFIXES = new Set([
  "people", "locations", "factions", "items", "monsters", "sessions", "campaign",
]);

/**
 * Public URL → object path within `bucket`, or `undefined` if the URL is not
 * unmistakably one this app wrote. See the header: `undefined` is the safe
 * answer and the common one, not an error case.
 */
export function storagePathFromUrl(
  url: string | null | undefined,
  bucket: string,
): string | undefined {
  if (typeof url !== "string" || !url) return undefined;

  // Query and fragment are not part of the object path. Strip before matching
  // so `?t=123` can't end up inside the key we ask the API to delete.
  const clean = url.split("#")[0].split("?")[0];

  const marker = `${MARKER}${bucket}/`;
  const at = clean.indexOf(marker);
  if (at === -1) return undefined;

  // The marker must be the START of the path, not merely present somewhere in
  // it. Without this, any URL that happens to contain the storage route as a
  // sub-path — `https://elsewhere.example/x/storage/v1/object/public/<bucket>/…`
  // — would resolve to a real key in OUR bucket and get deleted. Everything
  // before the marker has to be a bare origin.
  if (!/^https?:\/\/[^/]+$/.test(clean.slice(0, at))) return undefined;

  let path: string;
  try {
    path = decodeURIComponent(clean.slice(at + marker.length));
  } catch {
    // Malformed percent-encoding. Nothing this app wrote looks like that.
    return undefined;
  }
  if (!path) return undefined;

  // A path this app wrote is exactly `<prefix>/<filename>` — two segments, both
  // non-empty. Checking the shape rather than sanitizing it keeps traversal,
  // absolute paths and doubled slashes out by construction instead of by
  // blacklist.
  const segments = path.split("/");
  if (segments.length !== 2) return undefined;
  if (segments.some((s) => !s || s === "." || s === ".." || s.includes("\\"))) return undefined;
  if (!PREFIXES.has(segments[0])) return undefined;

  return path;
}

/**
 * Should the object behind `previousUrl` be swept now that `nextUrl` is stored?
 *
 * Returns the path to remove, or `undefined` to leave the bucket alone. Refuses
 * the two cases that would delete a live image: the URL being unchanged, and
 * two different URLs that resolve to the same object (belt and braces — the
 * Date.now() suffix should make that impossible, but "should" is doing work
 * there and the cost of being wrong is someone's artwork).
 */
export function pathToSweep(
  previousUrl: string | null | undefined,
  nextUrl: string | null | undefined,
  bucket: string,
): string | undefined {
  if (!previousUrl || previousUrl === nextUrl) return undefined;
  const previous = storagePathFromUrl(previousUrl, bucket);
  if (!previous) return undefined;
  if (previous === storagePathFromUrl(nextUrl, bucket)) return undefined;
  return previous;
}
