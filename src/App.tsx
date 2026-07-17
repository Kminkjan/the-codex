import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CampaignProvider } from "./campaignContext";
import { AuthProvider, DisplayNameGate } from "./auth";
import { useCampaign, useCampaignStatus, useFindEntity, useIsDm, useKinds, useViewAsPlayer } from "./hooks";
import { entityLabel, isShowEvent, stripShowMark } from "./data";
import { onWriteError } from "./mutations";
import { campaignHash, consumeCharterRequest, parseHash, writeCampaignHash } from "./route";
import { Icon } from "./icons";
import { Sidebar, Topbar } from "./components";
import { NoticeBoard, KindList } from "./board";
import { ArcsPage } from "./arcs";
import { EventsPage } from "./events";
import { CampaignCharterPage } from "./campaign";
import { DetailSheet } from "./detail";
import { LivePanel } from "./livePanel";
import { CommandPalette, useCommandPaletteHotkey } from "./commandPalette";
import { CleanupPanel } from "./cleanupPanel";
import { JoinFlow } from "./join";

function LoadingSheet() {
  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      background: "var(--vellum)", color: "var(--ink)",
      fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: ".04em",
      fontStyle: "italic",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12, color: "var(--ink-secondary)", marginBottom: 12 }}>
          ✦ THE CODEX ✦
        </div>
        <div>Unbinding the codex…</div>
      </div>
    </div>
  );
}

function ErrorSheet({ message }: { message: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      background: "var(--vellum)", color: "var(--ink)", padding: 40,
      fontFamily: "var(--font-fell)",
    }}>
      <div style={{ maxWidth: 540, textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12, color: "var(--bloodred)", marginBottom: 12 }}>
          ✦ THE PAGES WILL NOT TURN ✦
        </div>
        <div style={{ fontStyle: "italic", fontSize: 16, marginBottom: 16 }}>
          The codex could not be opened.
        </div>
        <pre style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-secondary)", whiteSpace: "pre-wrap" }}>
          {message}
        </pre>
      </div>
    </div>
  );
}

