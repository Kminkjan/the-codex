import { sessionLabel } from "./data";
import { useCampaign, useChronicleOrder } from "./hooks";
import { useAuth } from "./auth";
import { createEntity } from "./mutations";
import { Icon } from "./icons";
import { CHRONICLE_ORDERS, groupByDate, sortEvents, type ChronicleOrder } from "./chronicle";

function excerpt(text: string | undefined, max = 160): string {
  if (!text) return "";
  const plain = text.replace(/[#*_>`~\[\]]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function EventsPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();
  const [order, setOrder] = useChronicleOrder();

  const events = sortEvents(campaign.events, order);
  const groups = groupByDate(events);
  const sessionsById = new Map(campaign.sessions.map((s) => [s.id, s]));
  const locationsById = new Map(campaign.locations.map((l) => [l.id, l]));

  const onNewEvent = () => {
    const id = crypto.randomUUID();
    const orderNum = Math.max(0, ...campaign.events.map((e) => e.orderNum)) + 1;
    createEntity("events", id, { title: "Untitled event", orderNum })
      .then(() => onOpenEntity(id))
      .catch(console.error);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1, maxWidth: 860 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>Chronicle of Events</h1>
          <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {events.length} {events.length === 1 ? "moment" : "moments"} the world remembers
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            {events.length > 1 && (
              <select
                className="facet-select"
                value={order}
                onChange={(e) => setOrder(e.target.value as ChronicleOrder)}
                title="Order the chronicle"
                aria-label="Order the chronicle"
              >
                {CHRONICLE_ORDERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {canEdit && (
              <button onClick={onNewEvent} className="cleanup-link-btn">
                + new event
              </button>
            )}
          </div>
        </div>
        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        {groups.map((group, gi) => (
          <section key={gi} style={{ marginTop: 26 }}>
            <div style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 12, color: "var(--ink-secondary)" }}>
              ✦ {group.date.toUpperCase()} ✦
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10, borderLeft: "1px solid var(--ink-ghost)", paddingLeft: 18 }}>
              {group.events.map((ev) => {
                const session = ev.session ? sessionsById.get(ev.session) : undefined;
                const location = ev.location ? locationsById.get(ev.location) : undefined;
                const participants = campaign.eventParticipants[ev.id]?.length ?? 0;
                const summary = excerpt(ev.summary);
                return (
                  <div
                    key={ev.id}
                    onClick={() => onOpenEntity(ev.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ color: "var(--bloodred)", marginLeft: -25, background: "var(--vellum)", lineHeight: 1 }}>
                        <Icon name="sparkle" size={13} />
                      </span>
                      <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19, color: "var(--ink)" }}>
                        {ev.title}
                      </h3>
                      <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 10.5, color: "var(--ink-secondary)" }}>
                        {session && sessionLabel(session.num)}
                        {location && `${session ? " · " : ""}${location.name}`}
                        {participants > 0 && ` · ${participants} present`}
                      </span>
                    </div>
                    {summary && (
                      <p style={{ margin: "3px 0 0", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--ink-body)" }}>
                        {summary}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {events.length === 0 && (
          <p style={{ marginTop: 30, fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 15, color: "var(--ink-faded)" }}>
            Nothing of note has been chronicled yet.
          </p>
        )}
      </div>
    </div>
  );
}
