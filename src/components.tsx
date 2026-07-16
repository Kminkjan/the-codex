import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { sessionLabel, type KindKey, type PresenceUser } from "./data";
import { Icon, MapScribble, kindIcon } from "./icons";
import { rankIndex, KIND_LABEL, type Indexed } from "./entitySearch";
import { useCampaign, useCampaignSwitcher, useKinds, usePresence, useViewAsPlayer } from "./hooks";
import { createEntity, endLiveSession, setActiveSession, startLiveSession, switchLiveSession } from "./mutations";
import { SignInDialog, useAuth } from "./auth";

interface Position {
  x: number;
  y: number;
  rot?: number;
  kind: KindKey;
}

// Play-note exports write single key/value rows as one-row "tables"
// (`| **Attendees** | Mort, Fynn |`). Without a `| --- |` delimiter these
// aren't GFM tables, so react-markdown renders them as literal pipe text.
// Collapse any such loose pipe row into a plain "label: value" line; real
// tables (a row adjacent to a delimiter, or a body row under a header) are
// left untouched.
const isDelimRow = (l: string) => /^\|?[\s:\-|]+\|?$/.test(l.trim()) && l.includes("-");
const isPipeRow = (l: string) => /^\|.*\|$/.test(l.trim());
// Split a pipe row into trimmed cells, respecting escaped pipes (`\|` is a
// literal, not a cell boundary), then unescape them.
const splitRow = (t: string) =>
  t.replace(/^\|/, "").replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"))
    .filter(Boolean);
function normalizeLoosePipeRows(md: string): string {
  const lines = md.split("\n");
  // First, mark every line that belongs to a *real* GFM table: a header row
  // (its next line is the delimiter), the delimiter itself, and the body rows
  // that follow. Anything else that looks like a pipe row is "loose".
  const inTable = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!isPipeRow(t) || isDelimRow(t)) continue;
    if (!isDelimRow(lines[i + 1]?.trim() ?? "")) continue;
    inTable[i] = inTable[i + 1] = true;
    let j = i + 2;
    while (j < lines.length && isPipeRow(lines[j].trim())) inTable[j++] = true;
    i = j - 1;
  }
  return lines
    .map((line, i) => {
      const t = line.trim();
      if (inTable[i] || !isPipeRow(t) || isDelimRow(t)) return line;
      // Loose row (incl. several stacked back-to-back): collapse to text.
      const cells = splitRow(t);
      if (cells.length < 2) return cells[0] ?? line;
      return `${cells[0]}: ${cells.slice(1).join(" — ")}`;
    })
    .join("\n");
}

interface PinnedCardProps {
  entity: any;
  pos: Position;
  onOpen: (id: string) => void;
  onDragEnd: (id: string, p: { x: number; y: number }) => void;
  canEdit: boolean;
  scale: number;
  connectMode: boolean;
  onConnectClick: (id: string) => void;
  isConnectSource: boolean;
  dimmed?: boolean;
  // Session focus: card stays fully legible but collapses to headline-only.
  receded?: boolean;
  // Search wayfinding: brief flash when the palette jumps here.
  locating?: boolean;
  onHover?: (id: string | null) => void;
}