function AppLoaded() {
  const kinds = useKinds();
  const campaign = useCampaign();
  const findEntity = useFindEntity();

  const [theme, setTheme] = useState<string>(window.__TWEAKS__.theme || "cartographer");
  const [showPresence, setShowPresence] = useState<boolean>(window.__TWEAKS__.showPresence);
  const [density, setDensity] = useState<string>(window.__TWEAKS__.density || "cozy");
  // Founding a campaign (#87) lands on its charter: the picker raised the
  // one-shot flag, the switch remounted this component, the initializer
  // consumes it. Every other mount starts on the board as before.
  const [view, setView] = useState(() => (consumeCharterRequest() ? "campaign" : "board"));
  // Entity deep link: #/c/:campaignId/e/:entityId opens the detail sheet on
  // load; an id that doesn't resolve in this campaign is silently dropped.
  const [openId, setOpenId] = useState<string | null>(() => {
    const id = parseHash().entityId;
    return id && findEntity(id) ? id : null;
  });
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  // Rejected-write toast (#87): mutations are fire-and-forget, so an RLS
  // rejection (non-member since 0023) would otherwise die in the console.
  // seq keys the auto-dismiss timer so a repeat of the same message restarts it.
  const [writeErrorToast, setWriteErrorToast] = useState<{ message: string; seq: number } | null>(null);
  const writeErrorSeq = useRef(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // Ephemeral "jump to this card on the board" intent, raised by the command
  // palette and consumed by NoticeBoard (which owns pan/zoom). seq (a
  // monotonic counter that survives the null reset) lets the same card be
  // re-located; onLocated nulls the intent so returning to the board later
  // doesn't re-pan. This is a UI intent, not mirrored DB state.
  const [locate, setLocate] = useState<{ id: string; seq: number } | null>(null);
  const locateSeq = useRef(0);
  const isDm = useIsDm();
  const { viewAsPlayer, setViewAsPlayer } = useViewAsPlayer();
  // Reveal reactions (issue #68): the transient push half of a release. Both
  // are UI intents derived from session_events arriving over realtime — the
  // feed row is the persistent half and always exists first (push + persist).
  const [revealToast, setRevealToast] = useState<{ eventId: number; entityId: string; label: string } | null>(null);
  const [revealFlash, setRevealFlash] = useState<{ id: string; seq: number } | null>(null);
  const revealSeq = useRef(0);
  // Ids of feed rows already seen, lazily seeded from the mount-time array so
  // a reload/late-join replays the feed without replaying toasts. A Set diff,
  // NOT a max-id watermark: bigserial ids are assigned at insert while realtime
  // follows commit order, so a reveal can arrive carrying a lower id than an
  // already-seen note — a watermark would silently drop it.
  const seenEventsRef = useRef<Set<number> | null>(null);

  const sessionEvents = campaign.sessionEvents;
  const activeSessionId = campaign.activeSessionId;
  useEffect(() => {
    if (seenEventsRef.current === null) {
      seenEventsRef.current = new Set(sessionEvents.map((e) => e.id));
      return;
    }
    const seen = seenEventsRef.current;
    const fresh = sessionEvents.filter((e) => !seen.has(e.id));
    if (fresh.length === 0) return;
    fresh.forEach((e) => seen.add(e.id));
    // The active-session filter is load-bearing, not tidiness: viewers'
    // projection drops reveal events pointing at hidden entities, so
    // re-releasing a once-revealed-then-re-hidden entity makes its OLD
    // sessions' reveal rows reappear in the projected array — the diff sees
    // them as new, and only this filter keeps stale ceremonies from toasting.
    const reveals = fresh.filter(
      (e) => e.type === "reveal" && e.sessionId === activeSessionId && e.entityId,
    );
    if (reveals.length === 0) return;
    // Partition quiet releases from "show now" takeovers (#69) and process
    // quiet first, show last — deterministic regardless of how a realtime
    // flush interleaves them, and a takeover always wins over a toast.
    const quiet = reveals.filter((e) => !isShowEvent(e));
    const shows = reveals.filter(isShowEvent);
    if (quiet.length > 0) {
      const last = quiet[quiet.length - 1];
      setRevealFlash({ id: last.entityId!, seq: ++revealSeq.current });
      if (!isDm) {
        // The releasing DM's feedback is the queue row flipping to "released".
        const ent = findEntity(last.entityId);
        setRevealToast({
          eventId: last.id,
          entityId: last.entityId!,
          label: ent ? entityLabel(ent) : stripShowMark(last.text) || "something",
        });
      }
    }
    if (shows.length > 0) {
      const last = shows[shows.length - 1];
      setRevealFlash({ id: last.entityId!, seq: ++revealSeq.current });
      // The takeover is for player clients only — never ambush the DM who
      // triggered it (their feedback is the feed row / queue stamp).
      if (!isDm) {
        const ent = findEntity(last.entityId);
        // Don't yank the sheet out from under someone mid-edit: unmounting a
        // focused editable never fires its blur-commit, so the draft would be
        // lost. Degrade to the toast — the feed row is the recovery path.
        const el = document.activeElement;
        const midEdit = el instanceof HTMLElement &&
          (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
        if (ent && !midEdit) {
          // One slot, never stacked: a second show replaces the first.
          setOpenId(last.entityId!);
          setRevealToast(null);
        } else {
          // Entity unresolvable (dropped UPDATE / deleted) or user mid-edit —
          // a blind setOpenId would render nothing; the toast at least tells.
          setRevealToast({
            eventId: last.id,
            entityId: last.entityId!,
            label: ent ? entityLabel(ent) : stripShowMark(last.text) || "something",
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEvents]);

  // Auto-dismiss keyed on eventId so re-revealing the same entity restarts the
  // timer. Longer than shareToast's 2.2s — this one carries an action.
  useEffect(() => {
    if (!revealToast) return;
    const t = window.setTimeout(() => setRevealToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [revealToast?.eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onWriteError((message) => setWriteErrorToast({ message, seq: ++writeErrorSeq.current }));
    return () => onWriteError(null);
  }, []);
  useEffect(() => {
    if (!writeErrorToast) return;
    const t = window.setTimeout(() => setWriteErrorToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [writeErrorToast?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteHotkey(togglePalette);

  const locateOnBoard = useCallback((id: string) => {
    setView("board");
    setLocate({ id, seq: ++locateSeq.current });
    setPaletteOpen(false);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.__TWEAKS__.theme = theme;
  }, [theme]);
  useEffect(() => { window.__TWEAKS__.showPresence = showPresence; }, [showPresence]);
  useEffect(() => { window.__TWEAKS__.density = density; }, [density]);

  // Mirror the open entity into the hash (replace, not push, so browsing
  // entities doesn't spam history).
  useEffect(() => {
    writeCampaignHash(campaign.id, openId, { replace: true });
  }, [campaign.id, openId]);

  // Entity deep links pasted mid-session are fragment navigations (no page
  // load), so the mount-time parse above never sees them.
  useEffect(() => {
    const onHashChange = () => {
      const { campaignId: cid, entityId } = parseHash();
      if (cid === campaign.id) setOpenId(entityId && findEntity(entityId) ? entityId : null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [campaign.id, findEntity]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "__activate_edit_mode") setTweaksOpen(true);
      else if (e.data?.type === "__deactivate_edit_mode") setTweaksOpen(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  const persist = (edits: Record<string, unknown>) => {
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
  };

  const counts = useMemo(() => {
    const c: Record<string, { active: number; archived: number }> = {};
    kinds.forEach((k) => {
      const list = k.list() as any[];
      const archived = list.filter((e) => e.archived).length;
      c[k.key] = { active: list.length - archived, archived };
    });
    return c;
  }, [kinds]);

  const onShare = () => {
    const url = window.location.origin + window.location.pathname + campaignHash(campaign.id);
    navigator.clipboard.writeText(url).catch(console.error);
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2200);
  };

  return (
    <>
      <div className="app">
        <Topbar onShare={onShare} onOpenCharter={() => setView("campaign")} />
        <Sidebar active={view} onSelect={setView} onOpenEntity={setOpenId} onOpenCleanup={() => setCleanupOpen(true)} counts={counts} />
        <main className="main">
          {view === "board" && (
            <NoticeBoard
              onOpenEntity={setOpenId}
              locateRequest={locate}
              onLocated={() => setLocate(null)}
              revealFlash={revealFlash}
            />
          )}
          {view === "arcs" && <ArcsPage onOpenEntity={setOpenId} />}
          {view === "events" && <EventsPage onOpenEntity={setOpenId} />}
          {view === "campaign" && <CampaignCharterPage onOpenEntity={setOpenId} />}
          {/* Catch-all treats the view as a KindKey — every non-kind view
              must be excluded here or it double-renders a bogus KindList. */}
          {!["board", "arcs", "events", "campaign"].includes(view) && <KindList kind={view} onOpenEntity={setOpenId} />}
        </main>
        <LivePanel onOpenEntity={setOpenId} />
      </div>

      {openId && (
        <DetailSheet
          entityId={openId}
          onClose={() => setOpenId(null)}
          onOpen={(id) => setOpenId(id)}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenEntity={(id) => { setOpenId(id); setPaletteOpen(false); }}
        onLocate={locateOnBoard}
      />

      {cleanupOpen && (
        <CleanupPanel
          onClose={() => setCleanupOpen(false)}
          onOpenEntity={(id) => { setOpenId(id); setCleanupOpen(false); }}
        />
      )}

      {shareToast && (
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--vellum-light)",
          padding: "10px 18px 10px 14px",
          fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14,
          boxShadow: "0 6px 20px rgba(40,20,5,.45)",
          display: "flex", alignItems: "center", gap: 10,
          zIndex: 70, borderRadius: 2,
        }}>
          <Icon name="check" size={14} /> Share link copied — anyone with the link may read.
        </div>
      )}

      {/* Rejected write (#87) — same dress as the share toast but bloodred:
          this one reports a failure. Single slot, newest message wins. */}
      {writeErrorToast && (
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: "var(--bloodred)", color: "var(--vellum-light)",
          padding: "10px 18px 10px 14px",
          fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14,
          boxShadow: "0 6px 20px rgba(40,20,5,.45)",
          display: "flex", alignItems: "center", gap: 10,
          zIndex: 70, borderRadius: 2,
        }}>
          <span aria-hidden>✕</span> {writeErrorToast.message}
        </div>
      )}

      {/* The transient half of a reveal (issue #68) — same dress as the share
          toast. Single slot: a newer reveal replaces this one; the feed row in
          the live panel is the recovery path, never this toast. */}
      {revealToast && (
        <div style={{
          position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)",
          background: "var(--ink)", color: "var(--vellum-light)",
          padding: "10px 14px",
          fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14,
          boxShadow: "0 6px 20px rgba(40,20,5,.45)",
          display: "flex", alignItems: "center", gap: 12,
          zIndex: 70, borderRadius: 2,
        }}>
          <span>🕯 The DM revealed <strong style={{ fontStyle: "normal" }}>{revealToast.label}</strong></span>
          <button
            onClick={() => { setOpenId(revealToast.entityId); setRevealToast(null); }}
            style={{
              background: "transparent", color: "var(--vellum-light)",
              border: "1px solid var(--vellum-deep)", borderRadius: 2,
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".16em", fontSize: 10,
              padding: "4px 10px", cursor: "pointer", flexShrink: 0,
            }}
          >
            VIEW
          </button>
        </div>
      )}

      {/* Mode visibility for "view as player" (#71): the mode must be
          unmissable while active and exit in one click (NN/g modes guidance).
          z 72: above the detail overlay (50) and toasts (70) so it stays
          visible with a sheet open, below ⌘K (80) which opens top-center. */}
      {viewAsPlayer && (
        <div style={{
          position: "fixed", top: 64, left: "50%", transform: "translateX(-50%)",
          background: "var(--bloodred)", color: "var(--vellum-light)",
          padding: "8px 12px 8px 16px",
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".14em", fontSize: 11,
          boxShadow: "0 6px 20px rgba(40,20,5,.45)",
          display: "flex", alignItems: "center", gap: 14,
          zIndex: 72, borderRadius: 2, whiteSpace: "nowrap",
        }}>
          <span>◉ VIEWING AS PLAYER — hidden entries &amp; DM tools concealed</span>
          <button
            onClick={() => setViewAsPlayer(false)}
            style={{
              background: "var(--vellum-light)", color: "var(--bloodred)",
              border: "none", borderRadius: 2,
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".16em", fontSize: 10,
              fontWeight: 700, padding: "4px 10px", cursor: "pointer", flexShrink: 0,
            }}
          >
            EXIT
          </button>
        </div>
      )}

      {tweaksOpen && (
        <div className="tweaks-panel">
          <header>
            <span>✦ TWEAKS ✦</span>
            <button onClick={() => setTweaksOpen(false)} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--ink-faded)" }}>
              <Icon name="close" size={14} />
            </button>
          </header>
          <div className="body">
            <div className="tweak-row">
              <label>Aesthetic Theme</label>
              <div className="seg">
                <button className={theme === "cartographer" ? "active" : ""} onClick={() => { setTheme("cartographer"); persist({ theme: "cartographer" }); }}>Cartographer</button>
                <button className={theme === "grimoire" ? "active" : ""} onClick={() => { setTheme("grimoire"); persist({ theme: "grimoire" }); }}>Grimoire</button>
                <button className={theme === "modern" ? "active" : ""} onClick={() => { setTheme("modern"); persist({ theme: "modern" }); }}>Modern</button>
              </div>
            </div>
            <div className="tweak-row">
              <label>Collaborator Presence</label>
              <div className="seg">
                <button className={showPresence ? "active" : ""} onClick={() => { setShowPresence(true); persist({ showPresence: true }); }}>Show</button>
                <button className={!showPresence ? "active" : ""} onClick={() => { setShowPresence(false); persist({ showPresence: false }); }}>Hide</button>
              </div>
            </div>
            <div className="tweak-row">
              <label>Density</label>
              <div className="seg">
                <button className={density === "cozy" ? "active" : ""} onClick={() => { setDensity("cozy"); persist({ density: "cozy" }); }}>Cozy</button>
                <button className={density === "compact" ? "active" : ""} onClick={() => { setDensity("compact"); persist({ density: "compact" }); }}>Compact</button>
              </div>
            </div>
            <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 12, color: "var(--ink-secondary)", textAlign: "center", marginTop: 4 }}>
              "What a party writes down, the world remembers."
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AppGate() {
  const { loading, error } = useCampaignStatus();
  return (
    <>
      {loading ? <LoadingSheet /> : error ? <ErrorSheet message={error} /> : <AppLoaded />}
      {/* Invite redemption + sealed letter of summons (issue #86). Mounted
          OUTSIDE the loading gate: a redemption that switches campaigns sets
          loading=true, and the success toast must survive that unmount (it
          reads campaign state null-safely). The DisplayNameGate above means
          a fresh Discord editor names themselves before redemption puts
          them on the roster. */}
      {!error && <JoinFlow />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DisplayNameGate>
        <CampaignProvider>
          <AppGate />
        </CampaignProvider>
      </DisplayNameGate>
    </AuthProvider>
  );
}
