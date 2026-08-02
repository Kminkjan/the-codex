import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isPc, sessionLabel, type KindKey, type PresenceUser } from "./data";
import { Icon, MapScribble, kindIcon } from "./icons";
import { rankIndex, KIND_LABEL, type Indexed } from "./entitySearch";
import { focusImageStyle } from "./imageFocus";
import { arcSubtreeIds, sagaTree } from "./saga";
import { openFeedbackCount } from "./feedback";
import { useCampaign, useCampaignSwitcher, useDismiss, useKinds, usePresence, useSeatless, useViewAsPlayer } from "./hooks";
import { createCampaign, createEntity, endLiveSession, setActiveSession, startLiveSession, switchLiveSession } from "./mutations";
import { requestCharterOnNextLoad } from "./route";
import { clearDraft, readDraft, writeDraft } from "./noteDrafts";
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
    case "monsters":  body = <MonsterCard m={entity} />; break;
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

// Modern Atlas speaks a terser UI voice than the parchment themes ("Tidy"
// vs "Tidy board", "S191" vs "Session 191"). Both labels render; the theme
// CSS shows exactly one — same override-layer pattern as the visual dress.
export function ThemedLabel({ parchment, atlas }: { parchment: React.ReactNode; atlas: React.ReactNode }) {
  return (
    <>
      <span className="label-parchment">{parchment}</span>
      <span className="label-atlas">{atlas}</span>
    </>
  );
}

