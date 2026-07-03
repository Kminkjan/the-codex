// One-off: upload the decoded Fist of Ilmater note images (issue #20) to the
// public `entity-images` bucket under foi/, matching the URLs the seed
// migration bakes into session summaries.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-foi-images.ts
//
// The service-role key (dashboard → Settings → API) is needed because storage
// writes are RLS-gated to non-anonymous sessions. Alternative without the key:
// drag-drop docs/fist-of-ilmater/images/ into entity-images/foi/ in the
// dashboard Storage UI — the object names line up either way.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = "https://nsemknuzupcnvctevgfd.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY (dashboard → Settings → API).");
  process.exit(1);
}

const imagesDir = join(dirname(fileURLToPath(import.meta.url)), "../docs/fist-of-ilmater/images");
const files = readdirSync(imagesDir).filter((f) => f.endsWith(".png"));
console.log(`Uploading ${files.length} images to entity-images/foi/ …`);

let failed = 0;
for (const file of files) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/entity-images/foi/${file}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": "image/png",
      "x-upsert": "true",
    },
    body: readFileSync(join(imagesDir, file)),
  });
  if (!res.ok) {
    failed++;
    console.error(`  ${file}: ${res.status} ${await res.text()}`);
  }
}
console.log(failed ? `${failed}/${files.length} uploads FAILED` : "All uploads succeeded.");
if (failed) process.exit(1);
