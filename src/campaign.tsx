import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./utils/supabase";
import { sessionLabel } from "./data";
import { useCampaign, useIsDm, useKinds, usePresence } from "./hooks";
import { EditableText } from "./components";
import { updateCampaign } from "./mutations";
import { uploadEntityImage } from "./upload";
import { excerpt } from "./arcs";

// ============================================================================
// The Campaign Charter (issue #85) — a parchment frontispiece for the whole
// campaign: identity plate (DM-editable), living stats, the party, and a
// sessions ledger. Everything except the roster reads already-loaded
// campaign state, so the viewer projection applies automatically.
// ============================================================================

const LEDGER_PREVIEW = 10;

// Tiny deterministic string hash — varies the procedural crest ornament per
// campaign title. Not crypto, just stable visual variety.
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Initials for the procedural seal: first letters of the first two
// meaningful title words ("The Fist of Ilmater" → "FI").
function sealInitials(title: string): string {
  const minor = new Set(["the", "of", "a", "an", "and", "de", "van", "het"]);
  const words = title.split(/\s+/).filter((w) => w && !minor.has(w.toLowerCase()));
  const picked = (words.length ? words : title.split(/\s+/)).slice(0, 2);
  return picked.map((w) => w[0]?.toUpperCase() ?? "").join("") || "✦";
}

