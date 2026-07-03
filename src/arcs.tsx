import { type Arc, type Session } from "./data";
import { useCampaign } from "./hooks";
import { useAuth } from "./auth";
import { createEntity } from "./mutations";

// Plain-text excerpt of a markdown summary for the arc list.
function excerpt(text: string | undefined, max = 140): string {
  if (!text) return "";
  const plain = text.replace(/[#*_>`~\[\]]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

// "Session 3 — 12 June 2025" style range for an arc: explicit start/end
// sessions when set, otherwise the min/max of its assigned sessions.
function arcRange(arc: Arc, assigned: Session[], byId: Map<string, Session>): string {
  const first = (arc.startSession && byId.get(arc.startSession)) || assigned[0];
  const last = (arc.endSession && byId.get(arc.endSession)) || assigned[assigned.length - 1];
  if (!first || !last) return "";
  if (first.id === last.id) return first.date;
  return `${first.date} — ${last.date}`;
}

export function ArcsPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();

  const arcs = campaign.arcs.slice().sort((a, b) => a.orderNum - b.orderNum || a.title.localeCompare(b.title));
  const sessionsById = new Map(campaign.sessions.map((s) => [s.id, s]));
  const unassigned = campaign.sessions.filter((s) => !s.arc);

  const onNewArc = () => {
    const id = crypto.randomUUID();
    const orderNum = Math.max(0, ...campaign.arcs.map((a) => a.orderNum)) + 1;
    createEntity("arcs", id, { title: "Untitled arc", orderNum })
      .then(() => onOpenEntity(id))
      .catch(console.error);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1, maxWidth: 860 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>Story Arcs</h1>
          <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {arcs.length} {arcs.length === 1 ? "arc" : "arcs"} of the chronicle
          </span>
          {canEdit && (
            <button onClick={onNewArc} className="cleanup-link-btn" style={{ marginLeft: "auto" }}>
              + new arc
            </button>
          )}
        </div>
        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        {arcs.map((arc) => {
          const assigned = campaign.sessions.filter((s) => s.arc === arc.id);
          const quests = campaign.quests.filter((q) => q.arc === arc.id);
          const range = arcRange(arc, assigned, sessionsById);
          const summary = excerpt(arc.summary);
          return (
            <section key={arc.id} style={{ marginTop: 30 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2
                  onClick={() => onOpenEntity(arc.id)}
                  style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 24, color: "var(--ink)", cursor: "pointer" }}
                >
                  {arc.title}
                </h2>
                <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".12em", fontSize: 11, color: "var(--ink-faded)" }}>
                  {assigned.length} {assigned.length === 1 ? "session" : "sessions"}
                  {quests.length > 0 && ` · ${quests.length} ${quests.length === 1 ? "quest" : "quests"}`}
                  {range && ` · ${range}`}
                </span>
              </div>
              {summary && (
                <p style={{ margin: "6px 0 0", fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14, color: "var(--ink-body)" }}>
                  {summary}
                </p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 10 }}>
                {assigned.map((s) => (
                  <div key={s.id} className="session-chip" onClick={() => onOpenEntity(s.id)}>
                    <span className="num">SESS {String(s.num).padStart(2, "0")}</span>
                    <span style={{ flex: 1 }}>{s.title}</span>
                  </div>
                ))}
                {assigned.length === 0 && (
                  <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 13, color: "var(--ink-ghost)" }}>
                    No sessions claimed by this arc yet.
                  </span>
                )}
              </div>
            </section>
          );
        })}

        {arcs.length === 0 && (
          <p style={{ marginTop: 30, fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 15, color: "var(--ink-faded)" }}>
            No arcs written yet — the chronicle is a single unbroken thread.
          </p>
        )}

        {unassigned.length > 0 && arcs.length > 0 && (
          <section style={{ marginTop: 34 }}>
            <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 12, color: "var(--ink-faded)" }}>
              ✦ UNCLAIMED SESSIONS ✦
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
              {unassigned.map((s) => (
                <div key={s.id} className="session-chip" onClick={() => onOpenEntity(s.id)}>
                  <span className="num">SESS {String(s.num).padStart(2, "0")}</span>
                  <span style={{ flex: 1 }}>{s.title}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
