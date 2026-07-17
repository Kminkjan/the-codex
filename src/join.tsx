import { useEffect, useRef, useState } from "react";
import { SignInDialog, useAuth } from "./auth";
import { useCampaignStatus, useCampaignSwitcher, useMembershipRefresh } from "./hooks";
import { redeemCampaignInvite } from "./mutations";
import { parseHash } from "./route";
import { CrestSeal } from "./campaign";

// ============================================================================
// Invite redemption (issue #86): a visitor opening an invite link
// (…?join=CODE#/c/<cid>) is met with a sealed letter of summons. Breaking
// the wax seal reveals either sign-in (anonymous) or a take-your-seat
// button (editor); redemption goes through the redeem_campaign_invite RPC,
// which returns the campaign to switch to.
// ============================================================================

const PENDING_KEY = "codex.pendingJoin";
const PENDING_TTL_MS = 60 * 60 * 1000;

// localStorage, deliberately: the OAuth/magic-link redirectTo is the bare
// origin, so a ?join= param does NOT survive the sign-in round-trip, and
// magic links open in a new tab (sessionStorage is per-tab). This is a
// scoped exception to the "host page owns persistence" convention — that
// convention covers theme/presence/density tweaks; this is a transient auth
// handoff token, cleared on redemption and ignored after an hour so a stale
// stash can't silently join someone weeks later.
function readPendingJoin(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const { code, ts } = JSON.parse(raw);
    if (typeof code !== "string" || typeof ts !== "number" || Date.now() - ts > PENDING_TTL_MS) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

function writePendingJoin(code: string) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ code, ts: Date.now() }));
  } catch {
    // Storage unavailable (private mode quota etc.) — the OAuth round-trip
    // will lose the code; the visitor can re-click the invite once signed in.
  }
}

function clearPendingJoin() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* best effort */ }
}

function urlJoinCode(): string | null {
  return new URLSearchParams(window.location.search).get("join");
}

// Strip ONLY the join param — other query params and the hash survive.
function stripJoinParam() {
  const params = new URLSearchParams(window.location.search);
  params.delete("join");
  const search = params.toString();
  history.replaceState(null, "", window.location.pathname + (search ? `?${search}` : "") + window.location.hash);
}

// Module-level (not a ref): survives StrictMode's mount→unmount→remount so
// the silent post-round-trip redemption fires exactly once per page load.
// The RPC is idempotent anyway; this just keeps the toast from doubling.
let autoRedeemConsumed = false;