// Decorative ✦ flourishes around small-caps kind tags. A real span (not CSS
// content) so the Modern Atlas theme can hide them and swap in its own dot.
export function Fleurons({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="fleuron">✦ </span>
      {children}
      <span className="fleuron"> ✦</span>
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
  // No disposition band. It read as curation ("Of Note" = someone to watch) but
  // was really `disposition !== "ally"`, with *unset* falling through to the
  // "Of Note" side — so a background nobody with a blank disposition wore the
  // badge, contradicting `tier`, which is the actual is-this-person-important
  // axis. With most NPCs neutral or unmarked it fired on nearly every card, and
  // "Wanted" claimed a bounty the data never recorded. Cards carry uniform top
  // clearance now, so the portrait sits below the pin-head and the seen-live
  // dot instead of flush under them.
  // Corner sigil — the band's replacement, and deliberately a much smaller
  // claim. ONE axis (what is this person to the party), only the two
  // exceptional states marked, everyone else unmarked: with most NPCs neutral
  // or unmarked, absence has to be the common case or the mark means nothing
  // again. Deceased is intentionally NOT here — the strikethrough name and the
  // † tag already carry it twice, and the sigil is one channel, so stacking a
  // second axis onto it just re-creates the precedence problem. Hostile
  // outranks PC (rare, but a turned party member should read as the threat).
  //
  // The glyph is the carrier and the ink is flat --ink-secondary in both
  // states: hue alone fails for the ~8% of men with colour-vision deficiency,
  // and a ring reads as presence/status by convention everywhere else (this
  // card already spends a coloured dot on exactly that).
  const sigil = person.disposition === "hostile"
    ? { icon: "sword" as const, title: "Hostile" }
    : isPc(person) ? { icon: "star" as const, title: "Party member" } : null;
  return (
    <div className="card-poster">
      {seenLive && <span className="seen-live-dot" title="Seen this session" />}
      <div className="portrait">
        {person.imageUrl
          ? <img
              src={person.imageUrl}
              alt={person.name}
              className="portrait-img"
              style={focusImageStyle(person.imageFocus)}
            />
          : <span className="silhouette" />}
        {sigil && (
          <span className="portrait-sigil" title={sigil.title}>
            <Icon name={sigil.icon} size={14} />
          </span>
        )}
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
        <span className="quest-tag"><Fleurons>Quest</Fleurons></span>
        <StatusChip status={quest.status} />
      </div>
      <div className="quest-title">{quest.title}</div>
      <div className="quest-desc">{quest.desc}</div>
      <div className="quest-meta">
        <span>Reward</span>
        <span style={{ fontFamily: "var(--font-body)", textTransform: "none", fontSize: 12.5, letterSpacing: 0, color: "var(--ink-body)" }}>{quest.reward}</span>
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
        <div className="loc-type"><Fleurons>{loc.kind}</Fleurons></div>
        <div className="loc-name">{loc.name}</div>
        <div className="loc-desc">{loc.desc}</div>
      </div>
    </div>
  );
}

export function GoalCard({ goal }: { goal: any }) {
  return (
    <div className="card-goal">
      <div className="goal-kind"><Fleurons>{goal.kind} Goal</Fleurons></div>
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
      <div className="i-label"><Fleurons>{i.kind}</Fleurons></div>
      <div className="i-name">{i.name}</div>
      <div className="i-desc">{i.desc}</div>
    </div>
  );
}

// Bestiary plate. Artwork is the point of this kind, so the illustration is the
// card's headline (like PosterCard's portrait) and the words are the caption —
// creature type above the name, habitat and the opening of the description
// below. The threat band sits on the plate itself so it reads at board zoom.
export function MonsterCard({ m }: { m: any }) {
  return (
    <div className="card-monster">
      <div className="m-plate">
        {m.imageUrl
          ? <img
              src={m.imageUrl}
              alt={m.name}
              className="m-plate-img"
              style={focusImageStyle(m.imageFocus)}
            />
          : <span className="m-plate-empty"><Icon name="monster" size={44} strokeWidth={1.1} /></span>}
        {m.threat && <span className={`m-threat ${m.threat}`}>{m.threat}</span>}
      </div>
      <div className="m-body">
        {!!m.kind?.trim() && <div className="m-type"><Fleurons>{m.kind}</Fleurons></div>}
        <div className="m-name">{m.name}</div>
        {!!m.habitat?.trim() && <div className="m-habitat">{m.habitat}</div>}
        <div className="m-desc">{m.desc}</div>
      </div>
    </div>
  );
}

export function LoreCard({ l }: { l: any }) {
  return (
    <div className="card-lore">
      <div className="l-label"><Fleurons>Lore</Fleurons></div>
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
  onOpenFeedback: () => void;
  counts: Record<string, { active: number; archived: number }>;
}

// Sessions rendered before the "… N earlier sessions" fold.
const SESSION_CAP = 8;

export function Sidebar({ active, onSelect, onOpenEntity, onOpenCleanup, onOpenFeedback, counts }: SidebarProps) {
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
  // Picking a saga means "every chapter under it", not just the handful filed
  // at saga level — so the filter matches the whole subtree (0025 nesting).
  const arcFilterIds = effectiveArcFilter === "all"
    ? null
    : arcSubtreeIds(campaign, effectiveArcFilter);
  const visibleSessions = arcFilterIds
    ? campaign.sessions.filter((s) => s.arc && arcFilterIds.has(s.arc))
    : campaign.sessions;
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
            // Kind hue for the icon tint — only Modern Atlas reads it; the
            // parchment themes keep their neutral ink icons.
            style={{ "--kind-color": k.color } as React.CSSProperties}
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
        Sagas &amp; Arcs
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
          {/* Sagas, each followed by its own arcs — a flat list can't tell the
              two altitudes apart, and picking a saga filters its whole subtree.
              Newest saga first, matching the Arcs page and the sessions list
              right below this control, which is already newest-first. */}
          {sagaTree(campaign, "recent").map(({ saga, arcs }) => [
            <option key={saga.id} value={saga.id}>{saga.title}</option>,
            ...arcs.map((a) => (
              <option key={a.id} value={a.id}>{`  ↳ ${a.title}`}</option>
            )),
          ])}
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

      {/* Last section on purpose: feedback is about the software, not the
          campaign, so it sits below everything that IS the campaign. Open to
          read-only viewers — the board is world-readable and a viewer who can't
          write should still be able to see what's already been asked for. */}
      <div className="sidebar-label"><span><ThemedLabel parchment="The Codex Itself" atlas="This app" /></span></div>
      <div
        className="nav-item"
        onClick={onOpenFeedback}
        title="Report a bug or suggest a feature"
      >
        <span className="icon"><Icon name="feedback" /></span>
        <ThemedLabel parchment="Petitions &amp; Grievances" atlas="Feedback" />
        {openFeedbackCount(campaign.feedback) > 0 && (
          <span className="count">{openFeedbackCount(campaign.feedback)}</span>
        )}
      </div>

      <div className="sidebar-quote" style={{
        padding: "16px", marginTop: 12, borderTop: "1px dashed var(--vellum-deep)",
        fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 12,
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
  const { campaigns, activeCampaignId, switchCampaign, adoptCampaign } = useCampaignSwitcher();
  // isEditorAccount, not canEdit: founding a campaign needs only the editor
  // tier (create_campaign's assert_editor) and makes the founder its DM — so
  // it is precisely the escape hatch for an editor holding no seat anywhere.
  const { isEditorAccount } = useAuth();
  const [open, setOpen] = useState(false);
  // "Found a new campaign" (issue #87): the menu item swaps for an inline
  // title input. One RPC creates the campaign with the caller as DM, then
  // adoptCampaign switches to it (the charter-landing flag makes the
  // remounting AppLoaded open on the charter). null = item mode; a string
  // (even "") = input mode with that draft — one state, no lockstep pair.
  const [foundTitle, setFoundTitle] = useState<string | null>(null);
  const [foundBusy, setFoundBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const founding = foundTitle !== null;

  // Closing the menu always disarms the input — reopening starts fresh.
  useEffect(() => {
    if (!open) setFoundTitle(null);
  }, [open]);

  const found = async () => {
    const title = foundTitle?.trim();
    if (!title || foundBusy) return;
    setFoundBusy(true);
    try {
      const summary = await createCampaign(title);
      requestCharterOnNextLoad();
      adoptCampaign(summary); // unmounts AppLoaded (loading flips) — nothing to reset
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
      setFoundBusy(false);
    }
  };

  const close = useCallback(() => setOpen(false), []);
  useDismiss(rootRef, open, close);

  // Editors always get the menu (it holds "found a new campaign" even when
  // only one campaign exists); pure viewers of a single campaign keep the
  // chip's charter shortcut.
  const canSwitch = campaigns.length > 1 || isEditorAccount;

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
        <span className="campaign-chip-kicker">CAMPAIGN</span>
        <span className="campaign-chip-sep">·</span>
        <span className="campaign-chip-title">{campaign.title}</span>
        {campaign.subtitle && (
          <span className="campaign-chip-sub">· {campaign.subtitle}</span>
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
          {isEditorAccount && !founding && (
            <button
              className="campaign-picker-item"
              onClick={() => setFoundTitle("")}
            >
              <span className="dot" style={{ visibility: "hidden" }} />
              <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".14em", fontSize: 11, color: "var(--ink-secondary)" }}>
                <span className="fleuron">✦ </span>FOUND A NEW CAMPAIGN
              </span>
            </button>
          )}
          {isEditorAccount && founding && (
            <div className="campaign-picker-item" style={{ cursor: "default" }}>
              <span className="dot" style={{ visibility: "hidden" }} />
              <input
                autoFocus
                className="parchment-input"
                value={foundTitle ?? ""}
                disabled={foundBusy}
                onChange={(e) => setFoundTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void found();
                  } else if (e.key === "Escape") {
                    // Swallow it so the menu's document-level Escape handler
                    // doesn't also fire: first Esc disarms, second closes.
                    e.stopPropagation();
                    setFoundTitle(null);
                  }
                }}
                placeholder={foundBusy ? "Founding…" : "Name the campaign, then ⏎"}
                aria-label="New campaign title"
                style={{ fontSize: 13, borderRadius: 3, padding: "4px 8px", width: "100%", minWidth: 0 }}
              />
            </div>
          )}
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
  const { canEdit } = useAuth();
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
        <span className="pin-kicker"><ThemedLabel parchment="LIVE" atlas="Live" /></span>
        <span className="pin-sep">·</span>
        <span className="pin-session"><ThemedLabel parchment={`Session ${live.num}`} atlas={sessionLabel(live.num)} /></span>
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
    const op = id === prev
      ? setActiveSession(id)
      : id && prev
        ? switchLiveSession(prev, id)
        : id
          ? startLiveSession(id)
          : endLiveSession(prev!);
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
        <span className="pin-kicker"><ThemedLabel parchment={live ? "LIVE" : "GO LIVE"} atlas={live ? "Live" : "Go live"} /></span>
        {live && <><span className="pin-sep">·</span><span className="pin-session"><ThemedLabel parchment={label} atlas={sessionLabel(live.num)} /></span></>}
        <Icon name="chevron" size={11} style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", color: "var(--ink-faded)", flexShrink: 0 }} />
      </button>
      {open && (
        <div className="campaign-picker-menu" role="listbox">
          {live && (
            <button role="option" aria-selected={false} className="campaign-picker-item" onClick={() => pick(null)}>
              <span className="dot" style={{ visibility: "hidden" }} />
              <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13 }}>Stand down (not live)</span>
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

export function Topbar({ view, onShare, onOpenCharter, onSearch }: {
  view: string;
  onShare: () => void;
  onOpenCharter: () => void;
  onSearch: () => void;
}) {
  const presenceUsers = usePresence();
  const kinds = useKinds();
  // isEditorAccount: the account block is about who you're signed in as, not
  // what you may write here — a seatless editor is signed in, so offering them
  // "Sign in to edit" again would be a lie. The NO SEAT chip carries the gap.
  const { isEditorAccount, displayName, avatarUrl, signOut } = useAuth();
  const { isRealDm, viewAsPlayer, setViewAsPlayer } = useViewAsPlayer();
  const seatless = useSeatless();
  const [signingIn, setSigningIn] = useState(false);
  // Breadcrumb tail (Modern Atlas only, via CSS): "campaign / where you are".
  const viewLabel =
    view === "board" ? "Notice Board"
    : view === "arcs" ? "Sagas & Arcs"
    : view === "events" ? "Events"
    : view === "campaign" ? "Charter"
    : kinds.find((k) => k.key === view)?.label ?? "";
  return (
    <header className="topbar">
      <div className="logo">
        <div className="logo-mark"><Icon name="compass" size={18} /></div>
        <div>
          <div className="logo-title"><ThemedLabel parchment="THE CODEX" atlas="Codex" /></div>
          <div className="logo-sub">a shared journal</div>
        </div>
      </div>
      <div className="topbar-center">
        <CampaignPicker onOpenCharter={onOpenCharter} />
        {viewLabel && (
          <>
            <span className="topbar-crumb-sep" aria-hidden>/</span>
            <span className="topbar-crumb">{viewLabel}</span>
          </>
        )}
        <div className="topbar-center-gap" aria-hidden />
        <SessionPin />
        <button className="topbar-search" onClick={onSearch} title="Search the codex (⌘K)">
          <Icon name="search" size={12} />
          <span>Search the codex…</span>
          <kbd>⌘K</kbd>
        </button>
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
        <button className="btn" onClick={onShare}><Icon name="share" size={14} /> <ThemedLabel parchment="Share link" atlas="Share" /></button>
        {isEditorAccount ? (
          <>
            {seatless && (
              <span
                title="You're signed in, but you don't hold a seat at this table yet — ask the DM for an invite link."
                style={{
                  fontFamily: "var(--font-fell-sc)", letterSpacing: ".14em",
                  fontSize: 10, color: "var(--bloodred)",
                  border: "1px dashed var(--bloodred)", padding: "3px 8px",
                }}
              >
                NO SEAT
              </span>
            )}
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="avatar-self"
                title={displayName || undefined}
              />
            ) : (
              // Atlas-only fallback (CSS-gated): the design's initial disc, so
              // the account always has a face even without a Discord avatar.
              <span className="avatar-self-initial" title={displayName || undefined} aria-hidden>
                {(displayName || "?").trim().charAt(0).toUpperCase()}
              </span>
            )}
            {/* Functional micro-text, not flavor — the UI face reads better
                than 12px italic serif. */}
            <span className="topbar-account-name">
              {displayName}
            </span>
            <button
              className="btn topbar-signout"
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

// ============================================================================
// NoteComposer — the one composer for append-only notes. Two callers: the
// detail sheet's party notes and the live session panel's feed.
//
// THE RULE, which is the whole point of this component: a composer that
// creates an append-only, non-editable, non-deletable record commits only on
// an explicit act — a keystroke chosen for its medium, or the send button.
// NEVER on focus loss. Clicking away keeps the draft (src/noteDrafts.ts), it
// does not commit a half-typed note nobody can edit or delete.
//
// That is the opposite of EditableText/EditableMarkdown above, and correctly
// so: those edit an existing MUTABLE value, so blur-to-save is safe — the
// field is still sitting there to fix. Blur-to-save is only dangerous when
// there is no undo. Party notes used to send on blur and players reported it;
// the live panel never did.
//
// The keystroke follows the medium, and only the keystroke differs:
//   * party notes are margin prose (parchment even swaps to --font-hand), so
//     Enter must make a paragraph and ⌘/Ctrl+Enter sends — `sendOn="modEnter"`
//   * the live feed is one-line chat rows (issue #67), so Enter sends and
//     Shift+Enter makes a newline — `sendOn="enter"`
// Both render the button, because the keyboard hint is invisible once you
// type and there is no modifier key to hold on a tablet.
// ============================================================================

interface NoteComposerProps {
  // Per-entity / per-session draft identity. Changing it re-seeds the box from
  // the store, which is what keeps entity A's prose from being sent to B.
  draftKey: string;
  placeholder: string;
  submitLabel: React.ReactNode;
  submitTitle: string;
  // Must REJECT on failure — a rejected write keeps the draft rather than
  // silently eating the text.
  onSubmit: (text: string) => void | Promise<void>;
  sendOn: "enter" | "modEnter";
  className?: string;
}

export function NoteComposer({
  draftKey,
  placeholder,
  submitLabel,
  submitTitle,
  onSubmit,
  sendOn,
  className,
}: NoteComposerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => readDraft(draftKey));
  const [saving, setSaving] = useState(false);

  // React renders no children into the contentEditable (a text node would take
  // the caret and swallow the first keystroke — see the .add-note CSS note), so
  // the DOM has to be seeded imperatively whenever the identity changes. A
  // LAYOUT effect, so the previous entity's text never paints.
  //
  // This one hook does three jobs: restores a kept draft on remount, resets the
  // box when the relations rail swaps entities under a mounted sheet, and
  // re-fills it when the live panel's collapse unmounts only the subtree.
  useLayoutEffect(() => {
    const seeded = readDraft(draftKey);
    setDraft(seeded);
    if (ref.current) ref.current.textContent = seeded;
  }, [draftKey]);

  const clearComposer = () => {
    setDraft("");
    clearDraft(draftKey);
    if (ref.current) ref.current.textContent = "";
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await onSubmit(text);
      // Clear only on success. A write rejected by RLS keeps its prose, and
      // the caller's mutation has already raised the write-error toast.
      clearComposer();
    } catch (e) {
      console.error("note submit failed", e);
    } finally {
      // If the sheet remounted mid-flight (rail navigation) this lands on an
      // unmounted composer — a no-op in React 18. The insert still resolves
      // against the entity id the caller captured.
      setSaving(false);
    }
  };

  return (
    <div className="note-composer">
      <div
        className={`add-note${className ? ` ${className}` : ""}${draft.trim() ? " has-draft" : " is-empty"}`}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        ref={ref}
        onInput={(e) => {
          // innerText, NOT textContent: a paragraph break is an element boundary
          // (`alpha<div>beta</div>`), and textContent concatenates across it —
          // "alpha\nbeta" would be stored as "alphabeta", fusing the two words
          // in a record nobody can edit afterwards. innerText honours the
          // boundary, the same reason EditableText reads it.
          const text = e.currentTarget.innerText;
          setDraft(text);
          // Emptiness is by trim, because innerText reports a stray <br> (what
          // browsers leave after a select-all delete) as "\n". That keeps
          // whitespace-only typing out of the store — "empty means absence" —
          // while preserving newlines INSIDE a real draft.
          writeDraft(draftKey, text.trim() ? text : "");
        }}
        onPaste={(e) => {
          e.preventDefault();
          // Default paste into a contentEditable carries markup. textContent
          // flattens it on the way to the DB, but the box looks broken.
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onKeyDown={(e) => {
          // First: an Enter-to-send surface must not commit mid-composition,
          // or every IME user sends a partial word.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            // preventDefault + the contentEditable target both satisfy the
            // detail sheet's Esc guard, so this can never also close the
            // sheet. A second Esc (target is now body) does close it.
            e.preventDefault();
            clearComposer();
            ref.current?.blur();
            return;
          }
          if (e.key !== "Enter") return;
          if (e.shiftKey) return; // always a newline, on both surfaces
          const mod = e.metaKey || e.ctrlKey;
          // modEnter keeps plain Enter as a paragraph break; enter also takes
          // ⌘/Ctrl+Enter so muscle memory carries between the two surfaces.
          if (sendOn === "enter" || mod) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="note-composer-actions">
        <button
          type="button"
          className="note-send-btn"
          disabled={!draft.trim() || saving}
          title={submitTitle}
          onClick={submit}
        >
          {saving ? "…" : submitLabel}
        </button>
      </div>
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
      <span className={className} style={{ fontFamily: "var(--font-body)", ...style }}>
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
        fontFamily: "var(--font-body)",
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
  // Sessions only: lets a "S120" query resolve by sitting number (entitySearch's
  // parseSessionCode) instead of hunting the session's title.
  num?: number;
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
  const [rect, setRect] = useState<{ left: number; top: number; minWidth: number; maxWidth: number; flip: boolean; maxHeight: number } | null>(null);

  const index = useMemo<Indexed[]>(
    () => options.map((o) => ({ id: o.id, kind: o.kind, label: o.label, primary: o.label, secondary: "", archived: o.archived, hidden: o.hidden, num: o.num })),
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
    // The popover sizes to its widest row rather than to the trigger: FK fields
    // are often a few characters wide ("Arc", "Faction") while the entity names
    // inside them are long, and matching the trigger truncated every row to a
    // guess. min/max bracket that: never narrower than a readable list, never
    // wider than the room left of the viewport edge.
    const minWidth = Math.max(r.width, 280);
    // Anchor to the trigger's left edge, sliding left only when minWidth
    // wouldn't otherwise fit (a narrow field near the right edge of a resized
    // window), then let maxWidth take whatever room is left to the right.
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - minWidth - margin));
    // Never below minWidth: a viewport too narrow to hold the list would
    // otherwise compute a zero-or-negative cap, which the browser drops as
    // invalid and the popover grows unbounded.
    const maxWidth = Math.max(minWidth, Math.min(560, window.innerWidth - left - margin));
    setRect({ left, top: flip ? r.top : r.bottom, minWidth, maxWidth, flip, maxHeight });
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
      <span className={className} style={{ fontFamily: "var(--font-body)", ...style }}>
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
        <span className={`entity-combobox-value${current ? "" : " placeholder"}`} title={current?.label}>
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
            minWidth: rect.minWidth,
            maxWidth: rect.maxWidth,
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
                  <span className={`entity-combobox-row-label${hit.archived ? " archived" : ""}`} title={hit.label}>{hit.label}</span>
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
