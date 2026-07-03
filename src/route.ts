// Hash routing: #/c/:campaignId with an optional /e/:entityId deep link.
// Only hashes matching this shape are parsed or rewritten — a magic-link
// #access_token=... hash must be left untouched for supabase-js to consume.
const HASH_RE = /^#\/c\/([^/]+)(?:\/e\/(.+))?$/;

// Malformed percent-encoding (e.g. "#/c/abc%") must not throw — a bad URL
// then flows through the normal unknown-id fallbacks instead of wedging the
// loader or crashing the render tree.
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseHash(): { campaignId?: string; entityId?: string } {
  const m = HASH_RE.exec(window.location.hash);
  if (!m) return {};
  return { campaignId: safeDecode(m[1]), entityId: m[2] ? safeDecode(m[2]) : undefined };
}

export function campaignHash(campaignId: string, entityId?: string | null): string {
  return `#/c/${encodeURIComponent(campaignId)}` + (entityId ? `/e/${encodeURIComponent(entityId)}` : "");
}

export function writeCampaignHash(campaignId: string, entityId?: string | null, opts?: { replace?: boolean }) {
  const hash = campaignHash(campaignId, entityId);
  if (window.location.hash === hash) return;
  if (opts?.replace) {
    history.replaceState(null, "", window.location.pathname + window.location.search + hash);
  } else {
    window.location.hash = hash;
  }
}
