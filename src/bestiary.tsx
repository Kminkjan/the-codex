import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MONSTER_THREAT_OPTIONS, sessionLabel, sortForDisplay, type Monster } from "./data";
import { useCampaign, useIsDm } from "./hooks";
import { useAuth } from "./auth";
import { Icon } from "./icons";
import { Fleurons, ThemedLabel } from "./components";
import { NEW_ENTITY_DEFAULTS } from "./board";
import { createEntity } from "./mutations";
import { creatureTypes, inkedMonsters, type Encounter } from "./monsters";

// ============================================================================
// The Bestiary — the monsters kind's bespoke page (the generic KindList grid is
// bypassed for it in App.tsx). This kind exists for artwork, so the artwork is
// the layout: a wall of illustrated plates that inks itself in as the party
// meets things. See bestiary.ts for how "met" is derived and, importantly, for
// why the un-inked state is presentation rather than secrecy.
// ============================================================================

const ALL = "all";

// ---------------------------------------------------------------------------
// Full-bleed plate. The reason the artwork is here at all: at the table you
// want the illustration filling the screen, not a 240px thumbnail. Exported
// because App.tsx opens it too — a ⚡ SHOW NOW on a monster lands art-first on
// every player's screen.
//
// Portalled to <body> so it escapes the detail sheet's overflow container and
// backdrop-filter, the same reason EntityCombobox's popover is portalled.
// ---------------------------------------------------------------------------
export function PlateLightbox({ monsterId, onClose }: { monsterId: string; onClose: () => void }) {
  const campaign = useCampaign();
  const monster = campaign.monsters.find((m) => m.id === monsterId);

  // Esc closes the plate — and ONLY the plate. Registered in the CAPTURE phase
  // on purpose: the detail sheet's own Esc handler is a bubble-phase window
  // listener that was registered first (the sheet mounts before the plate
  // opens), so plain registration order would let the sheet close underneath us
  // while the artwork stayed up. That's the ⚡ SHOW NOW flow exactly, which
  // opens both at once. Capture runs before every bubble listener regardless of
  // order, so claiming the key here and marking it handled makes "topmost
  // overlay wins" true rather than accidental.
  //
  // Nothing on screen means nothing to claim: if the artwork was cleared out
  // from under us (a realtime edit, a re-hide) this renders null below, and a
  // capture listener still swallowing Esc would make the key do nothing —
  // a dead key, which is the thing the codebase keeps refusing to ship.
  const showing = !!monster?.imageUrl;
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, showing]);

  // A deleted or re-hidden monster drops out of the campaign object; retire the
  // overlay rather than render an empty void over the app. (The parent's slot
  // state clears on its own next open — nothing here is left stuck, and with
  // the effect above disarmed Esc reaches the sheet underneath as usual.)
  if (!showing) return null;

  return createPortal(
    <div className="plate-lightbox" onMouseDown={onClose} role="dialog" aria-label={monster.name}>
      <button className="plate-lightbox-close" onClick={onClose} title="Close the plate">
        <Icon name="close" size={18} />
      </button>
      <img
        className="plate-lightbox-img"
        src={monster.imageUrl}
        alt={monster.name}
        onMouseDown={(e) => e.stopPropagation()}
      />
      <div className="plate-lightbox-caption" onMouseDown={(e) => e.stopPropagation()}>
        {!!monster.kind?.trim() && <span className="plate-lightbox-type">{monster.kind}</span>}
        <span className="plate-lightbox-name">{monster.name}</span>
        {monster.threat && <span className={`m-threat ${monster.threat}`}>{monster.threat}</span>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// One plate on the wall.
// ---------------------------------------------------------------------------
function Plate({ monster, met, onOpen, onZoom }: {
  monster: Monster;
  met: Encounter | undefined;
  onOpen: (id: string) => void;
  onZoom: (id: string) => void;
}) {
  const campaign = useCampaign();
  const inked = !!met;
  const firstSession = met?.firstSessionId
    ? campaign.sessions.find((s) => s.id === met.firstSessionId)
    : undefined;

  const classes = [
    "plate",
    inked ? "" : "is-uninked",
    monster.archived ? "archived" : "",
    monster.pinned ? "is-pinned" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={classes} onClick={() => onOpen(monster.id)}>
      {/* Hidden rows never reach non-DM clients (projected out upstream), so
          this badge needs no role check — if it renders, you're the DM. */}
      {monster.hidden && <span className="veil-badge">unrevealed</span>}
      <div className="plate-art">
        {inked && monster.imageUrl ? (
          <>
            <img className="plate-art-img" src={monster.imageUrl} alt={monster.name} />
            <button
              className="plate-zoom"
              title="Show the plate full size"
              onClick={(e) => { e.stopPropagation(); onZoom(monster.id); }}
            >
              ⛶
            </button>
          </>
        ) : (
          // Un-inked, or met but never illustrated — the same empty frame either
          // way, since both mean "no plate has been drawn here yet".
          <span className="plate-art-empty">
            <Icon name="monster" size={46} strokeWidth={1.1} />
          </span>
        )}
        {inked && monster.threat && <span className={`m-threat ${monster.threat}`}>{monster.threat}</span>}
      </div>
      <div className="plate-body">
        {!!monster.kind?.trim() && <div className="m-type"><Fleurons>{monster.kind}</Fleurons></div>}
        <div className="plate-name">{monster.name}</div>
        {inked ? (
          <div className="plate-stamp">
            {firstSession
              ? <ThemedLabel
                  parchment={`First met — Session ${firstSession.num}`}
                  atlas={`First met ${sessionLabel(firstSession.num)}`}
                />
              : <ThemedLabel parchment="Met by the party" atlas="Encountered" />}
          </div>
        ) : (
          <div className="plate-stamp is-uninked">
            <ThemedLabel parchment="No plate inked yet" atlas="Not yet encountered" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The wall.
// ---------------------------------------------------------------------------
export function BestiaryPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const { canEdit } = useAuth();
  const isDm = useIsDm();
  const [typeFacet, setTypeFacet] = useState(ALL);
  const [threatFacet, setThreatFacet] = useState(ALL);
  // The un-inked frames are the whole point of the wall, so they're on by
  // default; the toggle is for a DM who wants to see only what's been met.
  const [showUninked, setShowUninked] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [zoomId, setZoomId] = useState<string | null>(null);

  const met = useMemo(() => inkedMonsters(campaign), [campaign.monsters, campaign.sessionEvents]);
  const types = useMemo(() => creatureTypes(campaign.monsters), [campaign.monsters]);

  const archivedCount = campaign.monsters.filter((m) => m.archived).length;
  // Progress counts the whole (visible) bestiary, not the filtered view — a
  // facet shouldn't make it read as though plates were lost.
  const total = campaign.monsters.filter((m) => !m.archived).length;
  const inkedCount = campaign.monsters.filter((m) => !m.archived && met.has(m.id)).length;

  const shown = useMemo(() => {
    let list = showArchived ? campaign.monsters : campaign.monsters.filter((m) => !m.archived);
    if (typeFacet !== ALL) list = list.filter((m) => m.kind?.trim().toLowerCase() === typeFacet);
    if (threatFacet !== ALL) list = list.filter((m) => m.threat === threatFacet);
    if (!showUninked) list = list.filter((m) => met.has(m.id));
    return sortForDisplay(list, { kind: "monsters" });
  }, [campaign.monsters, showArchived, typeFacet, threatFacet, showUninked, met]);

  const facetsActive = typeFacet !== ALL || threatFacet !== ALL || !showUninked;

  const onNew = () => {
    const id = crypto.randomUUID();
    // Same prep-time visibility default as the board's "Pin new" and the
    // people list's "New person" (#107): a DM writing up a monster outside a
    // live session is prepping a spoiler, and there's no draft state, so a
    // visible insert would broadcast the half-typed beast to the whole party.
    const hide = isDm && !campaign.activeSessionId;
    createEntity("monsters", id, { ...NEW_ENTITY_DEFAULTS.monsters, ...(hide ? { hidden: true } : {}) })
      .then(() => onOpenEntity(id))
      .catch(console.error);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40, color: "var(--ink)", letterSpacing: ".01em" }}>
            <ThemedLabel parchment="The Bestiary" atlas="Bestiary" />
          </h1>
          <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 16, color: "var(--ink-faded)" }}>
            {total === 0
              ? <ThemedLabel parchment="not a single plate" atlas="no creatures yet" />
              : <ThemedLabel
                  parchment={`${inkedCount} of ${total} plates inked`}
                  atlas={`${inkedCount} of ${total} encountered`}
                />}
          </span>
          {canEdit && (
            <button className="btn btn-ghost" onClick={onNew} title="Add a creature to the bestiary">
              <Icon name="plus" size={13} /> <ThemedLabel parchment="New creature" atlas="New creature" />
            </button>
          )}
          {archivedCount > 0 && (
            <span style={{ marginLeft: "auto" }}>
              <button onClick={() => setShowArchived((v) => !v)} className="cleanup-link-btn">
                {showArchived ? `hide ${archivedCount} archived` : `show ${archivedCount} archived`}
              </button>
            </span>
          )}
        </div>

        {campaign.monsters.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
            {types.length > 0 && (
              <select className="facet-select" value={typeFacet} onChange={(e) => setTypeFacet(e.target.value)} title="Filter by creature type">
                <option value={ALL}>every type</option>
                {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            )}
            <select className="facet-select" value={threatFacet} onChange={(e) => setThreatFacet(e.target.value)} title="Filter by threat">
              <option value={ALL}>any threat</option>
              {MONSTER_THREAT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="cleanup-link-btn" onClick={() => setShowUninked((v) => !v)}>
              {showUninked ? "hide un-inked plates" : "show un-inked plates"}
            </button>
            {facetsActive && (
              <button className="cleanup-link-btn" onClick={() => { setTypeFacet(ALL); setThreatFacet(ALL); setShowUninked(true); }}>
                clear filters
              </button>
            )}
          </div>
        )}

        <div className="scratch-divider"><em>✦ ✦ ✦</em></div>

        {shown.length === 0 ? (
          <p style={{ marginTop: 30, fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 15, color: "var(--ink-faded)" }}>
            {campaign.monsters.length === 0
              ? <ThemedLabel
                  parchment="No creature has been set down in these pages yet."
                  atlas="No creatures recorded yet."
                />
              : <ThemedLabel
                  parchment="No plate answers to that description."
                  atlas="Nothing matches those filters."
                />}
          </p>
        ) : (
          <div className="plate-wall">
            {shown.map((m) => (
              <Plate
                key={m.id}
                monster={m}
                met={met.get(m.id)}
                onOpen={onOpenEntity}
                onZoom={setZoomId}
              />
            ))}
          </div>
        )}
      </div>

      {zoomId && <PlateLightbox monsterId={zoomId} onClose={() => setZoomId(null)} />}
    </div>
  );
}
