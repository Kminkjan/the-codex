import { useMemo, useRef, useState } from "react";
import { type KindKey, entityLabel, isArchivableKind, isArchived, isPinned } from "./data";
import { Icon, kindIcon } from "./icons";
import { StatusChip, EditableText, EditableMarkdown, EnumSelect, EntitySelect, EntityCombobox } from "./components";
import { useCampaign, useFindEntity } from "./hooks";
import { useAuth } from "./auth";
import {
  insertPartyNote,
  updateEntity,
  deleteEntity,
  insertConnection,
  addEventParticipant,
  removeEventParticipant,
  markSeen,
  unmarkSeen,
} from "./mutations";
import { uploadEntityImage, type UploadableKind } from "./upload";
import { deriveRelations } from "./relations";

const UPLOADABLE_KINDS = ["people", "locations", "factions", "items", "sessions"] as const;
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

// A stat box must earn its slot: for read-only viewers an empty stat is pure
// noise ("Race —"), so it vanishes; editors keep it as the click-to-fill
// affordance. Pass `empty` from the underlying field.
function Stat({ label, empty, span, valueStyle, children }: {
  label: string;
  empty?: boolean;
  span?: 2 | 3;
  valueStyle?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const { canEdit } = useAuth();
  if (empty && !canEdit) return null;
  return (
    <div className="stat" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueStyle}>{children}</div>
    </div>
  );
}

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
  const { canEdit } = useAuth();
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
    if (!canEdit) {
      return (
        <div className="sb-portrait" style={{ background: "var(--paper-tan)" }}>
          <PortraitFallback kind={kind} />
        </div>
      );
    }
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
      {canEdit && (
        <>
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
        </>
      )}
    </div>
  );
}

const STATUS_OPTIONS = ["whispered", "pursuing", "resolved", "lost"] as const;
const DISPOSITION_OPTIONS = ["ally", "neutral", "wary", "hostile"] as const;

