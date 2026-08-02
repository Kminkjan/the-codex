// ============================================================================
// Feedback panel — where the party reports bugs and asks for things.
//
// Rides the .cleanup-* chrome (overlay, panel, header, body, footer) the same
// way the Complete Saga wizard does; only the composer head, the report rows,
// the vote button and the status chips are its own CSS.
//
// Three deliberate shapes, each of which the obvious implementation gets wrong:
//
//   * The composer is <NoteComposer>, not a hand-rolled contentEditable. A
//     report is append-only (0040: no player edit, no player delete), which is
//     exactly the condition that makes blur-to-save dangerous — and the reason
//     the shared composer exists at all is that two near-identical hand-rolled
//     boxes drifted apart and one of them shipped an onBlur commit. sendOn is
//     "modEnter": a bug report is prose with paragraphs, not a chat line.
//   * Voting is one bit per person and the button shows YOUR state, not a
//     leaderboard. No downvote, no rank, no per-item thread — with a party of
//     five those measure enthusiasm for clicking (see src/feedback.ts).
//   * Status is the DM's control and the reason the board isn't write-only. It
//     renders as a plain chip for everyone and as a <select> for the DM.
//
// Read-only viewers get the board and no composer, no vote button: the vote is
// gated on a real account because an anonymous JWT is per-browser-session and
// therefore forgeable by reloading in a private window.
// ============================================================================

import { useMemo, useState } from "react";
import { useCampaign, useFindEntity, useIsDm } from "./hooks";
import { useAuth } from "./auth";
import { Fleurons, NoteComposer, ThemedLabel } from "./components";
import { Icon } from "./icons";
import {
  FEEDBACK_STATUSES,
  hasVoted,
  isSettled,
  openFeedbackCount,
  orderFeedback,
  routeHint,
  sanitizeRoute,
  statusLabel,
  voteCount,
} from "./feedback";
import { isHidden, type FeedbackItem, type FeedbackKind, type FeedbackStatus } from "./data";
import { feedbackDraftKey } from "./noteDrafts";
import { deleteFeedback, insertFeedback, setFeedbackStatus, toggleFeedbackVote } from "./mutations";

