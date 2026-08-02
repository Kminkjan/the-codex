import { useCallback, useContext, useEffect, useMemo, useState, type RefObject } from "react";
import { CampaignContext } from "./campaignContext";
import { authorName, buildKinds, findEntity, type Campaign, type Entity, type KindKey } from "./data";
import { readListSort, writeListSort } from "./listPrefs";
import { isSortKey, type SortKey } from "./listSort";
import { isChronicleOrder, type ChronicleOrder } from "./chronicle";

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

// May triage the app-wide feedback board (0041): move a report's status, remove
// a duplicate. Deliberately NOT useIsDm — the board spans every campaign, and
// deriving the capability from DM-ness would grant it to anyone who founds one.
// Unaffected by "view as player", which is a campaign-view toggle and says
// nothing about maintaining the app.
export function useIsMaintainer(): boolean {
  return useContext(CampaignContext).isMaintainer;
}

// "View as player" (#71). isRealDm ignores the toggle — it gates the toggle
// affordance and banner themselves (which must survive the flip) and write
// paths whose mutation choice depends on real DM-ness (SessionPin brackets).
export function useViewAsPlayer() {
  const { isRealDm, viewAsPlayer, setViewAsPlayer } = useContext(CampaignContext);
  return { isRealDm, viewAsPlayer, setViewAsPlayer };
}

// A signed-in editor holding no campaign_members row for this campaign, so
// RLS (0023) rejects every write. canEdit already reflects this — the edit
// affordances are simply gone — so this is only for the surfaces that EXPLAIN
// the gap: the Topbar chip and the notice. False until the lookup resolves.
export function useSeatless(): boolean {
  return useContext(CampaignContext).seatless;
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

// Durable editor identity by auth uuid (issue #114) — everyone who has ever
// signed in, online or not. Use this to name a stored user_id; use
// usePresence() for who's at the table right now.
export function useProfiles() {
  return useContext(CampaignContext).profilesById;
}

// The byline for any signed row (0042) — pass a party note, session event or
// connection and get the name to print. Wraps data.ts's pure authorName() with
// the loaded profiles map so a renamed editor's whole back-catalogue follows
// them. Every byline should go through this rather than reading `.author`.
export function useAuthorName() {
  const profilesById = useProfiles();
  return useCallback(
    (signed: { author?: string; authorUserId?: string }) =>
      authorName(signed, (userId) => profilesById.get(userId)?.displayName),
    [profilesById],
  );
}

export function useCampaignSwitcher() {
  const { campaigns, activeCampaignId, switchCampaign, adoptCampaign, retireCampaign } = useContext(CampaignContext);
  return { campaigns, activeCampaignId, switchCampaign, adoptCampaign, retireCampaign };
}

export function useKinds() {
  const campaign = useCampaign();
  return useMemo(() => buildKinds(campaign), [campaign]);
}

// The overview pages' sort control, remembered per kind (see src/listPrefs.ts
// for where and why). Read through isSortKey both times, so a stored key that
// a release renamed — or one belonging to another kind — degrades to the
// default instead of leaving the list unsorted.
//
// The effect is not redundant with the lazy initialiser: App renders <KindList>
// at a fixed position with `kind` as a prop, so walking from People to Items
// REUSES the component instance and never re-runs the initialiser.
export function useListSort(kind: KindKey): [SortKey, (next: SortKey) => void] {
  const load = (k: KindKey): SortKey => {
    const stored = readListSort(k);
    return isSortKey(k, stored) ? stored : "default";
  };
  const [sort, setSort] = useState<SortKey>(() => load(kind));
  useEffect(() => { setSort(load(kind)); }, [kind]);
  const choose = useCallback((next: SortKey) => {
    setSort(next);
    writeListSort(kind, next);
  }, [kind]);
  return [sort, choose];
}

// The Chronicle of Events' order control. Shares listPrefs' store — sort is
// exactly the kind of state that file exists for — under a key no KindKey can
// collide with, since `events` isn't one of the nine kinds. No `kind` prop to
// react to here, so unlike useListSort this needs no resync effect.
const CHRONICLE_KEY = "events:chronicle";

export function useChronicleOrder(): [ChronicleOrder, (next: ChronicleOrder) => void] {
  const [order, setOrder] = useState<ChronicleOrder>(() => {
    const stored = readListSort(CHRONICLE_KEY);
    return isChronicleOrder(stored) ? stored : "default";
  });
  const choose = useCallback((next: ChronicleOrder) => {
    setOrder(next);
    writeListSort(CHRONICLE_KEY, next);
  }, []);
  return [order, choose];
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
