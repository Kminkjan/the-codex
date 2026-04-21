import { useMemo, useRef, useState } from "react";
import { type KindKey, entityLabel, isArchivableKind, isArchived, isPinned } from "./data";
import { Icon, kindIcon } from "./icons";
import { StatusChip, EditableText, EnumSelect } from "./components";
import { useCampaign, useFindEntity } from "./hooks";
import { useAuth } from "./auth";
import {
  insertPartyNote,
  updateEntity,
  deleteEntity,
  insertConnection,
} from "./mutations";
import { uploadEntityImage, type UploadableKind } from "./upload";

const UPLOADABLE_KINDS = ["people", "locations", "factions", "items"] as const;
const isUploadable = (k: KindKey): k is UploadableKind =>
  (UPLOADABLE_KINDS as readonly string[]).includes(k);

const chipStyle: React.CSSProperties = {
  background: "var(--vellum-light)",
  color: "var(--ink)",
  border: "1px solid var(--ink)",
  fontFamily: "var(--font-fell-sc)",
  letterSpacing: ".1em",
  fontSize: 11,
  lineHeight: 1.2,
  padding: "4px 9px",
  boxShadow: "0 1px 2px rgba(0,0,0,.35)",
  cursor: "pointer",
};

function PortraitFallback({ kind }: { kind: KindKey }) {
  if (kind === "people") return <span className="silhouette" />;
  return (
    <div style={{ position: "absolute", inset: 6, border: "1px solid var(--ink-faded)", display: "grid", placeItems: "center", color: "var(--ink)" }}>
      <Icon name={kindIcon[kind]} size={48} strokeWidth={1.2} />
    </div>
  );
}

