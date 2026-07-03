import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { type KindKey, type PresenceUser } from "./data";
import { Icon, MapScribble, kindIcon } from "./icons";
import { useCampaign, useKinds } from "./hooks";
import { createEntity } from "./mutations";
import { SignInDialog, useAuth } from "./auth";

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

  const archived = !!entity.archived;
  const pinnedFlag = !!entity.pinned;

  return (
    <div
      ref={ref}
      className={`pinned ${dragging ? "dragging" : ""} ${archived ? "archived" : ""} ${pinnedFlag ? "is-pinned" : ""}`}
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
      <span className={`pin-head ${pinnedFlag ? "brass" : pinClass}`} />
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
  onOpenCleanup: () => void;
  counts: Record<string, { active: number; archived: number }>;
}

export function Sidebar({ active, onSelect, onOpenEntity, onOpenCleanup, counts }: SidebarProps) {
  const campaign = useCampaign();
  const kinds = useKinds();
  const { canEdit } = useAuth();
  const totalArchived = kinds.reduce((sum, k) => sum + (counts[k.key]?.archived ?? 0), 0);
  return (
    <aside className="sidebar">
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
          >
            <span className="icon"><Icon name={kindIcon[k.key]} /></span>
            {k.label}
            <span className="count">{c.active}</span>
            {c.archived > 0 && (
              <span className="count-archived" title={`${c.archived} archived`}>+{c.archived}</span>
            )}
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
  const { canEdit, displayName, signOut } = useAuth();
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
        {canEdit ? (
          <>
            <span style={{
              fontFamily: "var(--font-fell)", fontStyle: "italic",
              fontSize: 12, color: "var(--ink-faded)",
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
              fontSize: 10, color: "var(--ink-faded)",
              border: "1px dashed var(--ink-faded)", padding: "3px 8px",
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
  onSave: (next: string) => void | Promise<void>;
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Committed-but-not-yet-echoed text, same trick as EditableText: shown until
  // realtime updates `value` so the field doesn't flash back after blur.
  const [pending, setPending] = useState<string | null>(null);
  const display = pending ?? value;

  useLayoutEffect(() => {
    setPending(null);
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const next = draft.trim();
    if (next !== (display ?? "").trim()) {
      void onSave(next);
      setPending(next);
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
        {empty ? placeholder : <ReactMarkdown>{display}</ReactMarkdown>}
      </div>
    );
  }

  if (editing) {
    return (
      <textarea
        autoFocus
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
      onClick={() => {
        setDraft(display ?? "");
        setEditing(true);
      }}
      onFocus={() => {
        setDraft(display ?? "");
        setEditing(true);
      }}
    >
      {empty ? (placeholder || "Click to edit…") : <ReactMarkdown>{display}</ReactMarkdown>}
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