function relativeDay(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

interface FeedbackPanelProps {
  onClose: () => void;
}

export function FeedbackPanel({ onClose }: FeedbackPanelProps) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const isDm = useIsDm();
  const { canEdit, user, displayName } = useAuth();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  // The row with a write in flight, so its controls can't be double-fired. One
  // slot rather than a set: every control here is per-row and a person operates
  // one row at a time, and the realtime round trip is a few hundred ms.
  const [busyId, setBusyId] = useState<number | null>(null);
  // Settled reports are the ones worth being able to hide: the board's whole
  // job is showing what's outstanding, and the answered ones are kept for the
  // record rather than for reading. Default OPEN — someone who filed a thing
  // that got built should see that it got built.
  const [showSettled, setShowSettled] = useState(true);

  const ordered = useMemo(() => orderFeedback(campaign.feedback), [campaign.feedback]);
  const shown = showSettled ? ordered : ordered.filter((i) => !isSettled(i.status));
  const settledCount = ordered.length - ordered.filter((i) => !isSettled(i.status)).length;
  const openCount = openFeedbackCount(campaign.feedback);

  // The composer must REJECT on failure or NoteComposer clears a draft that
  // never landed (its contract) — so this awaits and lets the error propagate.
  const submit = async (text: string) => {
    // Both context values are read at SUBMIT time from the live document, not
    // captured on mount: the panel outlives a theme flip and a navigation, and
    // what's wanted is where the reporter was when they sent it.
    //
    // sanitizeRoute drops the entity segment when the sheet under the panel
    // holds a HIDDEN entity — `feedback` is world-readable, and this surface
    // must not be the one place that writes unreleased ids into an open column.
    // findEntity resolves against the DM's unprojected campaign, which is the
    // only client that can see a hidden row at all, so it's also the only client
    // where this can trigger.
    const route = sanitizeRoute(window.location.hash, (id) => isHidden(findEntity(id)));
    // Falls back to "cartographer" rather than undefined: the attribute is
    // absent exactly when no theme has been set, which IS the default parchment
    // theme rather than an unknown one.
    const theme = document.documentElement.dataset.theme || "cartographer";
    await insertFeedback({ kind, text, author: displayName || "someone", route, theme });
  };

  const vote = (item: FeedbackItem) => {
    if (!user || !canEdit || busyId === item.id) return;
    setBusyId(item.id);
    // Fire-and-forget with the house pattern: realtime brings the new count
    // back. Nothing is patched locally, so a rejected vote simply never appears
    // rather than appearing and snapping back.
    toggleFeedbackVote(item.id, user.id, hasVoted(item, user.id))
      .catch(console.error)
      .finally(() => setBusyId((id) => (id === item.id ? null : id)));
  };

  return (
    <div className="cleanup-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cleanup-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cleanup-header">
          <button className="cleanup-close" onClick={onClose}><Icon name="close" size={16} /></button>
          <h2><ThemedLabel parchment="Petitions & Grievances" atlas="Feedback" /></h2>
          <p>
            <ThemedLabel
              parchment="Report what's broken, ask for what's missing. Add your mark to a petition you share."
              atlas="Report a bug or suggest a feature. Add a “me too” to anything you also want."
            />
          </p>
        </div>

        {canEdit && (
          <div className="feedback-compose">
            <div className="feedback-kind">
              {(["bug", "idea"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`feedback-kind-btn${kind === k ? " active" : ""}`}
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                >
                  {k === "bug"
                    ? <ThemedLabel parchment="A fault" atlas="Bug" />
                    : <ThemedLabel parchment="A petition" atlas="Idea" />}
                </button>
              ))}
            </div>
            <NoteComposer
              // One draft per campaign — the panel has a single box, and an
              // unsent report survives closing the panel like every other note
              // draft does.
              draftKey={feedbackDraftKey(campaign.id)}
              placeholder={kind === "bug"
                ? "What went wrong, and what were you doing?"
                : "What would you like the codex to do?"}
              submitLabel={<ThemedLabel parchment="Submit" atlas="Send" />}
              submitTitle="Send (⌘/Ctrl + Enter)"
              sendOn="modEnter"
              onSubmit={submit}
            />
          </div>
        )}

        <div className="cleanup-body">
          {ordered.length === 0 && (
            <div className="cleanup-empty">
              <Fleurons>
                <ThemedLabel
                  parchment="No grievances recorded. All is well, or nobody has said."
                  atlas="Nothing reported yet."
                />
              </Fleurons>
            </div>
          )}
          {shown.map((item) => {
            const mine = hasVoted(item, user?.id);
            const votes = voteCount(item);
            return (
              <div className={`feedback-row${isSettled(item.status) ? " settled" : ""}`} key={item.id}>
                <button
                  type="button"
                  className={`feedback-vote${mine ? " voted" : ""}`}
                  // Viewers see the count and no control — the button would be
                  // a promise the RLS policy won't keep.
                  disabled={!canEdit || busyId === item.id}
                  aria-pressed={mine}
                  title={canEdit
                    ? (mine ? "Remove your mark" : "Me too")
                    : "Sign in to add your mark"}
                  onClick={() => vote(item)}
                >
                  <span className="feedback-vote-caret">▲</span>
                  {/* 0 renders as a dash, not a zero: an unvoted report is
                      unremarkable, and a column of zeroes reads as failure. */}
                  <span className="feedback-vote-count">{votes || "–"}</span>
                </button>

                <div className="feedback-main">
                  <div className="feedback-text">{item.text}</div>
                  <div className="feedback-meta">
                    <span className={`feedback-tag ${item.kind}`}>
                      {item.kind === "bug"
                        ? <ThemedLabel parchment="Fault" atlas="Bug" />
                        : <ThemedLabel parchment="Petition" atlas="Idea" />}
                    </span>
                    <span>{item.author}</span>
                    <span className="feedback-dot">·</span>
                    <span>{relativeDay(item.createdAt)}</span>
                    {item.route && (
                      <>
                        <span className="feedback-dot">·</span>
                        {/* Captured context, shown as a hint. Never a link: the
                            page it names may not exist any more. */}
                        <span className="feedback-where">{routeHint(item.route)}</span>
                      </>
                    )}
                  </div>
                </div>

                {isDm ? (
                  <div className="feedback-dm">
                    <select
                      className="feedback-status-select"
                      value={item.status}
                      disabled={busyId === item.id}
                      onChange={(e) => {
                        const next = e.target.value as FeedbackStatus;
                        setBusyId(item.id);
                        setFeedbackStatus(item.id, next)
                          .catch(console.error)
                          .finally(() => setBusyId((id) => (id === item.id ? null : id)));
                      }}
                    >
                      {FEEDBACK_STATUSES.map((s) => (
                        <option key={s} value={s}>{statusLabel(s)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="feedback-del"
                      title="Remove this report"
                      disabled={busyId === item.id}
                      // Confirmed because it's the one destructive control here
                      // and it takes someone else's words with it — votes
                      // cascade, and there is no undo and no backup.
                      onClick={() => {
                        if (!window.confirm("Remove this report? Its votes go with it.")) return;
                        setBusyId(item.id);
                        deleteFeedback(item.id)
                          .catch(console.error)
                          .finally(() => setBusyId((id) => (id === item.id ? null : id)));
                      }}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ) : (
                  <span className={`feedback-status ${item.status}`}>{statusLabel(item.status)}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="cleanup-footer">
          <span className="cleanup-selected">
            {openCount} OPEN · {ordered.length} TOTAL
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {settledCount > 0 && (
              <button className="cleanup-link-btn" onClick={() => setShowSettled((v) => !v)}>
                {showSettled ? `hide ${settledCount} settled` : `show ${settledCount} settled`}
              </button>
            )}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