export function PinnedCard({
  entity,
  pos,
  onOpen,
  onDragEnd,
  canEdit,
  scale,
  connectMode,
  onConnectClick,
  isConnectSource,
  dimmed,
  receded,
  locating,
  onHover,
}: PinnedCardProps) {
  const [dragging, setDragging] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (connectMode) {
      e.stopPropagation();
      onConnectClick(entity.id);
      return;
    }
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const origX = pos.x, origY = pos.y;
    if (canEdit) setDragging(true);
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      // Viewers can't move cards — don't visually drag them only to snap back.
      if (canEdit) setDrag({ x: origX + dx, y: origY + dy });
    };
    const onUp = (ev: MouseEvent) => {
      setDragging(false);
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (moved) {
        // A drag persists only for editors; for viewers it's a no-op (not a
        // mis-click open), matching the read-only affordance.
        if (canEdit) onDragEnd(entity.id, { x: origX + dx, y: origY + dy });
      } else {
        onOpen(entity.id);
      }
      setDrag(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const effective = drag || pos;
  const pinClass = pos.kind === "quests" ? "brass" : pos.kind === "lore" ? "iron" : "";

  const archived = !!entity.archived;
  const pinnedFlag = !!entity.pinned;

  return (
    <div
      ref={ref}
      className={`pinned ${dragging ? "dragging" : ""} ${archived ? "archived" : ""} ${pinnedFlag ? "is-pinned" : ""} ${dimmed ? "dimmed" : ""} ${receded ? "receded" : ""} ${locating ? "locating" : ""}`}
      data-kind={pos.kind}
      data-id={entity.id}
      style={{
        left: effective.x,
        top: effective.y,
        transform: `rotate(${pos.rot || 0}deg)`,
        outline: isConnectSource ? "2px dashed var(--bloodred)" : "none",
        outlineOffset: 6,
        // Read-only viewers get a plain pointer (click opens the detail sheet);
        // only editors see the grab/grabbing move affordance.
        cursor: dragging ? "grabbing" : connectMode ? "crosshair" : canEdit ? "grab" : "pointer",
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={() => onHover?.(entity.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <span className={`pin-head ${pinnedFlag ? "brass" : pinClass}`} />
      <CardBody entity={entity} kind={pos.kind} />
    </div>
  );
}

export function CardBody({ entity, kind }: { entity: any; kind: KindKey }) {
  let body: React.ReactNode;
  switch (kind) {
    case "people":    body = <PosterCard person={entity} />; break;
    case "locations": body = <LocationCard loc={entity} />; break;
    case "quests":    body = <QuestCard quest={entity} />; break;
    case "goals":     body = <GoalCard goal={entity} />; break;
    case "factions":  body = <FactionCard f={entity} />; break;
    case "items":     body = <ItemCard i={entity} />; break;
    case "lore":      body = <LoreCard l={entity} />; break;
    default: return null;
  }
  // Hidden rows never reach non-DM users (projected out in campaignContext),
  // so this badge needs no role check — if it renders, the viewer is the DM.
  // One insertion covers both board cards and kind-list cards.
  if (!entity.hidden) return body;
  return (
    <>
      <span className="veil-badge">unrevealed</span>
      {body}
    </>
  );
}

export function PosterCard({ person }: { person: any }) {
  const campaign = useCampaign();
  const sess = person.lastSeen ? campaign.sessions.find((s) => s.id === person.lastSeen) : null;
  // Seen in the currently-live session? Subtle read-only marker; the toggle
  // itself lives on the detail sheet.
  const seenLive = !!campaign.activeSessionId
    && (campaign.sessionParticipants[campaign.activeSessionId] ?? []).includes(person.id);
  // Allies dominate the board, so their band is noise — a band's presence is
  // the signal (Wanted / Of Note), plain allies go headerless. Headerless
  // cards get top clearance so the portrait sits below the pin-head and the
  // seen-live dot instead of flush under them.
  const headerless = person.disposition === "ally";
  return (
    <div className={`card-poster${headerless ? " headerless" : ""}`}>
      {seenLive && <span className="seen-live-dot" title="Seen this session" />}
      {!headerless && (
        <div className="wanted">
          {person.disposition === "hostile" ? "✦ Wanted ✦" : "✦ Of Note ✦"}
        </div>
      )}
      <div className="portrait">
        {person.imageUrl
          ? <img src={person.imageUrl} alt={person.name} className="portrait-img" />
          : <span className="silhouette" />}
      </div>
      <div className={`name${person.status === "dead" ? " is-dead" : ""}`}>{person.name}</div>
      {person.status === "dead" && <div className="deceased-tag">† deceased</div>}
      {!!person.epithet?.trim() && <div className="desc">— {person.epithet}</div>}
      <div className="reward">
        {person.race
          ? <span><strong>Race</strong> · {person.race}</span>
          : <span />}
        {sess && <span>{sessionLabel(sess.num)}</span>}
      </div>
    </div>
  );
}

export function QuestCard({ quest }: { quest: any }) {
  return (
    <div className="card-quest">
      <div className="quest-head">
        <span className="quest-tag">✦ Quest ✦</span>
        <StatusChip status={quest.status} />
      </div>
      <div className="quest-title">{quest.title}</div>
      <div className="quest-desc">{quest.desc}</div>
      <div className="quest-meta">
        <span>Reward</span>
        <span style={{ fontFamily: "var(--font-fell)", textTransform: "none", fontSize: 12.5, letterSpacing: 0, color: "var(--ink-body)" }}>{quest.reward}</span>
      </div>
    </div>
  );
}

export function LocationCard({ loc }: { loc: any }) {
  return (
    <div className="card-location">
      <div className="map-region">
        <MapScribble seed={loc.id.charCodeAt(1)} />
      </div>
      <div className="loc-body">
        <div className="loc-type">✦ {loc.kind} ✦</div>
        <div className="loc-name">{loc.name}</div>
        <div className="loc-desc">{loc.desc}</div>
      </div>
    </div>
  );
}

export function GoalCard({ goal }: { goal: any }) {
  return (
    <div className="card-goal">
      <div className="goal-kind">✦ {goal.kind} Goal ✦</div>
      <div className="goal-text">{goal.text}</div>
      <div className="goal-owner">— {goal.owner}</div>
      <div style={{ marginTop: 8 }}><StatusChip status={goal.status} /></div>
    </div>
  );
}

export function FactionCard({ f }: { f: any }) {
  return (
    <div className="card-faction">
      <div className="sigil">{f.sigil}</div>
      <div>
        <div className="f-name">{f.name}</div>
        <div className="f-sub">{f.desc}</div>
      </div>
    </div>
  );
}

export function ItemCard({ i }: { i: any }) {
  return (
    <div className="card-item">
      <div className="i-label">✦ {i.kind} ✦</div>
      <div className="i-name">{i.name}</div>
      <div className="i-desc">{i.desc}</div>
    </div>
  );
}

export function LoreCard({ l }: { l: any }) {
  return (
    <div className="card-lore">
      <div className="l-label">✦ Lore ✦</div>
      {l.title && <div className="l-title">{l.title}</div>}
      <div className="l-text">{l.text}</div>
    </div>
  );
}

export function StatusChip({ status }: { status?: string }) {
  const labels: Record<string, string> = {
    whispered: "Whispered",
    pursuing: "Pursuing",
    resolved: "Resolved",
    lost: "Lost",
  };
  if (!status) return null;
  return (
    <span className={`status-chip ${status}`}>
      <span className="dot" /> {labels[status]}
    </span>
  );
}

export function Presence({ users }: { users: PresenceUser[] }) {
  if (!window.__TWEAKS__.showPresence) return null;
  return (
    <div className="presence" title="Currently viewing">
      {users.map((u) => (
        <div key={u.id} className="avatar" style={{ background: u.color }} title={`${u.name} (online)`}>
          {u.initials}
        </div>
      ))}
    </div>
  );
}

interface SidebarProps {
  active: string;
  onSelect: (v: string) => void;
  onOpenEntity: (id: string) => void;
  onOpenCleanup: () => void;
  counts: Record<string, { active: number; archived: number }>;
}

// Sessions rendered before the "… N earlier sessions" fold.
const SESSION_CAP = 8;

export function Sidebar({ active, onSelect, onOpenEntity, onOpenCleanup, counts }: SidebarProps) {
  const campaign = useCampaign();
  const kinds = useKinds();
  const { canEdit } = useAuth();
  const totalArchived = kinds.reduce((sum, k) => sum + (counts[k.key]?.archived ?? 0), 0);
  // View filter, not a write — available to read-only viewers too.
  const [arcFilter, setArcFilter] = useState<string>("all");
  // Progressive disclosure: the list is recency-biased, so only the newest
  // few sessions render until expanded.
  const [showAllSessions, setShowAllSessions] = useState(false);
  const arcsById = new Map(campaign.arcs.map((a) => [a.id, a]));
  // Fall back to "all" if the selected arc was deleted (possibly live, from
  // another tab) so the list and the select never disagree.
  const effectiveArcFilter = arcsById.has(arcFilter) ? arcFilter : "all";
  const visibleSessions = effectiveArcFilter === "all"
    ? campaign.sessions
    : campaign.sessions.filter((s) => s.arc === effectiveArcFilter);
  // Roster of people marked seen in the currently-live session.
  const liveSession = campaign.sessions.find((s) => s.id === campaign.activeSessionId);
  // Newest first by num, not array order — realtime INSERTs append, so
  // campaign.sessions isn't reliably sorted (same guard as arcs.tsx).
  const newestFirst = visibleSessions.slice().sort((a, b) => b.num - a.num);
  let shownSessions = newestFirst;
  if (!showAllSessions) {
    shownSessions = newestFirst.slice(0, SESSION_CAP);
    // The live session stays one click away even when the cap would hide it
    // (unless the arc filter excludes it — respect that).
    if (liveSession && newestFirst.includes(liveSession) && !shownSessions.includes(liveSession)) {
      shownSessions = [...shownSessions, liveSession];
    }
  }
  const hiddenSessions = newestFirst.length - shownSessions.length;
  const seenThisSession = liveSession
    ? (campaign.sessionParticipants[liveSession.id] ?? [])
        .map((pid) => campaign.people.find((p) => p.id === pid))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  return (
    <aside className="sidebar">
      {liveSession && (
        <>
          <div className="sidebar-label"><span>This Session · {liveSession.num}</span></div>
          <div className="session-roster">
            {seenThisSession.length === 0 ? (
              <div className="session-roster-empty">No one marked seen yet.</div>
            ) : (
              seenThisSession.map((p) => (
                <button key={p.id} className="roster-chip" onClick={() => onOpenEntity(p.id)} title={p.epithet ?? p.name}>
                  {p.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
      <div className="sidebar-label"><span>The Board</span></div>
      <div className={`nav-item ${active === "board" ? "active" : ""}`} onClick={() => onSelect("board")}>
        <span className="icon"><Icon name="board" /></span>
        Notice Board
      </div>

      <div className="sidebar-label"><span>Codex</span></div>
      {kinds.map((k) => {
        const c = counts[k.key] ?? { active: 0, archived: 0 };
        return (
          <div
            key={k.key}
            className={`nav-item ${active === k.key ? "active" : ""}`}
            onClick={() => onSelect(k.key)}
            // One number per row — the archive story lives in the tooltip and
            // in "Tidy the Codex" below.
            title={c.archived > 0 ? `${c.active} active · ${c.archived} archived` : undefined}
          >
            <span className="icon"><Icon name={kindIcon[k.key]} /></span>
            {k.label}
            <span className="count">{c.active}</span>
          </div>
        );
      })}
      <div
        className="nav-item"
        onClick={onOpenCleanup}
        style={{ marginTop: 4, fontStyle: "italic", color: "var(--ink-faded)" }}
        title="Review stale entities and archive in bulk"
      >
        <span className="icon"><Icon name="scroll" /></span>
        Tidy the Codex
        {totalArchived > 0 && <span className="count-archived">{totalArchived} archived</span>}
      </div>

      <div className="sidebar-label"><span>The Chronicle</span></div>
      <div className={`nav-item ${active === "arcs" ? "active" : ""}`} onClick={() => onSelect("arcs")}>
        <span className="icon"><Icon name="layers" /></span>
        Story Arcs
        <span className="count">{campaign.arcs.length}</span>
      </div>
      <div className={`nav-item ${active === "events" ? "active" : ""}`} onClick={() => onSelect("events")}>
        <span className="icon"><Icon name="sparkle" /></span>
        Events
        <span className="count">{campaign.events.length}</span>
      </div>

      <div className="sidebar-label">
        <span>Sessions</span>
        {canEdit && <button
          title="New session"
          onClick={() => {
            const id = crypto.randomUUID();
            const num = Math.max(0, ...campaign.sessions.map((s) => s.num)) + 1;
            const date = new Date().toLocaleDateString("en-GB", {
              day: "numeric", month: "long", year: "numeric",
            });
            createEntity("sessions", id, { num, title: "Untitled session", date })
              .then(() => onOpenEntity(id))
              .catch(console.error);
          }}
          style={{
            background: "transparent",
            border: "1px dashed var(--ink-faded)",
            color: "var(--ink-faded)",
            width: 18, height: 18, lineHeight: "14px",
            fontSize: 13, padding: 0, cursor: "pointer",
            flex: "0 0 auto",
          }}
        >+</button>}
      </div>
      {campaign.arcs.length > 0 && (
        <select
          value={effectiveArcFilter}
          onChange={(e) => setArcFilter(e.target.value)}
          title="Filter sessions by arc"
          // View control, not an edit affordance — dashed borders mean
          // "editable" everywhere else, so this stays borderless.
          style={{
            margin: "2px 16px 6px",
            background: "transparent",
            border: "none",
            fontFamily: "var(--font-fell-sc)",
            letterSpacing: ".08em",
            fontSize: 11,
            color: "var(--ink-secondary)",
            padding: "2px 4px 2px 0",
            cursor: "pointer",
          }}
        >
          <option value="all">every arc</option>
          {campaign.arcs.slice().sort((a, b) => a.orderNum - b.orderNum).map((a) => (
            <option key={a.id} value={a.id}>{a.title}</option>
          ))}
        </select>
      )}
      {shownSessions.map((s) => (
        <div key={s.id} className="session-chip" onClick={() => onOpenEntity(s.id)} title={s.title}>
          <span className="num">{sessionLabel(s.num)}</span>
          <span className="title">{s.title}</span>
        </div>
      ))}
      {(showAllSessions ? newestFirst.length > SESSION_CAP : hiddenSessions > 0) && (
        <div className="session-more" onClick={() => setShowAllSessions((v) => !v)}>
          {showAllSessions
            ? "show fewer"
            : `… ${hiddenSessions} earlier ${hiddenSessions === 1 ? "session" : "sessions"}`}
        </div>
      )}

      <div style={{
        padding: "16px", marginTop: 12, borderTop: "1px dashed var(--vellum-deep)",
        fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 12,
        color: "var(--ink-faded)", textAlign: "center",
      }}>
        <em>"Bound in vellum,<br />writ in iron."</em>
      </div>
    </aside>
  );
}

// Campaign switcher in the Topbar. Visible to read-only viewers too —
// switching campaigns is navigation, not an edit.
function CampaignPicker({ onOpenCharter }: { onOpenCharter: () => void }) {
  const campaign = useCampaign();
  const { campaigns, activeCampaignId, switchCampaign } = useCampaignSwitcher();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canSwitch = campaigns.length > 1;

  return (
    <div className="campaign-picker" ref={rootRef}>
      <button
        className="campaign-chip"
        onClick={() => (canSwitch ? setOpen((o) => !o) : onOpenCharter())}
        aria-haspopup={canSwitch ? "listbox" : undefined}
        aria-expanded={canSwitch ? open : undefined}
        title={canSwitch ? "Switch campaign" : "View campaign charter"}
        style={{ cursor: "pointer" }}
      >
        <span className="dot" />
        <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 11 }}>CAMPAIGN</span>
        <span>·</span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15 }}>{campaign.title}</span>
        {campaign.subtitle && (
          <span style={{ color: "var(--ink-secondary)", fontStyle: "italic", fontSize: 12 }}>· {campaign.subtitle}</span>
        )}
        {canSwitch && (
          <Icon name="chevron" size={11} style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", color: "var(--ink-faded)", flexShrink: 0 }} />
        )}
      </button>
      {open && (
        <div className="campaign-picker-menu" role="listbox">
          {campaigns.map((c) => (
            <button
              key={c.id}
              role="option"
              aria-selected={c.id === activeCampaignId}
              className={"campaign-picker-item" + (c.id === activeCampaignId ? " active" : "")}
              onClick={() => { switchCampaign(c.id); setOpen(false); }}
            >
              <span className="dot" style={{ visibility: c.id === activeCampaignId ? "visible" : "hidden" }} />
              <span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, display: "block" }}>{c.title}</span>
                {c.subtitle && (
                  <span style={{ color: "var(--ink-secondary)", fontStyle: "italic", fontSize: 12 }}>{c.subtitle}</span>
                )}
              </span>
            </button>
          ))}
          <button
            className="campaign-picker-item"
            onClick={() => { onOpenCharter(); setOpen(false); }}
            style={{ borderTop: "1px dashed var(--vellum-deep)" }}
          >
            <span className="dot" style={{ visibility: "hidden" }} />
            <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".14em", fontSize: 11, color: "var(--ink-secondary)" }}>
              VIEW CHARTER
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// The shared "we're live in session N" pin, beside the campaign picker.
// The DM gets a dropdown to go live / switch / stand down; everyone else —
// viewers AND non-DM editors — sees a static label so the whole table knows
// which session is current. DM-only since #85: migration 0020 gates the
// campaigns UPDATE (which carries active_session_id) on is_campaign_dm, so a
// non-DM editor's pin move would silently match 0 rows. The value is
// campaign-wide and synced to every client via realtime.
function SessionPin() {
  const campaign = useCampaign();
  const { canEdit, displayName } = useAuth();
  // Real DM-ness, NOT the view-as-player-flipped gate: the pin must keep
  // working while the DM previews the player view (it's a write control,
  // like the toggle itself), and the mutations write the DM's feed brackets.
  const { isRealDm } = useViewAsPlayer();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const live = campaign.sessions.find((s) => s.id === campaign.activeSessionId);
  const label = live ? `SESSION ${live.num}` : "NOT LIVE";

  // Viewers and non-DM editors: static, non-interactive label (only shown
  // when a session is live) — their pin writes would be RLS no-ops (0020).
  if (!canEdit || !isRealDm) {
    if (!live) return null;
    return (
      <div className="session-pin">
        <span className={"pin-dot live"} />
        <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 11 }}>LIVE</span>
        <span>·</span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14 }}>Session {live.num}</span>
      </div>
    );
  }

  // Only the DM reaches this point (see the gate above), so every pin move
  // gets its feed start/end brackets; re-picking the current session stays a
  // bare no-op write. Switching A→B goes through switchLiveSession so the
  // pin never passes through null — that would flicker "not live" across
  // every client.
  const pick = (id: string | null) => {
    const prev = campaign.activeSessionId ?? null;
    const author = displayName || undefined;
    const op = id === prev
      ? setActiveSession(id)
      : id && prev
        ? switchLiveSession(prev, id, author)
        : id
          ? startLiveSession(id, author)
          : endLiveSession(prev!, author);
    op.catch(console.error);
    setOpen(false);
  };
  // Newest sessions first — that's the one you're most likely going live on.
  const ordered = [...campaign.sessions].sort((a, b) => b.num - a.num);

  return (
    <div className="session-pin-picker" ref={rootRef}>
      <button
        className="session-pin"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={live ? "Switch or stand down" : "Go live on a session"}
      >
        <span className={"pin-dot" + (live ? " live" : "")} />
        <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 11 }}>{live ? "LIVE" : "GO LIVE"}</span>
        {live && <><span>·</span><span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14 }}>{label}</span></>}
        <Icon name="chevron" size={11} style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", color: "var(--ink-faded)", flexShrink: 0 }} />
      </button>
      {open && (
        <div className="campaign-picker-menu" role="listbox">
          {live && (
            <button role="option" aria-selected={false} className="campaign-picker-item" onClick={() => pick(null)}>
              <span className="dot" style={{ visibility: "hidden" }} />
              <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 13 }}>Stand down (not live)</span>
            </button>
          )}
          {ordered.map((s) => (
            <button
              key={s.id}
              role="option"
              aria-selected={s.id === campaign.activeSessionId}
              className={"campaign-picker-item" + (s.id === campaign.activeSessionId ? " active" : "")}
              onClick={() => pick(s.id)}
            >
              <span className="dot" style={{ visibility: s.id === campaign.activeSessionId ? "visible" : "hidden" }} />
              <span>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, display: "block" }}>Session {s.num}</span>
                {s.title && <span style={{ color: "var(--ink-secondary)", fontStyle: "italic", fontSize: 12 }}>{s.title}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Topbar({ onShare, onOpenCharter }: { onShare: () => void; onOpenCharter: () => void }) {
  const presenceUsers = usePresence();
  const { canEdit, displayName, avatarUrl, signOut } = useAuth();
  const { isRealDm, viewAsPlayer, setViewAsPlayer } = useViewAsPlayer();
  const [signingIn, setSigningIn] = useState(false);
  return (
    <header className="topbar">
      <div className="logo">
        <div className="logo-mark"><Icon name="compass" size={18} /></div>
        <div>
          <div className="logo-title">THE CODEX</div>
          <div className="logo-sub">a shared journal</div>
        </div>
      </div>
      <div className="topbar-center">
        <CampaignPicker onOpenCharter={onOpenCharter} />
        <SessionPin />
      </div>
      <div className="topbar-right">
        <Presence users={presenceUsers} />
        {/* "View as player" (#71) — DM-only, gated on isRealDm so it doesn't
            vanish mid-mode; while active the banner's EXIT is the off-switch,
            so the button hides rather than double up as a second exit. */}
        {isRealDm && !viewAsPlayer && (
          <button
            className="btn"
            onClick={() => setViewAsPlayer(true)}
            title="See the codex exactly as a player does — hidden entries and DM tools concealed"
          >
            <Icon name="eye" size={14} /> View as player
          </button>
        )}
        <button className="btn" onClick={onShare}><Icon name="share" size={14} /> Share link</button>
        {canEdit ? (
          <>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                style={{
                  width: 20, height: 20, borderRadius: "50%",
                  border: "1px solid var(--ink-faded)", objectFit: "cover",
                }}
              />
            )}
            {/* Functional micro-text, not flavor — the UI face reads better
                than 12px italic serif. */}
            <span style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12, color: "var(--ink-secondary)",
            }}>
              {displayName}
            </span>
            <button
              className="btn"
              onClick={() => { signOut().catch(console.error); }}
              title="Sign out and return to read-only viewing"
            >
              Sign out
            </button>
          </>
        ) : (
          <>
            <span style={{
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".14em",
              fontSize: 10, color: "var(--ink-secondary)",
              border: "1px dashed var(--ink-secondary)", padding: "3px 8px",
            }}>
              READ-ONLY
            </span>
            <button className="btn btn-primary" onClick={() => setSigningIn(true)}>
              Sign in to edit
            </button>
          </>
        )}
      </div>
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </header>
  );
}

