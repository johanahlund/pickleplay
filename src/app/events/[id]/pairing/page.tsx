"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useConfirm } from "@/components/ConfirmDialog";

// ── Types mirroring src/lib/solver/types.ts ──────────────────────────────

type Base = "random" | "swiss" | "king" | "manual";
type Teams = "fixed" | "rotating";
type Gender = "mixed" | "random" | "same";
// Use numbers in the UI; Infinity is represented as "inf" over JSON.
type Window = 0 | 1 | 2 | "inf";

interface PairingSettings {
  base: Base;
  teams: Teams;
  gender: Gender;
  skillWindow: Window;
  matchCountWindow: Window;
  varietyWindow: Window;
}

interface EventClass {
  id: string;
  name: string;
  format: string;
  pairingSettings: PairingSettings | null;
  players: Array<{
    id: string;
    playerId: string;
    skillLevel: number | null;
    autoSkillLevel: number | null;
    status: string;
    player: {
      id: string;
      name: string;
      gender: string | null;
      photoUrl: string | null;
      duprRating: number | null;
      globalRating: number | null;
      rating: number | null;
    };
  }>;
}

interface EventSummary {
  id: string;
  name: string;
  numCourts: number;
  classes: EventClass[];
}

interface PoolAnalysis {
  pool: {
    total: number;
    active: number;
    paused: number;
    genderCounts: { M: number; F: number; unknown: number };
    skillDistribution: Record<string, number>;
  };
  capacity: { playersPerRound: number; sitOutPerRound: number };
  varietyCeiling: number;
  feasibility: {
    simulatedRounds: number;
    maxCleanRounds: number;
    firstViolation: Partial<Record<string, number>>;
  };
  warnings: string[];
}

interface PairLockDTO {
  id: string;
  playerAId: string;
  playerBId: string;
  note: string | null;
  playerA: { id: string; name: string; photoUrl: string | null };
  playerB: { id: string; name: string; photoUrl: string | null };
}

// ── Defaults ─────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: PairingSettings = {
  base: "random",
  teams: "rotating",
  gender: "random",
  skillWindow: 1,
  matchCountWindow: 1,
  varietyWindow: 0,
};

// ── Component ─────────────────────────────────────────────────────────────

