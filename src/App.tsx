import { useCallback, useEffect, useMemo, useState } from "react";
import { CampaignProvider } from "./campaignContext";
import { AuthProvider, DisplayNameGate } from "./auth";
import { useCampaignStatus, useKinds } from "./hooks";
import { Icon } from "./icons";
import { Sidebar, Topbar } from "./components";
import { NoticeBoard, KindList } from "./board";
import { DetailSheet } from "./detail";
import { CommandPalette, useCommandPaletteHotkey } from "./commandPalette";

function LoadingSheet() {
  return (
    <div style={{
      position: "fixed", inset: 0, display: "grid", placeItems: "center",
      background: "var(--vellum)", color: "var(--ink)",
      fontFamily: "var(--font-display)", fontSize: 22, letterSpacing: ".04em",
      fontStyle: "italic",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12, color: "var(--ink-faded)", marginBottom: 12 }}>
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
        <pre style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-faded)", whiteSpace: "pre-wrap" }}>
          {message}
        </pre>
      </div>
    </div>
  );
}

function AppLoaded() {
  const kinds = useKinds();

  const [theme, setTheme] = useState<string>(window.__TWEAKS__.theme || "cartographer");
  const [showPresence, setShowPresence] = useState<boolean>(window.__TWEAKS__.showPresence);
  const [density, setDensity] = useState<string>(window.__TWEAKS__.density || "cozy");
  const [view, setView] = useState("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [shareToast, setShareToast] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  useCommandPaletteHotkey(togglePalette);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.__TWEAKS__.theme = theme;
  }, [theme]);
  useEffect(() => { window.__TWEAKS__.showPresence = showPresence; }, [showPresence]);
  useEffect(() => { window.__TWEAKS__.density = density; }, [density]);

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
    const c: Record<string, number> = {};
    kinds.forEach((k) => { c[k.key] = k.list().length; });
    return c;
  }, [kinds]);

  const onShare = () => {
    setShareToast(true);
    setTimeout(() => setShareToast(false), 2200);
  };

  return (
    <>
      <div className="app">
        <Topbar onShare={onShare} />
        <Sidebar active={view} onSelect={setView} onOpenEntity={setOpenId} counts={counts} />
        <main className="main">
          {view === "board" && <NoticeBoard onOpenEntity={setOpenId} />}
          {view !== "board" && <KindList kind={view} onOpenEntity={setOpenId} />}
        </main>
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
      />

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
          <Icon name="check" size={14} /> Share link copied — anyone with the link may read &amp; write.
          <span style={{ opacity: .6, fontFamily: "var(--font-ui)", fontStyle: "normal", fontSize: 11, letterSpacing: ".1em" }}>codex.app/c/ember-accord</span>
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
            <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 12, color: "var(--ink-faded)", textAlign: "center", marginTop: 4 }}>
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
  if (loading) return <LoadingSheet />;
  if (error) return <ErrorSheet message={error} />;
  return <AppLoaded />;
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
