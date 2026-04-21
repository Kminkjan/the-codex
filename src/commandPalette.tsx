import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "./hooks";
import { entityLabel, type Campaign, type KindKey } from "./data";
import { Icon } from "./icons";

type MatchSource = "primary" | "secondary" | "note";

interface PaletteHit {
  id: string;
  kind: KindKey;
  label: string;
  snippet?: string;
  matchSource: MatchSource;
  rank: 0 | 1 | 2 | 3;
}

const KIND_ICON: Record<KindKey, "people" | "location" | "quest" | "goal" | "faction" | "item" | "lore" | "session"> = {
  people: "people",
  locations: "location",
  quests: "quest",
  goals: "goal",
  factions: "faction",
  items: "item",
  lore: "lore",
  sessions: "session",
};

const KIND_LABEL: Record<KindKey, string> = {
  people: "Person",
  locations: "Location",
  quests: "Quest",
  goals: "Goal",
  factions: "Faction",
  items: "Item",
  lore: "Lore",
  sessions: "Session",
};

interface Indexed {
  id: string;
  kind: KindKey;
  label: string;
  primary: string;
  secondary: string;
}

function joinFields(...parts: Array<string | number | null | undefined>): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== "").join(" · ");
}

function buildIndex(campaign: Campaign): Indexed[] {
  const out: Indexed[] = [];
  for (const p of campaign.people) {
    out.push({
      id: p.id,
      kind: "people",
      label: entityLabel(p),
      primary: p.name ?? "",
      secondary: joinFields(p.epithet, p.race, p.role, p.disposition, p.alignment, p.notes),
    });
  }
  for (const l of campaign.locations) {
    out.push({
      id: l.id,
      kind: "locations",
      label: entityLabel(l),
      primary: l.name ?? "",
      secondary: joinFields(l.kind, l.region, l.ruler, l.desc, l.notes),
    });
  }
  for (const q of campaign.quests) {
    out.push({
      id: q.id,
      kind: "quests",
      label: entityLabel(q),
      primary: q.title ?? "",
      secondary: joinFields(q.status, q.reward, q.desc, q.hooks),
    });
  }
  for (const g of campaign.goals) {
    out.push({
      id: g.id,
      kind: "goals",
      label: entityLabel(g),
      primary: g.text ?? "",
      secondary: joinFields(g.owner, g.kind, g.status),
    });
  }
  for (const f of campaign.factions) {
    out.push({
      id: f.id,
      kind: "factions",
      label: entityLabel(f),
      primary: f.name ?? "",
      secondary: joinFields(f.sigil, f.desc, f.allegiance),
    });
  }
  for (const i of campaign.items) {
    out.push({
      id: i.id,
      kind: "items",
      label: entityLabel(i),
      primary: i.name ?? "",
      secondary: joinFields(i.kind, i.desc),
    });
  }
  for (const lo of campaign.lore) {
    out.push({
      id: lo.id,
      kind: "lore",
      label: entityLabel(lo),
      primary: lo.title ?? "",
      secondary: lo.text ?? "",
    });
  }
  for (const s of campaign.sessions) {
    out.push({
      id: s.id,
      kind: "sessions",
      label: entityLabel(s),
      primary: s.title ?? "",
      secondary: joinFields(s.date, `Session ${s.num}`),
    });
  }
  return out;
}

function makeSnippet(source: string, queryLower: string): string {
  const idx = source.toLowerCase().indexOf(queryLower);
  if (idx < 0) return source.slice(0, 90);
  const start = Math.max(0, idx - 30);
  const end = Math.min(source.length, idx + queryLower.length + 40);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
  const core = source.slice(start, end);
  const snippet = `${prefix}${core}${suffix}`;
  return snippet.length > 100 ? `${snippet.slice(0, 97)}…` : snippet;
}

function searchHits(index: Indexed[], campaign: Campaign, query: string): PaletteHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const best = new Map<string, PaletteHit>();
  const keepBest = (hit: PaletteHit) => {
    const prev = best.get(hit.id);
    if (!prev || hit.rank < prev.rank) best.set(hit.id, hit);
  };

  for (const e of index) {
    const primary = e.primary.toLowerCase();
    if (primary.startsWith(q)) {
      keepBest({ id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 0 });
      continue;
    }
    if (primary.includes(q)) {
      keepBest({ id: e.id, kind: e.kind, label: e.label, matchSource: "primary", rank: 1 });
      continue;
    }
    const secondary = e.secondary.toLowerCase();
    if (secondary.includes(q)) {
      keepBest({
        id: e.id,
        kind: e.kind,
        label: e.label,
        snippet: makeSnippet(e.secondary, q),
        matchSource: "secondary",
        rank: 2,
      });
    }
  }

  const indexById = new Map(index.map((e) => [e.id, e] as const));
  for (const [entityId, notes] of Object.entries(campaign.notes)) {
    const parent = indexById.get(entityId);
    if (!parent) continue;
    for (const note of notes) {
      if (note.text.toLowerCase().includes(q)) {
        keepBest({
          id: entityId,
          kind: parent.kind,
          label: parent.label,
          snippet: `${note.author}: ${makeSnippet(note.text, q)}`,
          matchSource: "note",
          rank: 3,
        });
        break;
      }
    }
  }

  return Array.from(best.values())
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label))
    .slice(0, 30);
}

export function useCommandPaletteHotkey(onToggle: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onOpenEntity: (id: string) => void;
}

export function CommandPalette({ open, onClose, onOpenEntity }: CommandPaletteProps) {
  const campaign = useCampaign();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const index = useMemo(() => buildIndex(campaign), [campaign]);
  const results = useMemo(() => searchHits(index, campaign, query), [index, campaign, query]);

  useEffect(() => { setSelected(0); }, [query]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setSelected(0);
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(t);
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    active?.scrollIntoView({ block: "nearest" });
  }, [selected, open, results.length]);

  const choose = useCallback((hit: PaletteHit | undefined) => {
    if (!hit) return;
    onOpenEntity(hit.id);
  }, [onOpenEntity]);

  if (!open) return null;

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setSelected((i) => (i + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setSelected((i) => (i - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      choose(results[selected]);
    }
  };

  return (
    <div className="cmdk-overlay" onMouseDown={onClose} role="dialog" aria-label="Search">
      <div className="cmdk-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search the codex…"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="cmdk-list" ref={listRef}>
          {query.trim() === "" && (
            <div className="cmdk-empty">Type to search people, places, quests, goals, factions, items, lore, sessions, and party notes.</div>
          )}
          {query.trim() !== "" && results.length === 0 && (
            <div className="cmdk-empty">Nothing in the codex matches "{query}".</div>
          )}
          {results.map((hit, i) => (
            <button
              key={`${hit.id}:${hit.matchSource}`}
              data-idx={i}
              className={`cmdk-row${i === selected ? " active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(hit)}
              type="button"
            >
              <Icon name={KIND_ICON[hit.kind]} size={16} />
              <div className="cmdk-row-text">
                <div className="cmdk-row-label">{hit.label}</div>
                {hit.snippet && (
                  <div className="cmdk-snippet">
                    {hit.matchSource === "note" ? <span className="cmdk-snippet-tag">note · </span> : null}
                    {hit.snippet}
                  </div>
                )}
              </div>
              <span className="cmdk-kind">{KIND_LABEL[hit.kind]}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-hint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
