import { useEffect, useRef, useState } from "react";
import { entityLabel, isHidden, isShowEvent, stripShowMark, type KindKey, type SessionEvent } from "./data";
import { Icon, kindIcon } from "./icons";
import { useCampaign, useFindEntity, useIsDm, usePresence } from "./hooks";
import { useAuth } from "./auth";
import { endLiveSession, insertSessionEvent, releaseEntity, showEntity } from "./mutations";

// The at-the-table surface (issue #67): a docked right panel that opens when a
// session is live (campaigns.active_session_id) and closes when it isn't. It
// occupies its own grid column in .app — shrinking .main rather than overlaying
// it, so the board's pan/zoom yarn coordinates stay correct. Everything here
// reads from useCampaign() and writes through mutations; there is no local
// mirror of any DB state (collapse, draft and in-flight release are UI-only).

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Exported for the session detail sheet's read-only "As it happened" block
// (issue #72) — past feeds render with the exact same row language.
export function FeedRow({ ev, onOpenEntity }: { ev: SessionEvent; onOpenEntity: (id: string) => void }) {
  const findEntity = useFindEntity();
  if (ev.type === "start" || ev.type === "end") {
    return (
      <div className="live-marker">
        ✦ the session {ev.type === "start" ? "begins" : "ends"} · {fmtTime(ev.createdAt)} ✦
      </div>
    );
  }
  if (ev.type === "reveal") {
    // The ceremonial row. entityId may dangle (feed rows outlive entity
    // deletion by design) — fall back to the label snapshotted in `text`
    // (always through stripShowMark: show rows carry the sentinel prefix).
    const ent = findEntity(ev.entityId);
    const label = ent ? entityLabel(ent) : stripShowMark(ev.text) || "something struck from the codex";
    const shown = isShowEvent(ev);
    return (
      <div
        className={`live-reveal${ent ? " linked" : ""}`}
        onClick={ent ? () => onOpenEntity(ent.id) : undefined}
        title={ent ? "Open in the codex" : undefined}
      >
        <div>{shown ? <>⚡ The DM showed <em>{label}</em></> : <>🕯 The DM revealed <em>{label}</em></>}</div>
        <div className="live-meta"><span>{ev.author ? `by ${ev.author}` : ""}</span><span>{fmtTime(ev.createdAt)}</span></div>
      </div>
    );
  }
  return (
    <div className="live-note">
      <div>{ev.text}</div>
      <div className="live-meta"><span>— {ev.author || "Anonymous"}</span><span>{fmtTime(ev.createdAt)}</span></div>
    </div>
  );
}

