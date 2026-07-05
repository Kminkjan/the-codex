import { useContext, useEffect, useMemo, type RefObject } from "react";
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

export function useCampaignSwitcher() {
  const { campaigns, activeCampaignId, switchCampaign } = useContext(CampaignContext);
  return { campaigns, activeCampaignId, switchCampaign };
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

// Dropdown dismissal: outside mousedown or Escape closes. Unlike a fixed
// backdrop this doesn't swallow the outside click and isn't trapped by the
// opener's stacking context (the backdrop approach misses clicks on the
// higher z-index topbar).
export function useDismiss(ref: RefObject<HTMLElement>, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, active, onClose]);
}
