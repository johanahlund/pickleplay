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
  maxWaitWindow: Window;
}

interface EventClass {
  id: string;
  name: string;
  format: string;
  pairingSettings: PairingSettings | null;
}

interface EventPlayerDTO {
  id: string;
  playerId: string;
  classId: string | null;
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
}

interface EventMatchDTO {
  id: string;
  round: number;
  courtNum: number;
  classId: string | null;
  status: string;
  players: { playerId: string; team: number; score: number }[];
}

interface EventSummary {
  id: string;
  name: string;
  numCourts: number;
  classes: EventClass[];
  players: EventPlayerDTO[];
  matches: EventMatchDTO[];
}

interface PreviewTeam {
  player1Id: string;
  player2Id: string;
}

interface PreviewMatch {
  court: number;
  team1: PreviewTeam;
  team2: PreviewTeam;
  team1Players: { id: string; name: string }[];
  team2Players: { id: string; name: string }[];
}

interface NextMatchPreview {
  preview: true;
  round: PreviewMatch[];
  cost: number;
  violations: { type: string; cost: number; details: string }[];
  sittingOut: string[];
  idleCourtCount: number;
  busyCourts: number[];
  includedCourts: number[];
  availablePlayerCount: number;
  courtsToFill: number;
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
  maxWaitWindow: 1,
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
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [includeCourts, setIncludeCourts] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<NextMatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

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
          players: data.players || [],
          matches: data.matches || [],
        });
        if (data.classes?.[0]) {
          setClassId(data.classes[0].id);
          if (data.classes[0].pairingSettings) {
            setSettings({ ...DEFAULT_SETTINGS, ...data.classes[0].pairingSettings });
          }
        }
        setSettingsLoaded(true);
      });
  }, [id]);

  // When switching classes, load that class's saved settings if any.
  useEffect(() => {
    if (!event || !classId) return;
    const cls = event.classes.find((c) => c.id === classId);
    if (cls?.pairingSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...cls.pairingSettings });
    } else {
      setSettings(DEFAULT_SETTINGS);
    }
  }, [classId, event]);

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

  // ── Auto-save settings to EventClass.pairingSettings (debounced) ────────
  useEffect(() => {
    if (!classId || !settingsLoaded) return;
    setSaveStatus("saving");
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/events/${id}/pairing/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ classId, settings }),
        });
        if (r.ok) setSaveStatus("saved");
        else setSaveStatus("");
      } catch {
        setSaveStatus("");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [id, classId, settings, settingsLoaded]);

  // ── Live preview (debounced) ────────────────────────────────────────────
  // Fetches the "what would happen if I generate now" state whenever
  // settings or includeCourts change. Drives the court-circles + preview UI.
  const runPreview = useCallback(async () => {
    if (!classId) return;
    setPreviewing(true);
    try {
      const r = await fetch(`/api/events/${id}/pairing/generate-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          settings,
          includeCourts: [...includeCourts],
          preview: true,
        }),
      });
      if (r.ok) {
        setPreview(await r.json());
      } else {
        setPreview(null);
      }
    } finally {
      setPreviewing(false);
    }
  }, [id, classId, settings, includeCourts]);

  useEffect(() => {
    const timer = setTimeout(runPreview, 200);
    return () => clearTimeout(timer);
  }, [runPreview]);

  // ── Commit the preview ──────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!classId) return;
    const ok = await confirm({
      title: "Generate match(es)",
      message: preview && preview.round.length > 1
        ? `This will create ${preview.round.length} new matches based on the current settings and selected courts. Continue?`
        : "This will create a new match based on the current settings. Continue?",
      confirmText: "Generate",
    });
    if (!ok) return;
    setGenerating(true);
    try {
      const r = await fetch(`/api/events/${id}/pairing/generate-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId,
          settings,
          includeCourts: [...includeCourts],
        }),
      });
      if (r.ok) {
        await alert("Match(es) generated successfully", "Done");
        router.push(`/events/${id}`);
      } else {
        const d = await r.json();
        await alert(d.error || "Failed to generate", "Error");
      }
    } finally {
      setGenerating(false);
    }
  };

  const toggleCourt = (court: number) => {
    setIncludeCourts((prev) => {
      const next = new Set(prev);
      if (next.has(court)) next.delete(court);
      else next.add(court);
      return next;
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
  // Event players are flat at the top level — filter by class here. Include
  // players with null classId (the default/auto-created class) when the
  // selected class is the first/default one.
  const classPlayers = event.players.filter(
    (p) => p.classId === classId || (p.classId === null && classId === event.classes[0]?.id),
  );
  // Derive played-match counts per player from the event's match history.
  // Includes pending/in-progress matches too so the count represents all
  // matches a player is scheduled for.
  const playerMatchCounts = new Map<string, number>();
  for (const m of event.matches) {
    if (m.classId !== classId && !(m.classId === null && classId === event.classes[0]?.id)) continue;
    for (const p of m.players) {
      playerMatchCounts.set(p.playerId, (playerMatchCounts.get(p.playerId) || 0) + 1);
    }
  }

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

      {/* Next match(es) — live preview with court selector */}
      {preview && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Next match{preview.round.length !== 1 ? "es" : ""}</h3>
            {previewing && <span className="text-[10px] text-muted">Updating...</span>}
          </div>

          {/* Courts in progress */}
          {preview.busyCourts.length > 0 && (
            <div>
              <div className="text-[11px] text-muted mb-1">
                Courts in progress — tap to include players who are about to finish:
              </div>
              <div className="flex gap-2">
                {preview.busyCourts.map((c) => {
                  const included = includeCourts.has(c);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleCourt(c)}
                      className={`w-10 h-10 rounded-full border-2 text-sm font-semibold transition-colors ${
                        included
                          ? "bg-action text-white border-action"
                          : "bg-white text-muted border-border hover:border-action"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted mt-1">
                {includeCourts.size === 0
                  ? "Currently only using idle players."
                  : `Waiting for ${includeCourts.size} court${includeCourts.size > 1 ? "s" : ""} to finish.`}
              </p>
            </div>
          )}

          {/* Preview matches */}
          {preview.round.length === 0 ? (
            <p className="text-xs text-muted">
              Not enough available players to form a match. Tap a court above to include more.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="text-[11px] text-muted">
                {preview.availablePlayerCount} players available ·{" "}
                {preview.round.length} match{preview.round.length > 1 ? "es" : ""} ready
                {preview.cost > 0 && ` · cost ${preview.cost}`}
              </div>
              {preview.round.map((m, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-2 text-xs">
                  <div className="text-[10px] text-muted mb-0.5">Court {m.court}</div>
                  <div className="flex items-center gap-1 font-medium">
                    <span>{m.team1Players[0].name} + {m.team1Players[1].name}</span>
                    <span className="text-muted text-[10px] mx-1">vs</span>
                    <span>{m.team2Players[0].name} + {m.team2Players[1].name}</span>
                  </div>
                </div>
              ))}
              {preview.violations.length > 0 && (
                <div className="text-[10px] text-yellow-700 bg-yellow-50 rounded px-2 py-1">
                  ⚠ {preview.violations.length} soft constraint{preview.violations.length > 1 ? "s" : ""} violated:
                  <ul className="mt-0.5 ml-3 list-disc">
                    {preview.violations.slice(0, 3).map((v, i) => (
                      <li key={i}>{v.details}</li>
                    ))}
                    {preview.violations.length > 3 && <li>and {preview.violations.length - 3} more...</li>}
                  </ul>
                </div>
              )}
              {preview.sittingOut.length > 0 && (
                <div className="text-[10px] text-muted">
                  Sitting out: {preview.sittingOut.length} player{preview.sittingOut.length > 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Settings */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Pairing settings</h3>
          {saveStatus === "saving" && <span className="text-[10px] text-muted">Saving...</span>}
          {saveStatus === "saved" && <span className="text-[10px] text-green-600">Saved ✓</span>}
        </div>

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

        <WindowPicker
          label="Max wait"
          help="Max rounds a player may sit out consecutively"
          value={settings.maxWaitWindow}
          onChange={(v) => setSettings((s) => ({ ...s, maxWaitWindow: v }))}
        />
      </div>

      {/* Pair locks */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Manual pair locks</h3>
          <LockAdder
            players={classPlayers}
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

      {/* Players — grouped by level, highest first */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold">Players</h3>
          <Link
            href={`/events/${id}/pairing/skills`}
            className="text-xs text-action font-medium"
          >
            Edit levels →
          </Link>
        </div>
        {classPlayers.length === 0 ? (
          <p className="text-xs text-muted px-1">No players registered in this class yet.</p>
        ) : (
          <>
            {(() => {
              // Group players by effective level (manual override falls back to auto).
              const byLevel = new Map<string, EventPlayerDTO[]>();
              for (const ep of classPlayers) {
                const eff = ep.skillLevel ?? ep.autoSkillLevel;
                const key = eff == null ? "unset" : String(eff);
                const list = byLevel.get(key) || [];
                list.push(ep);
                byLevel.set(key, list);
              }

              const rows: { key: string; label: string }[] = [
                { key: "5", label: "L5 — Expert" },
                { key: "4", label: "L4" },
                { key: "3", label: "L3" },
                { key: "2", label: "L2" },
                { key: "1", label: "L1 — Beginner" },
                { key: "unset", label: "Unset" },
              ];

              return rows
                .filter((row) => (byLevel.get(row.key) || []).length > 0)
                .map((row) => {
                  const players = byLevel.get(row.key) || [];
                  return (
                    <div key={row.key} className="bg-card rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                        <span className={`text-sm font-bold ${row.key === "unset" ? "text-muted" : ""}`}>
                          {row.label}
                        </span>
                        <span className="text-[10px] text-muted">{players.length} player{players.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {players
                          .sort((a, b) => a.player.name.localeCompare(b.player.name))
                          .map((ep) => {
                            const count = playerMatchCounts.get(ep.playerId) || 0;
                            const overridden =
                              ep.skillLevel != null &&
                              ep.autoSkillLevel != null &&
                              ep.skillLevel !== ep.autoSkillLevel;
                            return (
                              <div
                                key={ep.id}
                                className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2 py-1.5 min-w-0"
                                title={
                                  overridden
                                    ? `Auto: L${ep.autoSkillLevel}`
                                    : undefined
                                }
                              >
                                <PlayerAvatar
                                  name={ep.player.name}
                                  photoUrl={ep.player.photoUrl}
                                  size="xs"
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-medium truncate">{ep.player.name}</div>
                                  {overridden && (
                                    <div className="text-[9px] text-muted">auto L{ep.autoSkillLevel}</div>
                                  )}
                                </div>
                                <span
                                  className="text-[10px] text-muted tabular-nums shrink-0"
                                  title={`${count} match${count === 1 ? "" : "es"}`}
                                >
                                  {count}m
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  );
                });
            })()}
          </>
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
  players: EventPlayerDTO[];
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
