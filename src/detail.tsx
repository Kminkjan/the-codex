import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ARCHIVABLE_KINDS, type KindKey, MONSTER_THREAT_OPTIONS, PERSON_STATUS_OPTIONS, PERSON_TIER_OPTIONS, bothVisible, entityLabel, isArchivableKind, isArchived, isHidden, isPc, isPinned, isVisible, personTier, sessionFeedToMarkdown, sessionLabel } from "./data";
import { Icon, kindIcon } from "./icons";
import { StatusChip, EditableText, EditableMarkdown, EnumSelect, EntitySelect, EntityCombobox, type EntityOption, Fleurons, NoteComposer, ThemedLabel } from "./components";
import { clearDraft, entityDraftKey } from "./noteDrafts";
import { useAuthorName, useCampaign, useFindEntity, useIsDm, usePresence, useProfiles } from "./hooks";
import { useAuth } from "./auth";
import {
  insertPartyNote,
  updateEntity,
  setEntityImage,
  updateDmNotes,
  deleteEntity,
  insertConnection,
  deleteConnectionBetween,
  addEventParticipant,
  removeEventParticipant,
  markSeen,
  unmarkSeen,
  markAttended,
  markAbsent,
  stageEntity,
  unstageEntity,
  releaseEntity,
  showEntity,
  upsertBoardPosition,
  deleteBoardPosition,
} from "./mutations";
import { findFreeSpot } from "./boardLayout";
import { PlateLightbox } from "./bestiary";
import { crLabel, crToThreat, parseCr } from "./monsters";
import { FeedRow } from "./livePanel";
import { uploadEntityImage, type UploadableKind } from "./upload";
import { deriveRelations } from "./relations";
import {
  CENTER,
  MAX_ZOOM,
  MIN_ZOOM,
  focusFromPoint,
  focusImageStyle,
  isDefaultFocus,
  nudgeFocus,
  parseFocus,
  serializeFocus,
  zoomFocus,
  type Focus,
} from "./imageFocus";

const UPLOADABLE_KINDS = ["people", "locations", "factions", "items", "monsters", "sessions"] as const;
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

// ---------------------------------------------------------------------------
// Reframe: place an image's focal point so `object-fit: cover` stops cropping
// through faces. One point per image serves every crop box in the app — see the
// header of src/imageFocus.ts for why that works and scripts/focus-check.ts for
// what it guarantees.
//
// Portalled to <body> for PlateLightbox's reasons: it has to escape the detail
// sheet's overflow container and backdrop-filter. Not folded into that
// component, though — the plate is a viewing surface with a zoom-out cursor and
// a click-anywhere-to-close backdrop, and both of those are exactly wrong for a
// surface whose whole job is receiving a precise click.
// ---------------------------------------------------------------------------
function ReframeOverlay({
  imageUrl,
  imageFocus,
  label,
  onSave,
  onClose,
}: {
  imageUrl: string;
  imageFocus: string | undefined;
  label: string;
  /** Receives a value for image_focus: a serialized point, or "" to clear it. */
  onSave: (value: string) => void;
  onClose: () => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  // An uncommitted edit buffer, not mirrored DB state — the same category as
  // EditableText's contentEditable, and the reason the no-local-state rule
  // doesn't apply. Nothing outside this overlay reads it, and it dies on close.
  const [focus, setFocus] = useState<Focus>(() => parseFocus(imageFocus) ?? CENTER);

  // Esc closes the editor and only the editor, in the capture phase, for the
  // reason spelled out in PlateLightbox: the detail sheet's own bubble-phase Esc
  // listener was registered first, so registration order alone would close the
  // sheet out from under an open overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // The rect of the <img> itself — .reframe-img is sized by max-width/max-height
  // with no padding, so its box is the artwork's box and focusFromPoint needs no
  // letterbox arithmetic.
  const aim = (clientX: number, clientY: number) => {
    const el = imgRef.current;
    if (!el) return;
    // Zoom is carried through: aiming and zooming are separate gestures, and a
    // click after zooming must move the point, not reset the tightness.
    setFocus((f) => focusFromPoint(el.getBoundingClientRect(), clientX, clientY, f.z));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture on the stage, so a drag that wanders off the artwork keeps
    // delivering moves here (clamped) instead of being swallowed by the scrim.
    e.currentTarget.setPointerCapture(e.pointerId);
    aim(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    aim(e.clientX, e.clientY);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // +/- zoom, arrows aim. Both accept the bare and the shifted spellings the
    // key produces on different layouts (= and + are the same physical key).
    if (e.key === "+" || e.key === "=") { e.preventDefault(); setFocus((f) => zoomFocus(f, 0.1)); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); setFocus((f) => zoomFocus(f, -0.1)); return; }
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const move = d[e.key];
    if (!move) return;
    e.preventDefault();
    setFocus((f) => nudgeFocus(f, move[0], move[1], step));
  };

  // Zooming toward a point you can't see is guesswork, so the wheel zooms about
  // wherever the cursor is and moves the point there in the same gesture — the
  // one place aiming and zooming are deliberately fused, because it matches what
  // every map does. Passive listeners can't preventDefault, hence onWheel on a
  // non-passive React handler; the scrim behind has nothing to scroll anyway.
  const onWheel = (e: React.WheelEvent) => {
    const el = imgRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    setFocus((f) => {
      const next = focusFromPoint(rect, e.clientX, e.clientY, f.z + (e.deltaY < 0 ? 0.1 : -0.1));
      // Below 1x the point would drift while nothing visibly changes; hold it.
      return next.z === f.z ? f : next;
    });
  };

  // Dead centre at 1x is expressible as "no focus at all", and that is the value
  // worth storing: it keeps `null` meaning unframed for every untouched row
  // instead of scattering "50 50" through the tables to mean the same thing.
  // Identical render either way — the difference is only whether a row claims to
  // have been reframed. (toRow coerces "" → null on the way to the DB.)
  const value = isDefaultFocus(focus) ? "" : serializeFocus(focus);
  // The previews render through exactly the same helper as the five real
  // surfaces, so what you aim at is what ships — no second spelling to drift.
  const previewStyle = focusImageStyle(value);

  const preview = (w: number, h: number, caption: string) => (
    <div>
      <div className="reframe-preview" style={{ width: w, height: h }}>
        <img src={imageUrl} alt="" style={previewStyle} />
      </div>
      <div className="reframe-hint" style={{ marginTop: 5 }}>{caption}</div>
    </div>
  );

  return createPortal(
    <div className="reframe" role="dialog" aria-label={`Reframe ${label}`}>
      <div className="reframe-hint">
        <ThemedLabel
          parchment="Mark where the eye should fall, and how close. Every frame in the codex crops to it."
          atlas="Click or drag to set the focal point, then zoom. Every cropped view uses both."
        />
      </div>
      <div
        className="reframe-stage"
        tabIndex={0}
        role="application"
        aria-label="Focal point"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      >
        {/* The stage always shows the WHOLE artwork, unzoomed — it is the map you
            aim on, not a preview of the result. Scaling it here would hide the
            parts you might want to aim at next, and the tiles below already show
            the zoom truthfully. */}
        <img ref={imgRef} className="reframe-img" src={imageUrl} alt={label} draggable={false} />
        <span className="reframe-dot" style={{ left: `${focus.x}%`, top: `${focus.y}%` }} />
      </div>
      <label className="reframe-zoom">
        <span className="reframe-hint">
          <ThemedLabel parchment="Draw in" atlas="Zoom" />
        </span>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.1}
          value={focus.z}
          onChange={(e) => setFocus((f) => zoomFocus({ ...f, z: MIN_ZOOM }, Number(e.target.value) - MIN_ZOOM))}
          aria-label="Zoom toward the focal point"
        />
        {/* toFixed(1) so 1 reads as "1.0x" and the number doesn't change width as
            you drag — a jittering label makes a smooth slider feel broken. */}
        <span className="reframe-hint reframe-zoom-value">{focus.z.toFixed(1)}×</span>
      </label>
      {/* Squarest and widest of the boxes this point feeds; the 4:3 plate and the
          56px thumb fall between them. */}
      <div className="reframe-previews">
        {preview(96, 96, "1:1")}
        {preview(154, 96, "16:10")}
      </div>
      <div className="reframe-actions">
        <button onClick={() => onSave(value)} style={{ ...chipStyle, padding: "6px 14px" }}>
          <ThemedLabel parchment="Set the focus" atlas="Save" />
        </button>
        {/* Resets zoom as well as the point — "centre" means back to how an
            untouched image renders, which is the value Save then stores as NULL. */}
        <button onClick={() => setFocus(CENTER)} style={{ ...chipStyle, padding: "6px 14px" }}>
          <ThemedLabel parchment="Centre it" atlas="Reset" />
        </button>
        <button onClick={onClose} style={{ ...chipStyle, padding: "6px 14px" }}>
          <ThemedLabel parchment="Leave it be" atlas="Cancel" />
        </button>
      </div>
      <div className="reframe-hint">
        <ThemedLabel
          parchment="Arrow keys nudge · hold Shift for a longer step · scroll or +/− to draw in · Esc to leave"
          atlas="Arrow keys nudge · Shift for a bigger step · scroll or +/− to zoom · Esc to close"
        />
      </div>
    </div>,
    document.body,
  );
}

