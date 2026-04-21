import { useRef, useState } from "react";
import {
  type KindKey,
} from "./data";
import { CompassRose, Icon, kindIcon } from "./icons";
import { useCampaign, useFindEntity, useKinds } from "./hooks";
import { CardBody, PinnedCard } from "./components";
import { entityLabel } from "./data";
import {
  upsertBoardPosition,
  insertConnection,
  deleteConnection,
  createEntity,
} from "./mutations";

// Minimum required columns by kind (NOT NULL constraints in 0001_init.sql).
// createEntity injects id + campaign_id, so only the per-kind required fields go here.
const NEW_ENTITY_DEFAULTS: Record<Exclude<KindKey, "sessions">, Record<string, unknown>> = {
  people:    { name: "Unnamed wayfarer" },
  locations: { name: "Unnamed place", kind: "other" },
  quests:    { title: "Untitled quest" },
  goals:     { text: "A new aim", owner: "The Party", kind: "party" },
  factions:  { name: "Unnamed faction", sigil: "✦" },
  items:     { name: "Unnamed item", kind: "relic" },
  lore:      { title: "Untitled lore", text: "" },
};

interface Filters {
  sessions: string;
  people?: boolean;
  locations?: boolean;
  quests?: boolean;
  goals?: boolean;
  factions?: boolean;
  items?: boolean;
  lore?: boolean;
  [key: string]: boolean | string | undefined;
}

