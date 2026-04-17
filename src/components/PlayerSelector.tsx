"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ClearInput } from "./ClearInput";
import { PlayerAvatar } from "./PlayerAvatar";
import { useConfirm } from "./ConfirmDialog";

interface Player {
  id: string;
  name: string;
  gender?: string | null;
  rating?: number;
  photoUrl?: string | null;
  [key: string]: unknown;
}

interface PlayerSelectorProps {
  players: Player[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void | Promise<void>;
  onSelectAll?: () => void;
  recentIds?: Set<string>;
  /** Player IDs who are members of the event/club context this selector is filtering for. */
  clubMemberIds?: Set<string>;
  /** Short label for the club filter button, e.g. "🏓 Setubal" or just "Club". */
  clubLabel?: string;
}

function SwipeRow({ player, direction, onAction, needsConfirm }: {
  player: Player;
  direction: "right" | "left";
  onAction: () => void;
  needsConfirm?: boolean;
}) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const locked = useRef(false);
  const lastTap = useRef(0);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const THRESHOLD = 50;

  const doAction = useCallback(() => {
    if (needsConfirm && !confirming) {
      setConfirming(true);
      confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    onAction();
  }, [needsConfirm, confirming, onAction]);

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
      if (needsConfirm && !confirming) {
        setConfirming(true);
        confirmTimer.current = setTimeout(() => setConfirming(false), 3000);
        setOffsetX(0);
      } else {
        setSwiped(true);
        setOffsetX(direction === "right" ? 150 : -150);
        if (confirmTimer.current) clearTimeout(confirmTimer.current);
        setConfirming(false);
        setTimeout(() => { onAction(); setOffsetX(0); setSwiped(false); }, 200);
      }
    } else {
      setOffsetX(0);
    }
    startX.current = null;
    locked.current = false;
  }, [offsetX, direction, onAction, needsConfirm, confirming]);

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
        className={`flex items-center gap-1.5 py-1.5 px-2 transition-transform ${
          confirming ? "bg-red-100" : active ? (direction === "right" ? "bg-green-50" : "bg-red-50") : "bg-card"
        }`}
        style={{ transform: `translateX(${offsetX}px)`, transitionDuration: startX.current ? "0ms" : "200ms" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (confirming) {
            doAction();
            return;
          }
          const now = Date.now();
          if (now - lastTap.current < 350) {
            doAction();
            lastTap.current = 0;
          } else {
            lastTap.current = now;
          }
        }}
      >
        <PlayerAvatar name={player.name} photoUrl={player.photoUrl} size="xs" />
        <span className="text-xs font-medium flex-1 truncate">{confirming ? `Remove ${player.name}?` : player.name}</span>
        {confirming && <span className="text-[9px] text-danger font-bold shrink-0 animate-pulse">Tap to confirm</span>}
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

type FilterMode = "all" | "recent" | "club";

function InEventGrid({ players, onRemove }: { players: Player[]; onRemove: (id: string) => void }) {
  const { confirm: confirmDialog } = useConfirm();
  const lastTapRef = useRef<{ id: string; time: number }>({ id: "", time: 0 });
  return (
    <div className="grid grid-cols-2 gap-px">
      {players.map((p) => (
        <button key={p.id} onClick={async () => {
          const now = Date.now();
          if (lastTapRef.current.id === p.id && now - lastTapRef.current.time < 400) {
            lastTapRef.current = { id: "", time: 0 };
            const ok = await confirmDialog({ title: "Remove player?", message: `Remove ${p.name} from event?`, danger: true, confirmText: "Remove" });
            if (ok) onRemove(p.id);
          } else {
            lastTapRef.current = { id: p.id, time: now };
          }
        }}
          className="flex items-center gap-1 py-1 px-1 rounded min-w-0">
          <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
          <span className="text-[9px] font-medium truncate">{p.name}</span>
        </button>
      ))}
    </div>
  );
}