// Procedural wax-seal crest — the default when no image is uploaded. Wax
// colors are hardcoded like the .wax-seal class (it's wax, not text on card
// stock); the ornament ring's dash pattern and rotation vary by title hash.
function CrestSeal({ title, size }: { title: string; size: number }) {
  const h = hashString(title);
  const dash = 3 + (h % 4);
  const gap = 2 + ((h >> 3) % 4);
  const rotate = h % 360;
  const initials = sealInitials(title);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Wax seal of ${title}`}>
      <defs>
        <radialGradient id="charter-wax" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#b53a2a" />
          <stop offset="60%" stopColor="#7a1f14" />
          <stop offset="100%" stopColor="#4a120a" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#charter-wax)" stroke="rgba(0,0,0,.35)" strokeWidth="1" />
      <circle
        cx="50" cy="50" r="41"
        fill="none" stroke="rgba(255,220,180,.3)" strokeWidth="1.5"
        strokeDasharray={`${dash} ${gap}`}
        transform={`rotate(${rotate} 50 50)`}
      />
      <circle cx="50" cy="50" r="35" fill="none" stroke="rgba(255,220,180,.15)" strokeWidth="1" />
      <text
        x="50" y="50"
        textAnchor="middle" dominantBaseline="central"
        fill="#f4d9a0"
        style={{ fontFamily: "var(--font-fell-sc)", fontSize: initials.length > 1 ? 30 : 38, letterSpacing: ".04em" }}
      >
        {initials}
      </text>
    </svg>
  );
}

// Crest slot: uploaded image when set, procedural seal otherwise. The DM
// gets replace/remove affordances; everyone else sees the plain crest.
// Deliberately not EntityPortrait — that component is entity-shaped
// (KindKey fallbacks, sheet classes).
function CharterCrest() {
  const campaign = useCampaign();
  const isDm = useIsDm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadEntityImage(file, "campaign", campaign.id);
      await updateCampaign({ imageUrl: url });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clear = () => {
    if (!window.confirm("Remove the campaign crest?")) return;
    updateCampaign({ imageUrl: null }).catch(console.error);
  };

  const size = 116;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, flexShrink: 0 }}>
      {campaign.imageUrl ? (
        <img
          src={campaign.imageUrl}
          alt={`Crest of ${campaign.title}`}
          style={{
            width: size, height: size, objectFit: "cover", borderRadius: "50%",
            border: "1px solid var(--vellum-deep)", boxShadow: "0 2px 8px rgba(40,20,5,.25)",
          }}
        />
      ) : (
        <CrestSeal title={campaign.title} size={size} />
      )}
      {isDm && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button className="cleanup-link-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "sealing…" : campaign.imageUrl ? "replace crest" : "upload crest"}
            </button>
            {campaign.imageUrl && (
              <button className="cleanup-link-btn" onClick={clear}>remove</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// "191 sessions · chronicled across three years" — best-effort: session
// dates are free text, so unparseable dates degrade to the count alone.
function chronicleEpigraph(sessions: { date?: string }[]): string | null {
  if (sessions.length === 0) return null;
  const count = `${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`;
  const times = sessions
    .map((s) => (s.date ? Date.parse(s.date) : NaN))
    .filter((t) => !Number.isNaN(t));
  if (times.length < 2) return `${count} chronicled`;
  const spanDays = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  const words = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const inWords = (n: number) => words[n] ?? String(n);
  const years = Math.round(spanDays / 365.25);
  const months = Math.round(spanDays / 30.44);
  const span =
    years >= 2 ? `across ${inWords(years)} years`
    : months >= 12 ? "across a year and more"
    : months >= 2 ? `across ${inWords(months)} months`
    : months === 1 ? "within a single month"
    : null;
  return span ? `${count} · chronicled ${span}` : `${count} chronicled`;
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div style={{
      fontFamily: "var(--font-fell-sc)", letterSpacing: ".25em", fontSize: 12,
      color: "var(--ink-secondary)", marginTop: 38, marginBottom: 14,
    }}>
      ✦ {children} ✦
    </div>
  );
}

interface RosterEntry {
  userId: string;
  role: "dm" | "player";
  name: string | null;
  avatarUrl: string | null;
}

export function CampaignCharterPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const isDm = useIsDm();
  const kinds = useKinds();
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);

  // Party roster: campaign_members joined with profiles in JS (no FK
  // between them, so no PostgREST embed). Members are dashboard-managed and
  // not realtime-published; profiles staleness is accepted for v1 — the
  // fetch reruns per charter mount / campaign switch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: members, error } = await supabase
        .from("campaign_members")
        .select("user_id,role")
        .eq("campaign_id", campaign.id);
      if (cancelled) return;
      if (error) { console.error(error); setRoster([]); return; }
      const ids = (members ?? []).map((m: any) => m.user_id as string);
      const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      if (ids.length > 0) {
        const { data: profs, error: pErr } = await supabase
          .from("profiles")
          .select("user_id,display_name,avatar_url")
          .in("user_id", ids);
        if (cancelled) return;
        if (pErr) console.error(pErr);
        (profs ?? []).forEach((p: any) => profiles.set(p.user_id, p));
      }
      const entries: RosterEntry[] = (members ?? []).map((m: any) => ({
        userId: m.user_id,
        role: m.role,
        name: profiles.get(m.user_id)?.display_name ?? null,
        avatarUrl: profiles.get(m.user_id)?.avatar_url ?? null,
      }));
      // DM first, then named members alphabetically, unnamed last.
      entries.sort((a, b) =>
        a.role !== b.role ? (a.role === "dm" ? -1 : 1) : (a.name ?? "￿").localeCompare(b.name ?? "￿"));
      setRoster(entries);
    })();
    return () => { cancelled = true; };
  }, [campaign.id]);

  const liveSession = campaign.sessions.find((s) => s.id === campaign.activeSessionId);
  const epigraph = chronicleEpigraph(campaign.sessions);
  const lastPlayed = useMemo(() => {
    const dated = campaign.sessions.filter((s) => s.date).sort((a, b) => b.num - a.num);
    return dated[0] ?? null;
  }, [campaign.sessions]);
  // Presence is "who has the codex open now" — live channel occupancy
  // (issue #74), everyone shown is online. Deliberately a separate strip,
  // not a roster decoration, even though tracked ids are auth uuids now.
  const atTheTable = usePresence();
  const orderedSessions = useMemo(
    () => [...campaign.sessions].sort((a, b) => b.num - a.num),
    [campaign.sessions],
  );
  const ledger = ledgerExpanded ? orderedSessions : orderedSessions.slice(0, LEDGER_PREVIEW);

  const titleStyle: React.CSSProperties = {
    fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 40,
    color: "var(--ink)", letterSpacing: ".01em", lineHeight: 1.15,
  };
  const subtitleStyle: React.CSSProperties = {
    fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 17, color: "var(--ink-body)",
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 40px 60px", background: "var(--vellum)", position: "relative" }} className="tex-vellum">
      <div style={{ position: "relative", zIndex: 1, maxWidth: 860 }}>
        <div style={{
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".3em", fontSize: 12,
          color: "var(--ink-secondary)", textAlign: "center", marginBottom: 18,
        }}>
          ✦ THE CAMPAIGN CHARTER ✦
        </div>

        {/* Identity plate. The isDm wrapper (not just EditableText's canEdit
            gate) is load-bearing: a non-DM editor's write would match 0 rows
            under 0020's DM-only policy, silently. View-as-player folds into
            isDm, hiding the affordances. */}
        <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
          <CharterCrest />
          <div style={{ minWidth: 0, flex: 1 }}>
            {isDm ? (
              <EditableText
                value={campaign.title}
                onSave={(v) => {
                  const t = v.trim();
                  if (!t) return false; // campaigns.title is NOT NULL
                  updateCampaign({ title: t }).catch(console.error);
                }}
                style={titleStyle}
              />
            ) : (
              <h1 style={{ ...titleStyle, margin: 0 }}>{campaign.title}</h1>
            )}
            {isDm ? (
              <EditableText
                value={campaign.subtitle}
                onSave={(v) => updateCampaign({ subtitle: v }).catch(console.error)}
                placeholder="Add a subtitle…"
                style={subtitleStyle}
              />
            ) : (
              campaign.subtitle && <div style={subtitleStyle}>{campaign.subtitle}</div>
            )}
            {epigraph && (
              <div style={{
                fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14,
                color: "var(--ink-secondary)", marginTop: 8,
              }}>
                {epigraph}
              </div>
            )}
          </div>
        </div>

        <div className="scratch-divider" style={{ marginTop: 22 }}><em>✦ ✦ ✦</em></div>

        {/* Living stats — derived from loaded state, no extra queries. */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18, alignItems: "stretch" }}>
          <StatTile label="SESSIONS PLAYED" value={String(campaign.sessions.length)} />
          {lastPlayed?.date && <StatTile label="LAST PLAYED" value={lastPlayed.date} />}
          {liveSession && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 14px", border: "1px solid var(--bloodred)", borderRadius: 4,
              background: "var(--paper-cream)",
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", background: "var(--bloodred)",
                boxShadow: "0 0 0 2px rgba(138,42,31,.25)", flexShrink: 0,
              }} />
              <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".15em", fontSize: 11, color: "var(--bloodred)" }}>
                LIVE · SESSION {liveSession.num}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
          {kinds.map((k) => {
            const list = k.list() as { archived?: boolean }[];
            const active = list.filter((e) => !e.archived).length;
            return <StatTile key={k.key} label={k.plural.toUpperCase()} value={String(active)} dotColor={k.color} />;
          })}
        </div>

        {/* The Party — read-only in this phase; management is issue #86. */}
        <SectionHeading>THE PARTY</SectionHeading>
        {roster === null ? (
          <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
            Consulting the rolls…
          </div>
        ) : roster.length === 0 ? (
          <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
            No members are recorded on this charter yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {roster.map((m) => (
              <div
                key={m.userId}
                style={{
                  position: "relative",
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 14px",
                  background: "var(--paper-cream)",
                  border: "1px solid var(--vellum-deep)",
                  borderRadius: 22,
                  boxShadow: "0 1px 2px rgba(40,20,5,.12)",
                }}
              >
                {m.avatarUrl ? (
                  <img
                    src={m.avatarUrl}
                    alt=""
                    style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--vellum-deep)" }}
                  />
                ) : (
                  <span style={{
                    width: 28, height: 28, borderRadius: "50%", background: "var(--vellum-deep)",
                    display: "grid", placeItems: "center",
                    fontFamily: "var(--font-fell-sc)", fontSize: 12, color: "var(--ink-secondary)",
                  }}>
                    {(m.name?.[0] ?? "?").toUpperCase()}
                  </span>
                )}
                {m.name ? (
                  <span style={{ fontFamily: "var(--font-fell)", fontSize: 14, color: "var(--ink)" }}>{m.name}</span>
                ) : (
                  <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14, color: "var(--ink-faded)" }}>
                    an unnamed adventurer
                  </span>
                )}
                {m.role === "dm" && (
                  <span
                    className="wax-seal"
                    title="Dungeon Master"
                    style={{ top: -9, right: -9, width: 26, height: 26, fontSize: 9 }}
                  >
                    DM
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {atTheTable.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 11,
              color: "var(--ink-secondary)", marginBottom: 8,
            }}>
              AT THE TABLE · {atTheTable.length}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {atTheTable.map((p) => (
                <span
                  key={p.id}
                  title={p.name}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "3px 10px",
                    background: "var(--paper-cream)", border: "1px solid var(--vellum-deep)",
                    borderRadius: 12, fontFamily: "var(--font-fell)", fontSize: 12, color: "var(--ink)",
                  }}
                >
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: p.color || "var(--forest)",
                    // Neutral glow — p.color's format isn't guaranteed hex6,
                    // so no alpha-suffix tricks on it.
                    boxShadow: "0 0 5px 1px rgba(138,42,31,.3)",
                    flexShrink: 0,
                  }} />
                  {p.name || p.initials}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sessions ledger — links into the existing detail flow. Go-live
            lives on the SessionPin; the charter only reads. */}
        <SectionHeading>SESSIONS LEDGER</SectionHeading>
        {orderedSessions.length === 0 ? (
          <div style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
            The first session is yet to be written.
          </div>
        ) : (
          <>
            {ledger.map((s) => {
              const snippet = excerpt(s.summary);
              const isLive = s.id === campaign.activeSessionId;
              return (
                <button
                  key={s.id}
                  onClick={() => onOpenEntity(s.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: "none", border: "none", cursor: "pointer",
                    padding: "10px 4px",
                    borderBottom: "1px dashed var(--vellum-deep)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".1em", fontSize: 12, color: isLive ? "var(--bloodred)" : "var(--ink-secondary)" }}>
                      {sessionLabel(s.num).toUpperCase()}
                    </span>
                    <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>
                      {s.title}
                    </span>
                    {s.date && (
                      <span style={{ fontFamily: "var(--font-fell)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)" }}>
                        {s.date}
                      </span>
                    )}
                    {isLive && (
                      <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".15em", fontSize: 10, color: "var(--bloodred)" }}>
                        ● LIVE NOW
                      </span>
                    )}
                  </div>
                  {snippet && (
                    <div style={{ fontFamily: "var(--font-fell)", fontSize: 14, color: "var(--ink-body)", marginTop: 3 }}>
                      {snippet}
                    </div>
                  )}
                </button>
              );
            })}
            {orderedSessions.length > LEDGER_PREVIEW && (
              <button
                className="cleanup-link-btn"
                onClick={() => setLedgerExpanded((e) => !e)}
                style={{ marginTop: 12 }}
              >
                {ledgerExpanded
                  ? "show fewer"
                  : `show the full chronicle (${orderedSessions.length - LEDGER_PREVIEW} more)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, dotColor }: { label: string; value: string; dotColor?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px",
      background: "var(--paper-cream)", border: "1px solid var(--vellum-deep)", borderRadius: 4,
    }}>
      {dotColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
      <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".15em", fontSize: 11, color: "var(--ink-secondary)" }}>
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, color: "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}