// ============================================================================
// Editable primitives — used across the detail sheet to turn read-only fields
// into click-to-edit contentEditable or <select>. Blur-to-save, Esc cancels.
// ============================================================================

interface EditableTextProps {
  value: string;
  // Return false to reject the edit: no pending display, the field reverts.
  onSave: (next: string) => void | boolean | Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function EditableText({
  value,
  onSave,
  placeholder,
  multiline = false,
  className,
  style,
}: EditableTextProps) {
  const { canEdit } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const [editing, setEditing] = useState(false);
  // Committed-but-not-yet-echoed text: shown until realtime updates `value`,
  // so the field doesn't flash back to the old value after blur.
  const [pending, setPending] = useState<string | null>(null);
  const display = pending ?? value;

  useLayoutEffect(() => {
    setPending(null);
  }, [value]);

  // While editing, the DOM is user-owned: React renders no children, the
  // effect below seeds innerText once, and realtime updates to `value` are
  // ignored until blur (last-write-wins on commit).
  useLayoutEffect(() => {
    if (!editing || !ref.current) return;
    const el = ref.current;
    cancelledRef.current = false;
    el.innerText = display ?? "";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = (ref.current?.innerText ?? "").trim();
    setEditing(false);
    if (next !== (display ?? "").trim()) {
      if (onSave(next) !== false) setPending(next);
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    setEditing(false);
    ref.current?.blur();
  };

  const showPlaceholder = !editing && !(display ?? "").trim();

  // Read-only viewers get plain text: no affordance, no handlers. The
  // default "Click to edit…" placeholder is edit language, so only an
  // explicit placeholder (e.g. "Unclaimed") is shown for empty values.
  if (!canEdit) {
    const empty = !(value ?? "").trim();
    return (
      <div
        className={className}
        style={{
          minHeight: "1em",
          whiteSpace: multiline ? "pre-wrap" : "normal",
          opacity: empty ? 0.55 : 1,
          fontStyle: empty ? "italic" : undefined,
          ...style,
        }}
      >
        {empty ? placeholder ?? "" : value}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      tabIndex={0}
      className={`editable ${editing ? "editing" : ""} ${multiline ? "editable-multiline" : ""} ${className ?? ""}`}
      style={{
        outline: "none",
        cursor: editing ? "text" : "pointer",
        minHeight: "1em",
        whiteSpace: multiline ? "pre-wrap" : "normal",
        opacity: showPlaceholder ? 0.55 : 1,
        fontStyle: showPlaceholder ? "italic" : undefined,
        ...style,
      }}
      contentEditable={editing}
      suppressContentEditableWarning
      onClick={() => { if (!editing) setEditing(true); }}
      onFocus={() => { if (!editing) setEditing(true); }}
      onBlur={commit}
      onPaste={(e) => {
        e.preventDefault();
        let text = e.clipboardData.getData("text/plain");
        if (!multiline) text = text.replace(/\s*\n+\s*/g, " ");
        // execCommand is deprecated but still the only way to insert text
        // into a contentEditable while preserving undo history.
        document.execCommand("insertText", false, text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
        if (!multiline && e.key === "Enter") { e.preventDefault(); ref.current?.blur(); return; }
        if (multiline && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault(); ref.current?.blur();
        }
      }}
    >
      {editing ? null : showPlaceholder ? (placeholder || "Click to edit…") : display}
    </div>
  );
}

interface EditableMarkdownProps {
  value: string;
  // Return false to reject the edit: no pending display, the field reverts.
  onSave: (next: string) => void | boolean | Promise<void>;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

// Markdown sibling of EditableText: read mode renders the markdown, edit mode
// is a raw <textarea> (contentEditable would mangle markdown whitespace via
// innerText round-tripping). Blur saves, Esc cancels, ⌘/Ctrl+Enter commits.
export function EditableMarkdown({
  value,
  onSave,
  placeholder,
  className,
  style,
}: EditableMarkdownProps) {
  const { canEdit } = useAuth();
  const cancelledRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Committed-but-not-yet-echoed text, same trick as EditableText: shown until
  // realtime updates `value` so the field doesn't flash back after blur.
  const [pending, setPending] = useState<string | null>(null);
  const display = pending ?? value;

  useLayoutEffect(() => {
    setPending(null);
  }, [value]);

  // Focus alone leaves the caret at position 0 on prefilled content (the
  // quirk issue #5 fixed for EditableText) — put it at the end explicitly.
  useLayoutEffect(() => {
    if (!editing || !taRef.current) return;
    const el = taRef.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== (display ?? "").trim()) {
      if (onSave(next) !== false) setPending(next);
    }
  };

  const empty = !(display ?? "").trim();

  if (!canEdit) {
    if (empty && !placeholder) return null;
    return (
      <div
        className={`md-body ${className ?? ""}`}
        style={{ opacity: empty ? 0.55 : 1, fontStyle: empty ? "italic" : undefined, ...style }}
      >
        {empty ? placeholder : <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeLoosePipeRows(display)}</ReactMarkdown>}
      </div>
    );
  }

  if (editing) {
    return (
      <textarea
        ref={taRef}
        className={className}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancelledRef.current = true;
            e.currentTarget.blur();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        rows={Math.min(24, Math.max(8, draft.split("\n").length + 2))}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "color-mix(in srgb, var(--mustard) 12%, transparent)",
          border: "none",
          borderBottom: "1px solid var(--mustard)",
          outline: "none",
          resize: "vertical",
          font: "inherit",
          color: "inherit",
          lineHeight: "inherit",
          padding: "4px 6px",
          ...style,
        }}
      />
    );
  }

  return (
    <div
      tabIndex={0}
      className={`editable editable-multiline md-body ${className ?? ""}`}
      style={{
        outline: "none",
        cursor: "pointer",
        minHeight: "1em",
        opacity: empty ? 0.55 : 1,
        fontStyle: empty ? "italic" : undefined,
        ...style,
      }}
      onClick={(e) => {
        // Rendered markdown can contain real links — let those behave as
        // links instead of hijacking the click into edit mode.
        if ((e.target as HTMLElement).closest("a")) return;
        setDraft(display ?? "");
        setEditing(true);
      }}
      onFocus={(e) => {
        if (e.target !== e.currentTarget) return; // tabbing onto a nested link
        setDraft(display ?? "");
        setEditing(true);
      }}
    >
      {empty ? (placeholder || "Click to edit…") : <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeLoosePipeRows(display)}</ReactMarkdown>}
    </div>
  );
}

interface EnumSelectProps<T extends string> {
  value: T | undefined;
  options: readonly T[];
  onSave: (next: T | null) => void | Promise<void>;
  allowClear?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function EnumSelect<T extends string>({
  value,
  options,
  onSave,
  allowClear = false,
  className,
  style,
}: EnumSelectProps<T>) {
  const { canEdit } = useAuth();
  if (!canEdit) {
    return (
      <span className={className} style={{ fontFamily: "var(--font-fell)", ...style }}>
        {value ?? "—"}
      </span>
    );
  }
  return (
    <select
      className={className}
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        void onSave((v === "" ? null : v) as T | null);
      }}
      style={{
        background: "transparent",
        border: "1px dashed var(--ink-faded)",
        fontFamily: "var(--font-fell)",
        fontSize: "inherit",
        color: "var(--ink)",
        padding: "2px 6px",
        cursor: "pointer",
        ...style,
      }}
    >
      {allowClear && <option value="">—</option>}
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export interface EntityOption {
  id: string;
  label: string;
  kind: KindKey;
  archived?: boolean;
  hidden?: boolean;
}

interface EntityComboboxProps {
  value?: string;
  options: EntityOption[];
  onSelect: (id: string | null) => void | Promise<void>;
  allowClear?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
}

// Searchable entity picker: a dashed-border trigger that opens a type-to-filter
// popover ranked through the shared entity search (entitySearch.ts). Used for
// cross-kind relation targets and single-kind FK fields alike. Read-only
// viewers see the current label as plain text, matching EnumSelect/EntitySelect.
//
// The popover is portalled to <body> so it escapes the detail sheet's
// overflow:auto scroll container and the overlay's backdrop-filter (which would
// otherwise clip or re-anchor a fixed child); it's positioned against the
// trigger's rect and flips above the trigger when there's no room below.
export function EntityCombobox({
  value,
  options,
  onSelect,
  allowClear = false,
  placeholder = "Search…",
  className,
  style,
}: EntityComboboxProps) {
  const { canEdit } = useAuth();
  const current = options.find((o) => o.id === value);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; flip: boolean; maxHeight: number } | null>(null);

  const index = useMemo<Indexed[]>(
    () => options.map((o) => ({ id: o.id, kind: o.kind, label: o.label, primary: o.label, secondary: "", archived: o.archived, hidden: o.hidden })),
    [options],
  );
  const results = useMemo(() => rankIndex(index, query), [index, query]);

  // A "clear" pseudo-row sits at index 0 when clearable and unfiltered, so the
  // row indices below are offset by it. Shown whenever clearing is allowed —
  // including when the current value is dangling (references a deleted
  // entity, so `current` doesn't resolve) — matching the old <select>, which
  // always exposed an empty option in that case regardless of allowClear.
  const showClear = allowClear && query.trim() === "";
  const offset = showClear ? 1 : 0;
  const rowCount = results.length + offset;

  // Clamp the active row whenever the list shrinks for any reason (a new
  // search query, or the options themselves changing e.g. via a realtime
  // update) so Enter never targets a row past the end of a stale index.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(rowCount - 1, 0)));
  }, [rowCount]);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 10;
    const spaceBelow = window.innerHeight - r.bottom - margin;
    const spaceAbove = r.top - margin;
    // Prefer dropping down; flip up only when below can't fit a useful list and
    // above has more room. Either way cap the height to the side we chose so the
    // popover never runs past the viewport edge.
    const flip = spaceBelow < 300 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(320, Math.max(140, flip ? spaceAbove : spaceBelow));
    const width = Math.max(r.width, 240);
    // Clamp left so the popover's right edge never runs past the viewport —
    // it defaults to the trigger's left edge but slides left if that would
    // overflow (e.g. a narrow FK field near the right edge of a resized window).
    const left = Math.min(r.left, window.innerWidth - width - margin);
    setRect({ left: Math.max(left, margin), top: flip ? r.top : r.bottom, width: r.width, flip, maxHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    reposition();
    setQuery("");
    setSelected(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (popRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      setOpen(false);
    };
    const onScroll = () => reposition();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, reposition]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [selected, open, rowCount]);

  const close = () => {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  };
  const choose = (id: string | null) => {
    void onSelect(id);
    close();
  };

  const onInputKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (rowCount) setSelected((i) => (i + 1) % rowCount); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (rowCount) setSelected((i) => (i - 1 + rowCount) % rowCount); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (rowCount === 0) return;
      if (showClear && selected === 0) { choose(null); return; }
      const hit = results[selected - offset];
      if (hit) choose(hit.id);
    }
  };

  if (!canEdit) {
    return (
      <span className={className} style={{ fontFamily: "var(--font-fell)", ...style }}>
        {current?.label ?? "—"}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`entity-combobox-trigger${className ? ` ${className}` : ""}`}
        style={style}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current && <Icon name={kindIcon[current.kind]} size={13} />}
        <span className={`entity-combobox-value${current ? "" : " placeholder"}`}>
          {current?.label ?? placeholder}
        </span>
        <Icon name="chevron" size={12} className="entity-combobox-caret" />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          className="entity-combobox-pop"
          style={{
            position: "fixed",
            left: rect.left,
            width: Math.max(rect.width, 240),
            maxHeight: rect.maxHeight,
            ...(rect.flip
              ? { bottom: window.innerHeight - rect.top + 4 }
              : { top: rect.top + 4 }),
          }}
        >
          <div className="entity-combobox-input-row">
            <Icon name="search" size={14} />
            <input
              ref={inputRef}
              className="entity-combobox-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={placeholder}
              spellCheck={false}
              autoComplete="off"
              role="combobox"
              aria-expanded={rowCount > 0}
              aria-controls="entity-combobox-listbox"
              aria-activedescendant={rowCount > 0 ? `entity-combobox-opt-${selected}` : undefined}
            />
          </div>
          <div className="entity-combobox-list" ref={listRef} role="listbox" id="entity-combobox-listbox">
            {rowCount === 0 && <div className="entity-combobox-empty">Nothing matches.</div>}
            {showClear && (
              <div
                data-idx={0}
                id="entity-combobox-opt-0"
                role="option"
                aria-selected={selected === 0}
                className={`entity-combobox-row clear${selected === 0 ? " active" : ""}`}
                onMouseEnter={() => setSelected(0)}
                onClick={() => choose(null)}
              >
                <span className="entity-combobox-row-label">— clear —</span>
              </div>
            )}
            {results.map((hit, i) => {
              const idx = i + offset;
              return (
                <div
                  key={hit.id}
                  data-idx={idx}
                  id={`entity-combobox-opt-${idx}`}
                  role="option"
                  aria-selected={idx === selected}
                  className={`entity-combobox-row${idx === selected ? " active" : ""}`}
                  onMouseEnter={() => setSelected(idx)}
                  onClick={() => choose(hit.id)}
                >
                  <Icon name={kindIcon[hit.kind]} size={14} />
                  <span className={`entity-combobox-row-label${hit.archived ? " archived" : ""}`}>{hit.label}</span>
                  <span className="entity-combobox-kind">{KIND_LABEL[hit.kind]}</span>
                  {hit.archived && <span className="entity-combobox-archived">archived</span>}
                  {hit.hidden && <span className="entity-combobox-veiled">unrevealed</span>}
                </div>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

interface EntitySelectProps {
  value: string | undefined;
  options: EntityOption[];
  onSave: (next: string | null) => void | Promise<void>;
  allowClear?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// EnumSelect's sibling for FK fields, now a thin wrapper over EntityCombobox so
// single-kind FK pickers get the same type-to-filter UI as the relation picker.
export function EntitySelect({
  value,
  options,
  onSave,
  allowClear = false,
  className,
  style,
}: EntitySelectProps) {
  return (
    <EntityCombobox
      value={value}
      options={options}
      onSelect={onSave}
      allowClear={allowClear}
      placeholder="—"
      className={className}
      style={style}
    />
  );
}