function EntityPortrait({
  kind,
  entityId,
  imageUrl,
  imageFocus,
  label,
  onSave,
  onSaveFocus,
  onZoom,
}: {
  kind: UploadableKind;
  entityId: string;
  imageUrl: string | undefined;
  imageFocus: string | undefined;
  label: string;
  onSave: (url: string | null) => void;
  onSaveFocus: (value: string) => void;
  // Optional "see it full size" affordance. Only the Bestiary passes it — that
  // kind exists for its artwork, so the plate has somewhere bigger to go. It
  // rides beside Replace/✕ rather than hijacking a click on the image, which
  // is already the editor's re-upload target.
  onZoom?: () => void;
}) {
  const { canEdit } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reframing, setReframing] = useState(false);

  // A reframe session belongs to the image it was opened on. When the artwork
  // changes under it — this editor hit Replace, or another editor's realtime
  // edit landed — the session is stale, so it closes rather than re-anchoring a
  // crosshair placed on a picture that is no longer there. This also stops
  // `reframing` from surviving a Remove: the empty-portrait branch returns
  // before the overlay renders, so the flag would otherwise sit true and reopen
  // the editor by itself the moment a new image arrived.
  useEffect(() => { setReframing(false); }, [imageUrl]);

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
      <img
        src={imageUrl}
        alt={label}
        className="sb-portrait-img"
        style={focusImageStyle(imageFocus)}
      />
      {/* Viewers can't edit, so for them the image itself is the zoom target;
          editors get an explicit chip instead (a click on the image is not
          overloaded, but the chips row is where their actions already live). */}
      {onZoom && !canEdit && (
        <button
          onClick={onZoom}
          title="Show the plate full size"
          aria-label="Show the plate full size"
          style={{ position: "absolute", inset: 0, background: "transparent", border: "none", cursor: "zoom-in" }}
        />
      )}
      {canEdit && (
        <>
          {hiddenInput}
          <div className={uploading ? "portrait-chips is-uploading" : "portrait-chips"}>
            {onZoom && !uploading && (
              <button onClick={onZoom} title="Show the plate full size" style={{ ...chipStyle, padding: "4px 8px", fontSize: 12 }}>
                ⛶
              </button>
            )}
            {!uploading && (
              <button
                onClick={() => setReframing(true)}
                title="Set where the image is cropped from"
                style={chipStyle}
              >
                {/* Plain string, no <ThemedLabel>: both registers say the same
                    word, and its neighbours Replace / ✕ are voice-neutral too. */}
                Reframe
              </button>
            )}
            <button onClick={pick} disabled={uploading} style={chipStyle}>
              {uploading ? "Uploading…" : "Replace"}
            </button>
            {!uploading && (
              <button onClick={clear} title="Remove image" style={{ ...chipStyle, padding: "4px 8px", fontSize: 12 }}>
                ✕
              </button>
            )}
          </div>
          {reframing && (
            <ReframeOverlay
              imageUrl={imageUrl}
              imageFocus={imageFocus}
              label={label}
              onSave={(value) => { onSaveFocus(value); setReframing(false); }}
              onClose={() => setReframing(false)}
            />
          )}
        </>
      )}
    </div>
  );
}

const STATUS_OPTIONS = ["whispered", "pursuing", "resolved", "lost"] as const;
const DISPOSITION_OPTIONS = ["ally", "neutral", "wary", "hostile"] as const;
// people.is_pc is a boolean in the DB, but there's no boolean-toggle primitive
// and one stat cell doesn't justify inventing one — EnumSelect over these two
// labels, mapped back to the boolean at the call site, reads like Tier/Status
// beside it. Voice-neutral on purpose: it renders identically in both themes.
const PC_TYPE_OPTIONS = ["player character", "npc"] as const;

// Integer-only EditableText: non-numeric input is rejected (no write, the
// display reverts on blur), matching sessions.num being NOT NULL integer.
// `pad` defaults to 2 for session numbers ("07"), which is a session-number
// convention and not a numeric one — a tally must pass pad={0} or 7 creatures
// read as "07".
function EditableNumber({ value, pad = 2, onSave }: { value: number; pad?: number; onSave: (n: number) => void }) {
  return (
    <EditableText
      value={String(value).padStart(pad, "0")}
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
  const findEntity = useFindEntity();
  const [targetId, setTargetId] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const allOptions = useMemo(
    () => [
      ...campaign.people.map((p) => ({ id: p.id, label: p.name, kind: "people" as const, archived: p.archived, hidden: p.hidden })),
      ...campaign.locations.map((l) => ({ id: l.id, label: l.name, kind: "locations" as const, archived: l.archived, hidden: l.hidden })),
      ...campaign.quests.map((q) => ({ id: q.id, label: q.title, kind: "quests" as const, archived: q.archived, hidden: q.hidden })),
      ...campaign.goals.map((g) => ({ id: g.id, label: g.text, kind: "goals" as const, archived: g.archived, hidden: g.hidden })),
      ...campaign.factions.map((f) => ({ id: f.id, label: f.name, kind: "factions" as const, archived: f.archived, hidden: f.hidden })),
      ...campaign.items.map((i) => ({ id: i.id, label: i.name, kind: "items" as const, archived: i.archived, hidden: i.hidden })),
      ...campaign.lore.map((l) => ({ id: l.id, label: l.title, kind: "lore" as const, archived: l.archived, hidden: l.hidden })),
      ...campaign.monsters.map((m) => ({ id: m.id, label: m.name, kind: "monsters" as const, archived: m.archived, hidden: m.hidden })),
      // Sessions lead with their code: it's how the DM refers to a past
      // sitting, and it's what a "S120" search matched on (see `num`).
      ...campaign.sessions.map((s) => ({ id: s.id, label: `${sessionLabel(s.num)} · ${s.title}`, kind: "sessions" as const, num: s.num })),
      ...campaign.arcs.map((a) => ({ id: a.id, label: a.title, kind: "arcs" as const })),
      ...campaign.events.map((e) => ({ id: e.id, label: e.title, kind: "events" as const })),
    ].filter((o) => o.id !== fromId),
    [campaign, fromId],
  );

  const submit = async () => {
    if (!targetId || !label.trim() || saving) return;
    setSaving(true);
    try {
      await insertConnection(fromId, targetId, label.trim(), {
        announce: bothVisible(findEntity(fromId), findEntity(targetId)),
      });
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
          fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)",
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
  monsters: "name",
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
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 12, color: "var(--ink-ghost)" }}>
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
            fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)",
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

