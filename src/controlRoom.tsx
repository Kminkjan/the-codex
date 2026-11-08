import { useEffect, useRef, useState } from "react";
import { entityLabel, isHidden, isPc, sessionLabel, type Entity, type KindKey } from "./data";
import { Icon, kindIcon } from "./icons";
import { useCampaign, useFindEntity, useIsDm, usePresence } from "./hooks";
import { NoteComposer, ThemedLabel } from "./components";
import { FeedRow, useDeskActions } from "./livePanel";
import { liveDraftKey } from "./noteDrafts";
import {
  canReleaseQuietly,
  latestShow,
  previewState,
  splitStaged,
  stepSelection,
  visibleStaged,
  type PreviewState,
} from "./staging";
import { endLiveSession, insertSessionEvent, markAbsent, markAttended } from "./mutations";
import { focusImageStyle } from "./imageFocus";
import { excerpt } from "./arcs";

// The DM control room (#167): a full-page view the DM runs the session from,
// laid out like a broadcast vision mixer because its split is exactly ours.
//
//   PREVIEW  what the DM has selected. Only the DM sees it.
//   PROGRAM  what every player's screen was last sent (the latest ⚡ show).
//   SHOW NOW between them — the takeover, showEntity.
//
// Below and beside them: the staged rundown (#165's order and keyboard rules),
// the record, and the table (attendance, who's connected, who's appeared).
//
// Nothing here holds DB state. Selection, the folded record and the end-session
// confirm are UI-only; everything else is read from useCampaign() and comes
// back through realtime after a mutation. Players and non-DM editors never see
// this view — they keep the live panel.

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Stable DOM ids for the rundown's options, for aria-activedescendant — the
// same reason as the live desk: selection is roving state, not focus.
const rundownRowId = (entityId: string) => `cr-row-${entityId}`;

// The public prose a release puts in front of the party, flattened for a
// monitor. Never the DM note: that comes from dm_notes and is labelled as
// never-shown wherever it appears.
function publicBlurb(ent: Entity & Record<string, any>): string {
  switch (ent._kind) {
    case "people":
      return excerpt(ent.notes || [ent.epithet, ent.role].filter(Boolean).join(" · "), 220);
    case "lore":
      return excerpt(ent.text, 220);
    case "goals":
      // A goal's text IS its label; there is nothing further to show.
      return "";
    default:
      return excerpt(ent.desc, 220);
  }
}

