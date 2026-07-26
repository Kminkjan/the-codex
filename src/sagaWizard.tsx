import { useEffect, useMemo, useState } from "react";
import { Fleurons, ThemedLabel } from "./components";
import { useCampaign, useKinds } from "./hooks";
import { useAuth } from "./auth";
import { type KindKey, sessionLabel } from "./data";
import { Icon } from "./icons";
import { bulkArchive, bulkSetStatus, bulkUnarchive, completeSaga, reopenSaga } from "./mutations";
import { childArcs, sagaScope, type SweepCandidate } from "./saga";

// "Complete Saga" — the end-of-saga sweep. A saga leaves behind a long tail of
// supporting folk, one-scene taverns and settled threads; this walks the DM
// through tucking them away in one gesture instead of forty.
//
// Two rules shape the whole thing, both from how the table actually plays:
//   * **Majors stay.** A major-tier person is listed but never pre-checked —
//     the DM's own words were that major characters mostly need to keep
//     existing on the board. It's a default, not a wall: the box is there.
//   * **Nothing is destroyed.** Every write here is `archived` (a declutter
//     flag players can still read) or a quest status. Board positions survive,
//     so unarchiving restores a card exactly where it sat. Undo is therefore a
//     real undo, not a best effort.
//
// Selection state, the overlay chrome and the reason column are the cleanup
// panel's (cleanupPanel.tsx) — same keys, same look, so the two read as one
// family of tools.

type StepKey = "close" | "cast" | "threads" | "things" | "confirm";

// Two voices per step, the ThemedLabel contract (components.tsx): parchment
// speaks the ceremony, Atlas — the default theme — speaks the function.
const STEPS: Array<{ key: StepKey; parchment: string; atlas: string }> = [
  { key: "close", parchment: "Close", atlas: "Summary" },
  { key: "cast", parchment: "The cast", atlas: "People" },
  { key: "threads", parchment: "Loose ends", atlas: "Open threads" },
  { key: "things", parchment: "Places & things", atlas: "Related" },
  { key: "confirm", parchment: "Seal it", atlas: "Review" },
];

// What to do with a quest/goal the saga never resolved.
type ThreadChoice = "keep" | "lost" | "archive";

interface SagaWizardProps {
  sagaId: string;
  onClose: () => void;
  onOpenEntity: (id: string) => void;
}

const keyOf = (c: { kind: KindKey; id: string }) => `${c.kind}:${c.id}`;

