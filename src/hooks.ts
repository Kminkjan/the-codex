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

// The DM gate for edit affordances that go beyond canEdit (hide/reveal,
// staging, release). False for viewers, non-DM editors, DM-less campaigns —
// and for the real DM while "view as player" is on (that flip is the feature).
export function useIsDm(): boolean {
  return useContext(CampaignContext).isDm;
}

// "View as player" (#71). isRealDm ignores the toggle — it gates the toggle
// affordance and banner themselves (which must survive the flip) and write
// paths whose mutation choice depends on real DM-ness (SessionPin brackets).
export function useViewAsPlayer() {
  const { isRealDm, viewAsPlayer, setViewAsPlayer } = useContext(CampaignContext);
  return { isRealDm, viewAsPlayer, setViewAsPlayer };
}

// Membership isn't realtime (campaign_members is deliberately unpublished):
// after any membership RPC (issue #86), call refreshMembership() and key
// roster fetches on membershipVersion so isDm and member lists refetch.
export function useMembershipRefresh() {
  const { membershipVersion, refreshMembership } = useContext(CampaignContext);
  return { membershipVersion, refreshMembership };
}

// Who's at the table right now (issue #74) — live channel presence, one
// entry per signed-in named editor. Empty for a solo anonymous viewer.
export function usePresence() {
  return useContext(CampaignContext).presenceUsers;
}

export function useCampaignSwitcher() {
  const { campaigns, activeCampaignId, switchCampaign, adoptCampaign, retireCampaign } = useContext(CampaignContext);
  return { campaigns, activeCampaignId, switchCampaign, adoptCampaign, retireCampaign };
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
