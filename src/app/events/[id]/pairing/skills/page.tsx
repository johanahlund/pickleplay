"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useConfirm } from "@/components/ConfirmDialog";

/**
 * Skill level editor — two-pane layout:
 *   Left:  scrollable list of every player in the class (drag source +
 *          master reference), each card shows the current level badge.
 *   Right: one row per level, highest first (L5 → L4 → L3 → L2 → L1 →
 *          Unset). Each row is a drop target. Players currently assigned
 *          to that level appear as chips in the row.
 *
 * Supported interactions:
 *   - Drag a player card from the left into a level row on the right.
 *   - Drag a chip between level rows on the right to reassign.
 *   - Drag a chip off the right side back to Unset.
 *   - Tap a player / chip to select, then tap a level row to place them
 *     (mobile-friendly alternative to drag).
 */

type Level = 1 | 2 | 3 | 4 | 5 | null;

// Top-to-bottom order: L5 first. Unset is represented by the left player
// column itself — there's no separate "unset row" on the right.
const LEVEL_ROWS: { key: Exclude<Level, null>; label: string; level: Level }[] = [
  { key: 5, label: "L5 — Expert", level: 5 },
  { key: 4, label: "L4", level: 4 },
  { key: 3, label: "L3", level: 3 },
  { key: 2, label: "L2", level: 2 },
  { key: 1, label: "L1 — Beginner", level: 1 },
];

interface EventPlayerRow {
  id: string;
  playerId: string;
  classId: string | null;
  skillLevel: number | null;
  autoSkillLevel: number | null;
  player: {
    id: string;
    name: string;
    photoUrl: string | null;
    duprRating: number | null;
  };
}

interface EventClassLite {
  id: string;
  name: string;
}

interface EventSummary {
  id: string;
  name: string;
  classes: EventClassLite[];
  players: EventPlayerRow[];
}

