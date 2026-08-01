import { supabase } from "./utils/supabase";
import { compressImage, extForType } from "./imageResize";

/** Exported so mutations.ts can resolve stored URLs back to objects to sweep. */
export const BUCKET = "entity-images";

// Two limits, and the order they're applied in is the feature.
//
// MAX_BYTES is what may land in the bucket — it's a public object every viewer
// downloads forever. MAX_INPUT_BYTES is what may be *picked*, and it's far
// looser because src/imageResize.ts stands between the two: a 12 MP phone photo
// is a perfectly reasonable thing to hand this function and lands well under
// MAX_BYTES once resized. Checking the stored size before compression instead
// would reject uploads that were never going to be big.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;

// One year — and the SDK default is one HOUR, which is the whole reason this is
// stated explicitly.
//
// The free tier's binding constraint is egress (5 GB cached + 5 GB uncached per
// month), not the 1 GB of storage. At the default `cacheControl: "3600"` every
// player's browser re-fetches every portrait it has already seen once an hour,
// so a single evening of four people browsing the codex re-downloads the same
// artwork dozens of times. A long TTL turns those into browser cache hits,
// which cost nothing at all, and CDN hits for the rest.
//
// This is only safe because the path below is content-addressed by
// construction: `upsert: false` plus a Date.now() suffix means an object at a
// given path is never rewritten. Replacing an entity's image mints a NEW path
// and a new URL, so there is no stale-cache failure mode to trade against.
// Anything that starts overwriting a path in place must revisit this value.
//
// SECONDS ONLY — do not add directives here. The value is a duration everywhere
// it is documented, and the SDK interpolates it as `max-age=${value}`, so a
// `immutable` or `public` token rides on the server accepting a non-numeric
// field. Appending `, immutable` would suppress revalidation on an explicit
// reload and nothing else; that is not worth a change whose failure mode is
// every upload 400ing.
const CACHE_CONTROL = "31536000";

export type UploadableKind = "people" | "locations" | "factions" | "items" | "monsters" | "sessions";

// "campaign" is a path prefix for the campaign crest (issue #85), not a
// KindKey — keep it out of UploadableKind, which detail.tsx feeds into
// KindKey-typed helpers.
export async function uploadEntityImage(
  file: File,
  kind: UploadableKind | "campaign",
  entityId: string,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("Image must be 30 MB or smaller.");
  }

  const result = await compressImage(file);
  const upload = result.file;

  // Only reachable by a file compressImage declined or couldn't improve — an
  // animated GIF, an SVG, or an already-tight source that's simply huge.
  if (upload.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  // Extension comes from the bytes, not the picked filename — see extForType.
  // The filename is only consulted for a type extForType doesn't know (a TIFF,
  // a BMP), which by definition is one compressImage passed through untouched.
  const named = upload.name.match(/\.([a-zA-Z0-9]+)$/);
  const typed = extForType(upload.type);
  const ext = typed !== "bin" ? typed : named ? named[1].toLowerCase() : "bin";
  const path = `${kind}/${entityId}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, upload, {
      upsert: false,
      contentType: upload.type,
      cacheControl: CACHE_CONTROL,
    });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
