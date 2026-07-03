// Module-level active-session store. Written only by CampaignProvider (in the
// load effect and the campaigns realtime handler); read by mutations.ts, which
// are plain async functions and can't reach React context. Unlike the active
// campaign, this can be null — a campaign may have no session pinned as live.
let activeSessionId: string | null = null;

export function setActiveSessionId(id: string | null) {
  activeSessionId = id;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}
