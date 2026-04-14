"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useConfirm } from "@/components/ConfirmDialog";

type Bucket = "unset" | 1 | 2 | 3 | 4 | 5;

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "unset", label: "Unset" },
  { key: 1, label: "L1" },
  { key: 2, label: "L2" },
  { key: 3, label: "L3" },
  { key: 4, label: "L4" },
  { key: 5, label: "L5" },
];

interface EventPlayerRow {
  id: string; // EventPlayer id
  playerId: string;
  classId: string | null;
  skillLevel: number | null;
  autoSkillLevel: number | null;
  player: {
    id: string;
    name: string;
    photoUrl: string | null;
    duprRating: number | null;
    globalRating: number | null;
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
  // tap-to-assign support for touch devices: one-tap to select, then tap a bucket
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOverBucket, setDragOverBucket] = useState<Bucket | null>(null);

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

  // Group players by bucket
  const byBucket: Record<string, EventPlayerRow[]> = {
    unset: [],
    "1": [],
    "2": [],
    "3": [],
    "4": [],
    "5": [],
  };
  for (const ep of classPlayers) {
    const key = ep.skillLevel == null ? "unset" : String(ep.skillLevel);
    byBucket[key].push(ep);
  }

  // ── Assignment action (used by both drag-drop and tap) ─────────────────
  const assign = async (eventPlayerId: string, bucket: Bucket) => {
    const newLevel: number | null = bucket === "unset" ? null : bucket;
    // Optimistic
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((p) =>
          p.id === eventPlayerId ? { ...p, skillLevel: newLevel } : p,
        ),
      };
    });
    setSelectedId(null);
    setDraggingId(null);
    setDragOverBucket(null);

    // Persist
    await fetch(`/api/events/${id}/pairing/skill-levels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ eventPlayerId, skillLevel: newLevel }],
      }),
    });
  };

  // ── Recalculate from DUPR/rating ────────────────────────────────────────
  const handleRecalcAll = async () => {
    const ok = await confirm({
      title: "Recalculate from DUPR / rating?",
      message: "Every player's skill level will be reset to the value computed from their DUPR or app rating. Manual overrides will be lost.",
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
      // Re-fetch event
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

  // ── Drag & drop handlers ────────────────────────────────────────────────
  const onDragStart = (e: React.DragEvent, eventPlayerId: string) => {
    setDraggingId(eventPlayerId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", eventPlayerId);
  };

  const onDragOver = (e: React.DragEvent, bucket: Bucket) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverBucket !== bucket) setDragOverBucket(bucket);
  };

  const onDragLeave = () => setDragOverBucket(null);

  const onDrop = (e: React.DragEvent, bucket: Bucket) => {
    e.preventDefault();
    const eventPlayerId = draggingId || e.dataTransfer.getData("text/plain");
    if (eventPlayerId) assign(eventPlayerId, bucket);
  };

  // ── Tap-to-assign (mobile-friendly) ─────────────────────────────────────
  const onTapPlayer = (eventPlayerId: string) => {
    setSelectedId((prev) => (prev === eventPlayerId ? null : eventPlayerId));
  };

  const onTapBucket = (bucket: Bucket) => {
    if (selectedId) assign(selectedId, bucket);
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/events/${id}/pairing`} className="text-sm text-action">&larr; Back to pairing</Link>
          <h2 className="text-xl font-bold mt-1">Skill levels: {event.name}</h2>
        </div>
        <button
          onClick={handleRecalcAll}
          className="text-xs text-muted hover:text-foreground"
        >
          Recalculate from ratings
        </button>
      </div>

      {/* Class picker */}
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

      <p className="text-xs text-muted">
        Drag a player to a level, or tap a player then tap a level.
        Auto-assigned values are shown when overridden.
      </p>

      {/* Bucket columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
        {BUCKETS.map((b) => {
          const rows = byBucket[String(b.key)] || [];
          const isOver = dragOverBucket === b.key;
          const isHighlightedForTap = selectedId !== null;
          return (
            <div
              key={String(b.key)}
              onDragOver={(e) => onDragOver(e, b.key)}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, b.key)}
              onClick={() => onTapBucket(b.key)}
              className={`bg-card rounded-xl border-2 p-2 min-h-[160px] transition-colors ${
                isOver
                  ? "border-action bg-action/10"
                  : isHighlightedForTap
                    ? "border-primary/40 border-dashed cursor-pointer hover:bg-primary/5"
                    : "border-border"
              }`}
            >
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                <span className="text-sm font-bold">{b.label}</span>
                <span className="text-[10px] text-muted">{rows.length}</span>
              </div>
              <div className="space-y-1">
                {rows.map((ep) => (
                  <div
                    key={ep.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, ep.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTapPlayer(ep.id);
                    }}
                    className={`flex items-center gap-1.5 p-1.5 rounded-lg cursor-move transition-all ${
                      selectedId === ep.id
                        ? "bg-action text-white"
                        : draggingId === ep.id
                          ? "opacity-50 bg-gray-100"
                          : "bg-gray-50 hover:bg-gray-100"
                    }`}
                  >
                    <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium truncate">{ep.player.name}</div>
                      {ep.skillLevel != null && ep.autoSkillLevel != null && ep.skillLevel !== ep.autoSkillLevel && (
                        <div className={`text-[9px] ${selectedId === ep.id ? "text-white/70" : "text-muted"}`}>
                          auto L{ep.autoSkillLevel}
                        </div>
                      )}
                      {ep.player.duprRating != null && (
                        <div className={`text-[9px] ${selectedId === ep.id ? "text-white/70" : "text-muted"}`}>
                          DUPR {ep.player.duprRating.toFixed(2)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <p className="text-[10px] text-muted italic py-4 text-center">empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