// Elapsed since the session's latest start marker. A session switched into
// twice has two starts; the latest is when tonight's run began. "h:mm", and
// ticked by the caller — a clock is presentation, so it is fine for it to lag
// by up to a tick.
//
// Past half a day it stops being a clock. A pin left live after the game (it
// happens: nothing ends a session but the DM) would otherwise read "673:46",
// which is true and useless — the date is the fact worth showing then.
function elapsedSince(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (mins >= 12 * 60) {
    return `since ${new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" })}`;
  }
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

const stateLabel: Record<PreviewState, { parchment: string; atlas: string }> = {
  "on-screen": { parchment: "Before them now", atlas: "On screen now" },
  released: { parchment: "Drawn forth", atlas: "Released" },
  hidden: { parchment: "Veiled", atlas: "Hidden from players" },
  visible: { parchment: "Known to them", atlas: "Visible · not released" },
};

// One monitor's picture: the portrait through the shared focus rules, or the
// kind's icon. The wrapper clips, because a zoomed focus scales the <img> and
// an element cannot clip its own transform (same reason as .live-spotlight).
function MonitorArt({ ent }: { ent: Entity & Record<string, any> }) {
  return ent.imageUrl ? (
    <span className="cr-art">
      <img className="cr-art-img" src={ent.imageUrl} alt="" style={focusImageStyle(ent.imageFocus)} />
    </span>
  ) : (
    <span className="cr-art cr-art-icon" aria-hidden="true">
      <Icon name={kindIcon[ent._kind as KindKey]} size={34} />
    </span>
  );
}

export function ControlRoom({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const isDm = useIsDm();
  const sessionId = campaign.activeSessionId ?? null;

  // App sends a non-DM back to the board; this covers the frame in between
  // (and "view as player" being switched on while the room is open).
  if (!isDm) {
    return (
      <div className="cr-empty">
        <ThemedLabel
          parchment="Only the Dungeon Master may sit behind this screen."
          atlas="The control room is for the DM."
        />
      </div>
    );
  }
  if (!sessionId) {
    return (
      <div className="cr-empty">
        <div className="cr-empty-title">
          <ThemedLabel parchment="No session is afoot" atlas="No session is live" />
        </div>
        <ThemedLabel
          parchment="Go live from the session pin in the top bar, and this room will fill."
          atlas="Go live from the session pin in the top bar to run it from here."
        />
      </div>
    );
  }
  // Keyed on the session: useDeskActions never clears an in-flight release on
  // success, so carrying it into the next session would lock an entity that
  // was staged again there.
  return <Switcher key={sessionId} sessionId={sessionId} onOpenEntity={onOpenEntity} />;
}

function Switcher({ sessionId, onOpenEntity }: { sessionId: string; onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const presenceUsers = usePresence();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showReleased, setShowReleased] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  // In-flight attendance writes. markAttended is idempotent, but the toggle
  // reads its state from realtime, so without this a quick second click lands
  // before the first echo and flips it straight back.
  const [marking, setMarking] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const feedRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // A show or release on a queued row moves it into tonight's record; opening
  // the record keeps it on screen and selected (same reason as the live desk).
  const desk = useDeskActions(sessionId, () => setShowReleased(true));

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const session = campaign.sessions.find((s) => s.id === sessionId);
  const events = campaign.sessionEvents.filter((e) => e.sessionId === sessionId);
  const startedAt = events.filter((e) => e.type === "start").at(-1)?.createdAt;

  // ---- Rundown --------------------------------------------------------------
  const items = campaign.sessionStaging
    .filter((r) => r.sessionId === sessionId)
    .flatMap((r) => {
      const ent = findEntity(r.entityId);
      return ent
        ? [{ entityId: r.entityId, stagedAt: r.stagedAt, releasedAt: r.releasedAt, label: entityLabel(ent), ent }]
        : [];
    });
  const { queued, released } = splitStaged(items);
  const visible = visibleStaged(items, showReleased);

  // ---- Program ----------------------------------------------------------------
  const lastShow = latestShow(campaign.sessionEvents, sessionId);
  // A show whose entity was since deleted or re-hidden retires the monitor
  // rather than leaving a ghost on it — findEntity is the projection.
  const programEnt = lastShow ? findEntity(lastShow.entityId) : null;

  // ---- Preview ----------------------------------------------------------------
  // Derived, never stored: an entity deleted under the DM's cursor just empties
  // the monitor. Anything can be previewed that the DM chose from this room —
  // a rundown row, or the program entity via "back to preview".
  const previewEnt = selectedId ? findEntity(selectedId) : null;
  const previewRow = previewEnt ? items.find((i) => i.entityId === previewEnt.id) : undefined;
  const previewOnScreen = !!previewEnt && previewEnt.id === programEnt?.id;
  const pState = previewEnt
    ? previewState({ onScreen: previewOnScreen, releasedAt: previewRow?.releasedAt ?? null, hidden: isHidden(previewEnt) })
    : null;
  const canRelease = !!previewEnt && canReleaseQuietly({ staged: !!previewRow, releasedAt: previewRow?.releasedAt ?? null });
  const dmNote = previewEnt ? campaign.dmNotes[previewEnt.id] : undefined;

  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    const el = feedRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const releasePreview = () => {
    if (!previewEnt || !canRelease || desk.releaseBusy(previewEnt.id)) return;
    desk.release(previewEnt._kind as KindKey, previewEnt.id, entityLabel(previewEnt));
  };
  const showPreview = () => {
    if (!previewEnt) return;
    desk.show(previewEnt._kind as KindKey, previewEnt.id, entityLabel(previewEnt), isHidden(previewEnt));
  };
  const showBusy = previewEnt ? desk.showBusy(previewEnt.id, previewRow?.releasedAt ?? null) : true;

  // ---- The table ----------------------------------------------------------------
  const present = new Set(campaign.sessionAttendance[sessionId] ?? []);
  const pcs = campaign.people
    .filter((p) => isPc(p) && !p.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pcIds = new Set(pcs.map((p) => p.id));
  // Attendance isn't PC-only (a guest player can be marked from their sheet),
  // so anyone else on tonight's register still gets named here.
  const guests = [...present]
    .filter((id) => !pcIds.has(id))
    .map((id) => campaign.people.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const seen = (campaign.sessionParticipants[sessionId] ?? [])
    .map((id) => campaign.people.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => a.name.localeCompare(b.name));
  const pursuing = campaign.quests.filter((q) => q.status === "pursuing" && !q.archived);

  const toggleAttendance = (personId: string, isHere: boolean) => {
    if (marking.has(personId)) return;
    setMarking((prev) => new Set(prev).add(personId));
    (isHere ? markAbsent(sessionId, personId) : markAttended(sessionId, personId))
      .catch(console.error)
      .finally(() => setMarking((prev) => {
        const next = new Set(prev);
        next.delete(personId);
        return next;
      }));
  };

  const rundownRow = (i: typeof items[number]) => (
    <div
      key={i.entityId}
      id={rundownRowId(i.entityId)}
      ref={(el) => {
        if (el) rowRefs.current.set(i.entityId, el);
        else rowRefs.current.delete(i.entityId);
      }}
      role="option"
      aria-selected={selectedId === i.entityId}
      className={`cr-row${selectedId === i.entityId ? " is-selected" : ""}${i.releasedAt ? " is-out" : ""}`}
      onClick={() => setSelectedId(i.entityId)}
      title={i.label}
    >
      <Icon name={kindIcon[i.ent._kind as KindKey]} size={14} />
      <span className="cr-row-name">{i.label}</span>
      {programEnt?.id === i.entityId && (
        <span className="cr-chip cr-chip-onair"><ThemedLabel parchment="before the table" atlas="on screen" /></span>
      )}
      {!i.releasedAt && !isHidden(i.ent) && <span className="cr-chip">visible</span>}
      {i.releasedAt && <span className="cr-row-time">✓ {fmtTime(i.releasedAt)}</span>}
    </div>
  );

  return (
    <div className="cr">
      <header className="cr-head">
        <span className="cr-live-dot" aria-hidden="true" />
        <span className="cr-live-label">LIVE · {session ? sessionLabel(session.num) : "—"}</span>
        <h1 className="cr-title">{session?.title ?? "—"}</h1>
        {startedAt && (
          <span className="cr-clock" title={`Started ${fmtTime(startedAt)}`}>{elapsedSince(startedAt, now)}</span>
        )}
        <span className="cr-head-spacer" />
        {presenceUsers.length > 0 && (
          <span className="cr-presence" title={presenceUsers.map((u) => u.name).join(", ")}>
            {presenceUsers.slice(0, 6).map((u) => (
              <span key={u.id} className="cr-avatar" style={{ background: u.color }}>{u.initials}</span>
            ))}
            <span className="cr-presence-count">
              <ThemedLabel
                parchment={<>{presenceUsers.length} at the table</>}
                atlas={<>{presenceUsers.length} connected</>}
              />
            </span>
          </span>
        )}
        {!confirmEnd && (
          <button className="cr-end-btn" onClick={() => setConfirmEnd(true)}>
            <ThemedLabel parchment="Close the session" atlas="End session" />
          </button>
        )}
      </header>

      {confirmEnd && (
        <div className="cr-confirm" role="alertdialog" aria-label="End the session">
          <span className="cr-confirm-text">
            <ThemedLabel
              parchment={<>Close {session ? sessionLabel(session.num) : "the session"}? The record is sealed, the pin stands down and every player's panel closes. {queued.length > 0 ? `${queued.length} still staged stay staged.` : ""}</>}
              atlas={<>End {session ? sessionLabel(session.num) : "the session"}? This stamps the record, stands the live pin down and closes every player's live panel. {queued.length > 0 ? `${queued.length} still staged stay staged.` : ""}</>}
            />
          </span>
          <button className="cr-btn" onClick={() => setConfirmEnd(false)} autoFocus>
            <ThemedLabel parchment="Play on" atlas="Keep playing" />
          </button>
          <button
            className="cr-btn cr-btn-danger"
            disabled={ending}
            onClick={() => {
              setEnding(true);
              // On success the pin clears and ControlRoom swaps this whole
              // component out, so only failure needs to undo the guard.
              endLiveSession(sessionId).catch((e) => {
                console.error(e);
                setEnding(false);
              });
            }}
          >
            {ending ? "…" : <ThemedLabel parchment="Close it" atlas="End session" />}
          </button>
        </div>
      )}

      <div className="cr-body">
        {/* ---------------- Rundown ---------------- */}
        <section className="cr-panel cr-rundown" aria-label="Rundown">
          <div className="cr-panel-head">
            <span className="cr-panel-title"><ThemedLabel parchment="The rundown" atlas="Rundown" /></span>
            <span className="cr-panel-sub">
              <ThemedLabel
                parchment={<>{queued.length} yet to be drawn forth</>}
                atlas={<>{queued.length} queued</>}
              />
            </span>
          </div>
          {items.length === 0 ? (
            <div className="cr-panel-empty">
              <ThemedLabel
                parchment="Naught is staged. Stage entities from their sheets."
                atlas="Nothing staged. Stage entities from their sheets."
              />
            </div>
          ) : (
            <div className="cr-rundown-scroll">
              {/* As on the live desk, the listbox wraps ONLY option rows: the
                  record's disclosure is a <button> whose Enter activation would
                  otherwise bubble into the Enter-releases branch below. */}
              <div
                className="cr-list"
                role="listbox"
                aria-label="Staged for this session"
                aria-activedescendant={selectedId && visible.some((v) => v.entityId === selectedId) ? rundownRowId(selectedId) : undefined}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelectedId(stepSelection(queued, selectedId, e.key === "ArrowDown" ? 1 : -1));
                  } else if (e.key === "Enter" && previewRow && canRelease) {
                    // Enter is RELEASE QUIETLY, never SHOW: the quiet verb is
                    // the safe one under a key that fires without the pointer.
                    e.preventDefault();
                    releasePreview();
                  } else if (e.key === "Escape" && selectedId) {
                    e.preventDefault();
                    setSelectedId(null);
                  }
                }}
              >
                {queued.map(rundownRow)}
                {showReleased && released.map(rundownRow)}
              </div>
              {released.length > 0 && (
                <button
                  className="cr-fold"
                  aria-expanded={showReleased}
                  onClick={() => setShowReleased((v) => !v)}
                >
                  <span aria-hidden="true">{showReleased ? "▾" : "▸"}</span>
                  <ThemedLabel
                    parchment={<><b>{released.length}</b> drawn forth tonight</>}
                    atlas={<><b>{released.length}</b> released tonight</>}
                  />
                </button>
              )}
            </div>
          )}
          <div className="cr-panel-foot">
            <ThemedLabel
              parchment="↑↓ to choose · Enter releases quietly"
              atlas="↑↓ select · Enter releases quietly"
            />
          </div>
        </section>

        <div className="cr-main">
          {/* ---------------- Monitors ---------------- */}
          <section className="cr-monitors" aria-label="Monitors">
            <div className="cr-monitor cr-preview">
              <div className="cr-monitor-head">
                <span className="cr-monitor-title cr-preview-title">
                  <ThemedLabel parchment="Behind the screen" atlas="Preview" />
                </span>
                <span className="cr-monitor-sub"><ThemedLabel parchment="yours alone" atlas="only you" /></span>
                <span className="cr-head-spacer" />
                {pState && (
                  <span className={`cr-state cr-state-${pState}`}>
                    <ThemedLabel parchment={stateLabel[pState].parchment} atlas={stateLabel[pState].atlas} />
                    {pState === "released" && previewRow?.releasedAt ? ` ${fmtTime(previewRow.releasedAt)}` : ""}
                  </span>
                )}
              </div>
              {previewEnt ? (
                <>
                  <div className="cr-monitor-body">
                    <MonitorArt ent={previewEnt} />
                    <div className="cr-monitor-text">
                      <span className="cr-kind">{previewEnt._kindLabel}</span>
                      <h2 className="cr-name" title={entityLabel(previewEnt)}>{entityLabel(previewEnt)}</h2>
                      {publicBlurb(previewEnt) && <p className="cr-blurb">{publicBlurb(previewEnt)}</p>}
                      {dmNote && (
                        <div className="cr-dmnote">
                          <div className="cr-dmnote-label">
                            <ThemedLabel parchment="DM's note · never shown" atlas="DM note · never shown" />
                          </div>
                          <div className="cr-dmnote-text">{excerpt(dmNote, 200)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="cr-monitor-foot">
                    <button
                      className="cr-btn"
                      disabled={!canRelease || desk.releaseBusy(previewEnt.id)}
                      onClick={releasePreview}
                      title={canRelease ? `Reveal “${entityLabel(previewEnt)}” without putting it on anyone's screen` : undefined}
                    >
                      {desk.isReleasing(previewEnt.id) ? "…" : "Release quietly"}
                    </button>
                    <span className="cr-hint">
                      {pState === "visible" ? (
                        <ThemedLabel
                          parchment="They can see this already — releasing only writes it in the record."
                          atlas="Players can already see this. Releasing only logs it."
                        />
                      ) : canRelease ? (
                        <ThemedLabel
                          parchment="Lifts the veil and writes it in the record. No screen changes."
                          atlas="Unhides it and logs a reveal. Nobody's screen changes."
                        />
                      ) : (
                        <ThemedLabel
                          parchment="Already out tonight. Show it to bring it before the table again."
                          atlas="Already out tonight. Show now puts it back on every screen."
                        />
                      )}
                    </span>
                    <button className="cr-link" onClick={() => onOpenEntity(previewEnt.id)}>
                      <ThemedLabel parchment="Open in the codex ↗" atlas="Open sheet ↗" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="cr-monitor-idle">
                  <ThemedLabel
                    parchment="Choose from the rundown what the party shall see."
                    atlas="Select something in the rundown to preview it."
                  />
                </div>
              )}
            </div>

            <div className="cr-take">
              <button
                className="cr-take-btn"
                disabled={!previewEnt || showBusy}
                onClick={showPreview}
                aria-label={previewEnt ? `Show ${entityLabel(previewEnt)} on every player's screen` : "Show now"}
              >
                <span className="cr-take-bolt" aria-hidden="true">⚡</span>
                <span className="cr-take-label">
                  {previewEnt && desk.isShowing(previewEnt.id) ? "…" : "Show now"}
                </span>
              </button>
              <span className="cr-take-caption">
                {previewOnScreen ? (
                  <ThemedLabel parchment="Already before them — shows it again" atlas="On screen — shows it again" />
                ) : (
                  <ThemedLabel parchment="Before every player" atlas="On every player's screen" />
                )}
              </span>
              {previewEnt && pState === "hidden" && (
                <span className="cr-take-warn">
                  <ThemedLabel parchment="Also lifts the veil for good" atlas="Also unhides it for good" />
                </span>
              )}
            </div>

            <div className={`cr-monitor cr-program${programEnt ? " is-live" : ""}`}>
              <div className="cr-monitor-head">
                <span className="cr-tally" aria-hidden="true" />
                <span className="cr-monitor-title cr-program-title">
                  <ThemedLabel parchment="Before the table" atlas="On players' screens" />
                </span>
                <span className="cr-head-spacer" />
                {lastShow && programEnt && <span className="cr-monitor-sub">since {fmtTime(lastShow.createdAt)}</span>}
              </div>
              {programEnt ? (
                <>
                  <div className="cr-monitor-body">
                    <MonitorArt ent={programEnt} />
                    <div className="cr-monitor-text">
                      <span className="cr-kind">{programEnt._kindLabel}</span>
                      <h2 className="cr-name" title={entityLabel(programEnt)}>{entityLabel(programEnt)}</h2>
                      {publicBlurb(programEnt) && <p className="cr-blurb">{publicBlurb(programEnt)}</p>}
                    </div>
                  </div>
                  <div className="cr-monitor-foot">
                    <button className="cr-btn" onClick={() => setSelectedId(programEnt.id)}>
                      <ThemedLabel parchment="Bring it behind the screen" atlas="Back to preview" />
                    </button>
                    <span className="cr-hint">
                      <ThemedLabel
                        parchment="Players close the vision themselves. It holds until the next show."
                        atlas="Players close the takeover themselves. This holds until the next show."
                      />
                    </span>
                  </div>
                </>
              ) : (
                <div className="cr-monitor-idle">
                  <ThemedLabel
                    parchment="Nothing has been shown tonight."
                    atlas="Nothing shown yet this session."
                  />
                </div>
              )}
            </div>
          </section>

          <div className="cr-lower">
            {/* ---------------- The record ---------------- */}
            <section className="cr-panel cr-record" aria-label="The record">
              <div className="cr-panel-head">
                <span className="cr-panel-title">The record</span>
                <span className="cr-panel-sub">
                  <ThemedLabel parchment="what the chronicle is written from" atlas="what the recap is built from" />
                </span>
              </div>
              <div
                className="cr-feed"
                ref={feedRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
              >
                {events.length === 0 && (
                  <div className="live-empty">The table is quiet. The record waits.</div>
                )}
                {events.map((ev) => <FeedRow key={ev.id} ev={ev} onOpenEntity={onOpenEntity} />)}
              </div>
              {/* The live panel's draft key on purpose: it is the same record,
                  and App unmounts the panel while this room is open, so the two
                  composers never hold one draft at once. */}
              <div className="cr-composer">
                <NoteComposer
                  draftKey={liveDraftKey(campaign.id, sessionId)}
                  className="live-input"
                  placeholder="Note for the record…"
                  sendOn="enter"
                  submitLabel={<ThemedLabel parchment="Set it down" atlas="Send" />}
                  submitTitle="Add to the record (Enter)"
                  onSubmit={(text) => insertSessionEvent({ type: "note", sessionId, text })}
                />
              </div>
            </section>

            {/* ---------------- The table ---------------- */}
            <section className="cr-panel cr-table" aria-label="The table">
              <div className="cr-panel-head">
                <span className="cr-panel-title">The table</span>
                <span className="cr-panel-sub">
                  {pcs.length > 0 && (
                    <ThemedLabel
                      parchment={<>{pcs.filter((p) => present.has(p.id)).length} of {pcs.length} present</>}
                      atlas={<>{pcs.filter((p) => present.has(p.id)).length} of {pcs.length} here</>}
                    />
                  )}
                </span>
              </div>
              <div className="cr-table-scroll">
                {pcs.length === 0 ? (
                  <div className="cr-panel-empty">
                    <ThemedLabel
                      parchment="No player characters are marked. Mark them on their sheets to take the register here."
                      atlas="No player characters marked yet. Mark PCs on their sheets to take attendance here."
                    />
                  </div>
                ) : (
                  <div className="cr-pcs">
                    {pcs.map((p) => {
                      const here = present.has(p.id);
                      const busy = marking.has(p.id);
                      return (
                        <button
                          key={p.id}
                          className={`cr-pc${here ? " is-here" : ""}`}
                          aria-pressed={here}
                          disabled={busy}
                          onClick={() => toggleAttendance(p.id, here)}
                          title={here ? `Mark ${p.name} absent` : `Mark ${p.name} present`}
                        >
                          <span className="cr-pc-name">{p.name}</span>
                          <span className="cr-pc-state">
                            {busy ? "…" : here
                              ? <ThemedLabel parchment="present" atlas="here" />
                              : <ThemedLabel parchment="absent" atlas="away" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {guests.length > 0 && (
                  <div className="cr-sub">
                    <div className="cr-sub-title"><ThemedLabel parchment="Also at the table" atlas="Also here" /></div>
                    <div className="cr-chips">
                      {guests.map((p) => (
                        <button key={p.id} className="cr-chip-btn" onClick={() => onOpenEntity(p.id)}>{p.name}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="cr-sub">
                  <div className="cr-sub-title"><ThemedLabel parchment="Seen this night" atlas="Seen tonight" /></div>
                  {seen.length === 0 ? (
                    <div className="cr-sub-empty">
                      <ThemedLabel parchment="No one yet. Those you show are marked seen." atlas="No one yet. People you release or show are marked seen." />
                    </div>
                  ) : (
                    <div className="cr-chips">
                      {seen.map((p) => (
                        <button key={p.id} className="cr-chip-btn" onClick={() => onOpenEntity(p.id)}>{p.name}</button>
                      ))}
                    </div>
                  )}
                </div>
                {pursuing.length > 0 && (
                  <div className="cr-sub">
                    <div className="cr-sub-title"><ThemedLabel parchment="Afoot" atlas="In pursuit" /></div>
                    <ul className="cr-quests">
                      {pursuing.map((q) => (
                        <li key={q.id}>
                          <button className="cr-quest" onClick={() => onOpenEntity(q.id)}>
                            {q.title}
                            {isHidden(q) && <span className="cr-chip">hidden</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
