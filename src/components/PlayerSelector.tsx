"use client";

import { useState, useRef } from "react";
import { ClearInput } from "./ClearInput";
import { PlayerAvatar } from "./PlayerAvatar";

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
  recentIds?: Set<string>;
}

export function PlayerSelector({
  players,
  selectedIds,
  onToggle,
  onSelectAll,
  recentIds,
}: PlayerSelectorProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(!recentIds || recentIds.size === 0);

  // Swipe state
  const touchStart = useRef<{ x: number; id: string } | null>(null);
  const [swipingId, setSwipingId] = useState<string | null>(null);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);

  const handleTouchStart = (id: string, x: number) => {
    touchStart.current = { x, id };
    setSwipingId(null);
    setSwipeDir(null);
  };

  const handleTouchMove = (id: string, x: number) => {
    if (!touchStart.current || touchStart.current.id !== id) return;
    const dx = x - touchStart.current.x;
    if (Math.abs(dx) > 30) {
      setSwipingId(id);
      setSwipeDir(dx > 0 ? "right" : "left");
    } else {
      setSwipingId(null);
      setSwipeDir(null);
    }
  };

  const handleTouchEnd = (id: string, isSelected: boolean) => {
    if (swipingId === id && swipeDir) {
      // Swipe right on unselected = add, swipe left on selected = remove
      if (swipeDir === "right" && !isSelected) onToggle(id);
      if (swipeDir === "left" && isSelected) onToggle(id);
    }
    touchStart.current = null;
    setSwipingId(null);
    setSwipeDir(null);
  };

  // Unselected players (available to add)
  const available = players
    .filter((p) => !selectedIds.has(p.id))
    .filter((p) => {
      if (!showAll && recentIds && recentIds.size > 0 && !recentIds.has(p.id)) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (genderFilter && p.gender !== genderFilter) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Selected players (already added)
  const selected = players
    .filter((p) => selectedIds.has(p.id))
    .filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (genderFilter && p.gender !== genderFilter) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const isRecent = !showAll && recentIds && recentIds.size > 0;

  const renderRow = (p: Player, isSelected: boolean) => {
    const isSwiping = swipingId === p.id;
    const addSwipe = isSwiping && swipeDir === "right" && !isSelected;
    const removeSwipe = isSwiping && swipeDir === "left" && isSelected;

    return (
      <div
        key={p.id}
        className={`flex items-center gap-2 py-2 px-2.5 rounded-lg transition-all ${
          addSwipe ? "bg-green-50 translate-x-2" :
          removeSwipe ? "bg-red-50 -translate-x-2" :
          ""
        }`}
        onTouchStart={(e) => handleTouchStart(p.id, e.touches[0].clientX)}
        onTouchMove={(e) => handleTouchMove(p.id, e.touches[0].clientX)}
        onTouchEnd={() => handleTouchEnd(p.id, isSelected)}
      >
        <PlayerAvatar name={p.name} size="xs" />
        <span className="text-sm font-medium flex-1 truncate">{p.name}</span>
        {p.gender && (
          <span className={`text-[10px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
            {p.gender === "M" ? "♂" : "♀"}
          </span>
        )}
        {/* Desktop: click button */}
        {!isSelected ? (
          <button onClick={() => onToggle(p.id)}
            className="text-[10px] text-action font-medium px-2 py-0.5 rounded hover:bg-action/10 shrink-0">
            + Add
          </button>
        ) : (
          <button onClick={() => onToggle(p.id)}
            className="text-[10px] text-danger font-medium px-2 py-0.5 rounded hover:bg-red-50 shrink-0">
            Remove
          </button>
        )}
        {/* Swipe indicator */}
        {addSwipe && <span className="text-xs text-green-600 font-medium shrink-0">→ Add</span>}
        {removeSwipe && <span className="text-xs text-danger font-medium shrink-0">← Remove</span>}
      </div>
    );
  };

  return (
    <div className="space-y-2">
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
          className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${isRecent ? "bg-selected text-white" : "bg-gray-100 text-foreground"} disabled:opacity-40`}>
          Recent
        </button>
        {isRecent && onSelectAll && (
          <button type="button" onClick={onSelectAll}
            className="text-action text-[10px] font-medium ml-auto whitespace-nowrap">
            Select all
          </button>
        )}
      </div>
      <ClearInput value={search} onChange={setSearch} placeholder="Search..." className="text-xs" />

      {/* Added players */}
      {selected.length > 0 && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
            Added ({selected.length}){" "}
            <span className="normal-case text-muted font-normal">swipe ← to remove</span>
          </div>
          <div className="max-h-40 overflow-y-auto">
            {selected.map((p) => renderRow(p, true))}
          </div>
        </div>
      )}

      {/* Available players */}
      <div>
        <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
          Available ({available.length}){" "}
          <span className="normal-case text-muted font-normal">swipe → to add</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {available.map((p) => renderRow(p, false))}
          {available.length === 0 && <p className="text-xs text-muted py-3 text-center">No matches</p>}
        </div>
      </div>
    </div>
  );
}