export default function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { confirm, alert } = useConfirm();

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [classId, setClassId] = useState<string>("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverLevel, setDragOverLevel] = useState<Level | "unset" | null>(null);

  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setEvent({
          id: data.id,
          name: data.name,
          classes: (data.classes || []).map((c: EventClassLite) => ({ id: c.id, name: c.name })),
          players: data.players || [],
        });
        if (data.classes?.[0]) setClassId(data.classes[0].id);
      });
  }, [id]);

  if (!event) return <div className="p-4 text-sm text-muted">Loading...</div>;

  const classPlayers = event.players.filter(
    (p) => p.classId === classId || (p.classId === null && classId === event.classes[0]?.id),
  );
  // Left column: players without an assigned level.
  const unassignedPlayers = [...classPlayers]
    .filter((p) => p.skillLevel == null)
    .sort((a, b) => a.player.name.localeCompare(b.player.name));

  // Group assigned players by their level for the right-hand rows.
  const byLevel = new Map<string, EventPlayerRow[]>();
  for (const r of LEVEL_ROWS) byLevel.set(String(r.key), []);
  for (const ep of classPlayers) {
    if (ep.skillLevel == null) continue; // lives in left column, not a level row
    byLevel.get(String(ep.skillLevel))?.push(ep);
  }

  // ── Assignment ─────────────────────────────────────────────────────────
  const assign = async (eventPlayerId: string, level: Level) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((p) =>
          p.id === eventPlayerId ? { ...p, skillLevel: level } : p,
        ),
      };
    });
    setSelectedId(null);
    setDraggingId(null);
    setDragOverLevel(null);

    await fetch(`/api/events/${id}/pairing/skill-levels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ eventPlayerId, skillLevel: level }],
      }),
    });
  };

  const handleRecalcAll = async () => {
    const ok = await confirm({
      title: "Recalculate from DUPR / rating?",
      message:
        "Every player's skill level will be reset to the value computed from their DUPR or app rating. Manual overrides will be lost.",
      danger: true,
      confirmText: "Recalculate",
    });
    if (!ok) return;
    const r = await fetch(`/api/events/${id}/pairing/skill-levels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recalculate", classId }),
    });
    if (r.ok) {
      const ev = await fetch(`/api/events/${id}`).then((x) => x.json());
      setEvent({
        id: ev.id,
        name: ev.name,
        classes: (ev.classes || []).map((c: EventClassLite) => ({ id: c.id, name: c.name })),
        players: ev.players || [],
      });
    } else {
      await alert("Recalculate failed", "Error");
    }
  };

  // ── Drag-and-drop ──────────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, eventPlayerId: string) => {
    setDraggingId(eventPlayerId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", eventPlayerId);
  };

  const onDragOver = (e: React.DragEvent, target: Level | "unset") => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverLevel !== target) setDragOverLevel(target);
  };

  const onDragLeave = () => setDragOverLevel(null);

  const onDrop = (e: React.DragEvent, target: Level | "unset") => {
    e.preventDefault();
    const eventPlayerId = draggingId || e.dataTransfer.getData("text/plain");
    if (!eventPlayerId) return;
    const level: Level = target === "unset" ? null : (target as Level);
    assign(eventPlayerId, level);
  };

  // ── Tap-to-assign ──────────────────────────────────────────────────────
  const onTapPlayer = (eventPlayerId: string) => {
    setSelectedId((prev) => (prev === eventPlayerId ? null : eventPlayerId));
  };

  const onTapLevel = (target: Level | "unset") => {
    if (!selectedId) return;
    const level: Level = target === "unset" ? null : (target as Level);
    assign(selectedId, level);
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/events/${id}/pairing`} className="text-sm text-action">&larr; Back to pairing</Link>
          <h2 className="text-xl font-bold mt-1">Skill levels</h2>
          <p className="text-xs text-muted">{event.name}</p>
        </div>
        <button
          onClick={handleRecalcAll}
          className="text-xs text-muted hover:text-foreground underline"
        >
          Recalculate from ratings
        </button>
      </div>

      {event.classes.length > 1 && (
        <div>
          <label className="block text-xs text-muted mb-1">Class</label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm"
          >
            {event.classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      <p className="text-[11px] text-muted">
        Drag a player onto a level row, or tap a player then tap a row. Highest level is on top.
        Drop a chip back onto the Players column to unset their level.
      </p>

      {/* Two-pane grid: unassigned players left, level rows right */}
      <div className="grid grid-cols-[minmax(140px,180px)_1fr] gap-3">
        {/* LEFT: unassigned player list. Doubles as the "Unset" drop target. */}
        <div
          onDragOver={(e) => onDragOver(e, "unset")}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, "unset")}
          onClick={() => onTapLevel("unset")}
          className={`rounded-xl border-2 p-2 space-y-1 self-start sticky top-2 max-h-[80vh] overflow-y-auto transition-colors ${
            dragOverLevel === "unset"
              ? "border-action bg-action/10"
              : selectedId !== null
                ? "border-primary/40 border-dashed cursor-pointer bg-card"
                : "border-border bg-card"
          }`}
        >
          <div className="text-[11px] font-semibold text-muted uppercase tracking-wider px-1 py-1 border-b border-border mb-1 flex items-center justify-between">
            <span>No level yet</span>
            <span className="text-[10px] normal-case font-normal">{unassignedPlayers.length}</span>
          </div>
          {unassignedPlayers.length === 0 && (
            <p className="text-[11px] text-muted italic p-2">All players have a level.</p>
          )}
          {unassignedPlayers.map((ep) => (
            <PlayerCard
              key={ep.id}
              ep={ep}
              selected={selectedId === ep.id}
              dragging={draggingId === ep.id}
              onDragStart={onDragStart}
              onTap={onTapPlayer}
            />
          ))}
        </div>

        {/* RIGHT: level rows, highest first */}
        <div className="space-y-2">
          {LEVEL_ROWS.map((row) => {
            const rows = byLevel.get(String(row.key)) || [];
            const isOver = dragOverLevel === row.key;
            const highlightForTap = selectedId !== null;
            return (
              <div
                key={String(row.key)}
                onDragOver={(e) => onDragOver(e, row.key)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, row.key)}
                onClick={() => onTapLevel(row.key)}
                className={`bg-card rounded-xl border-2 p-3 min-h-[72px] transition-colors ${
                  isOver
                    ? "border-action bg-action/10"
                    : highlightForTap
                      ? "border-primary/40 border-dashed cursor-pointer hover:bg-primary/5"
                      : "border-border"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">{row.label}</span>
                  <span className="text-[10px] text-muted">{rows.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rows.map((ep) => (
                    <PlayerChip
                      key={ep.id}
                      ep={ep}
                      selected={selectedId === ep.id}
                      dragging={draggingId === ep.id}
                      onDragStart={onDragStart}
                      onTap={onTapPlayer}
                    />
                  ))}
                  {rows.length === 0 && (
                    <span className="text-[10px] text-muted italic">drop here</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────

function PlayerCard({
  ep,
  selected,
  dragging,
  onDragStart,
  onTap,
}: {
  ep: EventPlayerRow;
  selected: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onTap: (id: string) => void;
}) {
  const level = ep.skillLevel ?? ep.autoSkillLevel;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ep.id)}
      onClick={(e) => {
        e.stopPropagation();
        onTap(ep.id);
      }}
      className={`flex items-center gap-1.5 p-1.5 rounded-lg cursor-move transition-all ${
        selected
          ? "bg-action text-white"
          : dragging
            ? "opacity-50 bg-gray-100"
            : "bg-gray-50 hover:bg-gray-100"
      }`}
    >
      <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium truncate">{ep.player.name}</div>
      </div>
      <span
        className={`text-[9px] font-bold ${
          selected ? "text-white/90" : level == null ? "text-muted" : "text-foreground"
        }`}
      >
        {level == null ? "—" : `L${level}`}
      </span>
    </div>
  );
}

function PlayerChip({
  ep,
  selected,
  dragging,
  onDragStart,
  onTap,
}: {
  ep: EventPlayerRow;
  selected: boolean;
  dragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onTap: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, ep.id)}
      onClick={(e) => {
        e.stopPropagation();
        onTap(ep.id);
      }}
      className={`flex items-center gap-1 px-1.5 py-1 rounded-lg cursor-move transition-all ${
        selected
          ? "bg-action text-white"
          : dragging
            ? "opacity-50 bg-gray-100"
            : "bg-gray-100 hover:bg-gray-200"
      }`}
      title={
        ep.skillLevel != null && ep.autoSkillLevel != null && ep.skillLevel !== ep.autoSkillLevel
          ? `Auto: L${ep.autoSkillLevel}`
          : undefined
      }
    >
      <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
      <span className="text-[11px] font-medium">{ep.player.name}</span>
      {ep.skillLevel != null &&
        ep.autoSkillLevel != null &&
        ep.skillLevel !== ep.autoSkillLevel && (
          <span className={`text-[8px] ${selected ? "text-white/80" : "text-muted"}`}>
            ≠L{ep.autoSkillLevel}
          </span>
        )}
    </div>
  );
}