function EntityPortrait({
  kind,
  entityId,
  imageUrl,
  label,
  onSave,
}: {
  kind: UploadableKind;
  entityId: string;
  imageUrl: string | undefined;
  label: string;
  onSave: (url: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const pick = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadEntityImage(file, kind, entityId);
      onSave(url);
    } catch (err: any) {
      console.error("uploadEntityImage failed", err);
      window.alert(err?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    if (!window.confirm("Remove this image?")) return;
    onSave(null);
  };

  const hiddenInput = (
    <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
  );

  if (!imageUrl) {
    return (
      <button
        type="button"
        onClick={pick}
        disabled={uploading}
        className="sb-portrait portrait-empty"
        style={{ background: "var(--paper-tan)", padding: 0, cursor: uploading ? "wait" : "pointer" }}
      >
        <PortraitFallback kind={kind} />
        <div className="portrait-caption">
          {uploading ? "Uploading…" : "Click to add portrait"}
        </div>
        {hiddenInput}
      </button>
    );
  }

  return (
    <div className="sb-portrait">
      <img src={imageUrl} alt={label} className="sb-portrait-img" />
      {hiddenInput}
      <div className={uploading ? "portrait-chips is-uploading" : "portrait-chips"}>
        <button onClick={pick} disabled={uploading} style={chipStyle}>
          {uploading ? "Uploading…" : "Replace"}
        </button>
        {!uploading && (
          <button onClick={clear} title="Remove image" style={{ ...chipStyle, padding: "4px 8px", fontSize: 12 }}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

const STATUS_OPTIONS = ["whispered", "pursuing", "resolved", "lost"] as const;
const DISPOSITION_OPTIONS = ["ally", "neutral", "wary", "hostile"] as const;

function AddRelationForm({ fromId }: { fromId: string }) {
  const campaign = useCampaign();
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const allOptions = useMemo(
    () => [
      ...campaign.people.map((p) => ({ id: p.id, label: p.name, kind: "people" })),
      ...campaign.locations.map((l) => ({ id: l.id, label: l.name, kind: "locations" })),
      ...campaign.quests.map((q) => ({ id: q.id, label: q.title, kind: "quests" })),
      ...campaign.goals.map((g) => ({ id: g.id, label: g.text, kind: "goals" })),
      ...campaign.factions.map((f) => ({ id: f.id, label: f.name, kind: "factions" })),
      ...campaign.items.map((i) => ({ id: i.id, label: i.name, kind: "items" })),
      ...campaign.lore.map((l) => ({ id: l.id, label: l.title, kind: "lore" })),
      ...campaign.sessions.map((s) => ({ id: s.id, label: s.title, kind: "sessions" })),
    ].filter((o) => o.id !== fromId),
    [campaign, fromId],
  );

  const submit = async () => {
    if (!targetId || !label.trim() || saving) return;
    setSaving(true);
    try {
      await insertConnection(fromId, targetId, label.trim());
      setTargetId("");
      setLabel("");
    } catch (e) {
      console.error("insertConnection failed", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
        style={{
          background: "transparent",
          border: "1px dashed var(--ink-ghost)",
          fontFamily: "var(--font-fell)", fontSize: 12, color: "var(--ink)",
          padding: "6px 8px", cursor: "pointer",
        }}
      >
        <option value="">— pick an entity —</option>
        {allOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.kind}: {o.label}</option>
        ))}
      </select>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        placeholder="How are they linked? (e.g. ally of, resides at)"
        style={{
          background: "transparent",
          border: "1px dashed var(--ink-ghost)",
          fontFamily: "var(--font-fell)", fontSize: 12, color: "var(--ink)",
          padding: "6px 8px",
        }}
      />
      <button
        onClick={submit}
        disabled={!targetId || !label.trim() || saving}
        style={{
          background: "var(--ink)", color: "var(--vellum-light)",
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".2em", fontSize: 10,
          padding: "6px 10px", border: "none",
          cursor: (!targetId || !label.trim()) ? "not-allowed" : "pointer",
          opacity: (!targetId || !label.trim()) ? 0.5 : 1,
        }}
      >
        {saving ? "Pinning…" : "Pin the string"}
      </button>
    </div>
  );
}

// Which UI field holds the primary label (title vs name vs text) per kind.
const primaryField: Record<KindKey, string> = {
  people: "name",
  locations: "name",
  factions: "name",
  items: "name",
  quests: "title",
  lore: "title",
  sessions: "title",
  goals: "text",
};

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
  const { displayName } = useAuth();

  const notes = campaign.notes[entityId] || [];

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
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

  const patch = (fields: Record<string, unknown>) =>
    updateEntity(kind, entityId, fields).catch((e) =>
      console.error(`updateEntity(${kind}) failed`, e),
    );

  const onDelete = () => {
    if (!entity) return;
    const label = entityLabel(entity);
    if (!window.confirm(`Strike "${label}" from the codex? This cannot be undone.`)) return;
    deleteEntity(kind, entityId)
      .then(() => onClose())
      .catch((e) => console.error("deleteEntity failed", e));
  };

  const addNote = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await insertPartyNote(entityId, {
        author: displayName || "Anonymous",
        when: "Just now",
        text,
        hand: true,
      });
      setDraft("");
      if (draftRef.current) draftRef.current.textContent = "";
    } catch (e) {
      console.error("insertPartyNote failed", e);
    } finally {
      setSaving(false);
    }
  };

  const kindTitle: Record<string, string> = {
    people: "Person of Note", locations: "Location", quests: "Quest",
    goals: "Goal", factions: "Faction", items: "Item", lore: "Lore", sessions: "Session",
  };

  return (
    <div className="detail-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`detail-sheet tex-vellum ${isArchived(entity) ? "is-archived" : ""}`}>
        <button className="detail-close" onClick={onClose}><Icon name="close" size={16} /></button>
        <div style={{ position: "absolute", top: 14, right: 54, display: "flex", gap: 6, zIndex: 2 }}>
          {isArchivableKind(kind) && (
            <>
              <button
                onClick={() => patch({ pinned: !isPinned(entity) })}
                title={isPinned(entity) ? "Unpin from top of lists" : "Pin to top of lists"}
                className="detail-action-btn"
                style={isPinned(entity) ? { borderColor: "var(--mustard)", color: "#6e5018" } : undefined}
              >
                {isPinned(entity) ? "★ PINNED" : "☆ PIN"}
              </button>
              <button
                onClick={() => patch({ archived: !isArchived(entity) })}
                title={isArchived(entity) ? "Restore to active codex" : "Hide from default view"}
                className="detail-action-btn"
                style={isArchived(entity) ? { borderColor: "var(--ink)", color: "var(--ink)" } : undefined}
              >
                {isArchived(entity) ? "⤴ UNARCHIVE" : "⤵ ARCHIVE"}
              </button>
            </>
          )}
          <button
            onClick={onDelete}
            title="Strike from the codex"
            className="detail-action-btn"
            style={{ color: "var(--bloodred)" }}
          >
            ✕ STRIKE
          </button>
        </div>
        <div className="detail-sheet-inner">

          <div className="statblock">
            {isUploadable(kind) ? (
              <EntityPortrait
                kind={kind}
                entityId={entityId}
                imageUrl={(entity as any).imageUrl}
                label={entityLabel(entity)}
                onSave={(url) => patch({ imageUrl: url })}
              />
            ) : (
              <div className="sb-portrait" style={{ background: "var(--paper-tan)" }}>
                <PortraitFallback kind={kind} />
              </div>
            )}
            <div className="sb-meta">
              <div className="sb-kind">✦ {kindTitle[kind] || kind} ✦</div>
              <EditableText
                className="sb-title"
                value={(entity as any)[primaryField[kind]] ?? ""}
                onSave={(v) => patch({ [primaryField[kind]]: v })}
                placeholder="Untitled"
              />
              {kind === "people" && (
                <EditableText
                  className="sb-epithet"
                  value={(entity as any).epithet ?? ""}
                  onSave={(v) => patch({ epithet: v })}
                  placeholder="— an epithet —"
                />
              )}
              {kind === "goals" && (
                <div className="sb-epithet">— <EditableText
                  value={(entity as any).owner ?? ""}
                  onSave={(v) => patch({ owner: v })}
                  placeholder="borne by…"
                  style={{ display: "inline" }}
                /> —</div>
              )}

              <div className="sb-stats">
                {kind === "people" && (
                  <>
                    <div className="stat"><div className="stat-label">Race</div><div className="stat-value">{(entity as any).race}</div></div>
                    <div className="stat"><div className="stat-label">Role</div><div className="stat-value" style={{ fontSize: 14 }}>{(entity as any).role}</div></div>
                    <div className="stat"><div className="stat-label">Disposition</div><div className="stat-value" style={{ textTransform: "capitalize" }}>{(entity as any).disposition}</div></div>
                    <div className="stat"><div className="stat-label">Alignment</div><div className="stat-value" style={{ fontSize: 13 }}>{(entity as any).alignment}</div></div>
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

              {"notes" in (entity as any) && (
                <div className="long-note">
                  <p><em>From the party's record —</em></p>
                  <EditableText
                    multiline
                    value={(entity as any).notes ?? ""}
                    onSave={(v) => patch({ notes: v })}
                    placeholder="Write the party's record…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

              {("text" in (entity as any)) && kind !== "goals" && (
                <div className="long-note">
                  <EditableText
                    multiline
                    value={(entity as any).text ?? ""}
                    onSave={(v) => patch({ text: v })}
                    placeholder="The lore unfolds…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

              {("desc" in (entity as any)) && kind !== "people" && (
                <div className="long-note">
                  <EditableText
                    multiline
                    value={(entity as any).desc ?? ""}
                    onSave={(v) => patch({ desc: v })}
                    placeholder="Describe this…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

              {kind === "quests" && (
                <div className="long-note" style={{ marginTop: 14, padding: "10px 14px", borderLeft: "3px solid var(--bloodred)", background: "rgba(138,42,31,.06)" }}>
                  <em>Warning, given at handoff:</em>{" "}
                  <EditableText
                    multiline
                    value={(entity as any).hooks ?? ""}
                    onSave={(v) => patch({ hooks: v })}
                    placeholder="(no warning given)"
                    style={{ display: "inline" }}
                  />
                </div>
              )}

              {(kind === "quests" || kind === "goals") && (
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-fell-sc)", fontSize: 11, letterSpacing: ".2em", color: "var(--ink-faded)" }}>
                  STATUS
                  <EnumSelect
                    value={(entity as any).status}
                    options={STATUS_OPTIONS}
                    allowClear
                    onSave={(v) => patch({ status: v })}
                  />
                  <StatusChip status={(entity as any).status} />
                </div>
              )}

              {kind === "people" && (
                <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-fell-sc)", fontSize: 11, letterSpacing: ".2em", color: "var(--ink-faded)" }}>
                  DISPOSITION
                  <EnumSelect
                    value={(entity as any).disposition}
                    options={DISPOSITION_OPTIONS}
                    allowClear
                    onSave={(v) => patch({ disposition: v })}
                  />
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
              <div style={{ fontFamily: "var(--font-fell-sc)", fontSize: 11, letterSpacing: ".16em", color: "var(--ink-faded)", marginBottom: 14 }}>
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
                <AddRelationForm fromId={entityId} />
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