// "At the Table" — the session_attendance register (0039), on the chapter's own
// sheet, because attendance is usually written up after the fact rather than
// during play.
//
// Read the boundary before extending this: it is NOT the "+ Seen this session"
// toggle further down (session_participants — who appeared in the fiction, which
// feeds lastSeen and sagaScope), and it is NOT presence (who has the codex open
// right now, which expires with the socket). This is the party's own register of
// who played, and present/absent is the whole vocabulary: a row means present.
function AttendanceRegister({ sessionId }: { sessionId: string }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();
  const presenceUsers = usePresence();
  const session = campaign.sessions.find((s) => s.id === sessionId);
  const attended = new Set(campaign.sessionAttendance[sessionId] ?? []);
  // The party, UNION anyone already on the register. The union is what keeps the
  // history honest: a guest character, or an ex-PC whose is_pc was flipped off
  // later, must not silently drop out of a chapter they played. Archived PCs are
  // only listed if they're on it — archiving is the DM's "retire this row".
  const roster = campaign.people
    .filter((p) => attended.has(p.id) || (isPc(p) && !p.archived))
    // Dead characters sink to the bottom rather than being filtered out: a dead
    // PC stays a PC (0030), and back-filling an old chapter still needs them.
    .sort((a, b) => {
      const da = a.status === "dead", db = b.status === "dead";
      return da !== db ? (da ? 1 : -1) : a.name.localeCompare(b.name);
    });
  // An empty register is ambiguous on its own — the stamp is what makes it mean
  // "nobody came" instead of "nobody has recorded it". Rows imply the stamp, so
  // either signal counts (and the OR also survives a stamp that never landed).
  const recorded = attended.size > 0 || !!session?.attendanceTakenAt;
  // Live-session shortcut: presence tracks auth uuids and 0030 links a PC to its
  // player's uuid, so who-has-the-codex-open can *propose* a register. A
  // suggestion, never an automatic write — occupancy isn't a claim about who
  // played, and one careless auto-record would be indistinguishable from one the
  // DM made on purpose.
  const proposed = campaign.activeSessionId === sessionId
    ? roster.filter((p) => !attended.has(p.id) && p.playerUserId
        && presenceUsers.some((u) => u.id === p.playerUserId))
    : [];

  return (
    <div style={{ marginBottom: 26 }}>
      <h3><ThemedLabel parchment="Those Who Sat" atlas="Attendance" /></h3>
      {roster.length === 0 ? (
        <div className="attend-note">
          No player characters are marked yet — mark someone a player character on their own sheet
          and they'll appear here.
        </div>
      ) : (
        <>
          <div className="attend-register">
            {roster.map((p) => {
              const present = attended.has(p.id);
              const cls = "attend-chip" + (present ? " is-present" : "");
              const label = <>{present && <span className="attend-tick">✓</span>}{p.name}</>;
              if (!canEdit) {
                return (
                  <span key={p.id} className={cls} title={present ? "At the table" : "Not at the table"}>
                    {label}
                  </span>
                );
              }
              return (
                <button
                  key={p.id}
                  className={cls}
                  title={present ? `${p.name} was at the table — click to remove` : `Record ${p.name} at the table`}
                  onClick={() =>
                    (present
                      ? markAbsent(sessionId, p.id)
                      : markAttended(sessionId, p.id)
                    ).catch(console.error)}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="attend-note">
            {recorded
              ? `${attended.size} of ${roster.length} at the table.`
              : canEdit ? "Attendance not recorded — tick who played." : "Attendance not recorded."}
            {canEdit && proposed.length > 0 && (
              <button
                className="attend-propose"
                title={proposed.map((p) => p.name).join(", ")}
                onClick={() => {
                  proposed.forEach((p) =>
                    markAttended(sessionId, p.id).catch(console.error));
                }}
              >
                <ThemedLabel
                  parchment={`Seat the ${proposed.length} here now`}
                  atlas={`Add ${proposed.length} here now`}
                />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// The session's prep queue, on the session's own sheet — the counterpart to
// StageControls, so a DM can prepare a whole evening from one page instead of
// visiting nine entity sheets. DM-only (the queue is projected out for everyone
// else). Releasing stays in the live panel: this is the prep desk, not the
// release desk.
function SessionPrepList({ sessionId, onOpen }: { sessionId: string; onOpen: (id: string) => void }) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();

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

  // Only the archivable kinds carry `hidden` and a reveal ceremony — sessions,
  // arcs and events are never staged.
  const options = useMemo<EntityOption[]>(() => {
    const staged = new Set(
      campaign.sessionStaging.filter((r) => r.sessionId === sessionId).map((r) => r.entityId),
    );
    return ARCHIVABLE_KINDS.flatMap((k) =>
      ((campaign as any)[k] as any[]).map((e) => ({
        id: e.id,
        label: e[primaryField[k]] ?? "",
        kind: k,
        archived: e.archived,
        hidden: e.hidden,
      })),
    ).filter((o) => !staged.has(o.id));
  }, [campaign, sessionId]);

  return (
    <div className="detail-prep">
      <h3 style={{ marginTop: 28 }}>
        <ThemedLabel parchment="The DM's Preparations" atlas="Staged for this session" />
      </h3>
      {rows.length === 0 && (
        <div className="live-dm-empty">
          <ThemedLabel
            parchment="Naught is staged for this session."
            atlas="Nothing staged for this session yet."
          />
        </div>
      )}
      {rows.map(({ row, ent }) => (
        <div className="live-stage-row" key={row.entityId}>
          <Icon name={kindIcon[ent._kind as KindKey]} size={13} />
          <span className="lbl" onClick={() => onOpen(row.entityId)} title={entityLabel(ent)}>
            {entityLabel(ent)}
            {/* Staged-but-visible is legal (the STAGE flow allows it) — surface
                it so a later "reveal" of something the party already sees is
                deliberate, not a surprise. */}
            {!row.releasedAt && !isHidden(ent) && <span className="live-visible-hint">visible</span>}
          </span>
          {row.releasedAt ? (
            <span className="live-released" title="Released during this session">✓ revealed</span>
          ) : (
            <button
              className="prep-unstage-btn"
              title={`Take “${entityLabel(ent)}” off this session's queue`}
              onClick={() => unstageEntity(sessionId, row.entityId).catch(console.error)}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <EntityCombobox
        options={options}
        onSelect={(id) => {
          if (!id) return;
          const ent = findEntity(id);
          if (!ent) return;
          // Same hide offer as StageControls: staging happens either way, so
          // Cancel means "stage it, but leave it visible".
          if (!isHidden(ent) && window.confirm(`Hide “${entityLabel(ent)}” from the party until released?`)) {
            updateEntity(ent._kind as KindKey, id, { hidden: true }).catch(console.error);
          }
          stageEntity(sessionId, id).catch(console.error);
        }}
        placeholder="Stage something for this session…"
        style={{ marginTop: 10, fontSize: 13 }}
      />
    </div>
  );
}

// The DM's staging + reveal controls (issues #65/#68/#69). Staging is a
// (session_id, entity_id) row with no tie to campaigns.active_session_id, so
// prep is deliberately NOT live-only: the target defaults to the live session
// when there is one and the newest session otherwise, and the ▾ picker
// retargets to any session. Only RELEASE and ⚡ SHOW NOW stay live-gated —
// both append to the live feed and SHOW takes over every player's screen,
// which means nothing for a session that hasn't started.
function StageControls({ kind, entityId, entity, patch }: {
  kind: KindKey;
  entityId: string;
  entity: any;
  patch: (fields: Record<string, unknown>) => void;
}) {
  const campaign = useCampaign();
  // Double-click guard for RELEASE: the reveal event insert isn't idempotent
  // and realtime won't flip the staging row fast enough.
  const [releasing, setReleasing] = useState(false);
  // Same guard for SHOW NOW, but cleared on settle (success and failure):
  // this button never unmounts, and a deliberate re-show is legitimate.
  const [showing, setShowing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  // Newest first — the session you're most likely prepping for.
  const ordered = useMemo(
    () => [...campaign.sessions].sort((a, b) => b.num - a.num),
    [campaign.sessions],
  );
  const live = campaign.activeSessionId
    ? ordered.find((s) => s.id === campaign.activeSessionId)
    : undefined;
  // Staging needs a session row to hang off — with none, there's nothing to
  // offer (the sidebar's + creates one ahead of play).
  const target = live ?? ordered[0];
  if (!target) return null;

  const rowFor = (sessionId: string) =>
    campaign.sessionStaging.find((r) => r.sessionId === sessionId && r.entityId === entityId);
  // Queued = staged and not yet released. A released row is history, not a
  // pending reveal, so it doesn't claim the badge — it shows in the picker.
  const queued = ordered.filter((s) => {
    const row = rowFor(s.id);
    return !!row && !row.releasedAt;
  });
  const label = entityLabel(entity);

  const doStage = (sessionId: string) => {
    // Staging happens either way — the confirm is only the hide offer (default
    // yes), so Cancel truthfully means "stage it, but leave it visible".
    if (!isHidden(entity) && window.confirm(`Hide “${label}” from the party until released?`)) {
      patch({ hidden: true });
    }
    stageEntity(sessionId, entityId).catch(console.error);
  };

  const liveQueued = live ? queued.some((s) => s.id === live.id) : false;
  const liveCode = live ? sessionLabel(live.num) : "";

  return (
    <>
      {queued.map((s) => (
        <button
          key={s.id}
          onClick={() => unstageEntity(s.id, entityId).catch(console.error)}
          title={`Remove from the session ${sessionLabel(s.num)} queue`}
          className="detail-action-btn"
          style={{ borderColor: "var(--mustard)", color: "var(--mustard-deep)" }}
        >
          ⧉ STAGED {sessionLabel(s.num)}
        </button>
      ))}
      <div className="stage-picker" ref={rootRef}>
        {!queued.some((s) => s.id === target.id) && (
          <button
            onClick={() => doStage(target.id)}
            title={rowFor(target.id)?.releasedAt
              ? `Already revealed in session ${sessionLabel(target.num)} — re-queue it for another reveal`
              : `Stage for session ${sessionLabel(target.num)} — queued for one-click release from the live panel`}
            className="detail-action-btn"
          >
            ⧉ STAGE {sessionLabel(target.num)}
          </button>
        )}
        <button
          onClick={() => setPickerOpen((o) => !o)}
          title="Stage for another session"
          className="detail-action-btn"
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          style={{ padding: "4px 6px" }}
        >
          ▾
        </button>
        {pickerOpen && (
          <div className="campaign-picker-menu" role="listbox">
            {ordered.map((s) => {
              const row = rowFor(s.id);
              const isQueued = !!row && !row.releasedAt;
              return (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={isQueued}
                  className="campaign-picker-item"
                  onClick={() => {
                    if (isQueued) unstageEntity(s.id, entityId).catch(console.error);
                    else doStage(s.id);
                    setPickerOpen(false);
                  }}
                  title={isQueued ? `Remove from the session ${sessionLabel(s.num)} queue` : `Stage for session ${sessionLabel(s.num)}`}
                >
                  <span className="dot" style={{ visibility: s.id === campaign.activeSessionId ? "visible" : "hidden" }} />
                  <span style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: 13 }}>
                    {sessionLabel(s.num)} — {s.title}
                  </span>
                  <span style={{ fontFamily: "var(--font-fell-sc)", fontSize: 10, letterSpacing: ".12em", color: "var(--ink-secondary)" }}>
                    {isQueued ? "⧉ STAGED" : row?.releasedAt ? "✓ REVEALED" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {/* One-click release from the sheet (issue #68) — the same verb as the
          live panel's queue button. Unhiding via ◈ UNREVEALED is not a
          release: no feed event, no released_at stamp, no seen-mark. */}
      {live && liveQueued && isHidden(entity) && (
        <button
          disabled={releasing || showing}
          onClick={() => {
            setReleasing(true);
            releaseEntity(kind, entityId, live.id, { label })
              // Clear ONLY on failure (for retry). On success the button
              // unmounts once realtime flips hidden/released_at; resetting
              // here would re-enable it in the echo gap and allow a duplicate
              // release.
              .catch((e) => { console.error("releaseEntity failed", e); setReleasing(false); });
          }}
          title={`Reveal to the party now — unhides it, stamps the ${liveCode} queue, and lands in the session feed`}
          className="detail-action-btn"
          style={{ borderColor: "var(--bloodred)", color: "var(--bloodred)" }}
        >
          {releasing ? "🕯 …" : "🕯 RELEASE"}
        </button>
      )}
      {/* "Show now" (#69): the loud reveal — release semantics (unhide + stamp
          if queued) plus a takeover that opens this sheet on every player's
          screen. Legal on anything while live, hidden or not, staged or not —
          and only while live, since it's the live feed it plays to. */}
      {live && (
        <button
          disabled={showing || releasing}
          onClick={() => {
            setShowing(true);
            showEntity(kind, entityId, live.id, {
              label,
              unhide: isHidden(entity),
            })
              .catch((e) => console.error("showEntity failed", e))
              .finally(() => setShowing(false));
          }}
          title={`Show “${label}” now — opens it on every player's screen and lands in the ${liveCode} feed`}
          className="detail-action-btn"
          style={{ background: "var(--bloodred)", borderColor: "var(--bloodred)", color: "var(--vellum-light)" }}
        >
          {showing ? "⚡ …" : "⚡ SHOW NOW"}
        </button>
      )}
    </>
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
  // Optional context tag shown after the relation verb (e.g. an event's session).
  tag?: string;
  // Set ONLY for chips backed by a real `connections` row, carrying that row's
  // stored orientation so the rail's ✕ can target it. Its presence is the
  // single "this chip is deletable" predicate. Chips synthesized from FK
  // columns, arc nesting, event participation or the reveal log leave it
  // undefined and stay read-only (chevron). `label` is duplicated from `rel`
  // on purpose: `rel` is display text five other producers also write, so a
  // DELETE keyed on it would break the moment someone decorates it.
  edge?: { from: string; to: string; label: string };
}

export function DetailSheet({ entityId, onClose, onOpen }: DetailSheetProps) {
  const campaign = useCampaign();
  const findEntity = useFindEntity();
  const entity = findEntity(entityId);
  const { canEdit } = useAuth();
  const isDm = useIsDm();
  const profilesById = useProfiles();
  const resolveAuthor = useAuthorName();
  // The raw lookup, for sessionFeedToMarkdown — which is pure and takes the
  // resolver rather than the map.
  const resolveName = (userId: string) => profilesById.get(userId)?.displayName;

  const notes = campaign.notes[entityId] || [];

  // Same guard for DRAFT RECAP (issue #72): the append is a read-modify-write
  // on summary. Like RELEASE, the guard clears on failure only — clearing on
  // success would re-enable the button in the realtime echo gap while
  // entity.summary is still stale. Unlike RELEASE the button doesn't unmount
  // on success, so the echo itself (summary changing) is what re-enables it.
  const [draftingRecap, setDraftingRecap] = useState(false);
  // Bestiary plate blown up over the sheet (monsters only — see EntityPortrait).
  const [plateOpen, setPlateOpen] = useState(false);
  const entitySummary = entity ? (entity as any).summary : undefined;
  useEffect(() => {
    setDraftingRecap(false);
  }, [entitySummary]);
  // Unsent party-note text, held outside the component so none of the sheet's
  // dismissal paths can destroy it. Keyed per entity, which is also what stops
  // a draft typed for one entity being inserted onto another.
  const noteDraftKey = entityDraftKey(campaign.id, entityId);
  // Did the current drag start on the backdrop? See the overlay's handlers.
  const downOnBackdrop = useRef(false);

  // Esc closes the sheet ("single Esc/click dismiss", #69 — and general UX).
  // defaultPrevented skips Esc already claimed by an inner editor (EditableText
  // cancel, combobox/palette close — all preventDefault, and React's root-
  // attached handlers run before this window listener). The editable-target
  // check is the second belt for editors that don't.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // defaultPrevented covers an inner editor that already claimed the key
      // AND an open PlateLightbox, which claims Esc in the capture phase so the
      // topmost overlay closes first — including the App-level plate a
      // ⚡ SHOW NOW raises, which this component has no state for.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")
      ) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Belt to App.tsx's key={openId}, which remounts the sheet on entity change
  // and would reset this anyway: don't carry one creature's plate over onto the
  // next entity's sheet if the sheet ever stops being keyed.
  useEffect(() => { setPlateOpen(false); }, [entityId]);

  // Manual strings + FK relations (resides at / member of / quest giver /
  // happened at), unioned by the same selector the board reads — so the sheet
  // and the board can't drift. Session/arc/event/chapter links below aren't
  // board edges, so they stay derived inline here.
  const relations = useMemo(
    () => deriveRelations(campaign),
    [campaign.connections, campaign.people, campaign.quests, campaign.events],
  );

  // These four sat below the `if (!entity) return null` early return, which
  // violates the Rules of Hooks the moment `entity` resolves across renders —
  // the sheet can legitimately mount before its row lands over realtime
  // ("New person" opens the id right after createEntity; the takeover and
  // deep links guard with findEntity, this flow can't). Hooks live above the
  // return; they only read campaign, so a null entity is fine here.
  // A chapter or quest can be filed at either altitude, so this lists sagas
  // and arcs together. Children carry their saga in the label — the list runs
  // to ~25 entries on a long campaign and "Vallaki Arc" alone doesn't say
  // which saga it belongs to.
  const arcOptions = useMemo(
    () => {
      const titleOf = new Map(campaign.arcs.map((a) => [a.id, a.title]));
      return campaign.arcs
        .slice()
        .sort((a, b) => a.orderNum - b.orderNum)
        .map((a) => ({
          id: a.id,
          label: a.parentId && titleOf.has(a.parentId) ? `${titleOf.get(a.parentId)} · ${a.title}` : a.title,
          kind: "arcs" as const,
        }));
    },
    [campaign.arcs],
  );
  // Eligible sagas for this arc's parent. Mirrors tg_arcs_depth (0025): a
  // parent must itself be top-level, and can't be the arc being edited. The
  // remaining rule — an arc with children can't become a child — is enforced by
  // not rendering the picker at all in that case (see below), so the UI can
  // never offer a write the trigger would refuse.
  const sagaOptions = useMemo(
    () => campaign.arcs
      .filter((a) => !a.parentId && a.id !== entityId)
      .sort((a, b) => a.orderNum - b.orderNum)
      .map((a) => ({ id: a.id, label: a.title, kind: "arcs" as const })),
    [campaign.arcs, entityId],
  );
  const hasChildArcs = useMemo(
    () => campaign.arcs.some((a) => a.parentId === entityId),
    [campaign.arcs, entityId],
  );
  const sessionOptions = useMemo(
    () => campaign.sessions
      .map((s) => ({ id: s.id, label: `${sessionLabel(s.num)} — ${s.title}`, kind: "sessions" as const, num: s.num })),
    [campaign.sessions],
  );
  const locationOptions = useMemo(
    () => campaign.locations.map((l) => ({ id: l.id, label: l.name, kind: "locations" as const, archived: l.archived, hidden: l.hidden })),
    [campaign.locations],
  );
  const factionOptions = useMemo(
    () => campaign.factions.map((f) => ({ id: f.id, label: f.name, kind: "factions" as const, archived: f.archived, hidden: f.hidden })),
    [campaign.factions],
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
      related[k].push({
        entity: ent,
        rel: e.label,
        edge: e.source === "manual" ? { from: e.a, to: e.b, label: e.label } : undefined,
      });
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
    // The nesting itself (0025), in both directions: the saga above, or the
    // arcs below. Both land in `related.arcs`, which the rail already renders.
    const pushArc = (id: string, rel: string) => {
      const a = findEntity(id);
      if (!a) return;
      related.arcs = related.arcs || [];
      if (!related.arcs.find((r) => r.entity.id === a.id)) related.arcs.push({ entity: a, rel });
    };
    if ((entity as any).parentId) pushArc((entity as any).parentId, "part of saga");
    campaign.arcs
      .filter((a) => a.parentId === entityId)
      .sort((a, b) => a.orderNum - b.orderNum)
      .forEach((a) => pushArc(a.id, "arc of this saga"));
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
      const sessionsById = new Map(campaign.sessions.map((s) => [s.id, s]));
      // Array order isn't trustworthy after realtime splices — sort by orderNum.
      campaign.events.slice().sort((a, b) => a.orderNum - b.orderNum).forEach((ev) => {
        const rel = eventRel(ev);
        if (!rel) return;
        related.events = related.events || [];
        if (!related.events.find((r) => r.entity.id === ev.id)) {
          // Tag the chip with the event's session (its temporal anchor), the way
          // the Chronicle page labels each event — skip on a session's own sheet
          // where every chip would restate that session.
          const sess = kind !== "sessions" && ev.session ? sessionsById.get(ev.session) : undefined;
          related.events.push({ entity: findEntity(ev.id), rel, tag: sess ? sessionLabel(sess.num) : undefined });
        }
      });
    }
  }
  // Reveal chips, derived from the session_events log rather than stored as
  // connections rows — releaseEntity/showEntity already record the fact, so a
  // second table would just drift (re-hide, unstage, event delete). A session's
  // sheet lists what surfaced during it; an entity's sheet points back at the
  // sessions that revealed it. Curated chips win: any existing chip for the
  // same pair (manual string, introduced in / last seen in) suppresses the
  // derived one, mirroring how FK edges yield to manual strings. Hidden-entity
  // reveals are already projected out for players, so nothing leaks here.
  {
    const revealSeen = new Set<string>();
    campaign.sessionEvents.forEach((ev) => {
      if (ev.type !== "reveal" || !ev.entityId || !ev.sessionId) return;
      if (kind === "sessions" ? ev.sessionId !== entityId : ev.entityId !== entityId) return;
      const otherId = kind === "sessions" ? ev.entityId : ev.sessionId;
      if (revealSeen.has(otherId)) return; // re-reveals collapse to the first
      revealSeen.add(otherId);
      const other = findEntity(otherId);
      if (!other) return;
      const k = kind === "sessions" ? (other._kind as string) : "sessions";
      related[k] = related[k] || [];
      if (!related[k].find((r) => r.entity.id === other.id)) {
        related[k].push({ entity: other, rel: kind === "sessions" ? "revealed this session" : "revealed in" });
      }
    });
  }

  const patch = (fields: Record<string, unknown>) =>
    updateEntity(kind, entityId, fields).catch((e) =>
      console.error(`updateEntity(${kind}) failed`, e),
    );

  // Cuts a hand-drawn string from either endpoint's sheet, so a stale relation
  // no longer needs both cards pinned to the board to be removed. Confirmed
  // because connections have no undo and the label is free text the DM typed —
  // and because the ✕ sits inside a chip whose whole body navigates. The native
  // dialog also absorbs the double-click that would otherwise re-fire the
  // DELETE in the realtime echo gap and raise a spurious "wasn't saved" toast.
  const removeRelation = (edge: { from: string; to: string; label: string }, otherLabel: string) => {
    if (!window.confirm(`Cut the string "${edge.label}" to ${otherLabel}? This cannot be undone.`)) return;
    deleteConnectionBetween(edge.from, edge.to, edge.label).catch((e) =>
      console.error("deleteConnectionBetween failed", e),
    );
  };

  // The session's own feed (issue #72): session_events are loaded campaign-
  // wide and kept sorted, so past feeds are already in memory. Rendered
  // read-only once the session isn't the live one — during live, the panel
  // is the surface. Hidden-entity reveals are projected out for players.
  const sessionFeed = kind === "sessions"
    ? campaign.sessionEvents.filter((e) => e.sessionId === entityId)
    : [];
  const showFeed = sessionFeed.length > 0 && campaign.activeSessionId !== entityId;

  const draftRecap = () => {
    // Bylines resolve live here too (0040): the digest lands in the public
    // `summary` as frozen text, so it should be stamped with who those people
    // are now, not who they were called when the row was written.
    const digest = sessionFeedToMarkdown(sessionFeed, findEntity, resolveName);
    const existing = ((entity as any).summary ?? "").trim();
    setDraftingRecap(true);
    updateEntity("sessions", entityId, { summary: existing ? `${existing}\n\n${digest}` : digest })
      // Clear ONLY on failure (for retry) — the summary-echo effect above
      // handles success, once the appended digest is actually visible.
      .catch((e) => {
        console.error("draft recap failed", e);
        setDraftingRecap(false);
      });
  };

  const onDelete = () => {
    if (!entity) return;
    const label = entityLabel(entity);
    if (!window.confirm(`Strike "${label}" from the codex? This cannot be undone.`)) return;
    deleteEntity(kind, entityId)
      .then(() => {
        // A struck entity's kept draft is unreachable — nothing left to pin it to.
        clearDraft(noteDraftKey);
        onClose();
      })
      .catch((e) => console.error("deleteEntity failed", e));
  };

  // Returns the promise: NoteComposer keeps the draft if the write is rejected,
  // and insertPartyNote has already raised the write-error toast.
  const addNote = (text: string) =>
    insertPartyNote(entityId, {
      when: "Just now",
      text,
      hand: true,
    }, {
      // Announce it in the live feed only if the players can already see what
      // was annotated (0032) — a note on an unreleased entity is DM prep. The
      // label is snapshotted here because the mutation can't resolve a display
      // field that varies by kind; it's the fallback for a later-struck entity.
      announce: isVisible(entity),
      entityLabel: entity ? entityLabel(entity) : undefined,
    });

  const kindTitle: Record<string, string> = {
    people: "Person of Note", locations: "Location", quests: "Quest",
    goals: "Goal", factions: "Faction", items: "Item", lore: "Lore",
    monsters: "Bestiary Entry", sessions: "Session",
    arcs: "Story Arc", events: "Event",
  };

  return (
    <>
    {/* Dismiss needs BOTH mouse endpoints on the backdrop. Not onClick alone: a
        text-selection drag that starts inside the sheet and ends outside fires a
        click whose target is the common ancestor — this overlay — so the sheet
        would close out from under a selection. Not onMouseDown alone either
        (the old bug): the browser moves focus as mousedown's DEFAULT ACTION, so
        unmounting on down meant a focused EditableText never got its
        blur-commit and the edit was silently discarded. Waiting for mouseup
        lets the commit land first, for free. */}
    <div
      className="detail-overlay"
      onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => {
        const dismiss = downOnBackdrop.current && e.target === e.currentTarget;
        downOnBackdrop.current = false;
        if (dismiss) onClose();
      }}
    >
      <div className={`detail-sheet tex-vellum ${isArchived(entity) ? "is-archived" : ""} ${isHidden(entity) ? "is-veiled" : ""}`}>
        <button className="detail-close" onClick={onClose}><Icon name="close" size={16} /></button>
        {/* Wraps rather than overflows: the DM's row can reach nine controls
            once an entity is staged for a session other than the live one. */}
        {canEdit && <div className="detail-action-row">
          {isArchivableKind(kind) && (
            <>
              <button
                onClick={() => patch({ pinned: !isPinned(entity) })}
                title={isPinned(entity) ? "Unpin from top of lists" : "Pin to top of lists"}
                className="detail-action-btn"
                style={isPinned(entity) ? { borderColor: "var(--mustard)", color: "var(--mustard-deep)" } : undefined}
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
              {/* DM-only party visibility — distinct from ARCHIVE, which
                  declutters but stays readable by everyone. */}
              {isDm && (
                <button
                  onClick={() => patch({ hidden: !isHidden(entity) })}
                  title={isHidden(entity)
                    ? "Reveal to the party"
                    : "Hide from the party — only the DM sees it"}
                  className="detail-action-btn"
                  style={isHidden(entity) ? { borderColor: "var(--ink-secondary)", color: "var(--ink-secondary)", borderStyle: "dashed" } : undefined}
                >
                  {isHidden(entity) ? "◈ UNREVEALED" : "◇ HIDE"}
                </button>
              )}
              {isDm && <StageControls kind={kind} entityId={entityId} entity={entity} patch={patch} />}
              {/* Board membership is a positions row, independent of tier/archive.
                  Not worded "PIN" — that already means pinned-to-top above. */}
              <button
                onClick={() => {
                  if (campaign.board[entityId]) {
                    deleteBoardPosition(entityId).catch(console.error);
                  } else {
                    const spot = findFreeSpot(kind, campaign.board);
                    upsertBoardPosition(entityId, {
                      x: spot.x,
                      y: spot.y,
                      rot: Math.floor(Math.random() * 7) - 3,
                      kind,
                    }).catch(console.error);
                  }
                }}
                title={campaign.board[entityId]
                  ? "Take this card off the notice board (notes and relations keep)"
                  : "Pin this card to the notice board"}
                className="detail-action-btn"
              >
                {campaign.board[entityId] ? "⊟ OFF BOARD" : "⊞ ON BOARD"}
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
            {/* A focal point belongs to the IMAGE, not to the entity, so
                onSave clears it in the same write that replaces or removes the
                artwork. Without that a new portrait inherits the old one's
                crosshair and silently crops to a point taken from a different
                picture — the exact bug this feature exists to fix, reintroduced
                by a stale value. ("" → NULL via toRow.) */}
            {isUploadable(kind) ? (
              <EntityPortrait
                kind={kind}
                entityId={entityId}
                imageUrl={(entity as any).imageUrl}
                imageFocus={(entity as any).imageFocus}
                label={entityLabel(entity)}
                onSave={(url) => {
                  // setEntityImage rather than patch: it clears the focus AND
                  // sweeps the object the entity was using, but only once the
                  // row write has landed. See mutations.ts.
                  setEntityImage(kind, entityId, url, (entity as any).imageUrl).catch((e) =>
                    console.error(`setEntityImage(${kind}) failed`, e),
                  );
                }}
                onSaveFocus={(value) => patch({ imageFocus: value })}
                onZoom={kind === "monsters" && (entity as any).imageUrl
                  ? () => setPlateOpen(true)
                  : undefined}
              />
            ) : (
              <div className="sb-portrait" style={{ background: "var(--paper-tan)" }}>
                <PortraitFallback kind={kind} />
              </div>
            )}
            <div className="sb-meta">
              <div className="sb-kind"><Fleurons>{kindTitle[kind] || kind}</Fleurons></div>
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
                    {/* No allowClear on tier: null already reads as major (personTier), so a clear would be
                        indistinguishable. The no-op guard keeps re-picking the shown value from writing an
                        explicit 'major' — that would flip the stat permanently visible to viewers. */}
                    <Stat label="Tier" empty={!(entity as any).tier} valueStyle={{ textTransform: "capitalize" }}><EnumSelect value={personTier(entity as any)} options={PERSON_TIER_OPTIONS} onSave={(v) => { if (v !== personTier(entity as any)) patch({ tier: v }); }} /></Stat>
                    <Stat label="Status" empty={!(entity as any).status} valueStyle={{ textTransform: "capitalize" }}><EnumSelect value={(entity as any).status} options={PERSON_STATUS_OPTIONS} allowClear onSave={(v) => patch({ status: v })} /></Stat>
                    <Stat label="Faction" empty={!(entity as any).faction} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).faction} options={factionOptions} allowClear onSave={(id) => patch({ faction: id ?? "" })} /></Stat>
                    <Stat label="Location" empty={!(entity as any).location} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).location} options={locationOptions} allowClear onSave={(id) => patch({ location: id ?? "" })} /></Stat>
                    {/* PC-ness is orthogonal to Tier: tier is narrative prominence for
                        NPC-roster triage (0014), and a retired PC is plausibly
                        "supporting". empty when false so viewers don't read "npc" on
                        every townsperson, while editors keep the affordance. */}
                    <Stat label="Type" empty={!isPc(entity)} valueStyle={{ textTransform: "capitalize", fontSize: 13 }}>
                      <EnumSelect
                        value={isPc(entity) ? "player character" : "npc"}
                        options={PC_TYPE_OPTIONS}
                        onSave={(v) => { if (v && (v === "player character") !== isPc(entity)) patch({ isPc: v === "player character" }); }}
                      />
                    </Stat>
                    {/* Read-only: binding a character to an account happens on the
                        charter, which is the only screen holding the member roster. */}
                    {isPc(entity) && (entity as any).playerUserId && (
                      <Stat label="Played by" valueStyle={{ fontSize: 13 }}>
                        {profilesById.get((entity as any).playerUserId)?.displayName ?? "an unnamed adventurer"}
                      </Stat>
                    )}
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
                      // Short legacy codes ("s3") still display; a dangling
                      // UUID FK (session deleted elsewhere) shows as absent
                      // instead of 36 uppercase characters.
                      const raw = (entity as any).session as string | undefined;
                      return s ? sessionLabel(s.num) : raw && raw.length <= 8 ? raw.toUpperCase() : "—";
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
                {kind === "monsters" && (
                  <>
                    <Stat label="Type" empty={!(entity as any).kind?.trim()}><EditableText value={(entity as any).kind ?? ""} onSave={(v) => patch({ kind: v })} placeholder="—" /></Stat>
                    <Stat label="Threat" empty={!(entity as any).threat} valueStyle={{ textTransform: "capitalize" }}><EnumSelect value={(entity as any).threat} options={MONSTER_THREAT_OPTIONS} allowClear onSave={(v) => patch({ threat: v })} /></Stat>
                    {/* Writing CR rewrites the band with it, because threat is
                        the reading of cr and not an independent field (see the
                        MonsterThreat comment in data.ts). Editing Threat alone
                        above is still allowed — that's the escape hatch for a
                        creature with no CR recorded. */}
                    <Stat label="CR" empty={(entity as any).cr == null}>
                      <EditableText
                        value={crLabel((entity as any).cr) ?? ""}
                        onSave={(v) => {
                          const typed = v.trim();
                          if (!typed) return patch({ cr: null, threat: null });
                          const cr = parseCr(typed);
                          if (cr === null) return false; // unreadable — revert, don't clear
                          patch({ cr, threat: crToThreat(cr) ?? null });
                        }}
                        placeholder="—"
                      />
                    </Stat>
                    <Stat label="Faced in all" empty={(entity as any).encountered == null}>
                      <EditableNumber value={(entity as any).encountered ?? 0} pad={0} onSave={(n) => patch({ encountered: n })} />
                    </Stat>
                    <Stat label="Habitat" empty={!(entity as any).habitat?.trim()} span={2} valueStyle={{ fontSize: 14 }}><EditableText value={(entity as any).habitat ?? ""} onSave={(v) => patch({ habitat: v })} placeholder="— where it is met —" /></Stat>
                  </>
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
                    {hasChildArcs ? (
                      <Stat label="Saga" span={2} valueStyle={{ fontSize: 13 }}>
                        <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "var(--ink-secondary)" }}>
                          a saga in its own right
                        </span>
                      </Stat>
                    ) : (
                      <Stat label="Part of Saga" empty={!(entity as any).parentId} span={2} valueStyle={{ fontSize: 13 }}><EntitySelect value={(entity as any).parentId} options={sagaOptions} allowClear onSave={(id) => patch({ parentId: id ?? "" })} /></Stat>
                    )}
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
                    <span className="fleuron">✦ </span>Last seen — Session {campaign.sessions.find((s) => s.id === (entity as any).lastSeen)?.num}
                  </span>
                )}
                {(entity as any).session && (
                  <span className="session-ribbon">
                    <span className="fleuron">✦ </span>{kind === "events" ? "During" : "Introduced"} — Session {campaign.sessions.find((s) => s.id === (entity as any).session)?.num}
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
              {kind === "sessions" && <AttendanceRegister sessionId={entityId} />}

              <h3>Chronicle</h3>

              {kind === "sessions" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="What happened this session…"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
              )}

              {kind === "sessions" && isDm && (
                <SessionPrepList sessionId={entityId} onOpen={onOpen} />
              )}

              {showFeed && (
                <div className="detail-feed">
                  <h3 style={{ marginTop: 28 }}>As It Happened</h3>
                  <div className="detail-feed-rows">
                    {sessionFeed.map((ev) => (
                      <FeedRow key={ev.id} ev={ev} onOpenEntity={onOpen} />
                    ))}
                  </div>
                  {isDm && (
                    <button
                      className="draft-recap-btn"
                      disabled={draftingRecap}
                      onClick={draftRecap}
                      title="Append a markdown digest of this feed to the Chronicle — existing prose is kept"
                    >
                      {draftingRecap ? "…" : "✒ DRAFT RECAP FROM FEED"}
                    </button>
                  )}
                </div>
              )}

              {kind === "arcs" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="The shape of this arc…"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
              )}

              {kind === "events" && (
                <div className="long-note">
                  <EditableMarkdown
                    value={(entity as any).summary ?? ""}
                    onSave={(v) => patch({ summary: v })}
                    placeholder="What came to pass…"
                    style={{ fontFamily: "var(--font-body)" }}
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
                    style={{ fontFamily: "var(--font-body)" }}
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
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
              )}

              {("desc" in (entity as any)) && kind !== "people" && (
                <div className="long-note">
                  <EditableText
                    multiline
                    value={(entity as any).desc ?? ""}
                    onSave={(v) => patch({ desc: v })}
                    placeholder={kind === "monsters" ? "What the party has learned of it…" : "Describe this…"}
                    style={{ fontFamily: "var(--font-body)" }}
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

              {/* DM-only notes (issue #70): one coarse field per entity, the
                  80% substitute for per-section permissions. Stored in the
                  dm_notes side table whose RLS is DM-only (issue #73), so
                  campaign.dmNotes is empty on every non-DM client; the isDm
                  gate here is the view-as-player affordance, not security. */}
              {isDm && kind !== "arcs" && kind !== "events" && (
                <div className="dm-note">
                  <div className="dm-note-head"><Fleurons>DM'S EYES ONLY</Fleurons></div>
                  <EditableMarkdown
                    value={campaign.dmNotes[entityId] ?? ""}
                    onSave={(v) => updateDmNotes(entityId, v).catch((e) => console.error("updateDmNotes failed", e))}
                    placeholder="Prep notes the party never sees…"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
              )}

              <h3 style={{ marginTop: 28 }}>Party Notes</h3>
              <div className="notes-stack">
                {notes.length === 0 && (
                  <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", color: "var(--ink-secondary)", fontSize: 13 }}>
                    No notes yet. The margin waits.
                  </div>
                )}
                {notes.map((n, i) => (
                  <div key={i}
                       className={`note-scrap ${n.hand ? "" : "typed"}`}
                       style={{ transform: `rotate(${((i * 37) % 5 - 2) * 0.4}deg)` }}
                  >
                    <div className="note-body">{n.text}</div>
                    <div className="meta">
                      <span>— {resolveAuthor(n) ?? "Anonymous"}</span>
                      <span>{n.when}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Prose, so plain Enter makes a paragraph and ⌘/Ctrl+Enter pins.
                  Never sends on blur — see the rule on NoteComposer. */}
              {canEdit && <NoteComposer
                draftKey={noteDraftKey}
                placeholder="Leave a note in the margin…"
                sendOn="modEnter"
                submitLabel={<ThemedLabel parchment="Pin the note" atlas="Add note" />}
                submitTitle="Pin this note to the margin (⌘/Ctrl + Enter)"
                onSubmit={addNote}
              />}
            </div>

            <div className="detail-rail">
              <div style={{ fontFamily: "var(--font-fell-sc)", fontSize: 11, letterSpacing: ".16em", color: "var(--ink-secondary)", marginBottom: 14 }}>
                <Fleurons>RELATIONS</Fleurons>
              </div>

              {kind === "events" && <EventParticipantsEditor eventId={entityId} onOpen={onOpen} />}

              {(["people", "locations", "quests", "goals", "factions", "items", "lore", "monsters", "sessions", "arcs", "events"] as const).map((k) => {
                const list = related[k];
                if (!list || list.length === 0) return null;
                const label: Record<string, string> = {
                  people: "Known Folk", locations: "Places", quests: "Quests",
                  goals: "Goals", factions: "Factions", items: "Items & Relics",
                  lore: "Lore", monsters: "Bestiary", sessions: "Sessions",
                  arcs: "Sagas & Arcs", events: "Events",
                };
                return (
                  <div className="rail-section" key={k}>
                    <h4>{label[k]}</h4>
                    {/* Keyed by (entity, rel) rather than index: the chip now holds a
                        focusable button, so reconciling by position would re-render the
                        focused node as a different relation after a delete. */}
                    {list.map((r) => (
                      <div key={`${r.entity.id}|${r.rel}`} className={`rail-chip ${k}`} onClick={() => onOpen(r.entity.id)}>
                        <div className="rc-icon"><Icon name={kindIcon[k]} size={14} /></div>
                        <div style={{ flex: 1 }}>
                          <div className="rc-name">{entityLabel(r.entity)}</div>
                          <div className="rc-rel">
                            {r.rel}
                            {r.tag && <span className="rc-tag">{r.tag}</span>}
                          </div>
                        </div>
                        {/* ✕ replaces the chevron rather than joining it: the chevron is
                            decoration (the whole chip navigates), and two glyphs a few px
                            apart — one harmless, one irreversible — is the worst misclick
                            geometry. The swap also makes provenance legible: chevron =
                            derived and read-only, ✕ = a string you drew and can cut, the
                            same split the board makes with dashed yarn. */}
                        {r.edge && canEdit ? (
                          <button
                            type="button"
                            className="rc-unpin"
                            title="Remove this connection"
                            aria-label={`Remove connection: ${r.rel} — ${entityLabel(r.entity)}`}
                            onClick={(ev) => { ev.stopPropagation(); removeRelation(r.edge!, entityLabel(r.entity)); }}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        ) : (
                          <Icon name="chevron" size={12} />
                        )}
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
    {/* Sibling of the overlay, not a child: the lightbox portals to <body>,
        but React events still bubble through the component tree, and keeping
        it out of the overlay means a click on the plate can never be mistaken
        for a backdrop click that dismisses the sheet underneath. */}
    {plateOpen && <PlateLightbox monsterId={entityId} onClose={() => setPlateOpen(false)} />}
    </>
  );
}