export function JoinFlow() {
  const { user, canEdit } = useAuth();
  const { campaign } = useCampaignStatus();
  const { activeCampaignId, switchCampaign } = useCampaignSwitcher();
  const { refreshMembership } = useMembershipRefresh();

  // Read once per mount: the ceremony belongs to the URL the visitor
  // arrived on; stripJoinParam after redemption must not re-trigger it.
  const [urlCode] = useState<string | null>(urlJoinCode);
  const [letterOpen, setLetterOpen] = useState<boolean>(!!urlCode);
  const [sealBroken, setSealBroken] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const busyRef = useRef(false);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4200);
  };

  const redeem = async (code: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setRedeeming(true);
    try {
      const res = await redeemCampaignInvite(code);
      clearPendingJoin();
      stripJoinParam();
      setLetterOpen(false);
      if (res.campaignId !== activeCampaignId) switchCampaign(res.campaignId);
      // Membership isn't realtime: bump so the context re-checks isDm and
      // the charter roster refetches (a dm invite flips affordances live).
      refreshMembership();
      showToast(
        res.alreadyMember
          ? "You already have a seat at this table."
          : res.role === "dm"
            ? "The seal breaks — you now hold a DM's quill."
            : "The seal breaks — welcome to the party.",
      );
    } catch (e) {
      console.error(e);
      clearPendingJoin();
      stripJoinParam();
      setLetterOpen(false);
      showToast("This invitation is no longer valid.");
    } finally {
      busyRef.current = false;
      setRedeeming(false);
    }
  };

  // Stash the code the moment an anonymous visitor holds one, so the OAuth
  // redirect (from the letter OR the Topbar) can't lose it.
  useEffect(() => {
    if (urlCode && user?.is_anonymous) writePendingJoin(urlCode);
  }, [urlCode, user?.is_anonymous]);

  // Silent redemption when there's no letter to ceremony through: back from
  // an auth round-trip (stash only — redirectTo dropped the param), or the
  // visitor dismissed the letter and signed in via the Topbar later.
  useEffect(() => {
    if (autoRedeemConsumed || !canEdit || letterOpen) return;
    const code = urlCode ?? readPendingJoin();
    if (!code) return;
    autoRedeemConsumed = true;
    void redeem(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit, letterOpen, urlCode]);

  // Campaign identity on the letter only when the link's #/c/ hash resolved
  // to the loaded campaign — reads are world-open, so title/subtitle/crest
  // come free. Otherwise a generic summons (the code still knows its
  // campaign server-side).
  const hashCampaignId = parseHash().campaignId;
  const identity = campaign && campaign.id === hashCampaignId ? campaign : null;

  return (
    <>
      {letterOpen && urlCode && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 90,
          display: "grid", placeItems: "center",
          background: "rgba(40,20,5,.55)",
        }}>
          <div
            className="tex-vellum"
            style={{
              position: "relative",
              maxWidth: 480, width: "92%",
              padding: "44px 36px 38px",
              background: "var(--vellum-light)",
              boxShadow: "0 14px 50px rgba(20,10,2,.5)",
              textAlign: "center",
              fontFamily: "var(--font-body)",
            }}
          >
            <div style={{
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12,
              color: "var(--ink-secondary)", marginBottom: 22,
            }}>
              ✦ A SUMMONS TO ADVENTURE ✦
            </div>

            {identity?.imageUrl ? (
              <img
                src={identity.imageUrl}
                alt=""
                style={{
                  width: 96, height: 96, objectFit: "cover", borderRadius: "50%",
                  border: "1px solid var(--vellum-deep)", boxShadow: "0 2px 8px rgba(40,20,5,.25)",
                  marginBottom: 18,
                }}
              />
            ) : (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <CrestSeal title={identity?.title ?? "✦"} size={96} />
              </div>
            )}

            <div style={{ fontStyle: "italic", fontSize: 15, color: "var(--ink-body)" }}>
              You are called to join
            </div>
            <div style={{
              fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 30,
              color: "var(--ink)", lineHeight: 1.2, margin: "6px 0 4px",
            }}>
              {identity?.title ?? "a campaign of this codex"}
            </div>
            {identity?.subtitle && (
              <div style={{ fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
                {identity.subtitle}
              </div>
            )}

            {/* The wax seal. Clicking it breaks it: the seal fades/scales out
                and the action area fades in underneath. */}
            <div style={{ position: "relative", height: 120, marginTop: 26 }}>
              {!sealBroken && (
                <button
                  onClick={() => setSealBroken(true)}
                  aria-label="Break the seal"
                  style={{
                    position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)",
                    background: "transparent", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                  }}
                >
                  <span
                    className="wax-seal"
                    style={{ position: "relative", width: 64, height: 64, fontSize: 22 }}
                  >
                    ✦
                  </span>
                  <span style={{
                    fontFamily: "var(--font-fell-sc)", letterSpacing: ".22em", fontSize: 10,
                    color: "var(--ink-secondary)",
                  }}>
                    BREAK THE SEAL
                  </span>
                </button>
              )}
              {sealBroken && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  {canEdit ? (
                    <button
                      onClick={() => void redeem(urlCode)}
                      disabled={redeeming}
                      style={{
                        padding: "12px 26px",
                        background: "var(--ink)", color: "var(--vellum-light)",
                        fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 12,
                        border: "none", cursor: redeeming ? "wait" : "pointer",
                        opacity: redeeming ? 0.7 : 1,
                      }}
                    >
                      {redeeming ? "Unfolding the letter…" : "Take your seat at the table"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setSigningIn(true)}
                      style={{
                        padding: "12px 26px",
                        background: "var(--ink)", color: "var(--vellum-light)",
                        fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 12,
                        border: "none", cursor: "pointer",
                      }}
                    >
                      Sign in to answer the summons
                    </button>
                  )}
                  <button
                    className="cleanup-link-btn"
                    onClick={() => {
                      // An editor declining is a real decline: drop the code
                      // entirely, or the silent-redemption effect below would
                      // join them the moment the letter closes. An anonymous
                      // dismissal keeps the stash — the magic-link path and a
                      // later Topbar sign-in still need it.
                      if (canEdit) {
                        autoRedeemConsumed = true;
                        clearPendingJoin();
                        stripJoinParam();
                      }
                      setLetterOpen(false);
                    }}
                  >
                    not now — just look around
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The letter's own sign-in entry point (the Topbar's dialog state is
          private to it; a second instance of the self-contained modal is the
          established pattern). The pending stash is already written, so a
          Discord redirect from here round-trips into the silent redemption. */}
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}

      {toast && (
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--vellum-light)",
          padding: "10px 18px",
          fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14,
          boxShadow: "0 6px 20px rgba(40,20,5,.45)",
          zIndex: 70, borderRadius: 2,
        }}>
          {toast}
        </div>
      )}
    </>
  );
}