export function NoticeBoard({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const kinds = useKinds();

  const positions = campaign.board;
  const connections = campaign.connections;

  const [filters, setFilters] = useState<Filters>(() => {
    const f: Filters = { sessions: "all" };
    (["people", "locations", "quests", "goals", "factions", "items", "lore"] as const).forEach((k) => {
      (f as any)[k] = true;
    });
    return f;
  });
  const [scale, setScale] = useState(0.7);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  const [hoverConn, setHoverConn] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const visible = (id: string) => {
    const pos = positions[id];
    if (!pos) return false;
    if (!(filters as any)[pos.kind]) return false;
    return true;
  };

  const visibleConnections = connections.filter(([a, b]) => visible(a) && visible(b));

  const toggleKind = (k: KindKey) => setFilters((f) => ({ ...f, [k]: !(f as any)[k] }));

  const onDragEnd = (id: string, newPos: { x: number; y: number }) => {
    const base = positions[id];
    if (!base) return;
    upsertBoardPosition(id, { ...base, ...newPos }).catch((e) =>
      console.error("upsertBoardPosition failed", e),
    );
  };

  const handleConnectClick = (id: string) => {
    if (!connectSource) { setConnectSource(id); return; }
    if (connectSource === id) { setConnectSource(null); return; }
    insertConnection(connectSource, id, "linked").catch((e) =>
      console.error("insertConnection failed", e),
    );
    setConnectSource(null);
    setConnectMode(false);
  };

  const removeConnection = (fromId: string, toId: string, label: string) => {
    deleteConnection(fromId, toId, label).catch((e) =>
      console.error("deleteConnection failed", e),
    );
  };

  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const onCreate = async (k: Exclude<KindKey, "sessions">) => {
    setAddMenuOpen(false);
    const id = crypto.randomUUID();
    try {
      await createEntity(k, id, NEW_ENTITY_DEFAULTS[k]);
      // Drop the new card onto a slightly randomized spot so they don't stack.
      await upsertBoardPosition(id, {
        x: 400 + Math.floor(Math.random() * 600),
        y: 300 + Math.floor(Math.random() * 400),
        rot: Math.floor(Math.random() * 7) - 3,
        kind: k,
      });
      onOpenEntity(id);
    } catch (e) {
      console.error("createEntity failed", e);
    }
  };

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".pinned")) return;
    if (e.button !== 0) return;
    setPanning(true);
    const startX = e.clientX, startY = e.clientY;
    const origPan = pan;
    const onMove = (ev: MouseEvent) => setPan({ x: origPan.x + (ev.clientX - startX), y: origPan.y + (ev.clientY - startY) });
    const onUp = () => {
      setPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const cardSize: Record<string, { w: number; h: number }> = {
    people: { w: 220, h: 300 },
    quests: { w: 240, h: 160 },
    locations: { w: 210, h: 200 },
    goals: { w: 200, h: 140 },
    factions: { w: 180, h: 80 },
    items: { w: 170, h: 90 },
    lore: { w: 190, h: 90 },
  };
  const centerOf = (id: string) => {
    const p = positions[id];
    if (!p) return null;
    const s = cardSize[p.kind] || { w: 200, h: 140 };
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };

  const yarnPath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 + Math.max(20, Math.hypot(dx, dy) * 0.08);
    return `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
  };

  const zoomBy = (delta: number) =>
    setScale((s) => Math.max(0.35, Math.min(1.6, +(s + delta).toFixed(2))));

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.05 : -0.05);
    }
  };

  const filteredSessionQuests: Set<string> | null = filters.sessions === "all"
    ? null
    : new Set([
        ...campaign.quests.filter((q) => q.session === filters.sessions).map((q) => q.id),
        ...campaign.people.filter((p) => p.lastSeen === filters.sessions).map((p) => p.id),
      ]);

  return (
    <>
      <div className="board-toolbar">
        <h1>The Notice Board <em>— last edit: just now, by Kael</em></h1>
        <div style={{ flex: 1 }} />

        <div className="filter-group">
          {kinds.map((k) => (
            <span
              key={k.key}
              className={`filter-pill ${(filters as any)[k.key] ? "active" : ""}`}
              onClick={() => toggleKind(k.key)}
            >
              <span className="swatch" style={{ background: k.color }} />
              {k.label}
            </span>
          ))}
        </div>

        <div className="filter-group">
          <span
            className={`filter-pill ${filters.sessions === "all" ? "active" : ""}`}
            onClick={() => setFilters((f) => ({ ...f, sessions: "all" }))}
          >
            All sessions
          </span>
          {campaign.sessions.map((s) => (
            <span
              key={s.id}
              className={`filter-pill ${filters.sessions === s.id ? "active" : ""}`}
              onClick={() => setFilters((f) => ({ ...f, sessions: s.id }))}
              title={s.title}
            >
              S{String(s.num).padStart(2, "0")}
            </span>
          ))}
        </div>

        <button
          className={`btn ${connectMode ? "btn-primary" : ""}`}
          onClick={() => { setConnectMode((m) => !m); setConnectSource(null); }}
          title="Draw a connection between two cards"
        >
          <Icon name="link" size={14} /> {connectMode ? "Cancel string" : "Draw string"}
        </button>

        <div style={{ position: "relative" }}>
          <button
            className="btn btn-primary"
            onClick={() => setAddMenuOpen((o) => !o)}
            title="Pin a new card to the board"
          >
            <Icon name="plus" size={14} /> Pin new
          </button>
          {addMenuOpen && (
            <>
              <div
                onClick={() => setAddMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 40 }}
              />
              <div
                style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 6,
                  background: "var(--vellum-light)", minWidth: 180,
                  boxShadow: "0 8px 24px rgba(40,20,5,.25)",
                  border: "1px solid var(--ink-faded)",
                  fontFamily: "var(--font-fell)", fontSize: 13,
                  zIndex: 50,
                }}
              >
                {kinds.map((k) => (
                  <div
                    key={k.key}
                    onClick={() => onCreate(k.key as Exclude<KindKey, "sessions">)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 12px", cursor: "pointer",
                      borderBottom: "1px solid rgba(40,20,5,.08)",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(40,20,5,.04)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                  >
                    <span className="swatch" style={{ background: k.color, width: 10, height: 10, display: "inline-block", borderRadius: 2 }} />
                    <Icon name={kindIcon[k.key]} size={14} />
                    New {k.label.toLowerCase()}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div
        ref={canvasRef}
        className={`board-canvas tex-cork ${panning ? "panning" : ""}`}
        onMouseDown={onCanvasMouseDown}
        onWheel={onWheel}
      >
        <div
          className="board-surface"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
        >
          <div className="board-frame" />
          <CompassRose style={{ top: 60, right: 120, color: "var(--ink)" } as any} />

          <div style={{
            position: "absolute", top: 60, left: 900,
            padding: "10px 40px",
            background: "var(--paper-scroll)",
            fontFamily: "var(--font-fell-sc)",
            letterSpacing: ".3em", fontSize: 14,
            color: "var(--ink)",
            transform: "rotate(-1deg)",
            boxShadow: "var(--shadow-pin)",
            border: "1px solid rgba(139,94,40,.4)",
            zIndex: 2,
          }}>
            <span className="pin-head" style={{ left: "10%" }} />
            <span className="pin-head" style={{ left: "90%" }} />
            ✦ THE NOTICE BOARD OF THE CROOKED TANKARD ✦
          </div>

          <svg className="yarn-layer" viewBox={`0 0 2800 2000`} preserveAspectRatio="none">
            <defs>
              <filter id="yarn-glow">
                <feGaussianBlur stdDeviation="0.6" />
              </filter>
            </defs>
            {visibleConnections.map((conn, i) => {
              const [a, b, label] = conn;
              const A = centerOf(a), B = centerOf(b);
              if (!A || !B) return null;
              const faded = filteredSessionQuests && !(filteredSessionQuests.has(a) || filteredSessionQuests.has(b));
              const isHover = hoverConn === i;
              const pathD = yarnPath(A, B);
              const midX = (A.x + B.x) / 2;
              const midY = (A.y + B.y) / 2 + Math.max(20, Math.hypot(B.x - A.x, B.y - A.y) * 0.08) * 0.5;
              return (
                <g key={i}
                   onMouseEnter={() => setHoverConn(i)}
                   onMouseLeave={() => setHoverConn(null)}
                   style={{ pointerEvents: "stroke" }}
                >
                  <path d={pathD} stroke="rgba(0,0,0,.35)" strokeWidth="2.5" fill="none" transform="translate(1,2)" filter="url(#yarn-glow)" />
                  <path d={pathD} className={`yarn-path ${faded ? "faded" : ""} ${isHover ? "hover" : ""}`} />
                  {isHover && (
                    <text>
                      <textPath href={`#yp${i}`} startOffset="50%" textAnchor="middle" className="yarn-label">
                        {label}
                      </textPath>
                    </text>
                  )}
                  <path id={`yp${i}`} d={pathD} fill="none" stroke="none" />
                  {isHover && (
                    <g
                      transform={`translate(${midX} ${midY})`}
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                      onClick={(e) => { e.stopPropagation(); removeConnection(a, b, label); }}
                    >
                      <circle r="11" fill="var(--bloodred)" stroke="var(--vellum-light)" strokeWidth="1.5" />
                      <path d="M -4 -4 L 4 4 M -4 4 L 4 -4" stroke="var(--vellum-light)" strokeWidth="2" strokeLinecap="round" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {Object.entries(positions).map(([id, pos]) => {
            if (!(filters as any)[pos.kind]) return null;
            const entity = findEntity(id);
            if (!entity) return null;
            return (
              <PinnedCard
                key={id}
                entity={entity}
                pos={pos}
                scale={scale}
                onOpen={onOpenEntity}
                onDragEnd={onDragEnd}
                connectMode={connectMode}
                onConnectClick={handleConnectClick}
                isConnectSource={connectSource === id}
              />
            );
          })}

          <div className="pinned" style={{ left: 1050, top: 500, transform: "rotate(-6deg)", cursor: "default" }}>
            <span className="pin-head" />
            <div className="card-note">
              <div className="n-text">Don't break the black seal. Vareth read it once — he can't remember his own sister now.</div>
              <div className="n-author">— Nym</div>
            </div>
          </div>
          <div className="pinned" style={{ left: 1750, top: 1100, transform: "rotate(4deg)", cursor: "default" }}>
            <span className="pin-head iron" />
            <div className="card-note" style={{ background: "#f0e4b8" }}>
              <div className="n-text">The bells at Blackmere rang TWICE last tide. Once for Oriane. Once for someone we haven't met yet.</div>
              <div className="n-author">— Sera</div>
            </div>
          </div>

          <div className="wax-seal" style={{ top: 120, left: 60 }}>EC</div>
          <div className="wax-seal" style={{ top: 1820, left: 2200, background: "radial-gradient(circle at 35% 30%, #c5a04a 0%, #8a6820 60%, #5a430f 100%)" }}>✦</div>
        </div>

        {connectMode && (
          <div className="connect-mode-banner">
            <Icon name="link" size={14} />
            {connectSource
              ? `Select a second card to connect to ${entityLabel(findEntity(connectSource))}`
              : "Click a card to start a string"}
          </div>
        )}

        <div className="board-zoom">
          <button onClick={() => zoomBy(0.1)} title="Zoom in">+</button>
          <div className="zoom-val">{Math.round(scale * 100)}%</div>
          <button onClick={() => zoomBy(-0.1)} title="Zoom out">−</button>
          <button onClick={() => { setScale(0.7); setPan({ x: 0, y: 0 }); }} title="Reset view" style={{ fontSize: 11, fontFamily: "var(--font-fell-sc)" }}>⟲</button>
        </div>
      </div>
    </>
  );
}

export function KindList({ kind, onOpenEntity }: { kind: string; onOpenEntity: (id: string) => void }) {
  const kinds = useKinds();
  const k = kinds.find((x) => x.key === kind);
  if (!k) return null;
  const items = k.list();
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>{k.label}</h1>
          <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {items.length} {k.plural} of note
          </span>
        </div>
        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 20, marginTop: 24 }}>
          {items.map((e: any) => (
            <div key={e.id}
                 onClick={() => onOpenEntity(e.id)}
                 style={{ cursor: "pointer", transform: `rotate(${(e.id.charCodeAt(1) % 5 - 2) * 0.6}deg)` }}
            >
              <CardBody entity={e} kind={k.key as KindKey} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
