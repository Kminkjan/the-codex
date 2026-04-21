import { useMemo, useState } from "react";
import { useCampaign, useKinds } from "./hooks";
import {
  type Campaign,
  type KindKey,
  ARCHIVABLE_KINDS,
  entityLabel,
  isArchived,
  isPinned,
} from "./data";
import { Icon } from "./icons";
import { bulkArchive } from "./mutations";

interface Suggestion {
  kind: KindKey;
  id: string;
  label: string;
  reason: string;
}

function computeSuggestions(campaign: Campaign, n: number): Suggestion[] {
  const sessionsByNum = [...campaign.sessions].sort((a, b) => a.num - b.num);
  const recentSessionIds = new Set(sessionsByNum.slice(-n).map((s) => s.id));
  const lastTwoSessionIds = new Set(sessionsByNum.slice(-2).map((s) => s.id));

  const touchedByRecent = new Set<string>();
  for (const p of campaign.people) {
    if (p.lastSeen && recentSessionIds.has(p.lastSeen)) touchedByRecent.add(p.id);
  }
  for (const q of campaign.quests) {
    if (q.session && recentSessionIds.has(q.session)) touchedByRecent.add(q.id);
  }

  const connectionNeighbours = new Map<string, Set<string>>();
  for (const [a, b] of campaign.connections) {
    if (!connectionNeighbours.has(a)) connectionNeighbours.set(a, new Set());
    if (!connectionNeighbours.has(b)) connectionNeighbours.set(b, new Set());
    connectionNeighbours.get(a)!.add(b);
    connectionNeighbours.get(b)!.add(a);
  }
  const activeByConnection = new Set<string>();
  for (const id of touchedByRecent) {
    activeByConnection.add(id);
    const neighbours = connectionNeighbours.get(id);
    if (neighbours) for (const n2 of neighbours) activeByConnection.add(n2);
  }

  const out: Suggestion[] = [];
  const skip = (e: any) => isArchived(e) || isPinned(e);

  for (const p of campaign.people) {
    if (skip(p)) continue;
    if (p.lastSeen && !recentSessionIds.has(p.lastSeen)) {
      const sess = sessionsByNum.find((s) => s.id === p.lastSeen);
      out.push({
        kind: "people",
        id: p.id,
        label: entityLabel(p),
        reason: sess ? `last seen session ${sess.num}` : "not seen recently",
      });
    } else if (!p.lastSeen && !activeByConnection.has(p.id)) {
      out.push({ kind: "people", id: p.id, label: entityLabel(p), reason: "no session link" });
    }
  }

  for (const q of campaign.quests) {
    if (skip(q)) continue;
    if (q.status !== "resolved" && q.status !== "lost") continue;
    if (q.session && lastTwoSessionIds.has(q.session)) continue;
    out.push({ kind: "quests", id: q.id, label: entityLabel(q), reason: q.status });
  }

  for (const g of campaign.goals) {
    if (skip(g)) continue;
    if (g.status !== "resolved" && g.status !== "lost") continue;
    out.push({ kind: "goals", id: g.id, label: entityLabel(g), reason: g.status });
  }

  const connectionStaleKinds: Array<[KindKey, any[]]> = [
    ["locations", campaign.locations],
    ["factions", campaign.factions],
    ["items", campaign.items],
    ["lore", campaign.lore],
  ];
  for (const [kind, list] of connectionStaleKinds) {
    for (const e of list) {
      if (skip(e)) continue;
      if (activeByConnection.has(e.id)) continue;
      out.push({ kind, id: e.id, label: entityLabel(e), reason: "no recent connection" });
    }
  }

  return out;
}

interface CleanupPanelProps {
  onClose: () => void;
  onOpenEntity: (id: string) => void;
}