// Integer-only EditableText: non-numeric input is rejected (no write, the
// display reverts on blur), matching sessions.num being NOT NULL integer.
function EditableNumber({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  return (
    <EditableText
      value={String(value).padStart(2, "0")}
      onSave={(v) => {
        const trimmed = v.trim();
        if (!/^\d+$/.test(trimmed)) return false;
        const n = Number.parseInt(trimmed, 10);
        if (n === value) return false; // no-op edit; revert to padded display
        onSave(n);
      }}
    />
  );
}

function AddRelationForm({ fromId }: { fromId: string }) {
  const campaign = useCampaign();
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const allOptions = useMemo(
    () => [
      ...campaign.people.map((p) => ({ id: p.id, label: p.name, kind: "people" as const })),
      ...campaign.locations.map((l) => ({ id: l.id, label: l.name, kind: "locations" as const })),
      ...campaign.quests.map((q) => ({ id: q.id, label: q.title, kind: "quests" as const })),
      ...campaign.goals.map((g) => ({ id: g.id, label: g.text, kind: "goals" as const })),
      ...campaign.factions.map((f) => ({ id: f.id, label: f.name, kind: "factions" as const })),
      ...campaign.items.map((i) => ({ id: i.id, label: i.name, kind: "items" as const })),
      ...campaign.lore.map((l) => ({ id: l.id, label: l.title, kind: "lore" as const })),
      ...campaign.sessions.map((s) => ({ id: s.id, label: s.title, kind: "sessions" as const })),
      ...campaign.arcs.map((a) => ({ id: a.id, label: a.title, kind: "arcs" as const })),
      ...campaign.events.map((e) => ({ id: e.id, label: e.title, kind: "events" as const })),
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
      <EntityCombobox
        value={targetId || undefined}
        options={allOptions}
        onSelect={(id) => setTargetId(id ?? "")}
        placeholder="Search entities…"
        style={{ fontSize: 12, padding: "6px 8px" }}
      />
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
  arcs: "title",
  events: "title",
  goals: "text",
};

// "Those Present" — the event_participants junction, editable in the rail.
// Owns participant display for events, so the related-rail never also
// synthesizes these people (that would duplicate the chips).
function EventParticipantsEditor({ eventId, onOpen }: { eventId: string; onOpen: (id: string) => void }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();
  const ids = campaign.eventParticipants[eventId] ?? [];
  const participants = ids
    .map((pid) => campaign.people.find((p) => p.id === pid))
    .filter((p): p is NonNullable<typeof p> => !!p);
  const available = campaign.people.filter((p) => !ids.includes(p.id));

  return (
    <div className="rail-section">
      <h4>Those Present</h4>
      {participants.map((p) => (
        <div key={p.id} className="rail-chip people" onClick={() => onOpen(p.id)}>
          <div className="rc-icon"><Icon name="people" size={14} /></div>
          <div style={{ flex: 1 }}>
            <div className="rc-name">{p.name}</div>
            <div className="rc-rel">was present</div>
          </div>
          {canEdit ? (
            <button
              title="No longer counted among those present"
              onClick={(e) => {
                e.stopPropagation();
                removeEventParticipant(eventId, p.id).catch(console.error);
              }}
              style={{
                background: "transparent", border: "none", cursor: "pointer",
                color: "var(--ink-secondary)", fontSize: 12, padding: "0 2px",
              }}
            >✕</button>
          ) : (
            <Icon name="chevron" size={12} />
          )}
        </div>
      ))}
      {participants.length === 0 && (
        <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 12, color: "var(--ink-ghost)" }}>
          No one is recorded at this event.
        </div>
      )}
      {canEdit && available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) addEventParticipant(eventId, e.target.value).catch(console.error);
          }}
          style={{
            marginTop: 6, width: "100%",
            background: "transparent",
            border: "1px dashed var(--ink-ghost)",
            fontFamily: "var(--font-fell)", fontSize: 12, color: "var(--ink)",
            padding: "6px 8px", cursor: "pointer",
          }}
        >
          <option value="">— record someone present —</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
    </div>
  );
}

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
  const { displayName, canEdit } = useAuth();

  const notes = campaign.notes[entityId] || [];

  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const draftRef = useRef<HTMLDivElement>(null);

  // Manual strings + FK relations (resides at / member of / quest giver /
  // happened at), unioned by the same selector the board reads — so the sheet
  // and the board can't drift. Session/arc/event/chapter links below aren't
  // board edges, so they stay derived inline here.
  const relations = useMemo(
    () => deriveRelations(campaign),
    [campaign.connections, campaign.people, campaign.quests, campaign.events],
  );

  if (!entity) return null;
  const kind = entity._kind as KindKey;

  const related: Record<string, Related[]> = {};
  relations.forEach((e) => {
    const other = e.a === entityId ? e.b : e.b === entityId ? e.a : null;
    if (!other) return;
    const ent = findEntity(other);
    if (!ent) return;
    const k = ent._kind as string;
    related[k] = related[k] || [];
    // Dedupe by (entity, label): parallel manual strings between the same pair
    // with different labels ("ally of" AND "owes a debt to") must both survive.
    if (!related[k].find((r) => r.entity.id === ent.id && r.rel === e.label)) {
      related[k].push({ entity: ent, rel: e.label });
    }
  });
  if ((entity as any).session || (entity as any).lastSeen) {
    const sid = (entity as any).session || (entity as any).lastSeen;
    const s = findEntity(sid);
    if (s) {
      related.sessions = related.sessions || [{
        entity: s,
        rel: kind === "events" ? "during" : (entity as any).session ? "introduced in" : "last seen in",
      }];
    }
  }
  if ((kind === "sessions" || kind === "quests") && (entity as any).arc) {
    const a = findEntity((entity as any).arc);
    if (a) {
      related.arcs = related.arcs || [];
      if (!related.arcs.find((r) => r.entity.id === a.id)) {
        related.arcs.push({ entity: a, rel: "part of arc" });
      }
    }
  }
  if (kind === "arcs") {
    // An arc's chapters: the sessions and quests that claim it.
    campaign.sessions.filter((s) => s.arc === entityId).forEach((s) => {
      related.sessions = related.sessions || [];
      if (!related.sessions.find((r) => r.entity.id === s.id)) {
        related.sessions.push({ entity: findEntity(s.id), rel: "chapter of this arc" });
      }
    });
    campaign.quests.filter((q) => q.arc === entityId).forEach((q) => {
      related.quests = related.quests || [];
      if (!related.quests.find((r) => r.entity.id === q.id)) {
        related.quests.push({ entity: findEntity(q.id), rel: "woven into this arc" });
      }
    });
  }
  // Event chips on the sheets an event touches.
  {
    const eventRel =
      kind === "people"
        ? (ev: any) => (campaign.eventParticipants[ev.id] ?? []).includes(entityId) && "took part in"
        : kind === "locations"
          ? (ev: any) => ev.location === entityId && "happened here"
          : kind === "sessions"
            ? (ev: any) => ev.session === entityId && "during this session"
            : null;
    if (eventRel) {
      // Array order isn't trustworthy after realtime splices — sort by orderNum.
      campaign.events.slice().sort((a, b) => a.orderNum - b.orderNum).forEach((ev) => {
        const rel = eventRel(ev);
        if (!rel) return;
        related.events = related.events || [];
        if (!related.events.find((r) => r.entity.id === ev.id)) {
          related.events.push({ entity: findEntity(ev.id), rel });
        }
      });
    }
  }

  const patch = (fields: Record<string, unknown>) =>
    updateEntity(kind, entityId, fields).catch((e) =>
      console.error(`updateEntity(${kind}) failed`, e),
    );

  const arcOptions = campaign.arcs
    .slice()
    .sort((a, b) => a.orderNum - b.orderNum)
    .map((a) => ({ id: a.id, label: a.title, kind: "arcs" as const }));
  const sessionOptions = campaign.sessions
    .map((s) => ({ id: s.id, label: `S${String(s.num).padStart(2, "0")} — ${s.title}`, kind: "sessions" as const }));
  const locationOptions = campaign.locations.map((l) => ({ id: l.id, label: l.name, kind: "locations" as const }));

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
    arcs: "Story Arc", events: "Event",
  };

  return (
    <div className="detail-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`detail-sheet tex-vellum ${isArchived(entity) ? "is-archived" : ""}`}>
        <button className="detail-close" onClick={onClose}><Icon name="close" size={16} /></button>
        {canEdit && <div style={{ position: "absolute", top: 14, right: 54, display: "flex", gap: 6, zIndex: 2 }}>
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
        </div>}
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
              {/* Viewers don't need a "— an epithet —" placeholder taking the
                  subtitle slot; editors keep it as the click-to-fill affordance. */}
              {kind === "people" && (canEdit || (entity as any).epithet?.trim()) && (
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
                    <Stat label="Race" empty={!(entity as any).race?.trim()}><EditableText value={(entity as any).race ?? ""} onSave={(v) => patch({ race: v })} placeholder="—" /></Stat>
                    <Stat label="Role" empty={!(entity as any).role?.trim()} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).role ?? ""} onSave={(v) => patch({ role: v })} placeholder="—" /></Stat>
                    <Stat label="Disposition" empty={!(entity as any).disposition} valueStyle={{ textTransform: "capitalize" }}><EnumSelect value={(entity as any).disposition} options={DISPOSITION_OPTIONS} allowClear onSave={(v) => patch({ disposition: v })} /></Stat>
                    <Stat label="Alignment" empty={!(entity as any).alignment?.trim()} valueStyle={{ fontSize: 13 }}><EditableText value={(entity as any).alignment ?? ""} onSave={(v) => patch({ alignment: v })} placeholder="—" /></Stat>
                  </>
                )}
                {kind === "locations" && (
                  <>
                    <Stat label="Kind" empty={!(entity as any).kind?.trim()}><EditableText value={(entity as any).kind ?? ""} onSave={(v) => (v.trim() ? patch({ kind: v }) : false)} placeholder="—" /></Stat>
                    <Stat label="Region" empty={!(entity as any).region?.trim()} valueStyle={{ fontSize: 13 }}><EditableText value={(entity as any).region ?? ""} onSave={(v) => patch({ region: v })} placeholder="—" /></Stat>
                    <Stat label="Ruler" empty={!(entity as any).ruler?.trim()} span={2} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).ruler ?? ""} onSave={(v) => patch({ ruler: v })} placeholder="Unclaimed" /></Stat>
                  </>
                )}
                {kind === "quests" && (
                  <>
                    <Stat label="Status" empty={!(entity as any).status}>{canEdit ? <EnumSelect value={(entity as any).status} options={STATUS_OPTIONS} allowClear onSave={(v) => patch({ status: v })} /> : <StatusChip status={(entity as any).status} />}</Stat>
                    <Stat label="Reward" empty={!(entity as any).reward?.trim()} span={2} valueStyle={{ fontSize: 13 }}><EditableText value={(entity as any).reward ?? ""} onSave={(v) => patch({ reward: v })} placeholder="—" /></Stat>
                    <Stat label="Session" empty={!(entity as any).session}>{(() => {
                      const s = campaign.sessions.find((x) => x.id === (entity as any).session);
                      return s ? `Sess ${s.num}` : (entity as any).session?.toUpperCase();
                    })()}</Stat>
                    <Stat label="Arc" empty={!(entity as any).arc} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).arc} options={arcOptions} allowClear onSave={(id) => patch({ arc: id ?? "" })} /></Stat>
                  </>
                )}
                {kind === "goals" && (
                  <>
                    <Stat label="Kind" empty={!(entity as any).kind?.trim()}><EditableText value={(entity as any).kind ?? ""} onSave={(v) => patch({ kind: v })} placeholder="—" /></Stat>
                    <Stat label="Status" empty={!(entity as any).status}>{canEdit ? <EnumSelect value={(entity as any).status} options={STATUS_OPTIONS} allowClear onSave={(v) => patch({ status: v })} /> : <StatusChip status={(entity as any).status} />}</Stat>
                    <Stat label="Borne By" empty={!(entity as any).owner?.trim()} span={2} valueStyle={{ fontSize: 13 }}>{(entity as any).owner}</Stat>
                  </>
                )}
                {kind === "factions" && (
                  <>
                    <Stat label="Sigil" empty={!(entity as any).sigil?.trim()}><EditableText value={(entity as any).sigil ?? ""} onSave={(v) => patch({ sigil: v })} placeholder="—" /></Stat>
                    <Stat label="Stance" empty={!(entity as any).allegiance?.trim()}><EditableText value={(entity as any).allegiance ?? ""} onSave={(v) => patch({ allegiance: v })} placeholder="—" /></Stat>
                  </>
                )}
                {kind === "items" && (
                  <Stat label="Kind" empty={!(entity as any).kind?.trim()}><EditableText value={(entity as any).kind ?? ""} onSave={(v) => patch({ kind: v })} placeholder="—" /></Stat>
                )}
                {kind === "sessions" && (
                  <>
                    <Stat label="No."><EditableNumber value={(entity as any).num ?? 0} onSave={(n) => patch({ num: n })} /></Stat>
                    <Stat label="Date" empty={!(entity as any).date?.trim()} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).date ?? ""} onSave={(v) => patch({ date: v })} placeholder="—" /></Stat>
                    <Stat label="Reckoning" empty={!(entity as any).inGameDate?.trim()} span={2} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).inGameDate ?? ""} onSave={(v) => patch({ inGameDate: v })} placeholder="— by Faerûn's reckoning —" /></Stat>
                    <Stat label="Arc" empty={!(entity as any).arc} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).arc} options={arcOptions} allowClear onSave={(id) => patch({ arc: id ?? "" })} /></Stat>
                  </>
                )}
                {kind === "arcs" && (
                  <>
                    <Stat label="First Session" empty={!(entity as any).startSession} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).startSession} options={sessionOptions} allowClear onSave={(id) => patch({ startSession: id ?? "" })} /></Stat>
                    <Stat label="Last Session" empty={!(entity as any).endSession} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).endSession} options={sessionOptions} allowClear onSave={(id) => patch({ endSession: id ?? "" })} /></Stat>
                    <Stat label="Order"><EditableNumber value={(entity as any).orderNum ?? 0} onSave={(n) => patch({ orderNum: n })} /></Stat>
                  </>
                )}
                {kind === "events" && (
                  <>
                    <Stat label="Reckoning" empty={!(entity as any).inGameDate?.trim()} span={3} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).inGameDate ?? ""} onSave={(v) => patch({ inGameDate: v })} placeholder="— by Faerûn's reckoning —" /></Stat>
                    <Stat label="Order"><EditableNumber value={(entity as any).orderNum ?? 0} onSave={(n) => patch({ orderNum: n })} /></Stat>
                    <Stat label="Session" empty={!(entity as any).session} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).session} options={sessionOptions} allowClear onSave={(id) => patch({ session: id ?? "" })} /></Stat>
                    <Stat label="Location" empty={!(entity as any).location} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).location} options={locationOptions} allowClear onSave={(id) => patch({ location: id ?? "" })} /></Stat>
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
                    ✦ {kind === "events" ? "During" : "Introduced"} — Session {campaign.sessions.find((s) => s.id === (entity as any).session)?.num}
                  </span>
                )}
                {kind === "people" && canEdit && campaign.activeSessionId && (() => {
                  const activeNum = campaign.sessions.find((s) => s.id === campaign.activeSessionId)?.num;
                  const seen = (campaign.sessionParticipants[campaign.activeSessionId] ?? []).includes(entity.id);
                  return (
                    <button
                      className={"seen-toggle" + (seen ? " seen" : "")}
                      onClick={() => (seen ? unmarkSeen(entity.id) : markSeen(entity.id)).catch(console.error)}
                      title={seen ? `Marked seen in session ${activeNum} — click to remove` : `Mark seen in session ${activeNum}`}
                    >
                      {seen ? "✓ Seen this session" : "+ Seen this session"}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>

          <div className="detail-body">
            <div className="detail-notes">
              <h3>Chronicle</h3>

              {kind === "sessions" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="What happened this session…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

              {kind === "arcs" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="The shape of this arc…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

              {kind === "events" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="What came to pass…"
                    style={{ fontFamily: "var(--font-fell)" }}
                  />
                </div>
              )}

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

              <h3 style={{ marginTop: 28 }}>Party Notes</h3>
              <div className="notes-stack">
                {notes.length === 0 && (
                  <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", color: "var(--ink-secondary)", fontSize: 13 }}>
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

              {canEdit && <div
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
              </div>}
            </div>

            <div className="detail-rail">
              <div style={{ fontFamily: "var(--font-fell-sc)", fontSize: 11, letterSpacing: ".16em", color: "var(--ink-secondary)", marginBottom: 14 }}>
                ✦ RELATIONS ✦
              </div>

              {kind === "events" && <EventParticipantsEditor eventId={entityId} onOpen={onOpen} />}

              {(["people", "locations", "quests", "goals", "factions", "items", "lore", "sessions", "arcs", "events"] as const).map((k) => {
                const list = related[k];
                if (!list || list.length === 0) return null;
                const label: Record<string, string> = {
                  people: "Known Folk", locations: "Places", quests: "Quests",
                  goals: "Goals", factions: "Factions", items: "Items & Relics",
                  lore: "Lore", sessions: "Sessions", arcs: "Story Arcs", events: "Events",
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

              {canEdit && <div className="rail-section">
                <h4>Add Relation</h4>
                <AddRelationForm fromId={entityId} />
              </div>}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
