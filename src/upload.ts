import { supabase } from "./utils/supabase";

const BUCKET = "entity-images";
const MAX_BYTES = 5 * 1024 * 1024;

export type UploadableKind = "people" | "locations" | "factions" | "items";

export async function uploadEntityImage(
  file: File,
  kind: UploadableKind,
  entityId: string,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Image must be 5 MB or smaller.");
  }

  const match = file.name.match(/\.([a-zA-Z0-9]+)$/);
  const ext = match ? match[1].toLowerCase() : "bin";
  const path = `${kind}/${entityId}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