export function PlayerSelector({
  players,
  selectedIds,
  onToggle,
  onSelectAll,
  recentIds,
  clubMemberIds,
  clubLabel = "Club",
}: PlayerSelectorProps) {
  const [search, setSearch] = useState("");
  const [genderFilter, setGenderFilter] = useState<string | null>(null);
  // Three-state filter: Recent / Club / All. Default priority:
  // Club (if provided) > Recent (if provided) > All.
  const [filterMode, setFilterMode] = useState<FilterMode>(() => {
    if (clubMemberIds) return "club";
    if (recentIds && recentIds.size > 0) return "recent";
    return "all";
  });
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

  const modeFilter = (p: Player) => {
    if (filterMode === "recent" && recentIds && recentIds.size > 0) return recentIds.has(p.id);
    if (filterMode === "club" && clubMemberIds && clubMemberIds.size > 0) return clubMemberIds.has(p.id);
    return true; // "all" or fallback
  };

  const available = players
    .filter((p) => !effectiveSelected.has(p.id))
    .filter((p) => modeFilter(p) && baseFilter(p))
    .sort((a, b) => a.name.localeCompare(b.name));

  const selected = players
    .filter((p) => effectiveSelected.has(p.id))
    .filter(baseFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const hasRecent = !!(recentIds && recentIds.size > 0);
  const hasClub = !!(clubMemberIds && clubMemberIds.size > 0);

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <ClearInput value={search} onChange={setSearch} placeholder="Search..." className="text-xs flex-1" />
        <div className="flex flex-col gap-1 shrink-0 items-end">
          {/* Gender row */}
          <div className="flex gap-1">
            {(["M", "F"] as const).map((g) => (
              <button key={g} type="button"
                onClick={() => setGenderFilter(genderFilter === g ? null : g)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  genderFilter === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>
                {g === "M" ? "♂" : "♀"}
              </button>
            ))}
          </div>
          {/* Mode row */}
          <div className="flex gap-1">
            {hasRecent && (
              <button type="button" onClick={() => setFilterMode("recent")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  filterMode === "recent" ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>
                Recent
              </button>
            )}
            {hasClub && (
              <button type="button" onClick={() => setFilterMode("club")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  filterMode === "club" ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>
                {clubLabel}
              </button>
            )}
            <button type="button" onClick={() => setFilterMode("all")}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                filterMode === "all" ? "bg-selected text-white" : "bg-gray-100 text-foreground"
              }`}>
              All
            </button>
          </div>
        </div>
      </div>
      {filterMode === "recent" && onSelectAll && (
        <div className="flex justify-end">
          <button type="button" onClick={onSelectAll}
            className="text-action text-[10px] font-medium whitespace-nowrap">
            Select all
          </button>
        </div>
      )}

      {/* Two columns: Players | In Event */}
      <div className="flex gap-2" style={{ height: "calc(100vh - 220px)", minHeight: "300px" }}>
        {/* Left: Players */}
        <div className="w-[45%] min-w-0 flex flex-col shrink-0">
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
            Players ({available.length})
          </div>
          <div className="flex-1 overflow-y-auto space-y-px rounded-lg border border-border bg-gray-50 p-1">
            {available.map((p) => (
              <SwipeRow key={p.id} player={p} direction="right" onAction={() => handleToggle(p.id)} needsConfirm={false} />
            ))}
            {available.length === 0 && <p className="text-[10px] text-muted py-4 text-center">No players</p>}
          </div>
        </div>

        {/* Right: In Event */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-[10px] text-muted uppercase tracking-wider font-medium px-1 pb-1">
            In Event (<span className={flashCount ? "text-green-600 text-xs font-bold" : ""}>{selected.length}</span>)
          </div>
          <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-gray-50 p-1">
            <InEventGrid players={selected} onRemove={handleToggle} />
            {selected.length === 0 && <p className="text-[10px] text-muted py-4 text-center">None yet</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
