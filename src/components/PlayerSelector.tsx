"use client";

import { useState } from "react";
import { ClearInput } from "./ClearInput";

interface Player {
  id: string;
  name: string;
  gender?: string | null;
  rating?: number;
  [key: string]: unknown;
}

interface PlayerSelectorProps {
  players: Player[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void | Promise<void>;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  recentIds?: Set<string>;
}

export function PlayerSelector({
  players,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
  recentIds,
}: PlayerSelectorProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!recentIds || recentIds.size === 0);
  const [showSelected, setShowSelected] = useState(true);

  const filtered = players
    .filter((p) => {
      if (!showAll && recentIds && recentIds.size > 0 && !recentIds.has(p.id)) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (genderFilter && p.gender !== genderFilter) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const selectedList = players
    .filter((p) => selectedIds.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));

  const handleSelectAllDisplayed = () => {
    if (allFilteredSelected) {
      onDeselectAll?.();
    } else {
      for (const p of filtered) {
        if (!selectedIds.has(p.id)) onToggle(p.id);
      }
    }
  };

  return (
    <div className="flex gap-2 -mx-1">
      {/* Left: filter + select */}
      <div className={`${showSelected ? "flex-1" : "w-full"} min-w-0 space-y-1.5`}>
        <div className="flex gap-1 flex-wrap">
          {(["M", "F"] as const).map((g) => (
            <button key={g} type="button"
              onClick={() => setGenderFilter(genderFilter === g ? null : g)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                genderFilter === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
              }`}>
              {g === "M" ? "♂" : "♀"}
            </button>
          ))}
          <button type="button"
            onClick={() => setShowAll(true)}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${showAll ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
            All
          </button>
          <button type="button"
            onClick={() => { if (recentIds && recentIds.size > 0) setShowAll(false); }}
            disabled={!recentIds || recentIds.size === 0}
            className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${!showAll && recentIds && recentIds.size > 0 ? "bg-selected text-white" : "bg-gray-100 text-foreground"} disabled:opacity-40`}>
            Recent
          </button>
          <button type="button" onClick={handleSelectAllDisplayed}
            className="text-primary text-[10px] font-medium ml-auto whitespace-nowrap">
            {allFilteredSelected ? "Deselect all" : "Select displayed"}
          </button>
        </div>
        <ClearInput value={search} onChange={setSearch} placeholder="Search..." className="text-xs" />
        <div className="space-y-0 max-h-72 overflow-y-auto">
          {filtered.map((p) => (
            <button key={p.id} type="button" onClick={() => onToggle(p.id)}
              className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded transition-all ${
                selectedIds.has(p.id) ? "bg-selected/10" : "hover:bg-gray-50"
              }`}>
              <span className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center text-[8px] font-bold shrink-0 ${
                selectedIds.has(p.id) ? "bg-selected border-selected text-white" : "border-gray-300"
              }`}>
                {selectedIds.has(p.id) ? "✓" : ""}
              </span>
              <span className="text-xs font-medium flex-1 text-left truncate">{p.name}</span>
              {p.gender && (
                <span className={`text-[9px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                  {p.gender === "M" ? "♂" : "♀"}
                </span>
              )}
            </button>
          ))}
          {filtered.length === 0 && <p className="text-xs text-muted py-3 text-center">No matches</p>}
        </div>
      </div>

      {/* Right: selected list */}
      {showSelected && (
        <div className="w-[42%] shrink-0 bg-gray-50 rounded-lg p-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Selected ({selectedList.length})</span>
            <button type="button" onClick={() => setShowSelected(false)}
              className="text-[9px] text-muted hover:text-foreground">Hide</button>
          </div>
          <div className="max-h-80 overflow-y-auto space-y-0">
            {selectedList.map((p) => (
              <button key={p.id} type="button" onClick={() => onToggle(p.id)}
                className="w-full flex items-center gap-1 py-1 px-1.5 rounded hover:bg-red-50 hover:text-danger transition-colors group">
                <span className="text-xs font-medium flex-1 text-left leading-tight truncate">{p.name}</span>
                {p.gender && (
                  <span className={`text-[9px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"} group-hover:hidden`}>
                    {p.gender === "M" ? "♂" : "♀"}
                  </span>
                )}
                <span className="text-[9px] text-danger hidden group-hover:block">✕</span>
              </button>
            ))}
            {selectedList.length === 0 && <p className="text-[10px] text-muted py-2 text-center">None</p>}
          </div>
        </div>
      )}

      {/* Show selected toggle when hidden */}
      {!showSelected && selectedList.length > 0 && (
        <button type="button" onClick={() => setShowSelected(true)}
          className="shrink-0 w-8 bg-gray-50 rounded-lg flex flex-col items-center justify-center text-[9px] text-muted hover:text-foreground">
          <span className="font-bold">{selectedList.length}</span>
          <span>▶</span>
        </button>
      )}
    </div>
  );
}
