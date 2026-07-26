import { useState } from "react";
import { sessionLabel, type Arc, type Session } from "./data";
import { useCampaign } from "./hooks";
import { useAuth } from "./auth";
import { createEntity } from "./mutations";
import { Icon } from "./icons";
import { Fleurons, ThemedLabel } from "./components";
import { childArcs, isCompleted, sagaSessions, sagaTree } from "./saga";
import { SagaWizard } from "./sagaWizard";

// Plain-text excerpt of a markdown summary for the arc list (also used by
// the charter's sessions ledger).
export function excerpt(text: string | undefined, max = 140): string {
  if (!text) return "";
  const plain = text.replace(/[#*_>`~\[\]]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

// "12 June 2025 — 3 Sept 2025" style range: explicit start/end sessions when
// set, otherwise the min/max of the sessions handed in.
function arcRange(arc: Arc, assigned: Session[], byId: Map<string, Session>): string {
  const first = (arc.startSession && byId.get(arc.startSession)) || assigned[0];
  const last = (arc.endSession && byId.get(arc.endSession)) || assigned[assigned.length - 1];
  if (!first || !last) return "";
  // Guard the date fields, not just the session objects: an arc can span
  // sessions whose `date` column is null, and an unguarded template would
  // print the literal string "null".
  const fd = first.date, ld = last.date;
  if (first.id === last.id) return fd ?? "";
  if (!fd || !ld) return fd || ld || "";
  return `${fd} — ${ld}`;
}

// "S148–S191" — the chapter span, which is what the DM's own table reads in.
function chapterSpan(sessions: Session[]): string {
  if (sessions.length === 0) return "";
  const lo = sessions[0], hi = sessions[sessions.length - 1];
  return lo.id === hi.id ? sessionLabel(lo.num) : `${sessionLabel(lo.num)}–${sessionLabel(hi.num)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ChapterChips({ sessions, onOpenEntity }: { sessions: Session[]; onOpenEntity: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
      {sessions.map((s) => (
        <div key={s.id} className="session-chip" onClick={() => onOpenEntity(s.id)} title={s.title}>
          <span className="num">{sessionLabel(s.num)}</span>
          <span className="title">{s.title}</span>
        </div>
      ))}
    </div>
  );
}

export function ArcsPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();
  const [wizardSagaId, setWizardSagaId] = useState<string | null>(null);
  // Explicit open/closed per saga, falling back to "open unless completed".
  //
  // Storing the reader's *intent* rather than "deviates from the default"
  // matters because the default itself moves: sealing a saga flips it to
  // closed, and a set-of-deviations would have inverted at that moment —
  // collapse a saga by hand, complete it, and it would spring open exactly
  // when the fold-away is the point.
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});

  const tree = sagaTree(campaign);
  const sessionsById = new Map(campaign.sessions.map((s) => [s.id, s]));
  // Chapters claimed by no arc at all. Sessions filed directly against a saga
  // are accounted for inside that saga, so they're not "unclaimed".
  const arcIds = new Set(campaign.arcs.map((a) => a.id));
  const unclaimed = campaign.sessions
    .filter((s) => !s.arc || !arcIds.has(s.arc))
    .sort((a, b) => a.num - b.num);
  const arcCount = campaign.arcs.filter((a) => a.parentId).length;

  const isOpen = (saga: Arc) => openOverride[saga.id] ?? !isCompleted(saga);
  // Reads `prev`, not isOpen(), so a toggle can't act on a stale closure.
  const toggle = (saga: Arc) => setOpenOverride((prev) => ({
    ...prev,
    [saga.id]: !(prev[saga.id] ?? !isCompleted(saga)),
  }));

  const onNewSaga = () => {
    const id = crypto.randomUUID();
    const orderNum = Math.max(0, ...campaign.arcs.filter((a) => !a.parentId).map((a) => a.orderNum)) + 1;
    createEntity("arcs", id, { title: "Untitled saga", orderNum })
      .then(() => onOpenEntity(id))
      .catch(console.error);
  };

  const onNewArc = (sagaId: string) => {
    const id = crypto.randomUUID();
    const siblings = childArcs(campaign, sagaId);
    const orderNum = Math.max(0, ...siblings.map((a) => a.orderNum)) + 1;
    createEntity("arcs", id, { title: "Untitled arc", orderNum, parentId: sagaId })
      .then(() => onOpenEntity(id))
      .catch(console.error);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1, maxWidth: 860 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>Sagas &amp; Arcs</h1>
          <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {plural(tree.length, "saga", "sagas")}
            {arcCount > 0 && ` · ${plural(arcCount, "arc", "arcs")}`}
          </span>
          {canEdit && (
            <button onClick={onNewSaga} className="cleanup-link-btn" style={{ marginLeft: "auto" }}>
              <ThemedLabel parchment="+ new saga" atlas="New saga" />
            </button>
          )}
        </div>
        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        {tree.map(({ saga, arcs }) => {
          const chapters = sagaSessions(campaign, saga.id);
          // Chapters filed at saga level rather than against one of its arcs.
          const direct = campaign.sessions.filter((s) => s.arc === saga.id).sort((a, b) => a.num - b.num);
          const questCount = campaign.quests.filter(
            (q) => q.arc === saga.id || arcs.some((a) => q.arc === a.id),
          ).length;
          const span = chapterSpan(chapters);
          const open = isOpen(saga);
          const sealed = isCompleted(saga);
          const summary = excerpt(saga.summary);

          return (
            <section key={saga.id} className={`saga ${sealed ? "is-sealed" : ""}`}>
              <div className="saga-head">
                <button
                  className="saga-toggle"
                  onClick={() => toggle(saga)}
                  aria-expanded={open}
                  title={open ? "Fold this saga away" : "Unfold this saga"}
                >
                  <Icon name="chevron" size={14} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} />
                </button>
                <h2 onClick={() => onOpenEntity(saga.id)}>{saga.title}</h2>
                {sealed && (
                  <span className="saga-seal" title={`Completed ${saga.completedAt?.slice(0, 10)}`}>
                    <Fleurons><ThemedLabel parchment="sealed" atlas="complete" /></Fleurons>
                  </span>
                )}
                <span className="saga-meta">
                  {arcs.length > 0 && `${plural(arcs.length, "arc", "arcs")} · `}
                  {plural(chapters.length, "chapter", "chapters")}
                  {questCount > 0 && ` · ${plural(questCount, "quest", "quests")}`}
                  {span && ` · ${span}`}
                </span>
                {canEdit && !sealed && (
                  <button
                    className="cleanup-link-btn saga-complete-btn"
                    onClick={() => setWizardSagaId(saga.id)}
                    title="Close this saga and archive the cast it leaves behind"
                  >
                    {/* The engraving is parchment voice; Atlas hides it through
                        [data-theme="modern"] .saga-complete-btn svg, the same
                        scoped-selector pattern as the topbar and board toolbar. */}
                    <Icon name="check" size={13} />
                    <ThemedLabel parchment="complete saga…" atlas="Complete saga" />
                  </button>
                )}
              </div>

              {summary && <p className="saga-summary">{summary}</p>}

              {open && (
                <div className="saga-body">
                  {arcs.map((arc) => {
                    // Array order isn't trustworthy after realtime splices — sort by num.
                    const assigned = campaign.sessions.filter((s) => s.arc === arc.id).sort((a, b) => a.num - b.num);
                    const quests = campaign.quests.filter((q) => q.arc === arc.id);
                    const range = arcRange(arc, assigned, sessionsById);
                    const arcSummary = excerpt(arc.summary);
                    const arcSpan = chapterSpan(assigned);
                    return (
                      <div key={arc.id} className="arc-block">
                        <div className="arc-head">
                          <h3 onClick={() => onOpenEntity(arc.id)}>{arc.title}</h3>
                          <span className="arc-meta">
                            {plural(assigned.length, "chapter", "chapters")}
                            {quests.length > 0 && ` · ${plural(quests.length, "quest", "quests")}`}
                            {arcSpan && ` · ${arcSpan}`}
                            {range && ` · ${range}`}
                          </span>
                        </div>
                        {arcSummary && <p className="arc-summary">{arcSummary}</p>}
                        {assigned.length > 0 ? (
                          <ChapterChips sessions={assigned} onOpenEntity={onOpenEntity} />
                        ) : (
                          <span className="arc-empty">No chapters recorded for this arc yet.</span>
                        )}
                      </div>
                    );
                  })}

                  {direct.length > 0 && (
                    <div className="arc-block">
                      {arcs.length > 0 && (
                        <div className="arc-head">
                          <h3 style={{ fontStyle: "italic" }}>Filed at saga level</h3>
                          <span className="arc-meta">{plural(direct.length, "chapter", "chapters")}</span>
                        </div>
                      )}
                      <ChapterChips sessions={direct} onOpenEntity={onOpenEntity} />
                    </div>
                  )}

                  {arcs.length === 0 && direct.length === 0 && (
                    <span className="arc-empty">No arcs written under this saga yet.</span>
                  )}

                  {canEdit && (
                    <button className="cleanup-link-btn" style={{ marginTop: 12 }} onClick={() => onNewArc(saga.id)}>
                      <ThemedLabel parchment="+ new arc in this saga" atlas="New arc" />
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}

        {tree.length === 0 && (
          <p style={{ marginTop: 30, fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 15, color: "var(--ink-faded)" }}>
            No sagas written yet — the chronicle is a single unbroken thread.
          </p>
        )}

        {unclaimed.length > 0 && tree.length > 0 && (
          <section style={{ marginTop: 34 }}>
            <div className="saga-unclaimed-head">
              <Fleurons>UNCLAIMED CHAPTERS</Fleurons>
            </div>
            <ChapterChips sessions={unclaimed} onOpenEntity={onOpenEntity} />
          </section>
        )}
      </div>

      {wizardSagaId && (
        <SagaWizard
          sagaId={wizardSagaId}
          onClose={() => setWizardSagaId(null)}
          onOpenEntity={(id) => { setWizardSagaId(null); onOpenEntity(id); }}
        />
      )}
    </div>
  );
}