export default function PairingConfigPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { confirm, alert } = useConfirm();

  const [event, setEvent] = useState<EventSummary | null>(null);
  const [classId, setClassId] = useState<string>("");
  const [settings, setSettings] = useState<PairingSettings>(DEFAULT_SETTINGS);
  const [analysis, setAnalysis] = useState<PoolAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [locks, setLocks] = useState<PairLockDTO[]>([]);
  const [generating, setGenerating] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setEvent({
          id: data.id,
          name: data.name,
          numCourts: data.numCourts,
          classes: data.classes || [],
        });
        if (data.classes?.[0]) {
          setClassId(data.classes[0].id);
          if (data.classes[0].pairingSettings) {
            setSettings({ ...DEFAULT_SETTINGS, ...data.classes[0].pairingSettings });
          }
        }
      });
  }, [id]);

  // Load locks whenever class changes
  useEffect(() => {
    if (!classId) return;
    fetch(`/api/events/${id}/pairing/locks?classId=${classId}`)
      .then((r) => r.json())
      .then(setLocks);
  }, [id, classId]);

  // ── Live analyzer — re-run whenever settings or class change ──────────
  const runAnalyze = useCallback(async () => {
    if (!classId) return;
    setAnalyzing(true);
    try {
      const r = await fetch(`/api/events/${id}/pairing/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, settings }),
      });
      if (r.ok) setAnalysis(await r.json());
    } finally {
      setAnalyzing(false);
    }
  }, [id, classId, settings]);

  useEffect(() => {
    const timer = setTimeout(runAnalyze, 250); // debounce
    return () => clearTimeout(timer);
  }, [runAnalyze]);

  // ── Generate next round ─────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!classId) return;
    const ok = await confirm({
      title: "Generate next round",
      message: "This will create new matches based on the current settings. Continue?",
      confirmText: "Generate",
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await fetch(`/api/events/${id}/pairing/generate-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, settings }),
      });
      if (r.ok) {
        await alert("Round generated successfully", "Done");
        router.push(`/events/${id}`);
      } else {
        const d = await r.json();
        await alert(d.error || "Failed to generate round", "Error");
      }
    } finally {
      setGenerating(false);
    }
  };

  // ── Recalculate skill levels ────────────────────────────────────────────
  const handleRecalcAll = async () => {
    if (!classId) return;
    const ok = await confirm({
      title: "Recalculate all skill levels?",
      message: "This will reset every player's skill level to the value computed from their DUPR / app rating. Any manual overrides will be lost.",
      danger: true,
      confirmText: "Recalculate",
    });
    if (!ok) return;
    await fetch(`/api/events/${id}/pairing/skill-levels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recalculate", classId }),
    });
    // reload event
    const r = await fetch(`/api/events/${id}`);
    const reloaded = await r.json();
    setEvent((prev) => (prev ? { ...prev, classes: reloaded.classes } : prev));
  };

  // Update a single player's skill level
  const handleUpdateLevel = async (eventPlayerId: string, level: number | null) => {
    await fetch(`/api/events/${id}/pairing/skill-levels`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: [{ eventPlayerId, skillLevel: level }] }),
    });
    // Optimistic: patch in memory.
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        classes: prev.classes.map((c) =>
          c.id === classId
            ? {
                ...c,
                players: c.players.map((p) =>
                  p.id === eventPlayerId ? { ...p, skillLevel: level } : p,
                ),
              }
            : c,
        ),
      };
    });
  };

  // ── Pair lock CRUD ──────────────────────────────────────────────────────
  const handleAddLock = async (playerAId: string, playerBId: string) => {
    const r = await fetch(`/api/events/${id}/pairing/locks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classId, playerAId, playerBId }),
    });
    if (r.ok) {
      const newLock = await r.json();
      setLocks((prev) => [...prev, newLock]);
    }
  };

  const handleRemoveLock = async (lockId: string) => {
    await fetch(`/api/events/${id}/pairing/locks`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lockId }),
    });
    setLocks((prev) => prev.filter((l) => l.id !== lockId));
  };

  if (!event) return <div className="p-4 text-muted text-sm">Loading...</div>;

  const currentClass = event.classes.find((c) => c.id === classId);

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/events/${id}`} className="text-sm text-action">&larr; Back to event</Link>
          <h2 className="text-xl font-bold mt-1">Pairing: {event.name}</h2>
        </div>
      </div>

      {/* Class picker */}
      {event.classes.length > 1 && (
        <div className="bg-card rounded-xl border border-border p-3">
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

      {/* Pool analyzer (live) */}
      {analysis && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Pool analysis</h3>
            {analyzing && <span className="text-xs text-muted">Updating...</span>}
          </div>
          <div className="text-xs text-muted">
            {analysis.pool.active} active
            {analysis.pool.paused > 0 && ` · ${analysis.pool.paused} paused`}
            {" · "}
            {analysis.pool.genderCounts.M}M {analysis.pool.genderCounts.F}F
            {analysis.pool.genderCounts.unknown > 0 && ` · ${analysis.pool.genderCounts.unknown} unspecified`}
          </div>
          <div className="text-xs text-muted">
            Skill distribution:{" "}
            {[1, 2, 3, 4, 5]
              .map((l) => `${analysis.pool.skillDistribution[l] || 0}×L${l}`)
              .join(" · ")}
          </div>
          <div className="text-xs">
            <span className="font-medium">Capacity:</span>{" "}
            {analysis.capacity.playersPerRound} players/round
            {analysis.capacity.sitOutPerRound > 0 && ` · ${analysis.capacity.sitOutPerRound} sit out`}
          </div>
          <div className="text-xs">
            <span className="font-medium">Max clean rounds:</span>{" "}
            {analysis.feasibility.maxCleanRounds} of {analysis.feasibility.simulatedRounds} simulated
          </div>
          {analysis.warnings.length > 0 && (
            <div className="pt-2 border-t border-border space-y-1">
              {analysis.warnings.map((w, i) => (
                <div key={i} className="text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-1">⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold">Pairing settings</h3>

        <SegPicker
          label="Base mode"
          value={settings.base}
          onChange={(v) => setSettings((s) => ({ ...s, base: v as Base }))}
          options={[
            { value: "random", label: "Random" },
            { value: "swiss", label: "Swiss" },
            { value: "king", label: "King" },
            { value: "manual", label: "Manual" },
          ]}
        />

        <SegPicker
          label="Teams"
          value={settings.teams}
          onChange={(v) => setSettings((s) => ({ ...s, teams: v as Teams }))}
          options={[
            { value: "rotating", label: "Rotating" },
            { value: "fixed", label: "Fixed" },
          ]}
        />

        <SegPicker
          label="Gender"
          value={settings.gender}
          onChange={(v) => setSettings((s) => ({ ...s, gender: v as Gender }))}
          options={[
            { value: "random", label: "Any" },
            { value: "mixed", label: "Mixed" },
            { value: "same", label: "Same" },
          ]}
        />

        <WindowPicker
          label="Skill window"
          help="How close in skill level must players be?"
          value={settings.skillWindow}
          onChange={(v) => setSettings((s) => ({ ...s, skillWindow: v }))}
        />

        <WindowPicker
          label="Match count window"
          help="Fairness: max gap from average matches played"
          value={settings.matchCountWindow}
          onChange={(v) => setSettings((s) => ({ ...s, matchCountWindow: v }))}
        />

        <WindowPicker
          label="Variety window"
          help="How many partner/opponent repeats allowed"
          value={settings.varietyWindow}
          onChange={(v) => setSettings((s) => ({ ...s, varietyWindow: v }))}
        />
      </div>

      {/* Pair locks */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Manual pair locks</h3>
          <LockAdder
            players={currentClass?.players || []}
            existingLocks={locks}
            onAdd={handleAddLock}
          />
        </div>
        {locks.length === 0 ? (
          <p className="text-xs text-muted">No locked pairs. Add one if you have players who must partner together.</p>
        ) : (
          <div className="space-y-1">
            {locks.map((l) => (
              <div key={l.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                <PlayerAvatar name={l.playerA.name} photoUrl={l.playerA.photoUrl} size="xs" />
                <span className="text-sm font-medium">{l.playerA.name}</span>
                <span className="text-xs text-muted">+</span>
                <PlayerAvatar name={l.playerB.name} photoUrl={l.playerB.photoUrl} size="xs" />
                <span className="text-sm font-medium flex-1">{l.playerB.name}</span>
                <button onClick={() => handleRemoveLock(l.id)} className="text-xs text-danger">Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk skill editor */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Skill levels</h3>
          <div className="flex gap-2">
            <button onClick={() => setBulkMode(!bulkMode)} className="text-xs text-action">
              {bulkMode ? "Done" : "Edit"}
            </button>
            <button onClick={handleRecalcAll} className="text-xs text-muted">Recalculate</button>
          </div>
        </div>
        {currentClass && (
          <div className="space-y-1">
            {currentClass.players.map((ep) => (
              <div key={ep.id} className="flex items-center gap-2 p-1.5 rounded">
                <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                <span className="text-sm font-medium flex-1 truncate">{ep.player.name}</span>
                {ep.player.duprRating != null && (
                  <span className="text-[10px] text-muted">DUPR {ep.player.duprRating.toFixed(2)}</span>
                )}
                {bulkMode ? (
                  <select
                    value={ep.skillLevel ?? ""}
                    onChange={(e) =>
                      handleUpdateLevel(ep.id, e.target.value ? parseInt(e.target.value) : null)
                    }
                    className="text-xs border border-border rounded px-1.5 py-1"
                  >
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((l) => (
                      <option key={l} value={l}>L{l}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-semibold">
                    L{ep.skillLevel ?? ep.autoSkillLevel ?? "—"}
                    {ep.skillLevel != null && ep.autoSkillLevel != null && ep.skillLevel !== ep.autoSkillLevel && (
                      <span className="text-[10px] text-muted font-normal"> · was L{ep.autoSkillLevel}</span>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Generate button (sticky) */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-3 z-40">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={handleGenerate}
            disabled={generating || !classId}
            className="w-full bg-action-dark text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
          >
            {generating ? "Generating..." : "Generate Next Round"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function SegPicker<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">{label}</label>
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
              value === opt.value ? "bg-action text-white" : "bg-gray-100 text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WindowPicker({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: Window;
  onChange: (v: Window) => void;
}) {
  const opts: { value: Window; label: string }[] = [
    { value: 0, label: "±0" },
    { value: 1, label: "±1" },
    { value: 2, label: "±2" },
    { value: "inf", label: "∞" },
  ];
  return (
    <div>
      <label className="block text-xs text-muted mb-0.5">{label}</label>
      <div className="flex gap-1">
        {opts.map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
              value === opt.value ? "bg-action text-white" : "bg-gray-100 text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted mt-0.5">{help}</p>
    </div>
  );
}

function LockAdder({
  players,
  existingLocks,
  onAdd,
}: {
  players: EventClass["players"];
  existingLocks: PairLockDTO[];
  onAdd: (aId: string, bId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const lockedIds = new Set(
    existingLocks.flatMap((l) => [l.playerAId, l.playerBId]),
  );

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-primary">+ Add lock</button>
    );
  }

  const eligible = players.filter((p) => !lockedIds.has(p.playerId));

  return (
    <div className="flex items-center gap-1">
      <select value={a} onChange={(e) => setA(e.target.value)} className="text-[11px] border border-border rounded px-1 py-0.5">
        <option value="">—</option>
        {eligible.map((p) => (
          <option key={p.playerId} value={p.playerId}>{p.player.name}</option>
        ))}
      </select>
      <span className="text-[10px]">+</span>
      <select value={b} onChange={(e) => setB(e.target.value)} className="text-[11px] border border-border rounded px-1 py-0.5">
        <option value="">—</option>
        {eligible.filter((p) => p.playerId !== a).map((p) => (
          <option key={p.playerId} value={p.playerId}>{p.player.name}</option>
        ))}
      </select>
      <button
        onClick={() => {
          if (a && b) {
            onAdd(a, b);
            setA(""); setB(""); setOpen(false);
          }
        }}
        disabled={!a || !b}
        className="text-[11px] px-2 py-0.5 bg-action text-white rounded disabled:opacity-50"
      >
        Add
      </button>
      <button onClick={() => setOpen(false)} className="text-[11px] text-muted">Cancel</button>
    </div>
  );
}
