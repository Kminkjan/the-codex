// ============================================================================
// Unsent note drafts — the text a composer is holding but hasn't committed.
//
// Note composers create APPEND-ONLY records (party_notes rows, session_events
// feed rows): once written there is no edit and no delete. So they commit only
// on an explicit act — a keystroke or the send button — never on focus loss.
// The corollary is this store: clicking away has to KEEP the draft, because
// the composer's DOM is about to be unmounted by any of the detail sheet's
// dismissal paths (backdrop, ✕, Esc, hashchange, ⚡ SHOW takeover, a realtime
// delete, rail navigation) or the live panel's collapse.
//
// A plain module-level Map, not React state, precisely because the component
// goes away. Same shape and reasoning as src/activeCampaign.ts.
//
// In memory only. It is NOT localStorage, and that is a decision, not an
// omission: every loss path above happens inside one page lifetime, so a
// memory store covers all of them. A reload-surviving draft would be the
// dangerous one — insertPartyNote stamps getActiveSessionId() and signs with
// the display name AT INSERT TIME, so a draft resurrected a week later would
// enter a different live session under whoever is signed in then, as a
// permanent undeletable record. src/listPrefs.ts's localStorage exception is
// defensible because a sort order is inert; a half-typed sentence is not.
// If reload-loss is ever reported, a mirror goes behind these three functions
// and nothing else in the tree changes.
//
// Deliberately not paired with a beforeunload guard either: it needs user
// activation, it's unreliable from an iframe, and it trades a silent loss for
// a native dialog on every navigation away.
// ============================================================================

// Insertion-ordered, which is what makes the cap below an LRU.
const drafts = new Map<string, string>();

// A ceiling so a marathon session can't grow this without bound. Well above
// the number of entities anyone leaves half-written notes on.
const MAX_KEYS = 60;

// Keys are campaign-scoped so switching campaigns can't bleed a draft across,
// and namespaced so an entity id can never collide with a session id.
export function entityDraftKey(campaignId: string, entityId: string): string {
  return `note:${campaignId}:${entityId}`;
}

export function liveDraftKey(campaignId: string, sessionId: string): string {
  return `live:${campaignId}:${sessionId}`;
}

// The feedback panel's composer (0040). One per campaign, not one per report —
// the panel has a single box at its head and reports are never edited, so there
// is no second identity to key on. Namespaced like the two above so a campaign
// id can't collide with the entity or session ids they hold.
export function feedbackDraftKey(campaignId: string): string {
  return `feedback:${campaignId}`;
}

export function readDraft(key: string): string {
  return drafts.get(key) ?? "";
}

// Empty means absence — clearing a composer leaves no key behind, mirroring
// writeListSort's "default is stored as absence".
export function writeDraft(key: string, text: string): void {
  if (!text) {
    drafts.delete(key);
    return;
  }
  // Delete-then-set moves the key to the newest position, so the composer
  // being typed in right now is always the last candidate for eviction.
  drafts.delete(key);
  drafts.set(key, text);
  // Evict the OLDEST, never the newest. Dropping the wrong end would silently
  // discard the note the user is in the middle of writing.
  while (drafts.size > MAX_KEYS) {
    const oldest = drafts.keys().next();
    if (oldest.done) break;
    drafts.delete(oldest.value);
  }
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

// How many drafts are held. Exists for scripts/drafts-check.ts: readDraft
// returns "" for both an absent key and a stored empty string, so "clearing a
// composer leaves no key behind" and "the cap evicts" are not otherwise
// observable through this module's API. Not for UI use — nothing should render
// a count of other people's unsent notes.
export function draftCount(): number {
  return drafts.size;
}
