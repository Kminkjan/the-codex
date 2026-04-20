import { useRef, useState } from "react";
import { type KindKey, type PresenceUser } from "./data";
import { Icon, MapScribble, kindIcon } from "./icons";
import { useCampaign, useKinds } from "./hooks";

interface Position {
  x: number;
  y: number;
  rot?: number;
  kind: KindKey;
}

interface PinnedCardProps {
  entity: any;
  pos: Position;
  onOpen: (id: string) => void;
  onDragEnd: (id: string, p: { x: number; y: number }) => void;
  scale: number;
  connectMode: boolean;
  onConnectClick: (id: string) => void;
  isConnectSource: boolean;
}

export function PinnedCard({
  entity,
  pos,
  onOpen,
  onDragEnd,
  scale,
  connectMode,
  onConnectClick,
  isConnectSource,
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
    setDragging(true);
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      setDrag({ x: origX + dx, y: origY + dy });
    };
    const onUp = (ev: MouseEvent) => {
      setDragging(false);
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (moved) {
        onDragEnd(entity.id, { x: origX + dx, y: origY + dy });
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

  return (
    <div
      ref={ref}
      className={`pinned ${dragging ? "dragging" : ""}`}
      data-kind={pos.kind}
      data-id={entity.id}
      style={{
        left: effective.x,
        top: effective.y,
        transform: `rotate(${pos.rot || 0}deg)`,
        outline: isConnectSource ? "2px dashed var(--bloodred)" : "none",
        outlineOffset: 6,
      }}
      onMouseDown={onMouseDown}
    >
      <span className={`pin-head ${pinClass}`} />
      <CardBody entity={entity} kind={pos.kind} />
    </div>
  );
}

export function CardBody({ entity, kind }: { entity: any; kind: KindKey }) {
  switch (kind) {
    case "people":    return <PosterCard person={entity} />;
    case "locations": return <LocationCard loc={entity} />;
    case "quests":    return <QuestCard quest={entity} />;
    case "goals":     return <GoalCard goal={entity} />;
    case "factions":  return <FactionCard f={entity} />;
    case "items":     return <ItemCard i={entity} />;
    case "lore":      return <LoreCard l={entity} />;
    default: return null;
  }
}

export function PosterCard({ person }: { person: any }) {
  const campaign = useCampaign();
  const sess = person.lastSeen ? campaign.sessions.find((s) => s.id === person.lastSeen) : null;
  return (
    <div className="card-poster">
      <div className="wanted">
        {person.disposition === "hostile"
          ? "✦ Wanted ✦"
          : person.disposition === "ally"
          ? "✦ Known Ally ✦"
          : "✦ Of Note ✦"}
      </div>
      <div className="portrait">
        {person.imageUrl
          ? <img src={person.imageUrl} alt={person.name} className="portrait-img" />
          : <span className="silhouette" />}
      </div>
      <div className="name">{person.name}</div>
      <div className="desc">— {person.epithet}</div>
      <div className="reward">
        <span><strong>Race</strong> · {person.race}</span>
        {sess && <span>Sess {sess.num}</span>}
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
        <span style={{ fontFamily: "var(--font-fell)", textTransform: "none", fontSize: 11, letterSpacing: 0, color: "var(--ink-body)" }}>{quest.reward}</span>
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
        <div
          key={u.id}
          className={`avatar ${u.active ? "" : "inactive"}`}
          style={{ background: u.color }}
          title={`${u.name} ${u.active ? "(online)" : "(idle)"}`}
        >
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
  counts: Record<string, number>;
}

export function Sidebar({ active, onSelect, onOpenEntity, counts }: SidebarProps) {
  const campaign = useCampaign();
  const kinds = useKinds();
  return (
    <aside className="sidebar">
      <div className="sidebar-label"><span>The Board</span></div>
      <div className={`nav-item ${active === "board" ? "active" : ""}`} onClick={() => onSelect("board")}>
        <span className="icon"><Icon name="board" /></span>
        Notice Board
      </div>

      <div className="sidebar-label"><span>Codex</span></div>
      {kinds.map((k) => (
        <div
          key={k.key}
          className={`nav-item ${active === k.key ? "active" : ""}`}
          onClick={() => onSelect(k.key)}
        >
          <span className="icon"><Icon name={kindIcon[k.key]} /></span>
          {k.label}
          <span className="count">{counts[k.key]}</span>
        </div>
      ))}

      <div className="sidebar-label"><span>Sessions</span></div>
      {campaign.sessions.slice().reverse().map((s) => (
        <div key={s.id} className="session-chip" onClick={() => onOpenEntity(s.id)}>
          <span className="num">SESS {String(s.num).padStart(2, "0")}</span>
          <span style={{ flex: 1 }}>{s.title}</span>
        </div>
      ))}

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

export function Topbar({ onShare }: { onShare: () => void }) {
  const campaign = useCampaign();
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
        <div className="campaign-chip">
          <span className="dot" />
          <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 11 }}>CAMPAIGN</span>
          <span>·</span>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15 }}>{campaign.title}</span>
          <span style={{ color: "var(--ink-faded)", fontStyle: "italic", fontSize: 12 }}>· {campaign.subtitle}</span>
        </div>
      </div>
      <div className="topbar-right">
        <Presence users={campaign.presence} />
        <button className="btn" onClick={onShare}><Icon name="share" size={14} /> Share link</button>
        <button className="btn btn-primary"><Icon name="plus" size={14} /> New entry</button>
      </div>
    </header>
  );
}
