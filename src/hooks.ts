import { useContext, useMemo } from "react";
import { CampaignContext } from "./campaignContext";
import { buildKinds, findEntity, type Campaign, type Entity } from "./data";

export function useCampaign(): Campaign {
  const { campaign } = useContext(CampaignContext);
  if (!campaign) {
    throw new Error("useCampaign must be used inside <CampaignProvider> after data has loaded");
  }
  return campaign;
}

export function useCampaignStatus() {
  const { campaign, loading, error } = useContext(CampaignContext);
  return { campaign, loading, error };
}

export function useKinds() {
  const campaign = useCampaign();
  return useMemo(() => buildKinds(campaign), [campaign]);
}

export function useFindEntity() {
  const campaign = useCampaign();
  return useMemo(
    () => (id: string | null | undefined): (Entity & Record<string, any>) | null =>
      findEntity(campaign, id),
    [campaign],
  );
}
