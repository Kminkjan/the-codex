export {};

declare global {
  interface Window {
    __TWEAKS__: {
      theme: string;
      showPresence: boolean;
      density: string;
      // Not in TWEAK_DEFAULTS on purpose — absence falls through to the
      // first campaign by creation date (see CampaignProvider).
      campaignId?: string;
      [key: string]: unknown;
    };
  }
}
