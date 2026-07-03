// Module-level active-campaign store. Written only by CampaignProvider
// (synchronously, before any await in its load effect); read by mutations.ts,
// which are plain async functions and can't reach React context.
let activeCampaignId: string | null = null;

export function setActiveCampaignId(id: string) {
  activeCampaignId = id;
}

export function getActiveCampaignId(): string {
  if (!activeCampaignId) throw new Error("No active campaign");
  return activeCampaignId;
}
