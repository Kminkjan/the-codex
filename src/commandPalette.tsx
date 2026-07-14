import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCampaign } from "./hooks";
import { type Campaign } from "./data";
import { Icon, kindIcon } from "./icons";
import {
  buildIndex,
  keepBest,
  listAlphabetical,
  makeSnippet,
  matchesOps,
  parseOperators,
  rankEntities,
  sortHits,
  KIND_LABEL,
  type Indexed,
  type RankedHit,
} from "./entitySearch";

function searchHits(fullIndex: Indexed[], campaign: Campaign, query: string): RankedHit[] {
  // Facet operators (tier:/status:/race:/faction:) pre-filter the index; the
  // remaining free text ranks as usual. The notes pass below reads the same
  // filtered index, so a note hit can't resurrect an operator-excluded person.
  const { ops, rest } = parseOperators(query);
  const index = ops.length ? fullIndex.filter((e) => matchesOps(e, ops)) : fullIndex;
  const q = rest.trim().toLowerCase();
  if (!q && !ops.length) return [];
  if (!q) {
    // Pure operator query ("tier:background") — the whole filtered set,
    // alphabetically, same listing the combobox shows before typing.
    return listAlphabetical(index, 30);
  }

  const best = new Map<string, RankedHit>();
  rankEntities(index, q, best);

  const indexById = new Map(index.map((e) => [e.id, e] as const));
  for (const [entityId, notes] of Object.entries(campaign.notes)) {
    const parent = indexById.get(entityId);
    if (!parent) continue;
    for (const note of notes) {
      if (note.text.toLowerCase().includes(q)) {
        keepBest(best, {
          id: entityId,
          kind: parent.kind,
          label: parent.label,
          snippet: `${note.author}: ${makeSnippet(note.text, q)}`,
          matchSource: "note",
          rank: 3,
          archived: parent.archived,
          hidden: parent.hidden,
        });
        break;
      }
    }
  }

  return sortHits(best, 30);
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
  onLocate?: (id: string) => void;
}

export function CommandPalette({ open, onClose, onOpenEntity, onLocate }: CommandPaletteProps) {
  const campaign = useCampaign();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const index = useMemo(() => buildIndex(campaign), [campaign]);
  const results = useMemo(() => searchHits(index, campaign, query), [index, campaign, query]);
  // Which hits actually have a pin on the notice board — only those can be
  // located there. Sessions/arcs/events and never-pinned cards have no
  // position, so they show no locate affordance.
  const boardIds = useMemo(() => new Set(Object.keys(campaign.board)), [campaign.board]);
  // Single source of truth for "can this hit be located on the board" — keeps
  // the ⌥↵ handler and the row's "On board" button in lockstep.
  const canLocate = useCallback(
    (hit: RankedHit | undefined): boolean => !!onLocate && !!hit && boardIds.has(hit.id),
    [onLocate, boardIds],
  );

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

  const choose = useCallback((hit: RankedHit | undefined) => {
    if (!hit) return;
    onOpenEntity(hit.id);
  }, [onOpenEntity]);

  const locate = useCallback((hit: RankedHit | undefined) => {
    if (!hit) return;
    // Alt+Enter on a card without a board pin has nowhere to jump — fall back
    // to opening its detail sheet so the shortcut is never a dead key.
    if (canLocate(hit)) onLocate!(hit.id);
    else onOpenEntity(hit.id);
  }, [canLocate, onLocate, onOpenEntity]);

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
      if (e.altKey) locate(results[selected]);
      else choose(results[selected]);
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
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="cmdk-listbox"
            aria-activedescendant={results.length > 0 ? `cmdk-opt-${selected}` : undefined}
          />
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox" id="cmdk-listbox">
          {query.trim() === "" && (
            <div className="cmdk-empty">Type to search people, places, quests, goals, factions, items, lore, sessions, and party notes — or narrow people with tier: status: race: faction:</div>
          )}
          {query.trim() !== "" && results.length === 0 && (
            <div className="cmdk-empty">Nothing in the codex matches "{query}".</div>
          )}
          {results.map((hit, i) => (
            <div
              key={`${hit.id}:${hit.matchSource}`}
              data-idx={i}
              id={`cmdk-opt-${i}`}
              role="option"
              aria-selected={i === selected}
              className={`cmdk-row${i === selected ? " active" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => choose(hit)}
            >
              <Icon name={kindIcon[hit.kind]} size={16} />
              <div className="cmdk-row-text">
                <div className={`cmdk-row-label ${hit.archived ? "archived" : ""}`}>{hit.label}</div>
                {hit.snippet && (
                  <div className="cmdk-snippet">
                    {hit.matchSource === "note" ? <span className="cmdk-snippet-tag">note · </span> : null}
                    {hit.snippet}
                  </div>
                )}
              </div>
              <span className="cmdk-kind">{KIND_LABEL[hit.kind]}</span>
              {hit.archived && <span className="cmdk-kind-archived">archived</span>}
              {hit.hidden && <span className="cmdk-kind-veiled">unrevealed</span>}
              {canLocate(hit) && (
                <button
                  type="button"
                  className="cmdk-locate"
                  title="Jump to this card on the notice board (⌥↵)"
                  onClick={(e) => { e.stopPropagation(); onLocate!(hit.id); }}
                >
                  <Icon name="search" size={12} /> On board
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="cmdk-hint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌥↵ on board</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
