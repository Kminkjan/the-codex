import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./utils/supabase";
import { isPc, sessionLabel } from "./data";
import { useCampaign, useCampaignSwitcher, useIsDm, useKinds, useMembershipRefresh, usePresence, useProfiles } from "./hooks";
import { useAuth } from "./auth";
import { EditableText, EntitySelect, EnumSelect, ThemedLabel } from "./components";
import {
  updateCampaign, archiveCampaign, addMember, removeMember, setMemberRole,
  bindPlayerCharacter,
  listCampaignInvites, createCampaignInvite, revokeCampaignInvite,
  type CampaignInvite,
} from "./mutations";
import { inviteUrl } from "./route";
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
// Exported for the sealed letter of summons (join.tsx, issue #86).
export function CrestSeal({ title, size }: { title: string; size: number }) {
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

// DM-only: seat someone the app already knows, without the invite round-trip.
// An invite link is the right tool for a stranger; it's the wrong one for a
// player sitting in presence right now, whose auth uuid and name are already
// on screen. Both stay — this is the direct path, InviteCard is the link path.
//
// The directory is profilesById (issue #114), which already holds every
// account that has ever signed in, so there is no new fetch and no new read
// surface: profiles is world-readable by design (0020). Candidates are named
// profiles that aren't already on the charter — an unnamed row is either a
// stale mirror or an account nobody could identify in a picker anyway.
//
// Mounted only under isDm, matching add_campaign_member's DM gate (0038).
function SeatMemberCard({
  memberIds,
  onSeat,
}: {
  memberIds: Set<string>;
  onSeat: (userId: string, name: string) => void;
}) {
  const profilesById = useProfiles();
  const atTheTable = usePresence();
  const [query, setQuery] = useState("");

  // Everyone present but not seated. Presence is the whole point of this
  // card — these are the people the DM is most likely reaching for — so they
  // get their own row of one-click chips above the search.
  const presentCandidates = useMemo(
    () => atTheTable.filter((p) => !memberIds.has(p.id)),
    [atTheTable, memberIds],
  );

  // Presence ids are already offered above, so they're filtered out here to
  // keep one candidate in one place.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const present = new Set(presentCandidates.map((p) => p.id));
    return [...profilesById.values()]
      .filter((p) =>
        p.displayName
        && !memberIds.has(p.userId)
        && !present.has(p.userId)
        && (!q || p.displayName.toLowerCase().includes(q)))
      .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));
  }, [profilesById, memberIds, presentCandidates, query]);

  // Untruncated only while searching: the unfiltered directory grows with
  // every account that ever signs in, and this card is an aside on the
  // charter, not a user-management screen.
  const LIST_PREVIEW = 6;
  const shown = query.trim() ? candidates : candidates.slice(0, LIST_PREVIEW);
  const hiddenCount = candidates.length - shown.length;

  return (
    <div style={{
      marginTop: 18, padding: "14px 18px",
      background: "var(--paper-cream)", border: "1px solid var(--vellum-deep)",
      borderRadius: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 11,
          color: "var(--ink-secondary)",
        }}>
          <ThemedLabel parchment="SEAT AN ADVENTURER" atlas="Add a member" />
        </span>
        <input
          className="parchment-input"
          style={{ fontSize: 13, padding: "4px 8px", width: 180 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search by name…"
          aria-label="Search known adventurers by name"
        />
      </div>

      {presentCandidates.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <span style={{
            fontFamily: "var(--font-fell-sc)", letterSpacing: ".16em", fontSize: 10,
            color: "var(--ink-secondary)",
          }}>
            <ThemedLabel parchment="AT THE TABLE" atlas="At the table" />
          </span>
          {presentCandidates.map((p) => (
            <button
              key={p.id}
              className="cleanup-link-btn"
              style={{ fontStyle: "normal" }}
              onClick={() => onSeat(p.id, p.name)}
            >
              + {p.name}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)", marginTop: 10 }}>
          {query.trim() ? (
            <ThemedLabel
              parchment="No known adventurer by that name."
              atlas="No account matches that name."
            />
          ) : presentCandidates.length > 0 ? (
            <ThemedLabel
              parchment="Everyone else the codex knows is already on this charter."
              atlas="Everyone else with an account is already a member."
            />
          ) : (
            <ThemedLabel
              parchment="Everyone the codex knows is already on this charter. Forge an invite link for a newcomer."
              atlas="Everyone with an account is already a member. Use an invite link for someone new."
            />
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {shown.map((p) => (
            <button
              key={p.userId}
              className="cleanup-link-btn"
              style={{ fontStyle: "normal", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => onSeat(p.userId, p.displayName!)}
            >
              {p.avatarUrl ? (
                <img
                  src={p.avatarUrl}
                  alt=""
                  style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
                />
              ) : null}
              + {p.displayName}
            </button>
          ))}
        </div>
      )}
      {hiddenCount > 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 12, color: "var(--ink-faded)", marginTop: 8 }}>
          …and {hiddenCount} more — search by name.
        </div>
      )}
    </div>
  );
}

// DM-only invite ledger (issue #86): forge a link, copy it, revoke it.
// Mounted only under isDm, so the campaign_invites SELECT (DM-only RLS)
// never fires for anyone it would return [] for. Local list state instead
// of realtime: invites are deliberately unpublished, and every mutation
// returns enough to patch the list in place.
function InviteCard() {
  const campaign = useCampaign();
  const [invites, setInvites] = useState<CampaignInvite[] | null>(null);
  const [forging, setForging] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCampaignInvites()
      .then((list) => { if (!cancelled) setInvites(list); })
      .catch((e) => { console.error(e); if (!cancelled) setInvites([]); });
    return () => { cancelled = true; };
  }, [campaign.id]);

  const forge = async () => {
    setForging(true);
    try {
      const invite = await createCampaignInvite();
      setInvites((prev) => [invite, ...(prev ?? [])]);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setForging(false);
    }
  };

  const copy = async (code: string) => {
    const url = inviteUrl(campaign.id, code);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      setTimeout(() => setCopied((c) => (c === code ? null : c)), 2000);
    } catch {
      // Clipboard needs a secure context — fall back to showing the link.
      window.prompt("Copy the invite link:", url);
    }
  };

  const revoke = async (code: string) => {
    if (!window.confirm("Revoke this invitation? Its link will stop working.")) return;
    try {
      await revokeCampaignInvite(code);
      setInvites((prev) => (prev ?? []).filter((i) => i.code !== code));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{
      marginTop: 18, padding: "14px 18px",
      background: "var(--paper-cream)", border: "1px solid var(--vellum-deep)",
      borderRadius: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <span style={{
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 11,
          color: "var(--ink-secondary)",
        }}>
          LETTERS OF INVITATION
        </span>
        <button className="cleanup-link-btn" onClick={() => void forge()} disabled={forging}>
          {forging ? "forging…" : "forge an invite link"}
        </button>
      </div>
      {invites === null ? (
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)", marginTop: 10 }}>
          Unfurling the ledger…
        </div>
      ) : invites.length === 0 ? (
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)", marginTop: 10 }}>
          No invitations are outstanding. Forge a link and share it with your players.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {invites.map((inv) => (
            <div key={inv.code} style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink-secondary)", whiteSpace: "nowrap" }}>
                {new Date(inv.createdAt).toLocaleDateString()}
              </span>
              <span
                title={inviteUrl(campaign.id, inv.code)}
                style={{
                  fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  maxWidth: 260, flexShrink: 1,
                }}
              >
                …?join={inv.code.slice(0, 8)}…
              </span>
              <button className="cleanup-link-btn" onClick={() => void copy(inv.code)}>
                {copied === inv.code ? "copied ✓" : "copy link"}
              </button>
              <button className="cleanup-link-btn" onClick={() => void revoke(inv.code)}>
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// DM-only danger zone (issue #87): soft-archive the campaign. Archive, not
// delete — the row and every entity stay in the DB (world-readable, even),
// the picker just stops listing it; un-archive is dashboard-only for now.
// Type-the-title confirmation gates the button, and the only campaign can't
// be archived (the provider would be stranded on "No campaigns found").
// Mounted only under isDm — archiveCampaign rides 0020's DM-only UPDATE.
function DangerZoneCard() {
  const campaign = useCampaign();
  const { campaigns, retireCampaign } = useCampaignSwitcher();
  const [confirmText, setConfirmText] = useState("");
  const [archiving, setArchiving] = useState(false);
  const onlyCampaign = campaigns.length <= 1;
  // Archiving mid-live would drop the pin without endLiveSession's 'end'
  // feed marker, breaking the start/end bracketing invariant — make the DM
  // stand down first instead of half-reimplementing that verb here.
  const sessionLive = !!campaign.activeSessionId;
  const armed = confirmText.trim() === campaign.title && !sessionLive;

  const archive = async () => {
    if (!armed || onlyCampaign || archiving) return;
    setArchiving(true);
    try {
      await archiveCampaign();
      // Switches to the first remaining campaign, unmounting this card —
      // no state updates after this line.
      retireCampaign(campaign.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
      setArchiving(false);
    }
  };

  return (
    <>
      <SectionHeading>THE FINAL PAGE</SectionHeading>
      <div style={{
        padding: "14px 18px",
        background: "var(--paper-cream)", border: "1px solid var(--bloodred)",
        borderRadius: 6,
      }}>
        <div style={{
          fontFamily: "var(--font-fell-sc)", letterSpacing: ".18em", fontSize: 11,
          color: "var(--bloodred)",
        }}>
          SHELVE THIS CAMPAIGN
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)", marginTop: 8 }}>
          {onlyCampaign
            ? "The last campaign in the codex cannot be shelved — found another first."
            : sessionLive
            ? "A session is live — stand down from the table before shelving this campaign."
            : "Shelving removes this campaign from the picker for everyone. Nothing is burned: its pages remain and a keeper of the archive can restore it. To proceed, write the campaign's full title."}
        </div>
        {!onlyCampaign && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input
              className="parchment-input"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={campaign.title}
              aria-label="Type the campaign title to confirm"
              style={{ minWidth: 220 }}
            />
            <button
              className="cleanup-link-btn"
              disabled={!armed || archiving}
              onClick={() => void archive()}
              style={{ color: "var(--bloodred)", opacity: armed ? 1 : 0.5 }}
            >
              {archiving ? "shelving…" : "archive this campaign"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// Membership only. Names and avatars are resolved from the profiles map at
// render, not stored here: baking them in made loadRoster depend on that map,
// so every profiles resolution changed the callback's identity and refetched
// campaign_members for a second time. The identity fields have their own
// lifecycle (a global, non-realtime mirror) — keeping them out of roster state
// lets each refresh on its own terms.
interface RosterEntry {
  userId: string;
  role: "dm" | "player";
}

export function CampaignCharterPage({ onOpenEntity }: { onOpenEntity: (id: string) => void }) {
  const campaign = useCampaign();
  const isDm = useIsDm();
  const kinds = useKinds();
  const { user, canEdit } = useAuth();
  const { membershipVersion, refreshMembership } = useMembershipRefresh();
  const profilesById = useProfiles();
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  // Sequence counter instead of an effect-scoped cancelled flag: loadRoster
  // is also called outside the effect (after membership RPCs), and only the
  // newest in-flight fetch may write state.
  const rosterSeq = useRef(0);

  // Party roster: who is a member, nothing more (no FK to profiles, so this was
  // never a PostgREST embed anyway). Not realtime-published — reruns per
  // charter mount / campaign switch, and on membershipVersion bumps after
  // membership RPCs (issue #86).
  const loadRoster = useCallback(async () => {
    const seq = ++rosterSeq.current;
    const { data: members, error } = await supabase
      .from("campaign_members")
      .select("user_id,role")
      .eq("campaign_id", campaign.id);
    if (seq !== rosterSeq.current) return;
    if (error) { console.error(error); setRoster([]); return; }
    setRoster((members ?? []).map((m: any) => ({ userId: m.user_id, role: m.role })));
  }, [campaign.id]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster, membershipVersion]);

  // Names/avatars joined in at render, so a profiles refresh re-sorts without
  // re-querying campaign_members. DM first, then named members alphabetically,
  // unnamed last. Profiles staleness is accepted.
  const namedRoster = useMemo(() => {
    if (!roster) return null;
    return roster
      .map((m) => ({
        ...m,
        name: profilesById.get(m.userId)?.displayName ?? null,
        avatarUrl: profilesById.get(m.userId)?.avatarUrl ?? null,
      }))
      .sort((a, b) =>
        a.role !== b.role ? (a.role === "dm" ? -1 : 1) : (a.name ?? "￿").localeCompare(b.name ?? "￿"));
  }, [roster, profilesById]);

  // Who's already seated, for the add-member picker's exclusion filter. Keyed
  // off `roster` (not namedRoster) so it doesn't churn on profiles refreshes.
  const memberIds = useMemo(
    () => new Set((roster ?? []).map((m) => m.userId)),
    [roster],
  );

  // Characters a member can be bound to (issue #114). Only people already
  // marked as PCs on their detail sheet: the charter binds a player to a
  // character, it doesn't decide what counts as one.
  const pcOptions = useMemo(
    () => campaign.people
      .filter(isPc)
      .map((p) => ({ id: p.id, label: p.name, kind: "people" as const, archived: p.archived, hidden: p.hidden })),
    [campaign.people],
  );

  // One funnel for every membership mutation: await the RPC, surface its
  // error (last-DM guard messages are user-facing), then bump
  // membershipVersion — the effect above refetches the roster and the
  // context refetches isDmMember, so a self-demote drops the DM affordances
  // without a reload.
  const mutateMembership = async (fn: () => Promise<void>) => {
    try {
      await fn();
      refreshMembership();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

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
    fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 17, color: "var(--ink-body)",
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
                fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14,
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

        {/* The Party — self-service management (issue #86). The isDm wrapper
            around the controls is load-bearing like the identity plate's:
            it hides guaranteed-to-fail RPC calls and folds view-as-player in. */}
        <SectionHeading>THE PARTY</SectionHeading>
        {namedRoster === null ? (
          <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
            Consulting the rolls…
          </div>
        ) : namedRoster.length === 0 ? (
          <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
            No members are recorded on this charter yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {(() => {
              const dmCount = namedRoster.filter((r) => r.role === "dm").length;
              return namedRoster.map((m) => {
                // The server's last-DM guard is authoritative; this only
                // prevents a guaranteed-to-fail click.
                const lastDm = m.role === "dm" && dmCount === 1;
                const label = m.name ?? "this adventurer";
                // The character this member is playing *now*: derived from
                // status, not stored as a second pointer. A dead PC keeps its
                // link (that's the chronicle) but stops being the answer here.
                const playing = campaign.people.find(
                  (p) => isPc(p) && p.playerUserId === m.userId && p.status !== "dead",
                );
                // DM binds anyone; a player claims or releases their own.
                const canBind = isDm || (canEdit && user?.id === m.userId);
                return (
                  <div
                    key={m.userId}
                    style={{
                      position: "relative",
                      display: "flex", flexDirection: "column", gap: 4,
                      padding: "8px 14px",
                      background: "var(--paper-cream)",
                      border: "1px solid var(--vellum-deep)",
                      borderRadius: 22,
                      boxShadow: "0 1px 2px rgba(40,20,5,.12)",
                    }}
                  >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--ink)" }}>{m.name}</span>
                    ) : (
                      <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14, color: "var(--ink-faded)" }}>
                        an unnamed adventurer
                      </span>
                    )}
                    {isDm && !lastDm && (
                      <>
                        <EnumSelect<"dm" | "player">
                          value={m.role}
                          options={["dm", "player"] as const}
                          onSave={(next) => {
                            if (!next || next === m.role) return;
                            void mutateMembership(() => setMemberRole(m.userId, next));
                          }}
                          style={{ fontSize: 12 }}
                        />
                        <button
                          className="cleanup-link-btn"
                          title="Strike from the roster"
                          onClick={() => {
                            if (!window.confirm(`Strike ${label} from the roster?`)) return;
                            void mutateMembership(() => removeMember(m.userId));
                          }}
                        >
                          strike
                        </button>
                      </>
                    )}
                    {/* "Leave" is player-only (a co-DM demotes themselves
                        first) — that makes leave-as-last-DM unrepresentable
                        here, and a DM in view-as-player (isDm false, but
                        their row says dm) never sees a leave affordance. */}
                    {!isDm && canEdit && user?.id === m.userId && m.role === "player" && (
                      <button
                        className="cleanup-link-btn"
                        onClick={() => {
                          if (!window.confirm("Leave this campaign? The DM can invite you back later.")) return;
                          void mutateMembership(() => removeMember(m.userId));
                        }}
                      >
                        leave
                      </button>
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
                    {(canBind || playing) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 38, minHeight: 20 }}>
                        <span style={{
                          fontFamily: "var(--font-fell-sc)", letterSpacing: ".16em",
                          fontSize: 10, color: "var(--ink-secondary)",
                        }}>
                          <ThemedLabel parchment="PLAYING" atlas="Playing" />
                        </span>
                        {canBind ? (
                          <EntitySelect
                            value={playing?.id}
                            options={pcOptions}
                            allowClear
                            onSave={(id) => {
                              if (id === (playing?.id ?? null)) return;
                              // Binding a character overwrites its player_user_id,
                              // so picking one someone else is playing takes it from
                              // them. That is allowed — a DM correcting an assignment
                              // shouldn't have to unbind twice — but it must not be
                              // silent, since the loser sees only their own row go
                              // blank. Same confirm ritual as strike/leave below.
                              const heldBy = id
                                ? namedRoster.find(
                                    (o) => o.userId !== m.userId
                                      && campaign.people.some(
                                        (p) => p.id === id && p.playerUserId === o.userId && p.status !== "dead",
                                      ),
                                  )
                                : undefined;
                              if (heldBy) {
                                const taken = campaign.people.find((p) => p.id === id)?.name ?? "that character";
                                if (!window.confirm(
                                  `${taken} is played by ${heldBy.name ?? "another member"}. Reassign to ${label}?`,
                                )) return;
                              }
                              bindPlayerCharacter(
                                m.userId,
                                id,
                                playing ? { id: playing.id, status: playing.status } : null,
                              ).catch(console.error);
                            }}
                            style={{ fontSize: 13 }}
                          />
                        ) : (
                          <button
                            className="cleanup-link-btn"
                            style={{ fontStyle: "normal" }}
                            onClick={() => onOpenEntity(playing!.id)}
                          >
                            {playing!.name}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
        {/* Gated on a loaded roster, not just isDm: memberIds is the picker's
            exclusion filter, and an empty one (roster still null) would offer
            people who are already seated. The RPC is idempotent so a click
            there is harmless, but the card shouldn't contradict the "Consulting
            the rolls…" line directly above it. */}
        {isDm && roster !== null && (
          <SeatMemberCard
            memberIds={memberIds}
            onSeat={(userId, name) => {
              void mutateMembership(async () => {
                const { alreadyMember } = await addMember(userId);
                // The RPC is idempotent, so a stale roster (membership isn't
                // realtime) turns a double-click into a silent no-op. Say so
                // rather than let the DM think the click missed.
                if (alreadyMember) window.alert(`${name} is already on this charter.`);
              });
            }}
          />
        )}
        {isDm && <InviteCard />}
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
                    borderRadius: 12, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--ink)",
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
          <div style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 14, color: "var(--ink-secondary)" }}>
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
                      <span style={{ fontFamily: "var(--font-body)", fontStyle: "italic", fontSize: 13, color: "var(--ink-secondary)" }}>
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
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 14, color: "var(--ink-body)", marginTop: 3 }}>
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

        {isDm && <DangerZoneCard />}
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
