import { useMemo, useRef, useState } from "react";
import { type KindKey, entityLabel } from "./data";
import { Icon, kindIcon } from "./icons";
import { StatusChip } from "./components";
import { useCampaign, useFindEntity } from "./hooks";

interface DetailSheetProps {
  entityId: string;
  onClose: () => void;
  onOpen: (id: string) => void;
}

interface Related {
  entity: any;
  rel: string;
}

export function DetailSheet({ entityId, onClose, onOpen }: DetailSheetProps) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const entity = findEntity(entityId);

  const seeded = useMemo(() => campaign.notes[entityId] || [], [campaign.notes, entityId]);
  const [localNotes, setLocalNotes] = useState<typeof seeded>([]);
  const notes = [...seeded, ...localNotes];

  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLDivElement>(null);

  if (!entity) return null;
  const kind = entity._kind as KindKey;

  const related: Record<string, Related[]> = {};
  campaign.connections.forEach(([a, b, label]) => {
    let other: string | null = null;
    const rel = label;
    if (a === entityId) other = b;
    else if (b === entityId) other = a;
    if (!other) return;
    const e = findEntity(other);
    if (!e) return;
    const k = e._kind as string;
    related[k] = related[k] || [];
    related[k].push({ entity: e, rel });
  });

  if ((entity as any).location) {
    const loc = findEntity((entity as any).location);
    if (loc) {
      related.locations = related.locations || [];
      if (!related.locations.find((r) => r.entity.id === loc.id)) {
        related.locations.push({ entity: loc, rel: "resides at" });
      }
    }
  }
  if ((entity as any).faction) {
    const f = findEntity((entity as any).faction);
    if (f) {
      related.factions = related.factions || [];
      if (!related.factions.find((r) => r.entity.id === f.id)) {
        related.factions.push({ entity: f, rel: "member of" });
      }
    }
  }
  if ((entity as any).giver) {
    const g = findEntity((entity as any).giver);
    if (g) {
      related.people = related.people || [];
      if (!related.people.find((r) => r.entity.id === g.id)) {
        related.people.push({ entity: g, rel: "quest giver" });
      }
    }
  }
  if ((entity as any).session || (entity as any).lastSeen) {
    const sid = (entity as any).session || (entity as any).lastSeen;
    const s = findEntity(sid);
    if (s) {
      related.sessions = related.sessions || [{
        entity: s,
        rel: (entity as any).session ? "introduced in" : "last seen in",
      }];
    }
  }

  const addNote = () => {
    if (!draft.trim()) return;
    setLocalNotes((n) => [...n, { author: "You", when: "Just now", text: draft, hand: true }]);
    setDraft("");
  };

  const kindTitle: Record<string, string> = {
    people: "Person of Note", locations: "Location", quests: "Quest",
    goals: "Goal", factions: "Faction", items: "Item", lore: "Lore", sessions: "Session",
  };

  return (
    <div className="detail-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-sheet tex-vellum">
        <button className="detail-close" onClick={onClose}><Icon name="close" size={16} /></button>
        <div className="detail-sheet-inner">

          <div className="statblock">
            {kind === "people" ? (
              <div className="sb-portrait"><span className="silhouette" /></div>
            ) : (
              <div className="sb-portrait" style={{ background: "var(--paper-tan)" }}>
                <div style={{ position: "absolute", inset: 6, border: "1px solid var(--ink-faded)", display: "grid", placeItems: "center" }}>
                  <div style={{ color: "var(--ink)", textAlign: "center" }}>
                    <Icon name={kindIcon[kind]} size={48} strokeWidth={1.2} />
                  </div>
                </div>
              </div>
            )}
            <div className="sb-meta">
              <div className="sb-kind">✦ {kindTitle[kind] || kind} ✦</div>
              <div className="sb-title">{entityLabel(entity)}</div>
              {(entity as any).epithet && <div className="sb-epithet">— {(entity as any).epithet} —</div>}
              {(entity as any).desc && !(entity as any).epithet && <div className="sb-epithet">{(entity as any).desc}</div>}
              {(entity as any).owner && <div className="sb-epithet">— {(entity as any).owner} —</div>}

              <div className="sb-stats">
                {kind === "people" && (
                  <>
                    <div className="stat"><div className="stat-label">Race</div><div className="stat-value">{(entity as any).race}</div></div>
                    <div className="stat"><div className="stat-label">Role</div><div className="stat-value" style={{ fontSize: 14 }}>{(entity as any).role}</div></div>
                    <div className="stat"><div className="stat-label">Disposition</div><div className="stat-value" style={{ textTransform: "capitalize" }}>{(entity as any).disposition}</div></div>
                    <div className="stat"><div className="stat-label">Alignment</div><div className="stat-value" style={{ fontSize: 12 }}>{(entity as any).alignment}</div></div>
                  </>
                )}
                {kind === "locations" && (
                  <>
                    <div className="stat"><div className="stat-label">Kind</div><div className="stat-value">{(entity as any).kind}</div></div>
                    <div className="stat"><div className="stat-label">Region</div><div className="stat-value" style={{ fontSize: 13 }}>{(entity as any).region}</div></div>
                    <div className="stat" style={{ gridColumn: "span 2" }}><div className="stat-label">Ruler</div><div className="stat-value" style={{ fontSize: 14 }}>{(entity as any).ruler || "Unclaimed"}</div></div>
                  </>
                )}
                {kind === "quests" && (
                  <>
                    <div className="stat"><div className="stat-label">Status</div><div className="stat-value"><StatusChip status={(entity as any).status} /></div></div>
                    <div className="stat" style={{ gridColumn: "span 2" }}><div className="stat-label">Reward</div><div className="stat-value" style={{ fontSize: 13 }}>{(entity as any).reward}</div></div>
                    <div className="stat"><div className="stat-label">Session</div><div className="stat-value">{(entity as any).session?.toUpperCase()}</div></div>
                  </>
                )}
                {kind === "goals" && (
                  <>
                    <div className="stat"><div className="stat-label">Kind</div><div className="stat-value">{(entity as any).kind}</div></div>
                    <div className="stat"><div className="stat-label">Status</div><div className="stat-value"><StatusChip status={(entity as any).status} /></div></div>
                    <div className="stat" style={{ gridColumn: "span 2" }}><div className="stat-label">Borne By</div><div className="stat-value" style={{ fontSize: 13 }}>{(entity as any).owner}</div></div>
                  </>
                )}
                {kind === "factions" && (
                  <>
                    <div className="stat"><div className="stat-label">Sigil</div><div className="stat-value">{(entity as any).sigil}</div></div>
                    <div className="stat"><div className="stat-label">Stance</div><div className="stat-value">{(entity as any).allegiance}</div></div>
                  </>
                )}
                {kind === "items" && (
                  <>
                    <div className="stat"><div className="stat-label">Kind</div><div className="stat-value">{(entity as any).kind}</div></div>
                  </>
                )}
                {kind === "sessions" && (
                  <>
                    <div className="stat"><div className="stat-label">No.</div><div className="stat-value">{String((entity as any).num).padStart(2, "0")}</div></div>
                    <div className="stat" style={{ gridColumn: "span 3" }}><div className="stat-label">Date</div><div className="stat-value" style={{ fontSize: 14 }}>{(entity as any).date}</div></div>
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {(entity as any).lastSeen && (
                  <span className="session-ribbon">
                    ✦ Last seen — Session {campaign.sessions.find((s) => s.id === (entity as any).lastSeen)?.num}
                  </span>
                )}
                {(entity as any).session && (
                  <span className="session-ribbon">
                    ✦ Introduced — Session {campaign.sessions.find((s) => s.id === (entity as any).session)?.num}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="detail-body">
            <div className="detail-notes">
              <h3>Chronicle</h3>
              {(entity as any).notes && (
                <div className="long-note">
                  <p><em>From the party's record —</em></p>
                  <p>{(entity as any).notes}</p>
                </div>
              )}
              {(entity as any).text && <div className="long-note"><p>{(entity as any).text}</p></div>}
              {(entity as any).desc && kind !== "people" && (
                <div className="long-note"><p>{(entity as any).desc}</p></div>
              )}
              {(entity as any).hooks && (
                <div className="long-note" style={{ marginTop: 14, padding: "10px 14px", borderLeft: "3px solid var(--bloodred)", background: "rgba(138,42,31,.06)" }}>
                  <p style={{ margin: 0 }}><em>Warning, given at handoff:</em> {(entity as any).hooks}</p>
                </div>
              )}

              <h3 style={{ marginTop: 28 }}>Party Notes</h3>
              <div className="notes-stack">
                {notes.length === 0 && (
                  <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", color: "var(--ink-faded)", fontSize: 13 }}>
                    No notes yet. The margin waits.
                  </div>
                )}
                {notes.map((n, i) => (
                  <div key={i}
                       className={`note-scrap ${n.hand ? "" : "typed"}`}
                       style={{ transform: `rotate(${((i * 37) % 5 - 2) * 0.4}deg)` }}
                  >
                    <div>{n.text}</div>
                    <div className="meta">
                      <span>— {n.author}</span>
                      <span>{n.when}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="add-note"
                contentEditable
                suppressContentEditableWarning
                ref={draftRef}
                onInput={(e) => setDraft(e.currentTarget.textContent || "")}
                onBlur={addNote}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    addNote();
                    (e.currentTarget as HTMLDivElement).textContent = "";
                  }
                }}
              >
                {draft ? null : "Leave a note in the margin… (⌘↵ to pin)"}
              </div>
            </div>

            <div className="detail-rail">
              <div style={{ fontFamily: "var(--font-fell-sc)", fontSize: 10, letterSpacing: ".2em", color: "var(--ink-faded)", marginBottom: 14 }}>
                ✦ RELATIONS ✦
              </div>

              {(["people", "locations", "quests", "goals", "factions", "items", "lore", "sessions"] as const).map((k) => {
                const list = related[k];
                if (!list || list.length === 0) return null;
                const label: Record<string, string> = {
                  people: "Known Folk", locations: "Places", quests: "Quests",
                  goals: "Goals", factions: "Factions", items: "Items & Relics",
                  lore: "Lore", sessions: "Sessions",
                };
                return (
                  <div className="rail-section" key={k}>
                    <h4>{label[k]}</h4>
                    {list.map((r, i) => (
                      <div key={i} className={`rail-chip ${k}`} onClick={() => onOpen(r.entity.id)}>
                        <div className="rc-icon"><Icon name={kindIcon[k]} size={14} /></div>
                        <div style={{ flex: 1 }}>
                          <div className="rc-name">{entityLabel(r.entity)}</div>
                          <div className="rc-rel">{r.rel}</div>
                        </div>
                        <Icon name="chevron" size={12} />
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="rail-section">
                <h4>Add Relation</h4>
                <div className="rail-chip" style={{ borderLeftColor: "var(--ink-ghost)", borderStyle: "dashed", cursor: "pointer" }}>
                  <div className="rc-icon" style={{ background: "transparent", border: "1px dashed var(--ink-ghost)" }}><Icon name="plus" size={12} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="rc-name" style={{ color: "var(--ink-faded)", fontStyle: "italic" }}>Link another entity…</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