// The DM's release desk: tonight's staged queue, each row one click from live,
// plus the end-of-session control. Released rows stay listed (tonight's
// record), marked with their release time.
function DmSection({ sessionId, onOpenEntity }: { sessionId: string; onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const { displayName } = useAuth();
  // In-flight releases: insertSessionEvent is not idempotent, and realtime lag
  // means released_at won't disable the button in time — guard double-clicks
  // locally. Cleared on failure so the button comes back.
  const [releasing, setReleasing] = useState<ReadonlySet<string>>(new Set());
  // In-flight shows, same double-click guard — but cleared on settle (success
  // AND failure), unlike `releasing`: the SHOW button never unmounts (released
  // rows keep it) and a deliberate re-show is legitimate.
  const [showing, setShowing] = useState<ReadonlySet<string>>(new Set());

  const rows = campaign.sessionStaging
    .filter((r) => r.sessionId === sessionId)
    // A staging row can transiently dangle between an entity delete and the
    // staging sweep landing — skip rather than render a ghost.
    .flatMap((r) => {
      const ent = findEntity(r.entityId);
      return ent ? [{ row: r, ent }] : [];
    })
    .sort((a, b) =>
      (a.row.releasedAt ? 1 : 0) - (b.row.releasedAt ? 1 : 0)
      || entityLabel(a.ent).localeCompare(entityLabel(b.ent)),
    );

  const author = displayName || undefined;

  const onRelease = (kind: KindKey, entityId: string, label: string) => {
    setReleasing((prev) => new Set(prev).add(entityId));
    releaseEntity(kind, entityId, sessionId, { author, label }).catch((e) => {
      console.error("releaseEntity failed", e);
      setReleasing((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      });
    });
  };

  // "Show now" (#69): the loud reveal — release semantics plus a takeover on
  // every player client. Legal on both queued and already-released rows.
  const onShow = (kind: KindKey, entityId: string, label: string, unhide: boolean) => {
    setShowing((prev) => new Set(prev).add(entityId));
    showEntity(kind, entityId, sessionId, { author, label, unhide })
      .catch((e) => console.error("showEntity failed", e))
      .finally(() => setShowing((prev) => {
        const next = new Set(prev);
        next.delete(entityId);
        return next;
      }));
  };

  return (
    <div className="live-dm">
      <div className="live-dm-head">
        <span style={{ flex: 1 }}>✦ THE DM'S DESK ✦</span>
        <button
          className="live-end-btn"
          title="End the session — stamps the feed and stands the pin down"
          onClick={() => endLiveSession(sessionId, author).catch(console.error)}
        >
          END SESSION
        </button>
      </div>
      {rows.length === 0 && (
        <div className="live-dm-empty">Nothing staged. Stage entities from their detail sheets.</div>
      )}
      {rows.map(({ row, ent }) => {
        const kind = ent._kind as KindKey;
        const label = entityLabel(ent);
        return (
          <div className="live-stage-row" key={row.entityId}>
            <Icon name={kindIcon[kind]} size={13} />
            <span className="lbl" onClick={() => onOpenEntity(row.entityId)} title={label}>
              {label}
              {/* Staged-but-visible is legal (the sheet's STAGE flow allows it)
                  — surface it so a "reveal" of something the party already
                  sees is deliberate, not a surprise. */}
              {!row.releasedAt && !isHidden(ent) && <span className="live-visible-hint">visible</span>}
            </span>
            {row.releasedAt ? (
              <span className="live-released" title="Released this session">✓ {fmtTime(row.releasedAt)}</span>
            ) : (
              <button
                className="release-btn"
                disabled={releasing.has(row.entityId) || showing.has(row.entityId)}
                onClick={() => onRelease(kind, row.entityId, label)}
                title={`Reveal “${label}” to the party — unhides it, stamps the queue, and lands in the feed`}
              >
                {releasing.has(row.entityId) ? "…" : "RELEASE"}
              </button>
            )}
            <button
              className="release-btn show-btn"
              disabled={showing.has(row.entityId) || releasing.has(row.entityId)}
              onClick={() => onShow(kind, row.entityId, label, isHidden(ent))}
              title={`Show “${label}” now — ${row.releasedAt ? "" : "releases it and "}opens it on every player's screen`}
            >
              {showing.has(row.entityId) ? "…" : "⚡ SHOW"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function LivePanel({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const presenceUsers = usePresence();
  const isDm = useIsDm();
  const { canEdit, displayName } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  // Chat-style stickiness: follow new rows only while the reader is already at
  // the bottom; never yank someone who scrolled up to reread.
  const nearBottomRef = useRef(true);

  const sessionId = campaign.activeSessionId ?? null;
  const events = campaign.sessionEvents.filter((e) => e.sessionId === sessionId);

  // Going live (or switching sessions) re-opens a collapsed panel — the state
  // change is the moment the panel earns attention again.
  useEffect(() => {
    if (sessionId) setCollapsed(false);
  }, [sessionId]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length, collapsed]);

  if (!sessionId) return null;

  const session = campaign.sessions.find((s) => s.id === sessionId);
  // Tolerate a session deleted while pinned — the pin may briefly dangle.
  const code = session ? String(session.num) : "—";

  if (collapsed) {
    return (
      <aside className="live-panel is-collapsed">
        <button className="live-expand" onClick={() => setCollapsed(false)} title="Open the session panel">
          <span className="pin-dot live" />
          <span className="live-vertical">✦ LIVE · SESSION {code} ✦</span>
        </button>
      </aside>
    );
  }

  const send = () => {
    // Read the body from `draft` (set only by real typing), NOT el.textContent:
    // the placeholder is a real DOM child while empty, so textContent would
    // submit "Note for the record…" as a note on a bare Enter. Same guard as
    // the party-notes composer's addNote.
    const text = draft.trim();
    if (!text) return;
    insertSessionEvent({
      type: "note",
      sessionId,
      author: displayName || "Anonymous",
      text,
    }).catch(console.error);
    const el = composerRef.current;
    if (el) el.textContent = "";
    setDraft("");
  };

  return (
    <aside className="live-panel">
      <header className="live-head">
        <span className="pin-dot live" />
        <span style={{ flex: 1 }}>LIVE · SESSION {code}</span>
        {/* Occupancy garnish (#74): channel presence, named editors only. */}
        {presenceUsers.length > 0 && (
          <span className="live-table-count" title={presenceUsers.map((u) => u.name).join(", ")}>
            {presenceUsers.length} at the table
          </span>
        )}
        <button className="live-collapse" onClick={() => setCollapsed(true)} title="Collapse the session panel">
          <Icon name="chevron" size={12} />
        </button>
      </header>

      <div
        className="live-feed"
        ref={feedRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {events.length === 0 && (
          <div className="live-empty">The table is quiet. The record waits.</div>
        )}
        {events.map((ev) => (
          <FeedRow key={ev.id} ev={ev} onOpenEntity={onOpenEntity} />
        ))}
      </div>

      {isDm && <DmSection sessionId={sessionId} onOpenEntity={onOpenEntity} />}

      {canEdit && (
        <div className="live-composer">
          <div
            className="add-note live-input"
            contentEditable
            suppressContentEditableWarning
            ref={composerRef}
            onInput={(e) => setDraft(e.currentTarget.textContent || "")}
            onKeyDown={(e) => {
              // Enter sends (one-line chat rows, issue #67). Deliberately no
              // send-on-blur, unlike the party-notes composer: the feed is
              // append-only — clicking away must keep the draft, never commit
              // a half-typed note nobody can edit or delete.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          >
            {draft ? null : "Note for the record… (↵ to send)"}
          </div>
        </div>
      )}
    </aside>
  );
}
