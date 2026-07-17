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

// Invite links (issue #86). The join code rides the QUERY STRING, not the
// hash: HASH_RE wouldn't parse a suffix and the hash normalization in
// campaignContext would rewrite it away, while both writeCampaignHash
// branches and the auth error-strip preserve window.location.search.
// Including #/c/<cid> lands the invited visitor viewing the right campaign
// before they redeem (reads are world-open).
export function inviteUrl(campaignId: string, code: string): string {
  return (
    window.location.origin + window.location.pathname +
    `?join=${encodeURIComponent(code)}` + campaignHash(campaignId)
  );
}

// One-shot charter-landing intent (issue #87): founding a campaign should
// land on the new campaign's charter, but the view state lives in AppLoaded,
// which unmounts during the campaign switch — so the picker raises this flag
// and the remounting AppLoaded consumes it in its view initializer.
let charterRequested = false;

export function requestCharterOnNextLoad() {
  charterRequested = true;
}

export function consumeCharterRequest(): boolean {
  const requested = charterRequested;
  charterRequested = false;
  return requested;
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