export function CleanupPanel({ onClose, onOpenEntity }: CleanupPanelProps) {
  const campaign = useCampaign();
  const kinds = useKinds();
  const [n, setN] = useState(5);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  const kindLabel = useMemo(
    () => Object.fromEntries(kinds.map((k) => [k.key, k.label])) as Record<KindKey, string>,
    [kinds],
  );

  const suggestions = useMemo(() => computeSuggestions(campaign, n), [campaign, n]);

  const grouped = useMemo(() => {
    const g: Partial<Record<KindKey, Suggestion[]>> = {};
    for (const s of suggestions) {
      (g[s.kind] = g[s.kind] || []).push(s);
    }
    return g;
  }, [suggestions]);

  const keyOf = (s: Suggestion) => `${s.kind}:${s.id}`;
  const toggle = (s: Suggestion) => {
    const k = keyOf(s);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const selectGroup = (kind: KindKey, items: Suggestion[]) => {
    const allSelected = items.every((s) => selected.has(keyOf(s)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of items) {
        if (allSelected) next.delete(keyOf(s));
        else next.add(keyOf(s));
      }
      return next;
    });
  };
  const selectAll = () => {
    setSelected(new Set(suggestions.map(keyOf)));
  };

  const archiveSelected = async () => {
    if (selected.size === 0 || working) return;
    setWorking(true);
    const entries = suggestions
      .filter((s) => selected.has(keyOf(s)))
      .map(({ kind, id }) => ({ kind, id }));
    try {
      await bulkArchive(entries);
      setSelected(new Set());
    } catch (e) {
      console.error("bulkArchive failed", e);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="cleanup-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cleanup-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cleanup-header">
          <button className="cleanup-close" onClick={onClose}><Icon name="close" size={16} /></button>
          <h2>Tidy the Codex</h2>
          <p>
            Suggestions — nothing is archived until you act. Pinned entries are never suggested.
          </p>
        </div>
        <div className="cleanup-controls">
          <span>Fresh window:</span>
          <input
            type="range"
            min={1}
            max={Math.max(10, campaign.sessions.length)}
            value={n}
            onChange={(e) => setN(Number(e.target.value))}
          />
          <span style={{ fontFamily: "var(--font-fell-sc)", letterSpacing: ".16em", fontSize: 11, color: "var(--ink-faded)" }}>
            LAST {n} SESSIONS
          </span>
          <button className="cleanup-link-btn" onClick={selectAll}>select all</button>
        </div>
        <div className="cleanup-body">
          {suggestions.length === 0 && (
            <div className="cleanup-empty">
              ✦ Nothing stale — the Codex is tidy. ✦
            </div>
          )}
          {ARCHIVABLE_KINDS.map((kind) => {
            const items = grouped[kind];
            if (!items || items.length === 0) return null;
            const allSelected = items.every((s) => selected.has(keyOf(s)));
            return (
              <div className="cleanup-group" key={kind}>
                <div className="cleanup-group-head">
                  <span className="cleanup-group-title">
                    {kindLabel[kind]} · {items.length}
                  </span>
                  <button className="cleanup-link-btn" onClick={() => selectGroup(kind, items)}>
                    {allSelected ? "deselect group" : "select group"}
                  </button>
                </div>
                {items.map((s) => (
                  <label className="cleanup-row" key={keyOf(s)}>
                    <input
                      type="checkbox"
                      checked={selected.has(keyOf(s))}
                      onChange={() => toggle(s)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span
                      style={{ cursor: "pointer", color: "var(--ink)" }}
                      onClick={(e) => { e.preventDefault(); onOpenEntity(s.id); }}
                    >
                      {s.label}
                    </span>
                    <span className="cleanup-reason">{s.reason}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <div className="cleanup-footer">
          <span className="cleanup-selected">
            {selected.size} selected · {suggestions.length} suggested
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose}>Close</button>
            <button
              className="btn btn-primary"
              onClick={archiveSelected}
              disabled={selected.size === 0 || working}
              style={{ opacity: selected.size === 0 || working ? 0.5 : 1 }}
            >
              {working ? "Archiving…" : `Archive ${selected.size}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
