import { useEffect, useMemo, useRef, useState } from "react";
import {
  type KindKey,
  type BoardPosition,
  sortForDisplay,
  isArchivableKind,
} from "./data";
import { CompassRose, Icon, kindIcon } from "./icons";
import { useCampaign, useFindEntity, useKinds } from "./hooks";
import { useAuth } from "./auth";
import { CardBody, PinnedCard } from "./components";
import { entityLabel } from "./data";
import { computeTidyLayout, cardDims } from "./boardLayout";
import { deriveRelations } from "./relations";
import {
  upsertBoardPosition,
  bulkUpsertBoardPositions,
  insertConnection,
  deleteConnection,
  createEntity,
  markSeen,
} from "./mutations";

// Minimum required columns by kind (NOT NULL constraints in 0001_init.sql).
// createEntity injects id + campaign_id, so only the per-kind required fields go here.
const NEW_ENTITY_DEFAULTS: Record<Exclude<KindKey, "sessions" | "arcs" | "events">, Record<string, unknown>> = {
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

export function NoticeBoard({
  onOpenEntity,
  locateRequest,
  onLocated,
}: {
  onOpenEntity: (id: string) => void;
  locateRequest?: { id: string; seq: number } | null;
  onLocated?: () => void;
}) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const kinds = useKinds();
  const { canEdit } = useAuth();

  const positions = campaign.board;
  // Unified relationship edges: hand-drawn strings (connections table) + the
  // FK-derived relations (resides at / member of / quest giver / happened at),
  // the same projection the detail sheet and cleanup panel read, so the board
  // can't drift from them. deriveRelations reads only these arrays.
  const edges = useMemo(
    () => deriveRelations(campaign),
    [campaign.connections, campaign.people, campaign.quests, campaign.events],
  );

  // The board sizes itself to its content: the cork/frame and the yarn SVG
  // grow to enclose the furthest-flung card so nothing lands off-canvas and
  // no string is clipped. 2800×2000 is the floor (the original design size),
  // and the padding clears the tallest card (~220×344) plus a margin.
  const bounds = useMemo(() => {
    let w = 2800, h = 2000;
    for (const id in positions) {
      const p = positions[id];
      if (!p) continue;
      if (p.x + 320 > w) w = p.x + 320;
      if (p.y + 420 > h) h = p.y + 420;
    }
    return { w, h };
  }, [positions]);

  const [filters, setFilters] = useState<Filters>(() => {
    // Open focused on the live session's cast when a session is pinned.
    const f: Filters = { sessions: campaign.activeSessionId ?? "all" };
    (["people", "locations", "quests", "goals", "factions", "items", "lore"] as const).forEach((k) => {
      (f as any)[k] = true;
    });
    return f;
  });
  const [showArchived, setShowArchived] = useState(false);
  // FK-derived strings (dashed) can be hidden when the board gets busy; manual
  // strings always show. This also scopes Tidy to what's visible (see onTidy).
  const [showDerived, setShowDerived] = useState(true);
  const [scale, setScale] = useState(0.9);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);
  // Keyed on a stable edge identity (a|b|label|source), NOT the visibleEdges
  // index — that array is re-filtered on every render (Derived-strings toggle,
  // realtime splices), so an index would drift the highlight/delete onto the
  // wrong string mid-hover.
  const [hoverConn, setHoverConn] = useState<string | null>(null);
  const [hoverCard, setHoverCard] = useState<string | null>(null);
  // Locate-on-board: the card being flashed (with the locate seq as a nonce so
  // re-locating the same card restarts the flash), and whether the surface is
  // mid-glide (a one-shot transition on the pan/zoom — kept off at rest so
  // panning and dragging stay snappy). Both are ephemeral UI state, not DB
  // mirrors.
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const [gliding, setGliding] = useState(false);
  const flashId = flash?.id ?? null;
  const [tidyAnim, setTidyAnim] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [tidying, setTidying] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const lastLocateSeq = useRef(-1);
  const rafRef = useRef<number | null>(null);
  // The final rounded target of an in-flight tidy; kept until campaign.board
  // reflects it so cards don't flash back to their old spots between the write
  // and realtime landing.
  const pendingTargetRef = useRef<Record<string, { x: number; y: number }> | null>(null);

  const visible = (id: string) => {
    const pos = positions[id];
    if (!pos) return false;
    if (!(filters as any)[pos.kind]) return false;
    const ent = findEntity(id);
    if (!ent) return false;
    if (!showArchived && (ent as any).archived) return false;
    return true;
  };

  const visibleEdges = edges.filter(
    // Suppressed FK edges (a manual string already covers the pair) never draw
    // on the board regardless of the derived-strings toggle — the hand-drawn
    // string wins the board line — but they still exist in `edges` for other
    // consumers (the detail sheet's Relations rail) to read.
    (e) => visible(e.a) && visible(e.b) && !e.suppressed && (showDerived || e.source === "manual"),
  );

  // The entities tied to the focused session: quests logged in it and people
  // last seen there (sessions link to nothing else in the model). null means
  // "no focus" — either "All sessions", or a session with nothing linked to it
  // (an empty set would otherwise recede the whole board, spotlighting nothing).
  const sessionFocus: Set<string> | null = (() => {
    if (filters.sessions === "all") return null;
    const s = new Set([
      ...campaign.quests.filter((q) => q.session === filters.sessions).map((q) => q.id),
      ...campaign.people.filter((p) => p.lastSeen === filters.sessions).map((p) => p.id),
    ]);
    return s.size > 0 ? s : null;
  })();

  // Hover spotlight: a hovered card and its neighbors stay lit while the rest
  // dim (.pinned.dimmed). Session focus is a separate, milder treatment: cards
  // outside the focused session collapse to headline-only (.pinned.receded)
  // but stay fully legible — a live session shouldn't ghost the whole board.
  const hoverSpot = hoverCard
    ? new Set([hoverCard, ...visibleEdges.flatMap((e) =>
        e.a === hoverCard ? [e.b] : e.b === hoverCard ? [e.a] : [])])
    : null;

  const toggleKind = (k: KindKey) => setFilters((f) => ({ ...f, [k]: !(f as any)[k] }));

  const onDragEnd = (id: string, newPos: { x: number; y: number }) => {
    if (!canEdit) return; // read-only: card snaps back on next render
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

  const onCreate = async (k: Exclude<KindKey, "sessions" | "arcs" | "events">) => {
    setAddMenuOpen(false);
    const id = crypto.randomUUID();
    try {
      await createEntity(k, id, NEW_ENTITY_DEFAULTS[k]);
      // Creating a person while live implies they showed up this session —
      // auto-mark them seen (people have no session_id, so this is their
      // creation-only link, mirroring the events/quests default in createEntity).
      if (k === "people" && campaign.activeSessionId) {
        markSeen(id).catch(console.error);
      }
      // Drop the new card into the first open spot so cards don't pile up.
      const spot = findFreeSpot(k);
      await upsertBoardPosition(id, {
        x: spot.x,
        y: spot.y,
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

  // During a "Tidy" glide, tidyAnim holds the interpolated {x,y} per card; it
  // overrides the persisted position for rendering only (same transient
  // view-state pattern as drag/pan), then clears once realtime brings the
  // written positions back through campaign.board.
  const posOf = (id: string): BoardPosition | undefined => {
    const base = positions[id];
    if (!base) return undefined;
    const anim = tidyAnim?.[id];
    return anim ? { ...base, x: anim.x, y: anim.y } : base;
  };
  const centerOf = (id: string) => {
    const p = posOf(id);
    if (!p) return null;
    const s = cardDims(p.kind);
    return { x: p.x + s.w / 2, y: p.y + s.h / 2 };
  };

  // Search wayfinding: when the palette raises a locate request, reveal the
  // card (turn its kind filter / archived visibility back on if hidden), pan
  // and zoom so it sits dead-center, then arm the flash. Guarded by seq so it
  // fires once per request. The flash's decay lives in its own effect below,
  // keyed on the flash state — not tied to locateRequest — so nulling the
  // request (via onLocated) can't cut the flash short.
  useEffect(() => {
    if (!locateRequest || locateRequest.seq === lastLocateSeq.current) return;
    lastLocateSeq.current = locateRequest.seq;
    const { id, seq } = locateRequest;

    const pos = positions[id];
    if (!pos) {
      // Not pinned to the board — nothing to center on; open its sheet instead.
      onOpenEntity(id);
      onLocated?.();
      return;
    }

    if (!(filters as any)[pos.kind]) setFilters((f) => ({ ...f, [pos.kind]: true }));
    const ent = findEntity(id);
    if (ent && (ent as any).archived) setShowArchived(true);

    const rect = canvasRef.current?.getBoundingClientRect();
    const c = centerOf(id);
    if (rect && c) {
      const target = Math.min(1.6, Math.max(scale, 1));
      setGliding(true);
      setScale(target);
      setPan({ x: rect.width / 2 - c.x * target, y: rect.height / 2 - c.y * target });
    }

    setFlash({ id, n: seq });
    onLocated?.();
  }, [locateRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Decay the flash: end the glide, then clear the flash. Keyed on the flash
  // state (not locateRequest), so it re-derives its timers from state on every
  // run — including React StrictMode's mount/cleanup/mount replay, which would
  // otherwise tear the timers down and leave the flash stuck on.
  useEffect(() => {
    if (!flash) return;
    const t1 = window.setTimeout(() => setGliding(false), 650);
    const t2 = window.setTimeout(() => setFlash(null), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [flash]);

  // Probe outward for an open spot so a new card doesn't stack on others (or
  // land under the title banner). Sweeps a grid below the banner strip and
  // returns the first slot whose rect clears every existing card; falls back to
  // a randomized drop if the board is packed.
  const findFreeSpot = (kind: string) => {
    const s = cardDims(kind);
    const pad = 24;
    const occupied = Object.values(positions).map((p) => {
      const os = cardDims(p.kind);
      return { x: p.x, y: p.y, w: os.w, h: os.h };
    });
    const overlaps = (x: number, y: number) =>
      occupied.some(
        (o) =>
          x < o.x + o.w + pad &&
          x + s.w + pad > o.x &&
          y < o.y + o.h + pad &&
          y + s.h + pad > o.y,
      );
    const startX = 220, startY = 260, stepX = 120, stepY = 90, cols = 12, rows = 14;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = startX + c * stepX;
        const y = startY + r * stepY;
        if (!overlaps(x, y)) return { x, y };
      }
    }
    return { x: 400 + Math.floor(Math.random() * 600), y: 300 + Math.floor(Math.random() * 400) };
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

  // "Tidy board": force-directed re-layout of the *visible* cards into spheres
  // of influence (see boardLayout.ts). Computes target spots, glides cards (and
  // their yarn) there over ~0.9s, then persists the final positions in one bulk
  // upsert. The layout normalizes to the top-left margin so the whole board
  // reflows on-canvas as a unit.
  const onTidy = () => {
    if (!canEdit || tidying) return;
    const cards = Object.keys(positions)
      .filter((id) => visible(id))
      .map((id) => ({
        id,
        kind: positions[id].kind,
        pinned: !!(findEntity(id) as any)?.pinned,
      }));
    if (cards.length < 2) return;

    // Cluster on what's visible: hiding derived strings scopes Tidy to manual
    // edges (deliberate — mirrors the visible-cards-only footprint above).
    const target = computeTidyLayout({ cards, positions, edges: visibleEdges });
    const ids = Object.keys(target);
    if (ids.length === 0) return;
    const start: Record<string, { x: number; y: number }> = {};
    ids.forEach((id) => { start[id] = { x: positions[id].x, y: positions[id].y }; });

    setTidying(true);
    const DURATION = 900;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // ease-out cubic
    const t0 = performance.now();
    const step = (now: number) => {
      const e = ease(Math.min(1, (now - t0) / DURATION));
      const frame: Record<string, { x: number; y: number }> = {};
      ids.forEach((id) => {
        frame[id] = {
          x: start[id].x + (target[id].x - start[id].x) * e,
          y: start[id].y + (target[id].y - start[id].y) * e,
        };
      });
      setTidyAnim(frame);
      if (e < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      rafRef.current = null;
      // Snap to the rounded target (matches what the DB will store) and hold it
      // via pendingTargetRef until realtime confirms; then persist once.
      const rounded: Record<string, { x: number; y: number }> = {};
      ids.forEach((id) => { rounded[id] = { x: Math.round(target[id].x), y: Math.round(target[id].y) }; });
      setTidyAnim(rounded);
      pendingTargetRef.current = rounded;
      setTidying(false);
      bulkUpsertBoardPositions(
        ids.map((id) => ({
          entityId: id,
          pos: { ...rounded[id], rot: positions[id].rot, kind: positions[id].kind },
        })),
      ).catch((err) => {
        console.error("bulkUpsertBoardPositions failed", err);
        pendingTargetRef.current = null;
        setTidyAnim(null);
      });
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Clear the tidy override once campaign.board catches up to the written
  // positions, so realtime state takes back over without a flash.
  useEffect(() => {
    const pending = pendingTargetRef.current;
    if (!pending) return;
    const settled = Object.keys(pending).every((id) => {
      const p = positions[id];
      return p && p.x === pending[id].x && p.y === pending[id].y;
    });
    if (settled) {
      pendingTargetRef.current = null;
      setTidyAnim(null);
    }
  }, [positions]);

  // Cancel any in-flight glide if the board unmounts (e.g. campaign switch).
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

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
            className={`filter-pill ${showArchived ? "active" : ""}`}
            onClick={() => setShowArchived((v) => !v)}
            title="Include archived cards on the board"
          >
            {showArchived ? "✓ Archived" : "Show archived"}
          </span>
          <span
            className={`filter-pill ${showDerived ? "active" : ""}`}
            onClick={() => setShowDerived((v) => !v)}
            title="Show the dashed strings derived from relations (resides at, member of, quest giver)"
          >
            {showDerived ? "✓ Derived strings" : "Derived strings"}
          </span>
        </div>

        <div className={`filter-group ${filters.sessions !== "all" ? "active" : ""}`}>
          <select
            className="session-focus"
            value={filters.sessions}
            onChange={(e) => setFilters((f) => ({ ...f, sessions: e.target.value }))}
            title="Spotlight the cards from one session; the rest of the board drops to headlines"
          >
            <option value="all">All sessions</option>
            {campaign.sessions
              .slice()
              .sort((a, b) => b.num - a.num)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  S{String(s.num).padStart(2, "0")} — {s.title}
                </option>
              ))}
          </select>
        </div>

        {canEdit && <button
          className="btn"
          onClick={onTidy}
          disabled={tidying}
          title="Auto-arrange the board: connected cards cluster, same-kind cards group, starred cards stay put"
        >
          <Icon name="sparkle" size={14} /> {tidying ? "Tidying…" : "Tidy board"}
        </button>}

        {canEdit && <button
          className={`btn ${connectMode ? "btn-primary" : ""}`}
          onClick={() => { setConnectMode((m) => !m); setConnectSource(null); }}
          title="Draw a connection between two cards"
        >
          <Icon name="link" size={14} /> {connectMode ? "Cancel string" : "Draw string"}
        </button>}

        {canEdit && <div style={{ position: "relative" }}>
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
                    onClick={() => onCreate(k.key as Exclude<KindKey, "sessions" | "arcs" | "events">)}
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
        </div>}
      </div>

      <div
        ref={canvasRef}
        className={`board-canvas tex-cork ${panning ? "panning" : ""}`}
        onMouseDown={onCanvasMouseDown}
        onWheel={onWheel}
      >
        <div
          className={`board-surface ${scale < 0.7 ? "zoom-far" : ""} ${gliding ? "gliding" : ""}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, width: bounds.w, height: bounds.h }}
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
            zIndex: 5,
            pointerEvents: "none",
          }}>
            <span className="pin-head" style={{ left: "10%" }} />
            <span className="pin-head" style={{ left: "90%" }} />
            ✦ THE NOTICE BOARD OF THE CROOKED TANKARD ✦
          </div>

          <svg className="yarn-layer" viewBox={`0 0 ${bounds.w} ${bounds.h}`} preserveAspectRatio="none">
            <defs>
              <filter id="yarn-glow">
                <feGaussianBlur stdDeviation="0.6" />
              </filter>
            </defs>
            {visibleEdges.map((e, i) => {
              const { a, b, label, source } = e;
              const A = centerOf(a), B = centerOf(b);
              if (!A || !B) return null;
              // Stable identity for hover state (index would drift on re-filter).
              const eKey = `${a}|${b}|${label}|${source}`;
              const faded = sessionFocus && !(sessionFocus.has(a) || sessionFocus.has(b));
              const isHover = hoverConn === eKey;
              const lit = isHover || (hoverCard !== null && (a === hoverCard || b === hoverCard));
              // FK-derived edges render dashed and are read-only — they have no
              // connections row, so no hover-delete affordance.
              const derived = source === "fk";
              const pathD = yarnPath(A, B);
              const midX = (A.x + B.x) / 2;
              const midY = (A.y + B.y) / 2 + Math.max(20, Math.hypot(B.x - A.x, B.y - A.y) * 0.08) * 0.5;
              return (
                <g key={i}
                   className={`yarn ${derived ? "derived" : ""} ${lit ? "lit" : faded ? "faded" : ""}`}
                   onMouseEnter={() => setHoverConn(eKey)}
                   onMouseLeave={() => setHoverConn(null)}
                   style={{ pointerEvents: "stroke" }}
                >
                  <path d={pathD} className="yarn-shadow" stroke="rgba(0,0,0,.35)" strokeWidth="2.5" fill="none" transform="translate(1,2)" filter="url(#yarn-glow)" />
                  <path d={pathD} className="yarn-path" />
                  {isHover && (
                    <text>
                      <textPath href={`#yp${i}`} startOffset="50%" textAnchor="middle" className="yarn-label">
                        {label}
                      </textPath>
                    </text>
                  )}
                  <path id={`yp${i}`} d={pathD} fill="none" stroke="none" />
                  {isHover && canEdit && !derived && (
                    <g
                      transform={`translate(${midX} ${midY})`}
                      style={{ cursor: "pointer", pointerEvents: "all" }}
                      onClick={(ev) => { ev.stopPropagation(); removeConnection(a, b, label); }}
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
            if (!showArchived && (entity as any).archived) return null;
            const anim = tidyAnim?.[id];
            const dpos = anim ? { ...pos, x: anim.x, y: anim.y } : pos;
            return (
              <PinnedCard
                key={id}
                entity={entity}
                pos={dpos}
                scale={scale}
                onOpen={onOpenEntity}
                onDragEnd={onDragEnd}
                canEdit={canEdit}
                connectMode={connectMode}
                onConnectClick={handleConnectClick}
                isConnectSource={connectSource === id}
                dimmed={
                  (hoverSpot !== null && !hoverSpot.has(id)) ||
                  (flashId !== null && id !== flashId)
                }
                receded={hoverSpot === null && sessionFocus !== null && !sessionFocus.has(id)}
                locating={flashId === id}
                onHover={setHoverCard}
              />
            );
          })}

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
          <button onClick={() => { setScale(0.9); setPan({ x: 0, y: 0 }); }} title="Reset view" style={{ fontSize: 11, fontFamily: "var(--font-fell-sc)" }}>⟲</button>
        </div>
      </div>
    </>
  );
}

export function KindList({ kind, onOpenEntity }: { kind: string; onOpenEntity: (id: string) => void }) {
  const kinds = useKinds();
  const campaign = useCampaign();
  const [showArchived, setShowArchived] = useState(false);
  const k = kinds.find((x) => x.key === kind);
  if (!k) return null;

  const archivable = isArchivableKind(k.key);
  const all = k.list() as any[];
  const { archivedCount, sorted } = useMemo(() => {
    if (!archivable) return { archivedCount: 0, sorted: all };
    const numById = new Map(campaign.sessions.map((s) => [s.id, s.num]));
    const sessionNum = (id: string) => numById.get(id) ?? 0;
    const archived = all.filter((e) => e.archived).length;
    const visible = showArchived ? all : all.filter((e) => !e.archived);
    return { archivedCount: archived, sorted: sortForDisplay(visible, { kind: k.key as KindKey, sessionNum }) };
  }, [all, archivable, showArchived, k.key, campaign.sessions]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>{k.label}</h1>
          <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {sorted.length} {k.plural} of note
          </span>
          {archivable && archivedCount > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="cleanup-link-btn"
              style={{ marginLeft: "auto" }}
            >
              {showArchived ? `hide ${archivedCount} archived` : `show ${archivedCount} archived`}
            </button>
          )}
        </div>
        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 20, marginTop: 24 }}>
          {sorted.map((e: any) => {
            const classes = [
              "kind-card",
              e.archived ? "archived" : "",
              e.pinned ? "is-pinned" : "",
            ].filter(Boolean).join(" ");
            return (
              <div key={e.id}
                   onClick={() => onOpenEntity(e.id)}
                   className={classes}
                   style={{ transform: `rotate(${(e.id.charCodeAt(1) % 5 - 2) * 0.6}deg)` }}
              >
                <CardBody entity={e} kind={k.key as KindKey} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