export function SagaWizard({ sagaId, onClose, onOpenEntity }: SagaWizardProps) {
  const campaign = useCampaign();
  const kinds = useKinds();
  const { canEdit } = useAuth();

  const saga = campaign.arcs.find((a) => a.id === sagaId);
  const scope = useMemo(() => sagaScope(campaign, sagaId), [campaign, sagaId]);

  const [step, setStep] = useState<StepKey>("close");
  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const c of scope.cast) if (c.suggested) s.add(keyOf(c));
    for (const c of scope.things) if (c.suggested) s.add(keyOf(c));
    return s;
  });
  const [threads, setThreads] = useState<Record<string, ThreadChoice>>({});
  const [summary, setSummary] = useState(saga?.summary ?? "");
  const [working, setWorking] = useState(false);
  // The committed sweep, kept for Undo until the panel closes. Also the signal
  // that we're past the point of no return: the footer becomes the receipt.
  const [swept, setSwept] = useState<{
    archived: Array<{ kind: KindKey; id: string }>;
    resolved: Array<{ kind: KindKey; id: string }>;
    // False when the writes landed but the saga itself never got sealed. The
    // receipt still has to appear in that state — it's the only route to Undo.
    sealed: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kindLabel = useMemo(
    () => Object.fromEntries(kinds.map((k) => [k.key, k.label])) as Record<KindKey, string>,
    [kinds],
  );

  // Drop selections whose candidate vanished (realtime delete, another tab
  // archiving it first) — the same guard the cleanup panel keeps.
  useEffect(() => {
    if (swept) return;
    const valid = new Set([...scope.cast, ...scope.things].map(keyOf));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const k of prev) if (valid.has(k)) next.add(k);
      return next.size === prev.size ? prev : next;
    });
  }, [scope, swept]);

  // Esc dismisses, matching every other overlay in the app. Blocked mid-write
  // so a stray keypress can't orphan a half-applied sweep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || working) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  if (!saga) return null;

  const lastChapter = scope.sessions.length > 0 ? scope.sessions[scope.sessions.length - 1] : null;
  const arcs = childArcs(campaign, sagaId);

  const toggle = (c: SweepCandidate) => setSelected((prev) => {
    const next = new Set(prev);
    const k = keyOf(c);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const selectGroup = (items: SweepCandidate[]) => {
    const all = items.every((c) => selected.has(keyOf(c)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of items) {
        if (all) next.delete(keyOf(c)); else next.add(keyOf(c));
      }
      return next;
    });
  };

  const threadChoice = (id: string): ThreadChoice => threads[id] ?? "keep";

  const archiveEntries = [...scope.cast, ...scope.things]
    .filter((c) => selected.has(keyOf(c)))
    .map(({ kind, id }) => ({ kind, id }));
  const lostEntries = scope.looseEnds
    .filter((t) => threadChoice(t.id) === "lost")
    .map((t) => ({ kind: t.kind as KindKey, id: t.id }));
  const threadArchiveEntries = scope.looseEnds
    .filter((t) => threadChoice(t.id) === "archive")
    .map((t) => ({ kind: t.kind as KindKey, id: t.id }));
  const majorsKept = scope.cast.filter((c) => c.tier === "major" && !selected.has(keyOf(c))).length;

  const allArchive = [...archiveEntries, ...threadArchiveEntries];

  // Writes go out in stages, and a later stage failing must not strand the
  // earlier ones: whatever actually landed is recorded as it lands, so the
  // receipt — and with it Undo — is reachable no matter where this stops. The
  // old version set `swept` only after every stage succeeded, which meant a
  // failure on the final seal left dozens of entities archived with no way back
  // and a live "Seal" button inviting a second pass.
  const commit = async () => {
    if (working) return;
    setWorking(true);
    setError(null);
    const landed: { archived: typeof allArchive; resolved: typeof lostEntries } = {
      archived: [],
      resolved: [],
    };
    try {
      if (lostEntries.length > 0) {
        await bulkSetStatus(lostEntries, "lost");
        landed.resolved = lostEntries;
      }
      if (allArchive.length > 0) {
        await bulkArchive(allArchive);
        landed.archived = allArchive;
      }
      await completeSaga(sagaId, {
        endSession: lastChapter?.id ?? null,
        summary: summary.trim() ? summary : undefined,
      });
      setSwept({ ...landed, sealed: true });
    } catch (e) {
      console.error("completeSaga failed", e);
      if (landed.archived.length > 0 || landed.resolved.length > 0) {
        // Partial success. Show the receipt so Undo can reverse it, and say
        // plainly that the saga is still open.
        setSwept({ ...landed, sealed: false });
        setError("Those changes landed, but the saga wasn't sealed — it's still open. Undo below reverses them.");
      } else {
        setError("Nothing was changed. Check that you're a member of this campaign, then try again.");
      }
    } finally {
      setWorking(false);
    }
  };

  const undo = async () => {
    if (!swept || working) return;
    setWorking(true);
    setError(null);
    try {
      if (swept.archived.length > 0) await bulkUnarchive(swept.archived);
      // Statuses go back to `pursuing`: the pre-sweep value was whispered or
      // pursuing (resolved/lost never enter looseEnds), and "pursuing" is the
      // honest reading of a thread the DM just declined to close.
      if (swept.resolved.length > 0) await bulkSetStatus(swept.resolved, "pursuing");
      // Only if it actually got sealed — clearing completedAt on a saga that
      // was never closed is a pointless write against a row we know is already null.
      if (swept.sealed) await reopenSaga(sagaId);
      setSwept(null);
    } catch (e) {
      console.error("undo sweep failed", e);
      setError("Undo didn't fully land — the entries are still archived, restore them from their sheets.");
    } finally {
      setWorking(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const castByTier = (tier: SweepCandidate["tier"]) => scope.cast.filter((c) => c.tier === tier);
  const thingsByKind = (kind: KindKey) => scope.things.filter((c) => c.kind === kind);

  const row = (c: SweepCandidate) => (
    <label className="cleanup-row" key={keyOf(c)}>
      <input
        type="checkbox"
        checked={selected.has(keyOf(c))}
        onChange={() => toggle(c)}
        onClick={(e) => e.stopPropagation()}
        disabled={!!swept}
      />
      <span
        style={{ cursor: "pointer", color: "var(--ink)" }}
        onClick={(e) => { e.preventDefault(); onOpenEntity(c.id); }}
      >
        {c.label}
      </span>
      <span className="cleanup-reason">{c.reason}</span>
    </label>
  );

  const group = (title: string, items: SweepCandidate[], note?: React.ReactNode) => {
    if (items.length === 0) return null;
    const all = items.every((c) => selected.has(keyOf(c)));
    return (
      <div className="cleanup-group" key={title}>
        <div className="cleanup-group-head">
          <span className="cleanup-group-title">{title} · {items.length}</span>
          {!swept && (
            <button className="cleanup-link-btn" onClick={() => selectGroup(items)}>
              {all ? "deselect group" : "select group"}
            </button>
          )}
        </div>
        {note && <p className="saga-wizard-note">{note}</p>}
        {items.map(row)}
      </div>
    );
  };

  return (
    <div className="cleanup-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}>
      <div className="cleanup-panel saga-wizard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cleanup-header">
          <button className="cleanup-close" onClick={onClose}><Icon name="close" size={16} /></button>
          <h2>Complete {saga.title}</h2>
          <p>
            {swept ? (
              swept.sealed ? (
                <ThemedLabel
                  parchment="Sealed. Nothing was destroyed — everything swept is archived and one click from coming back."
                  atlas="Sealed. Everything swept is archived, not deleted — Undo restores it."
                />
              ) : (
                <ThemedLabel
                  parchment="The saga is still open. What was swept is archived, not destroyed, and Undo returns it."
                  atlas="The saga is still open. What was archived is not deleted — Undo restores it."
                />
              )
            ) : (
              <ThemedLabel
                parchment="Archiving only — every entry stays readable, keeps its place on the board, and can be restored."
                atlas="Archives only. Entries stay readable, keep their board position, and can be restored."
              />
            )}
          </p>
        </div>

        <div className="saga-wizard-steps">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              className={`saga-step ${s.key === step ? "is-current" : ""} ${i < stepIndex ? "is-done" : ""}`}
              onClick={() => !swept && setStep(s.key)}
              disabled={!!swept}
            >
              <span className="saga-step-num">{i + 1}</span>
              <ThemedLabel parchment={s.parchment} atlas={s.atlas} />
            </button>
          ))}
        </div>

        <div className="cleanup-body">
          {step === "close" && (
            <div className="saga-wizard-step">
              <dl className="saga-wizard-facts">
                <div><dt>Chapters</dt><dd>{scope.sessions.length}{lastChapter && ` · ends ${sessionLabel(lastChapter.num)} — ${lastChapter.title}`}</dd></div>
                <div><dt>Arcs</dt><dd>{arcs.length > 0 ? arcs.map((a) => a.title).join(" · ") : "none written"}</dd></div>
                <div>
                  <dt><ThemedLabel parchment="Cast in play" atlas="People" /></dt>
                  <dd>
                    <ThemedLabel
                      parchment={`${scope.cast.length} folk, ${scope.cast.filter((c) => c.carriesForward).length} still afoot`}
                      atlas={`${scope.cast.length} in this saga · ${scope.cast.filter((c) => c.carriesForward).length} continuing`}
                    />
                  </dd>
                </div>
                <div><dt>Open threads</dt><dd>{scope.looseEnds.length}</dd></div>
              </dl>
              {!lastChapter && (
                <p className="saga-wizard-warn">
                  <ThemedLabel
                    parchment="No chapters are filed under this saga, so there's nothing to date it by and nobody to sweep. File its sessions first — the arc page's chapter list is where."
                    atlas="No chapters are filed under this saga, so there's nothing to date it by and nobody to archive. File its sessions first."
                  />
                </p>
              )}
              <label className="saga-wizard-label"><ThemedLabel parchment="How it ended" atlas="Summary" /></label>
              <textarea
                className="saga-wizard-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="How this saga ended…"
                rows={6}
                disabled={!!swept}
              />
            </div>
          )}

          {step === "cast" && (
            <div className="saga-wizard-step">
              {scope.cast.length === 0 && (
                <div className="cleanup-empty">
                  <Fleurons><ThemedLabel parchment="No one to tuck away." atlas="No one to archive." /></Fleurons>
                </div>
              )}
              {group(
                "Major",
                castByTier("major"),
                <ThemedLabel
                  parchment="Majors are never pre-selected — the board keeps them. Tick one only if they're truly done."
                  atlas="Never pre-selected — majors stay on the board. Select one only if they're done."
                />,
              )}
              {group("Supporting", castByTier("supporting"))}
              {group("Background", castByTier("background"))}
            </div>
          )}

          {step === "threads" && (
            <div className="saga-wizard-step">
              {scope.looseEnds.length === 0 && (
                <div className="cleanup-empty">
                  <Fleurons><ThemedLabel parchment="Nothing left dangling." atlas="No open threads." /></Fleurons>
                </div>
              )}
              {scope.looseEnds.map((t) => (
                <div className="saga-thread" key={`${t.kind}:${t.id}`}>
                  <span className="saga-thread-label" onClick={() => onOpenEntity(t.id)}>{t.label}</span>
                  <span className="cleanup-reason">{t.status}</span>
                  <div className="saga-thread-choices">
                    {(["keep", "lost", "archive"] as const).map((c) => (
                      <button
                        key={c}
                        className={`saga-choice ${threadChoice(t.id) === c ? "is-on" : ""}`}
                        onClick={() => setThreads((prev) => ({ ...prev, [t.id]: c }))}
                        disabled={!!swept}
                        title={
                          c === "keep" ? "Carry it into the next saga, untouched"
                            : c === "lost" ? "Mark it lost — the party never closed it"
                              : "Archive it without a verdict"
                        }
                      >
                        {c === "keep"
                          ? <ThemedLabel parchment="carry on" atlas="keep" />
                          : c === "lost"
                            ? <ThemedLabel parchment="lost" atlas="mark lost" />
                            : "archive"}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === "things" && (
            <div className="saga-wizard-step">
              <p className="saga-wizard-note">
                <ThemedLabel
                  parchment="Places, factions, items, lore and beasts carry no chapter of their own — these are reached by association, so none are pre-selected. Trust your own read over this list."
                  atlas="Places, factions, items, lore and beasts have no chapter link, so these are inferred from relations. None are pre-selected — trust your own read."
                />
              </p>
              {scope.things.length === 0 && (
                <div className="cleanup-empty">
                  <Fleurons><ThemedLabel parchment="Nothing tied to this saga alone." atlas="Nothing tied to this saga only." /></Fleurons>
                </div>
              )}
              {(["locations", "factions", "items", "lore", "monsters"] as const).map((k) =>
                group(kindLabel[k] ?? k, thingsByKind(k)),
              )}
            </div>
          )}

          {step === "confirm" && (
            <div className="saga-wizard-step">
              <dl className="saga-wizard-facts">
                <div><dt>Archive</dt><dd>{allArchive.length} {allArchive.length === 1 ? "entry" : "entries"}</dd></div>
                <div><dt>Mark lost</dt><dd>{lostEntries.length} {lostEntries.length === 1 ? "thread" : "threads"}</dd></div>
                <div><dt>Keep on the board</dt><dd>{majorsKept} {majorsKept === 1 ? "major" : "majors"}</dd></div>
                <div><dt>Seal</dt><dd>{saga.title}{lastChapter && ` at ${sessionLabel(lastChapter.num)}`}</dd></div>
              </dl>
              <p className="saga-wizard-note">
                <ThemedLabel
                  parchment="Sealing folds this saga away on the Sagas & Arcs page. Its chapters, quests and everything swept stay readable — archiving is a filing decision, not a deletion."
                  atlas="Completing collapses this saga on the Sagas & Arcs page. Chapters, quests and archived entries stay readable — this files them, it doesn't delete them."
                />
              </p>
            </div>
          )}
        </div>

        {error && <div className="saga-wizard-error">{error}</div>}

        <div className="cleanup-footer">
          <span className="cleanup-selected">
            {/* Counts read the same in both voices — no ThemedLabel needed. */}
            {swept
              ? `${swept.archived.length} archived · ${swept.resolved.length} marked lost`
              : `${allArchive.length} to archive · ${majorsKept} majors kept`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {!swept && stepIndex > 0 && (
              <button className="btn" onClick={() => setStep(STEPS[stepIndex - 1].key)}>Back</button>
            )}
            {!swept && stepIndex < STEPS.length - 1 && (
              <button className="btn" onClick={() => setStep(STEPS[stepIndex + 1].key)}>Next</button>
            )}
            {swept ? (
              <>
                <button className="btn" onClick={undo} disabled={working}>
                  {working ? "Undoing…" : <ThemedLabel parchment="Undo the sweep" atlas="Undo" />}
                </button>
                <button className="btn btn-primary" onClick={onClose}>Done</button>
              </>
            ) : (
              <>
                <button className="btn" onClick={onClose}>Close</button>
                {canEdit && step === "confirm" && (
                  <button
                    className="btn btn-primary saga-seal-btn"
                    onClick={commit}
                    disabled={working || !lastChapter}
                  >
                    {working
                      ? <ThemedLabel parchment="Sealing…" atlas="Completing…" />
                      : <ThemedLabel parchment="Seal the saga" atlas="Complete saga" />}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
