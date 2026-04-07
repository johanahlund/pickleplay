"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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

function SwipeRow({ player, direction, onAction }: {
  player: Player;
  direction: "right" | "left"; // right = add (swipe →), left = remove (swipe ←)
  onAction: () => void;
}) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const locked = useRef(false);
  const THRESHOLD = 50;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    locked.current = false;
    setSwiped(false);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startX.current === null || startY.current === null) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!locked.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!locked.current) {
      if (Math.abs(dy) > Math.abs(dx)) { startX.current = null; return; }
      locked.current = true;
    }
    e.preventDefault();
    if (direction === "right" && dx > 0) setOffsetX(Math.min(dx, 100));
    else if (direction === "left" && dx < 0) setOffsetX(Math.max(dx, -100));
    else setOffsetX(0);
  }, [direction]);

  const handleTouchEnd = useCallback(() => {
    if (Math.abs(offsetX) > THRESHOLD) {
      setSwiped(true);
      setOffsetX(direction === "right" ? 150 : -150);
      setTimeout(() => { onAction(); setOffsetX(0); setSwiped(false); }, 200);
    } else {
      setOffsetX(0);
    }
    startX.current = null;
    locked.current = false;
  }, [offsetX, direction, onAction]);

  const active = direction === "right" ? offsetX > THRESHOLD : offsetX < -THRESHOLD;

  return (
    <div className={`relative overflow-hidden rounded-lg ${swiped ? "max-h-0 opacity-0 transition-all duration-200" : "max-h-20"}`}>
      {offsetX !== 0 && (
        <div className={`absolute inset-y-0 flex items-center text-[10px] font-semibold ${
          direction === "right" ? "left-2 text-green-600" : "right-2 text-danger"
        }`}>
          {direction === "right" ? "Add →" : "← Remove"}
        </div>
      )}
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 transition-transform ${active ? (direction === "right" ? "bg-green-50" : "bg-red-50") : "bg-card"}`}
        style={{ transform: `translateX(${offsetX}px)`, transitionDuration: startX.current ? "0ms" : "200ms" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <PlayerAvatar name={player.name} size="xs" />
        <span className="text-xs font-medium flex-1 truncate">{player.name}</span>
        {player.gender && (
          <span className={`text-[9px] ${player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
            {player.gender === "M" ? "♂" : "♀"}
          </span>
        )}
        {/* Desktop button */}
        <button onClick={onAction}
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 hidden sm:block ${
            direction === "right" ? "text-action hover:bg-action/10" : "text-danger hover:bg-red-50"
          }`}>
          {direction === "right" ? "+" : "×"}
        </button>
      </div>
    </div>
  );
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
  // Optimistic: track IDs that were just toggled (added/removed) to prevent flicker
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [recentlyRemoved, setRecentlyRemoved] = useState<Set<string>>(new Set());
  const [flashCount, setFlashCount] = useState(false);

  // Clear optimistic state when selectedIds changes (parent confirmed)
  const prevSelectedRef = useRef(selectedIds);
  if (prevSelectedRef.current !== selectedIds) {
    prevSelectedRef.current = selectedIds;
    if (recentlyAdded.size > 0) setRecentlyAdded(new Set());
    if (recentlyRemoved.size > 0) setRecentlyRemoved(new Set());
  }

  const handleToggle = (id: string) => {
    if (selectedIds.has(id) && !recentlyRemoved.has(id)) {
      // Removing
      setRecentlyRemoved((prev) => new Set([...prev, id]));
    } else if (!selectedIds.has(id) && !recentlyAdded.has(id)) {
      // Adding
      setRecentlyAdded((prev) => new Set([...prev, id]));
      setFlashCount(true);
      setTimeout(() => setFlashCount(false), 600);
    }
    onToggle(id);
  };

  // Effective selected = (selectedIds + recentlyAdded) - recentlyRemoved
  const effectiveSelected = new Set([...selectedIds, ...recentlyAdded]);
  for (const id of recentlyRemoved) effectiveSelected.delete(id);

  const baseFilter = (p: Player) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (genderFilter && p.gender !== genderFilter) return false;
    return true;
  };

  const available = players
    .filter((p) => !effectiveSelected.has(p.id))
    .filter((p) => {
      if (!showAll && recentIds && recentIds.size > 0 && !recentIds.has(p.id)) return false;
      return baseFilter(p);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const selected = players
    .filter((p) => effectiveSelected.has(p.id))
    .filter(baseFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const isRecent = !showAll && recentIds && recentIds.size > 0;

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
        <button type="button" onClick={() => setShowAll(true)}
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

      {/* Two columns: Available | Added */}
      <div className="flex gap-2">
        {/* Left: Available */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
            Available ({available.length})
          </div>
          <div className="max-h-80 overflow-y-auto space-y-px rounded-lg border border-border bg-gray-50 p-1">
            {available.map((p) => (
              <SwipeRow key={p.id} player={p} direction="right" onAction={() => handleToggle(p.id)} />
            ))}
            {available.length === 0 && <p className="text-[10px] text-muted py-4 text-center">No players</p>}
          </div>
        </div>

        {/* Right: Added */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
            Added (<span className={flashCount ? "text-green-600 text-xs font-bold" : ""}>{selected.length}</span>)
          </div>
          <div className="max-h-80 overflow-y-auto space-y-px rounded-lg border border-border bg-gray-50 p-1">
            {selected.map((p) => (
              <SwipeRow key={p.id} player={p} direction="left" onAction={() => handleToggle(p.id)} />
            ))}
            {selected.length === 0 && <p className="text-[10px] text-muted py-4 text-center">None yet</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
