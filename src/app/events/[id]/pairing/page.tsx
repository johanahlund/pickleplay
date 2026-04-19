"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { useConfirm } from "@/components/ConfirmDialog";
import { suggestWaitingAction } from "@/lib/solver/waitingSuggestion";
import { ScorePicker } from "@/components/ScorePicker";
import { useSession } from "next-auth/react";

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
  startedAt?: string | null;
  completedAt?: string | null;
  players: { playerId: string; team: number; score: number }[];
}

interface EventSummary {
  id: string;
  name: string;
  numCourts: number;
  createdById?: string;
  helpers?: { playerId: string }[];
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
  const [editingLocks, setEditingLocks] = useState(false);
  const [subPage, setSubPage] = useState<null | "settings">(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [levelEditMode, setLevelEditMode] = useState(false);
  const [levelSelectedIds, setLevelSelectedIds] = useState<Set<string>>(new Set());
  const toggleCollapsed = (k: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // Focused flow: hide the bottom nav on this page.
  useEffect(() => {
    const nav = document.querySelector("nav.fixed.bottom-0");
    if (nav) nav.classList.add("hidden");
    return () => {
      if (nav) nav.classList.remove("hidden");
    };
  }, []);
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const userRole = (session?.user as { role?: string } | undefined)?.role;
  const isAdmin = userRole === "admin";
  const isOwner = event?.createdById === userId;
  const isHelper = event?.helpers?.some((h) => h.playerId === userId);
  const canManage = isAdmin || isOwner || !!isHelper;
  const [generating, setGenerating] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"" | "saving" | "saved">("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [savedSettings, setSavedSettings] = useState<PairingSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [includeCourts, setIncludeCourts] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<NextMatchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [numRounds, setNumRounds] = useState(1);
  const [actionMatchId, setActionMatchId] = useState<string | null>(null);
  const [playerActionId, setPlayerActionId] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualCourt, setManualCourt] = useState(1);
  const [manualFilterMode, setManualFilterMode] = useState<"available" | "all">("available");
  const [manualGenderFilter, setManualGenderFilter] = useState<string | null>(null);
  const [newMatchId, setNewMatchId] = useState<string | null>(null);
  const [creatingMatch, setCreatingMatch] = useState(false);
  const [manualTeam1, setManualTeam1] = useState<string[]>([]);
  const [manualTeam2, setManualTeam2] = useState<string[]>([]);

  const refreshEvent = useCallback(async () => {
    const r = await fetch(`/api/events/${id}`);
    if (!r.ok) return;
    const data = await r.json();
    setEvent({
      id: data.id,
      name: data.name,
      numCourts: data.numCourts,
      createdById: data.createdById,
      helpers: data.helpers || [],
      classes: data.classes || [],
      players: data.players || [],
      matches: data.matches || [],
    });
  }, [id]);

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
            const loaded = { ...DEFAULT_SETTINGS, ...data.classes[0].pairingSettings };
            setSettings(loaded);
            setSavedSettings(loaded);
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
      const loaded = { ...DEFAULT_SETTINGS, ...cls.pairingSettings };
      setSettings(loaded);
      setSavedSettings(loaded);
    } else {
      setSettings(DEFAULT_SETTINGS);
      setSavedSettings(DEFAULT_SETTINGS);
    }
    setSettingsDirty(false);
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

  // ── Track dirty settings ────────
  useEffect(() => {
    if (!settingsLoaded) return;
    setSettingsDirty(JSON.stringify(settings) !== JSON.stringify(savedSettings));
  }, [settings, savedSettings, settingsLoaded]);

  const saveSettings = async () => {
    if (!classId) return;
    setSaveStatus("saving");
    try {
      const r = await fetch(`/api/events/${id}/pairing/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, settings }),
      });
      if (r.ok) {
        setSavedSettings(settings);
        setSettingsDirty(false);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      } else setSaveStatus("");
    } catch {
      setSaveStatus("");
    }
  };

  const cancelSettings = () => {
    setSettings(savedSettings);
    setSettingsDirty(false);
  };

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
  // Next Round: ALL checked-in players, ALL courts (includes busy courts)
  const handleGenerateRound = async () => {
    if (!classId || !event) return;
    setGenerating(true);
    try {
      const allCourtNums = Array.from({ length: event.numCourts }, (_, i) => i + 1);
      for (let i = 0; i < numRounds; i++) {
        const payload: Record<string, unknown> = {
          classId,
          settings,
          includeCourts: allCourtNums,
        };
        const r = await fetch(`/api/events/${id}/pairing/generate-round`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json();
          await alert(d.error || "Failed to generate", "Error");
          break;
        }
      }
      await refreshEvent();
    } finally {
      setGenerating(false);
    }
  };

  // Next Match: only IDLE players + IDLE courts (sitting out players only)
  const handleGenerate = async () => {
    if (!classId) return;
    setGenerating(true);
    try {
      for (let i = 0; i < numRounds; i++) {
        const usePreview = i === 0 && preview && preview.round.length > 0;
        const payload: Record<string, unknown> = {
          classId,
          settings,
          includeCourts: [...includeCourts],
          individual: true,
        };
        if (usePreview) {
          payload.commitRound = preview.round.map((m) => ({
            court: m.court,
            team1: m.team1,
            team2: m.team2,
          }));
        }
        const r = await fetch(`/api/events/${id}/pairing/generate-round`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const d = await r.json();
          await alert(d.error || "Failed to generate", "Error");
          break;
        } else {
          const data = await r.json();
          if (data.matches?.[0]) setNewMatchId(data.matches[0]);
        }
      }
      await refreshEvent();
      if (newMatchId) {
        setTimeout(() => {
          document.getElementById(`match-${newMatchId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
        setTimeout(() => setNewMatchId(null), 4000);
      }
    } finally {
      setGenerating(false);
    }
  };

  const startMatch = async (matchId: string) => {
    setEvent((prev) => prev ? {
      ...prev,
      matches: prev.matches.map((m) => m.id === matchId ? { ...m, status: "active", startedAt: new Date().toISOString() } : m),
    } : prev);
    await fetch(`/api/matches/${matchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    await refreshEvent();
  };

  const submitScore = async (matchId: string) => {
    const s = scores[matchId];
    if (!s?.team1 || !s?.team2) return;
    const t1 = parseInt(s.team1);
    const t2 = parseInt(s.team2);
    if (isNaN(t1) || isNaN(t2) || t1 === t2) return;
    setEvent((prev) => prev ? {
      ...prev,
      matches: prev.matches.map((m) => m.id === matchId ? {
        ...m,
        status: "completed",
        players: m.players.map((p) => ({ ...p, score: p.team === 1 ? t1 : t2 })),
      } : m),
    } : prev);
    await fetch(`/api/matches/${matchId}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team1Score: t1, team2Score: t2 }),
    });
    setScores((prev) => { const n = { ...prev }; delete n[matchId]; return n; });
    await refreshEvent();
  };

  const togglePausePlayer = async (playerId: string) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.playerId === playerId ? { ...ep, status: ep.status === "paused" ? "registered" : "paused" } : ep,
        ),
      };
    });
    await fetch(`/api/events/${id}/players/${playerId}/pause`, { method: "POST" });
    await refreshEvent();
  };

  const checkInPlayer = async (playerId: string) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.playerId === playerId ? { ...ep, status: ep.status === "checked_in" ? "registered" : "checked_in" } : ep,
        ),
      };
    });
    await fetch(`/api/events/${id}/players/${playerId}/checkin`, { method: "POST" });
    await refreshEvent();
  };

  const checkInAll = async (players: EventPlayerDTO[]) => {
    const registered = players.filter((ep) => ep.status === "registered");
    setEvent((prev) => {
      if (!prev) return prev;
      const regIds = new Set(registered.map((ep) => ep.playerId));
      return {
        ...prev,
        players: prev.players.map((ep) =>
          regIds.has(ep.playerId) ? { ...ep, status: "checked_in" } : ep,
        ),
      };
    });
    for (const ep of registered) {
      await fetch(`/api/events/${id}/players/${ep.playerId}/checkin`, { method: "POST" });
    }
    await refreshEvent();
  };

  const pauseMatch = async (matchId: string) => {
    setEvent((prev) => prev ? {
      ...prev,
      matches: prev.matches.map((m) => m.id === matchId ? { ...m, status: "paused" } : m),
    } : prev);
    await fetch(`/api/matches/${matchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paused" }),
    });
    await refreshEvent();
  };

  const deleteMatch = async (matchId: string) => {
    const ok = await confirm({ title: "Delete match?", message: "This cannot be undone.", danger: true, confirmText: "Delete" });
    if (!ok) return;
    setEvent((prev) => prev ? { ...prev, matches: prev.matches.filter((m) => m.id !== matchId) } : prev);
    await fetch(`/api/matches/${matchId}`, { method: "DELETE" });
    await refreshEvent();
  };

  const setSkillLevel = async (playerId: string, skillLevel: number | null) => {
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.playerId === playerId ? { ...ep, skillLevel } : ep,
        ),
      };
    });
    fetch(`/api/events/${id}/players/${playerId}/level`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillLevel }),
    });
  };

  const toggleManualPlayer = (playerId: string, team: 1 | 2) => {
    if (team === 1) {
      setManualTeam1((prev) => prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= 2 ? prev : [...prev, playerId]);
    } else {
      setManualTeam2((prev) => prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= 2 ? prev : [...prev, playerId]);
    }
  };

  const createManualMatch = async () => {
    if (manualTeam1.length === 0 || manualTeam2.length === 0) return;
    // Close immediately — show spinner while API runs
    const t1 = [...manualTeam1];
    const t2 = [...manualTeam2];
    const court = manualCourt;
    setManualTeam1([]);
    setManualTeam2([]);
    setShowManual(false);
    setCreatingMatch(true);
    // Scroll to the matches area immediately so user sees the spinner
    setTimeout(() => {
      document.getElementById("creating-spinner")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);

    const r = await fetch(`/api/events/${id}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team1PlayerIds: t1,
        team2PlayerIds: t2,
        courtNum: court,
      }),
    });
    if (r.ok) {
      const data = await r.json();
      setNewMatchId(data.id || null);
      await refreshEvent();
      if (data.id) {
        setTimeout(() => {
          document.getElementById(`match-${data.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 300);
        setTimeout(() => setNewMatchId(null), 4000);
      }
    } else {
      const d = await r.json();
      await alert(d.error || "Failed to create match", "Error");
    }
    setCreatingMatch(false);
  };

  const deleteAllPending = async () => {
    if (!event) return;
    const pendingIds = event.matches
      .filter((m) => m.status === "pending" && (m.classId === classId || (m.classId === null && classId === event.classes[0]?.id)))
      .map((m) => m.id);
    if (pendingIds.length === 0) return;
    const ok = await confirm({ title: `Delete ${pendingIds.length} pending match${pendingIds.length > 1 ? "es" : ""}?`, message: "This cannot be undone.", danger: true, confirmText: "Delete all" });
    if (!ok) return;
    setEvent((prev) => prev ? { ...prev, matches: prev.matches.filter((m) => !pendingIds.includes(m.id)) } : prev);
    for (const mid of pendingIds) {
      await fetch(`/api/matches/${mid}`, { method: "DELETE" });
    }
    await refreshEvent();
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

  if (!event) return (
    <div className="space-y-4">
      <Link href={`/events/${id}`} className="text-sm text-action font-medium">← Event Overview</Link>
      <div className="flex justify-center py-8">
        <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );

  if (showManual && event) {
    const manualMatchCounts = new Map<string, number>();
    for (const m of event.matches) for (const p of m.players) manualMatchCounts.set(p.playerId, (manualMatchCounts.get(p.playerId) || 0) + 1);
    // "Available" = checked in, not in any active/pending match
    const playingIds = new Set<string>();
    for (const m of event.matches.filter((m) => m.status === "active" || m.status === "pending" || m.status === "paused")) {
      for (const p of m.players) playingIds.add(p.playerId);
    }
    const allPlayers = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
    const availablePlayers = allPlayers.filter((ep) => !playingIds.has(ep.playerId));

    // Match type label
    const t1 = manualTeam1.length;
    const t2 = manualTeam2.length;
    const matchType = t1 === 0 && t2 === 0 ? "" : t1 === 1 && t2 === 1 ? "Singles" : t1 === 2 && t2 === 2 ? "Doubles" : t1 + t2 > 0 ? `${t1}v${t2}` : "";

    // Filter state for manual match
    const [manualFilter, setManualFilter] = [manualFilterMode, setManualFilterMode];
    const [manualGender, setManualGender] = [manualGenderFilter, setManualGenderFilter];
    const filteredPlayers = (manualFilter === "available" ? availablePlayers : allPlayers)
      .filter((ep) => !manualGender || ep.player.gender === manualGender);

    return (
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Manual Match</h2>
            {matchType && <span className="text-xs text-muted">{matchType}</span>}
          </div>
          <button onClick={() => { setShowManual(false); setManualTeam1([]); setManualTeam2([]); }}
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark">
            Done
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-sm font-semibold text-muted">Court</span>
            <div className="flex gap-1.5">
              {Array.from({ length: event.numCourts }, (_, i) => i + 1).map((c) => (
                <button key={c} onClick={() => setManualCourt(c)}
                  className={`w-9 h-9 rounded-xl font-bold text-base flex items-center justify-center transition-all ${
                    manualCourt === c ? "bg-selected text-white shadow-sm" : "bg-gray-100 text-foreground hover:bg-gray-200"
                  }`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            {(["M", "F"] as const).map((g) => (
              <button key={g} onClick={() => setManualGender(manualGender === g ? null : g)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  manualGender === g ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>{g === "M" ? "♂" : "♀"}</button>
            ))}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button onClick={() => setManualFilter("available")}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                manualFilter === "available" ? "bg-selected text-white" : "bg-gray-100 text-foreground"
              }`}>Available</button>
            <button onClick={() => setManualFilter("all")}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                manualFilter === "all" ? "bg-selected text-white" : "bg-gray-100 text-foreground"
              }`}>All</button>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1">Team 1 {t1 > 0 && `(${t1})`}</label>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {filteredPlayers.filter((ep) => !manualTeam2.includes(ep.playerId)).map((ep) => (
                  <button key={ep.playerId} onClick={() => toggleManualPlayer(ep.playerId, 1)}
                    disabled={!manualTeam1.includes(ep.playerId) && manualTeam1.length >= 2}
                    className={`w-full text-left text-sm py-1.5 px-2 rounded transition-all flex items-center gap-1.5 ${
                      manualTeam1.includes(ep.playerId) ? "bg-blue-100 text-blue-800 font-medium"
                      : manualTeam1.length >= 2 ? "opacity-30" : "hover:bg-gray-50"
                    }`}>
                    <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                    <span className="truncate flex-1">{ep.player.name}</span>
                    <span className="text-[10px] text-muted tabular-nums shrink-0">{manualMatchCounts.get(ep.playerId) || 0}m</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-foreground mb-1">Team 2 {t2 > 0 && `(${t2})`}</label>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {filteredPlayers.filter((ep) => !manualTeam1.includes(ep.playerId)).map((ep) => (
                  <button key={ep.playerId} onClick={() => toggleManualPlayer(ep.playerId, 2)}
                    disabled={!manualTeam2.includes(ep.playerId) && manualTeam2.length >= 2}
                    className={`w-full text-left text-sm py-1.5 px-2 rounded transition-all flex items-center gap-1.5 ${
                      manualTeam2.includes(ep.playerId) ? "bg-red-100 text-red-800 font-medium"
                      : manualTeam2.length >= 2 ? "opacity-30" : "hover:bg-gray-50"
                    }`}>
                    <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                    <span className="truncate flex-1">{ep.player.name}</span>
                    <span className="text-[10px] text-muted tabular-nums shrink-0">{manualMatchCounts.get(ep.playerId) || 0}m</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={createManualMatch} disabled={manualTeam1.length === 0 || manualTeam2.length === 0}
            className="flex-1 bg-action text-white py-3 rounded-xl font-semibold text-lg active:bg-action-dark disabled:opacity-50">
            Create {matchType || "Match"}
          </button>
          <button onClick={() => { setShowManual(false); setManualTeam1([]); setManualTeam2([]); }}
            className="px-4 py-3 rounded-xl text-sm font-medium text-muted bg-gray-100 hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    );
  }

  if (editingLocks) {
    const lockClassPlayers = event.players.filter(
      (p) => p.classId === classId || (p.classId === null && classId === event.classes[0]?.id),
    );
    return (
      <div className="space-y-4 pb-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Manual pair locks</h2>
          <button
            onClick={() => setEditingLocks(false)}
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm active:bg-action-dark"
          >
            Done
          </button>
        </div>
        <p className="text-xs text-muted">Lock two players together so the solver always keeps them on the same team.</p>
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <div className="flex justify-end">
            <LockAdder players={lockClassPlayers} existingLocks={locks} onAdd={handleAddLock} />
          </div>
          {locks.length === 0 ? (
            <p className="text-xs text-muted">No locked pairs yet.</p>
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
      </div>
    );
  }



  // ── Sub-page: Pairing Settings + Constraints + Pool Analysis ──
  if (subPage === "settings" || subPage === "pool") {
    const modeLabel = `${settings.base.charAt(0).toUpperCase() + settings.base.slice(1)}${settings.base !== "manual" ? ` · ${settings.teams === "fixed" ? "Fixed" : "Rotating"} · ${settings.gender === "mixed" ? "Mixed" : settings.gender === "same" ? "Same" : "Any"}` : ""}`;
    const constraintLabel = `Skill ±${settings.skillWindow === Infinity ? "∞" : settings.skillWindow} · Variety ±${settings.varietyWindow === Infinity ? "∞" : settings.varietyWindow}`;
    return (
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Pairing Settings</h2>
          <button onClick={async () => {
            if (settingsDirty) {
              const ok = await confirm({ title: "Unsaved changes", message: "You have unsaved changes. Discard them?", confirmText: "Discard", danger: true });
              if (!ok) return;
              cancelSettings();
            }
            setSubPage(null);
          }} className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm">Done</button>
        </div>
        <div className="text-xs text-foreground/70">{event.name}</div>

        {/* Mode & Teams — collapsible */}
        <div>
          <button onClick={() => toggleCollapsed("s-mode")}
            className="flex items-center justify-between w-full text-left py-1">
            <span className="flex items-center gap-1 text-sm font-bold">
              <span className={`transition-transform ${collapsed.has("s-mode") ? "" : "rotate-90"}`}>›</span>
              Mode & Teams
            </span>
            {collapsed.has("s-mode") && <span className="text-[10px] text-muted">{modeLabel}</span>}
          </button>
          {!collapsed.has("s-mode") && (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3 mt-1">
              <SegPicker label="Base mode" value={settings.base}
                onChange={(v) => setSettings((s) => ({ ...s, base: v as Base }))}
                options={[
                  { value: "random", label: "Random" }, { value: "swiss", label: "Swiss" },
                  { value: "king", label: "King" }, { value: "manual", label: "Manual" },
                ]}
              />
              {settings.base !== "manual" && settings.base !== "king" && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs text-muted">Teams</label>
                    <button type="button" onClick={() => setEditingLocks(true)}
                      className="flex items-center gap-1 text-[11px] text-action font-medium px-2 py-0.5 rounded hover:bg-action/10">
                      Pair locks {locks.length > 0 && `(${locks.length})`}
                    </button>
                  </div>
                  <div className="flex gap-1">
                    {([["rotating", "Rotating"], ["fixed", "Fixed"]] as const).map(([v, label]) => (
                      <button key={v} type="button" onClick={() => setSettings((s) => ({ ...s, teams: v as Teams }))}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${
                          settings.teams === v ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                        }`}>{label}</button>
                    ))}
                  </div>
                  {locks.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {locks.map((l) => (
                        <div key={l.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-50 text-[11px]">
                          <PlayerAvatar name={l.playerA.name} photoUrl={l.playerA.photoUrl} size="xs" />
                          <span className="font-medium">{l.playerA.name}</span>
                          <span className="text-muted">+</span>
                          <PlayerAvatar name={l.playerB.name} photoUrl={l.playerB.photoUrl} size="xs" />
                          <span className="font-medium flex-1">{l.playerB.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {settings.base !== "manual" && (
                <SegPicker label="Gender" value={settings.gender}
                  onChange={(v) => setSettings((s) => ({ ...s, gender: v as Gender }))}
                  options={[
                    { value: "random", label: "Any" }, { value: "mixed", label: "Mixed" }, { value: "same", label: "Same" },
                  ]}
                />
              )}
            </div>
          )}
        </div>

        {/* Constraints — collapsible */}
        {settings.base !== "manual" && (
          <div>
            <button onClick={() => toggleCollapsed("s-constraints")}
              className="flex items-center justify-between w-full text-left py-1">
              <span className="flex items-center gap-1 text-sm font-bold">
                <span className={`transition-transform ${collapsed.has("s-constraints") ? "" : "rotate-90"}`}>›</span>
                Constraints
              </span>
              {collapsed.has("s-constraints") && <span className="text-[10px] text-muted">{constraintLabel}</span>}
            </button>
            {!collapsed.has("s-constraints") && (
              <div className="bg-card rounded-xl border border-border p-4 space-y-3 mt-1">
                {settings.base !== "swiss" && (
                  <WindowPicker label="Skill window" help="How close in skill level must players be?"
                    value={settings.skillWindow} onChange={(v) => setSettings((s) => ({ ...s, skillWindow: v }))} />
                )}
                <WindowPicker label="Variety window" help="How many partner/opponent repeats allowed"
                  value={settings.varietyWindow} onChange={(v) => setSettings((s) => ({ ...s, varietyWindow: v }))} />
                <details className="group">
                  <summary className="text-[11px] text-muted cursor-pointer list-none flex items-center gap-1 select-none">
                    <span className="group-open:rotate-90 transition-transform">›</span>
                    Advanced fairness
                  </summary>
                  <div className="mt-3 space-y-3">
                    <WindowPicker label="Match count window" help="Max gap from average matches played (global fairness)"
                      value={settings.matchCountWindow} onChange={(v) => setSettings((s) => ({ ...s, matchCountWindow: v }))} />
                    <WindowPicker label="Max consecutive sit-outs" help="Max rounds a player may sit out in a row"
                      value={settings.maxWaitWindow} onChange={(v) => setSettings((s) => ({ ...s, maxWaitWindow: v }))} />
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* Pool Analysis — below constraints */}
        {analysis && (
          <div>
            <button onClick={() => toggleCollapsed("s-pool")}
              className="flex items-center gap-1 text-sm font-bold w-full text-left py-1">
              <span className={`transition-transform ${collapsed.has("s-pool") ? "" : "rotate-90"}`}>›</span>
              Pool Analysis
              {analyzing && <span className="text-[10px] text-muted font-normal ml-2">Updating...</span>}
            </button>
            {!collapsed.has("s-pool") && (() => {
              const skillDist = analysis.pool.skillDistribution as Record<number, number>;
              const levelsWithPlayers = [5, 4, 3, 2, 1].filter((l) => (skillDist[l] || 0) > 0);
              const active = analysis.pool.active;
              const max = analysis.feasibility.maxCleanRounds;
              const simulated = analysis.feasibility.simulatedRounds;
              return (
                <div className="bg-card rounded-xl border border-border p-4 space-y-3 mt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-xs"><div className="font-medium">{active} active</div>
                      <div className="text-muted">{analysis.pool.genderCounts.M}M · {analysis.pool.genderCounts.F}F{analysis.pool.paused > 0 && ` · ${analysis.pool.paused} paused`}</div></div>
                    <div className="text-xs"><div className="font-medium">Skill</div>
                      <div className="text-muted">{levelsWithPlayers.length === 0 ? "—" : levelsWithPlayers.map((l) => `${skillDist[l]}×L${l}`).join(" · ")}</div></div>
                    <div className="text-xs"><div className="font-medium">Capacity</div>
                      <div className="text-muted">{analysis.capacity.playersPerRound}/round{analysis.capacity.sitOutPerRound > 0 && ` · ${analysis.capacity.sitOutPerRound} sit out`}</div></div>
                    <div className="text-xs"><div className="font-medium">Clean rounds</div>
                      <div className="text-muted">{max >= simulated ? `${simulated}+` : max}</div></div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {settingsDirty && (
          <div className="flex gap-2">
            <button onClick={async () => { await saveSettings(); }}
              className="flex-1 bg-action text-white py-3 rounded-xl font-semibold text-base active:bg-action-dark">
              {saveStatus === "saving" ? "Saving..." : "Save"}
            </button>
            <button onClick={cancelSettings}
              className="px-6 py-3 rounded-xl text-sm font-medium text-muted bg-gray-100 hover:bg-gray-200">
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Sub-page: Edit Levels ──
  if (levelEditMode) {
    const lvlPlayers = event.players.filter(
      (p) => p.classId === classId || (p.classId === null && classId === event.classes[0]?.id),
    );
    const lvlMatchCounts = new Map<string, number>();
    for (const m of event.matches) for (const p of m.players) lvlMatchCounts.set(p.playerId, (lvlMatchCounts.get(p.playerId) || 0) + 1);
    const byLevel = new Map<string, typeof lvlPlayers>();
    for (const ep of lvlPlayers) {
      const eff = ep.skillLevel ?? ep.autoSkillLevel;
      const key = eff == null ? "unset" : String(eff);
      const list = byLevel.get(key) || [];
      list.push(ep);
      byLevel.set(key, list);
    }
    const rows: { key: string; label: string }[] = [
      { key: "5", label: "L5 — Expert" }, { key: "4", label: "L4" }, { key: "3", label: "L3" },
      { key: "2", label: "L2" }, { key: "1", label: "L1 — Beginner" }, { key: "unset", label: "Unset" },
    ];
    const picking = levelSelectedIds.size > 0;
    return (
      <div className="space-y-4 pb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Edit Levels</h2>
          <button onClick={() => { setLevelEditMode(false); setLevelSelectedIds(new Set()); }}
            className="bg-action text-white px-4 py-2 rounded-lg font-medium text-sm">Done</button>
        </div>
        <div className="text-xs text-foreground/70">{event.name}</div>
        {picking && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{levelSelectedIds.size} selected</span>
            <button onClick={() => setLevelSelectedIds(new Set())} className="text-xs text-action underline">Clear</button>
          </div>
        )}
        <div className="space-y-2">
          {rows.map((row) => {
            const players = (byLevel.get(row.key) || []).sort((a, b) => a.player.name.localeCompare(b.player.name));
            if (players.length === 0 && !picking) return null;
            return (
              <div key={row.key}
                onClick={picking ? () => {
                  const lvl = row.key === "unset" ? null : Number(row.key);
                  for (const pid of levelSelectedIds) setSkillLevel(pid, lvl);
                  setLevelSelectedIds(new Set());
                } : undefined}
                className={`bg-card rounded-xl border p-3 transition-colors ${
                  picking ? "border-action border-dashed cursor-pointer" : "border-border"
                }`}>
                <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                  <span className={`text-sm font-bold ${row.key === "unset" ? "text-muted" : ""}`}>{row.label}</span>
                  {picking ? (
                    <button onClick={(e) => { e.stopPropagation(); const lvl = row.key === "unset" ? null : Number(row.key); for (const pid of levelSelectedIds) setSkillLevel(pid, lvl); setLevelSelectedIds(new Set()); }}
                      className="bg-action text-white text-[11px] font-semibold px-3 py-1 rounded-full">
                      Move {levelSelectedIds.size} here
                    </button>
                  ) : (
                    <span className="text-[10px] text-muted">{players.length} player{players.length === 1 ? "" : "s"}</span>
                  )}
                </div>
                {players.length === 0 ? (
                  <p className="text-[10px] text-muted italic">drop here</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {players.map((ep) => {
                      const count = lvlMatchCounts.get(ep.playerId) || 0;
                      const isSelected = levelSelectedIds.has(ep.playerId);
                      return (
                        <div key={ep.id}
                          onClick={(e) => { e.stopPropagation(); setLevelSelectedIds((prev) => { const n = new Set(prev); if (n.has(ep.playerId)) n.delete(ep.playerId); else n.add(ep.playerId); return n; }); }}
                          className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 min-w-0 cursor-pointer transition-all ${
                            isSelected ? "bg-action text-white" : "bg-gray-50"
                          }`}>
                          <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                          <span className={`text-[11px] font-medium truncate flex-1 ${isSelected ? "font-bold" : ""}`}>{ep.player.name}</span>
                          <span className={`tabular-nums shrink-0 ${isSelected ? "text-white/80" : "text-muted"}`}>
                            <span className="text-xs font-medium">{count}</span><span className="text-[9px]"> m</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

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
    <div className="space-y-4 pb-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background -mx-4 px-4 py-2 shadow-sm space-y-1">
        <div>
          <Link href={`/events/${id}`} className="text-sm text-action font-medium">← Event Overview</Link>
          <div className="text-xs text-foreground/70 mt-0.5">{event.name}</div>
        </div>
        <h2 className="text-xl font-bold text-center">Pairing</h2>
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

      {/* Pairing Settings — managers only */}
      {canManage && (
        <button onClick={() => setSubPage("settings")}
          className="w-full text-action font-medium border border-action/30 px-3 py-2.5 rounded-lg text-center text-sm capitalize">
          <span>{settings.base} · {settings.teams === "fixed" ? "Fixed Teams" : "Rotating Teams"} · {settings.gender === "mixed" ? "Mixed Gender" : settings.gender === "same" ? "Same Gender" : "Any Gender"}</span>
          <span className="block text-xs mt-0.5">Skill window ±{settings.skillWindow === Infinity ? "∞" : settings.skillWindow} · Variety window ±{settings.varietyWindow === Infinity ? "∞" : settings.varietyWindow}</span>
        </button>
      )}



      {/* Players — collapsible section */}
      <div className="flex items-center justify-between">
        <button onClick={() => toggleCollapsed("players")}
          className="flex items-center gap-1 text-sm font-bold text-foreground py-1">
          <span className={`transition-transform ${collapsed.has("players") ? "" : "rotate-90"}`}>›</span>
          Players ({classPlayers.length})
        </button>
        {!collapsed.has("players") && (
          <div className="flex items-center gap-1.5">
            {event.players.some((ep) => ep.status === "registered") && !levelEditMode && (
              <button onClick={() => checkInAll(classPlayers)}
                className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg">
                <span className="w-2.5 h-2.5 bg-green-500 text-white rounded-full inline-flex items-center justify-center text-[6px] font-bold mr-0.5">✓</span>
                Check in all
              </button>
            )}
            <button
              onClick={() => { setLevelEditMode((p) => !p); setLevelSelectedIds(new Set()); }}
              className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg"
            >
              {levelEditMode ? "Done" : "Edit levels"}
            </button>
            <button
              onClick={() => setExpandedSection("players")}
              className="text-[10px] text-action font-medium border border-action/30 px-2 py-1 rounded-lg"
              title="Expand players view"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 8V4h4M17 8V4h-4M3 12v4h4M17 12v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {!collapsed.has("players") && (
      <div className="bg-card rounded-xl border border-border px-4 pt-3 pb-4 space-y-2">
        {classPlayers.length === 0 ? (
          <p className="text-xs text-muted">No players registered in this class yet.</p>
        ) : (
          <>
            {(() => {
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
                .filter((row) => levelEditMode || (byLevel.get(row.key) || []).length > 0)
                .map((row) => {
                  const players = byLevel.get(row.key) || [];
                  return (
                    <div key={row.key} className={`bg-card rounded-xl border p-3 transition-colors ${
                      levelEditMode && levelSelectedIds.size > 0 ? "border-action border-dashed" : "border-border"
                    }`}>
                      <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                        <span className={`text-sm font-bold ${row.key === "unset" ? "text-muted" : ""}`}>
                          {row.label}
                        </span>
                        {levelEditMode && levelSelectedIds.size > 0 ? (
                          <button
                            onClick={() => {
                              const lvl = row.key === "unset" ? null : Number(row.key);
                              for (const pid of levelSelectedIds) setSkillLevel(pid, lvl);
                              setLevelSelectedIds(new Set());
                            }}
                            className="bg-action text-white text-[11px] font-semibold px-3 py-1 rounded-full active:bg-action-dark"
                          >
                            Move {levelSelectedIds.size} here
                          </button>
                        ) : (
                          <span className="text-[10px] text-muted">{players.length} player{players.length === 1 ? "" : "s"}</span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {players
                          .sort((a, b) => a.player.name.localeCompare(b.player.name))
                          .map((ep) => {
                            const count = playerMatchCounts.get(ep.playerId) || 0;
                            const isPaused = ep.status === "paused";
                            const isRegistered = ep.status === "registered";
                            const isCheckedIn = ep.status === "checked_in";
                            const isSelected = levelSelectedIds.has(ep.playerId);
                            return (
                              <div
                                key={ep.id}
                                className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 min-w-0 transition-all ${
                                  isSelected ? "bg-action text-white"
                                  : isPaused ? "bg-amber-100 opacity-60"
                                  : isRegistered ? "bg-gray-50"
                                  : "bg-gray-50"
                                }`}
                                onClick={() => {
                                  if (levelEditMode) {
                                    setLevelSelectedIds((prev) => {
                                      const n = new Set(prev);
                                      if (n.has(ep.playerId)) n.delete(ep.playerId);
                                      else n.add(ep.playerId);
                                      return n;
                                    });
                                  } else {
                                    setPlayerActionId(ep.playerId);
                                  }
                                }}
                              >
                                <span className="flex items-center gap-1.5 min-w-0 flex-1">
                                  <span className={`relative shrink-0 ${isRegistered ? "opacity-40" : ""}`}>
                                    <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                                    {(isCheckedIn || isPaused) && (
                                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full flex items-center justify-center text-[7px] font-bold ${
                                        isPaused ? "bg-green-300 text-white" : "bg-green-500 text-white"
                                      }`}>✓</span>
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className={`text-xs font-medium truncate block ${
                                      isSelected ? "font-bold"
                                      : isPaused ? "line-through text-muted"
                                      : isRegistered ? "text-muted"
                                      : ""
                                    }`}>{ep.player.name} <span className={`font-normal ${isSelected ? "text-white/70" : "text-muted"}`}>({count})</span></span>
                                  </span>
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
      )}



      {/* Actions + Sitting out — collapsible, managers only */}
      {canManage && (<>
      <button onClick={() => toggleCollapsed("actions")}
        className="flex items-center gap-1 text-sm font-bold text-foreground w-full text-left py-1">
        <span className={`transition-transform ${collapsed.has("actions") ? "" : "rotate-90"}`}>›</span>
        Generate Matches
      </button>
      {!collapsed.has("actions") && (<>
      {/* Actions row */}
      <div className="bg-card rounded-xl border border-border p-2.5 space-y-2">
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-0 shrink-0">
            <button onClick={() => setNumRounds(Math.max(1, numRounds - 1))} className="w-7 h-7 rounded-l-lg bg-gray-200 text-foreground font-bold text-sm flex items-center justify-center">−</button>
            <div className="w-7 h-7 bg-selected text-white font-bold text-sm flex items-center justify-center">{numRounds}</div>
            <button onClick={() => setNumRounds(Math.min(20, numRounds + 1))} className="w-7 h-7 rounded-r-lg bg-gray-200 text-foreground font-bold text-sm flex items-center justify-center">+</button>
          </div>
          <button
            onClick={handleGenerateRound}
            disabled={generating || !classId}
            className="flex-1 bg-action text-white px-3 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {generating ? "..." : numRounds === 1 ? "Next Round" : `Next ${numRounds} Rounds`}
          </button>
        </div>
        <div className="flex justify-center">
          <button
            onClick={() => { setManualTeam1([]); setManualTeam2([]); setManualCourt(1); setShowManual(true); }}
            className="text-xs text-primary font-medium px-4 py-1.5 rounded-lg border border-primary/30 hover:bg-primary/5"
          >
            + Manual Match
          </button>
        </div>
      </div>
      </>)}
      </>)}

      <h2 id="matches-header" className="text-xl font-bold text-center">Matches</h2>
      {/* Matches — current, future, past */}
      {(() => {
        const allMatches = event.matches;
        if (allMatches.length === 0) return null;
        const active = allMatches.filter((m) => m.status === "active").sort((a, b) => a.courtNum - b.courtNum);
        const paused = allMatches.filter((m) => m.status === "paused").sort((a, b) => a.courtNum - b.courtNum);
        const pending = allMatches.filter((m) => m.status === "pending").sort((a, b) => a.round - b.round || a.courtNum - b.courtNum);
        const completed = allMatches.filter((m) => m.status === "completed").sort((a, b) => b.round - a.round || a.courtNum - b.courtNum);

        const playerMap = new Map(classPlayers.map((ep) => [ep.playerId, ep.player]));
        const matchCounts = new Map<string, number>();
        for (const m of allMatches) {
          for (const p of m.players) matchCounts.set(p.playerId, (matchCounts.get(p.playerId) || 0) + 1);
        }

        const renderMatchCard = (m: EventMatchDTO) => {
          const t1 = m.players.filter((p) => p.team === 1);
          const t2 = m.players.filter((p) => p.team === 2);
          const isActive = m.status === "active";
          const isPending = m.status === "pending";
          const isCompleted = m.status === "completed";
          const t1Score = isCompleted ? (t1[0]?.score ?? 0) : null;
          const t2Score = isCompleted ? (t2[0]?.score ?? 0) : null;
          const t1Won = t1Score !== null && t2Score !== null && t1Score > t2Score;
          const t2Won = t1Score !== null && t2Score !== null && t2Score > t1Score;
          const courtColor = isActive ? "bg-orange-500 text-white" : isPending ? "bg-green-500 text-white" : "bg-gray-300 text-white";

          const renderTeamRow = (players: typeof t1, team: "team1" | "team2", won: boolean, scoreVal: number | null) => (
            <div className={`flex items-center gap-1 p-1.5 rounded-lg ${won ? "bg-green-50" : ""}`}>
              <div className="flex-1 min-w-0 space-y-0.5">
                {players.map((mp) => {
                  const pl = playerMap.get(mp.playerId);
                  const isMe = mp.playerId === userId;
                  return (
                    <div key={mp.playerId} className="flex items-center gap-1.5">
                      <PlayerAvatar name={pl?.name || "?"} photoUrl={pl?.photoUrl} size="xs" />
                      <span className={`text-base truncate ${isMe ? "font-bold" : "font-medium"} ${won ? "text-green-700" : ""}`}>
                        {pl?.name || "?"} <span className="text-sm text-muted font-normal">({matchCounts.get(mp.playerId) || 0})</span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="shrink-0 ml-1">
                {isCompleted ? (
                  <span className={`text-2xl font-bold min-w-[2.5rem] text-center block ${won ? "text-green-600" : "text-gray-400"}`}>{scoreVal}</span>
                ) : isActive ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <ScorePicker
                      value={scores[m.id]?.[team] ?? ""}
                      targetScore={11}
                      winBy={2}
                      otherTeamScore={scores[m.id]?.[team === "team1" ? "team2" : "team1"] ?? ""}
                      onChange={(v) => setScores((prev) => ({
                        ...prev,
                        [m.id]: { ...prev[m.id], [team]: v },
                      }))}
                      onClearBoth={() => setScores((prev) => { const n = { ...prev }; delete n[m.id]; return n; })}
                    />
                  </div>
                ) : (
                  <span className="text-2xl font-bold min-w-[2.5rem] text-center block text-gray-400">-</span>
                )}
              </div>
            </div>
          );

          const hasScore = scores[m.id]?.team1 && scores[m.id]?.team2;

          return (
            <div key={m.id} id={`match-${m.id}`} className={`bg-card rounded-xl border overflow-hidden transition-all ${
              newMatchId === m.id ? "border-action border-2 shadow-lg shadow-action/20 animate-pulse"
              : isActive ? "border-orange-400 shadow-md shadow-orange-100"
              : isPending ? "border-green-400 shadow-md shadow-green-100"
              : "border-border"
            }`}>
              <div className="flex items-center gap-2 px-2 py-2" onClick={() => setActionMatchId(m.id)}>
                <div className="flex flex-col items-center shrink-0 min-w-[2.5rem]">
                  {m.startedAt && <span className="text-[8px] text-muted">{new Date(m.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>}
                  {isPending ? (
                    <button onClick={(e) => { e.stopPropagation(); startMatch(m.id); }}
                      className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center shadow-sm active:bg-green-700 relative"
                      title="Start match"
                    >
                      <span className="text-lg font-bold">▶</span>
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-gray-600 text-white text-[9px] font-bold flex items-center justify-center">{m.courtNum}</span>
                    </button>
                  ) : (
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${courtColor}`}>{m.courtNum}</div>
                  )}
                  {m.completedAt ? (
                    <span className="text-[8px] text-muted">{new Date(m.completedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
                  ) : (
                    <span className="text-[8px] text-muted">
                      {isActive ? "In Play" : isPending ? "Ready" : m.round === 0 ? "Individual" : `R${m.round}`}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  {renderTeamRow(t1, "team1", t1Won, t1Score)}
                  {renderTeamRow(t2, "team2", t2Won, t2Score)}
                </div>
              </div>
              {isActive && hasScore && (
                <button onClick={() => submitScore(m.id)}
                  className="w-full bg-action text-white py-2 text-sm font-semibold active:bg-action-dark"
                >
                  Submit Score
                </button>
              )}
            </div>
          );
        };

        const playingIds = new Set<string>();
        for (const m of active) for (const p of m.players) playingIds.add(p.playerId);
        for (const m of paused) for (const p of m.players) playingIds.add(p.playerId);
        for (const m of pending) for (const p of m.players) playingIds.add(p.playerId);
        const sittingOutPlayers = classPlayers.filter((ep) => !playingIds.has(ep.playerId) && ep.status !== "paused" && ep.status !== "registered");
        const notCheckedInPlayers = classPlayers.filter((ep) => ep.status === "registered");
        const pausedPlayers = classPlayers.filter((ep) => ep.status === "paused");

        return (
          <div className="space-y-4">
            {/* Sitting out + Paused — yellow band */}
            {(sittingOutPlayers.length > 0 || pausedPlayers.length > 0 || notCheckedInPlayers.length > 0) && (
              <div className="bg-amber-50 -mx-4 px-4 py-3 border-y border-amber-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                    Sitting out ({sittingOutPlayers.length})
                  </span>
                  <button onClick={() => setExpandedSection("status")} className="text-muted hover:text-foreground p-1" title="Expand">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" /></svg>
                  </button>
                </div>
                {sittingOutPlayers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {sittingOutPlayers.map((ep) => (
                      <button key={ep.playerId} onClick={() => setPlayerActionId(ep.playerId)}
                        className="flex items-center gap-1 bg-white/70 rounded-full px-2 py-1">
                        <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                        <span className="text-[11px] font-medium">{ep.player.name} <span className="text-xs text-muted font-normal">({matchCounts.get(ep.playerId) || 0})</span></span>
                      </button>
                    ))}
                  </div>
                )}
                {pausedPlayers.length > 0 && (
                  <div>
                    <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Paused ({pausedPlayers.length})</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {pausedPlayers.map((ep) => (
                        <button key={ep.playerId} onClick={() => setPlayerActionId(ep.playerId)}
                          className="flex items-center gap-1 bg-amber-100/80 rounded-full px-2 py-1 opacity-70">
                          <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                          <span className="text-[11px] font-medium line-through">{ep.player.name} <span className="text-xs text-muted font-normal no-underline">({matchCounts.get(ep.playerId) || 0})</span></span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {notCheckedInPlayers.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Not checked in ({notCheckedInPlayers.length})</span>
                      <button onClick={() => checkInAll(classPlayers)}
                        className="text-[10px] text-action font-medium">Check in all</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {notCheckedInPlayers.map((ep) => (
                        <button key={ep.playerId} onClick={() => setPlayerActionId(ep.playerId)}
                          className="flex items-center gap-1 bg-white/50 rounded-full px-2 py-1 opacity-50">
                          <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" />
                          <span className="text-[11px] font-medium">{ep.player.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(creatingMatch || generating) && (
              <div id="creating-spinner" className="flex items-center justify-center gap-2 py-4">
                <div className="w-5 h-5 border-2 border-action border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted">{creatingMatch ? "Creating match..." : "Generating..."}</span>
              </div>
            )}
            {pending.length > 0 && (
              <div className="bg-green-50 -mx-4 px-4 py-3 border-y border-green-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-green-700 uppercase tracking-wider">Upcoming</span>
                  <button onClick={deleteAllPending} className="text-[10px] text-danger font-medium">Delete all</button>
                </div>
                <div className="space-y-2 mt-2">{pending.map(renderMatchCard)}</div>
              </div>
            )}
            {active.length > 0 && (
              <div className="bg-orange-50 -mx-4 px-4 py-3 border-y border-orange-200">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-xs font-bold text-orange-700 uppercase tracking-wider">In Play</span>
                </div>
                <div className="space-y-2">{active.map(renderMatchCard)}</div>
              </div>
            )}
            {paused.length > 0 && (
              <div className="bg-amber-50 -mx-4 px-4 py-3 border-y border-amber-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Paused</span>
                </div>
                <div className="space-y-2">{paused.map(renderMatchCard)}</div>
              </div>
            )}
            {completed.length > 0 && (
              <div className="space-y-2 mt-2">
                <button
                  onClick={() => toggleCollapsed("past")}
                  className="flex items-center gap-1 text-xs font-bold text-muted uppercase tracking-wider"
                >
                  <span className={`transition-transform ${collapsed.has("past") ? "" : "rotate-90"}`}>›</span>
                  Completed ({completed.length})
                </button>
                {!collapsed.has("past") && (
                  <div className="space-y-2">{completed.slice(0, 20).map(renderMatchCard)}</div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Action sheet — same options as event page */}
      {actionMatchId && event && (() => {
        const m = event.matches.find((x) => x.id === actionMatchId);
        if (!m) return null;
        const t1 = m.players.filter((p) => p.team === 1);
        const t2 = m.players.filter((p) => p.team === 2);
        const playerMap2 = new Map(classPlayers.map((ep) => [ep.playerId, ep.player]));
        const t1Names = t1.map((p) => playerMap2.get(p.playerId)?.name || "?").join(" & ");
        const t2Names = t2.map((p) => playerMap2.get(p.playerId)?.name || "?").join(" & ");
        const isCompleted = m.status === "completed";
        const isActive = m.status === "active";
        const isMatchPlayer = m.players.some((p) => p.playerId === userId);
        const canScore = canManage || isMatchPlayer;
        const close = () => setActionMatchId(null);
        return (
          <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center" onClick={close}>
            <div className="bg-white rounded-t-2xl w-full max-w-[600px] shadow-2xl mb-0 mx-auto" onClick={(e) => e.stopPropagation()}>
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
              <div className="text-center px-4 pb-3 border-b border-border">
                <span className="text-sm font-semibold">Court {m.courtNum}</span>
                <span className="text-xs text-muted ml-2">{t1Names} vs {t2Names}</span>
              </div>
              <div className="flex p-3 gap-3">
                {/* Left: Edit + Delete — managers only */}
                {canManage && (
                  <div className="flex flex-col gap-1.5 w-24">
                    {!isCompleted && (
                      <button onClick={() => { close(); setShowManual(true); setManualCourt(m.courtNum); }}
                        className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex flex-col items-center gap-1">✏️ <span>Edit</span></button>
                    )}
                    <button onClick={() => { close(); deleteMatch(m.id); }}
                      className="flex-1 py-2.5 rounded-xl text-xs font-medium border border-red-200 bg-white text-danger hover:bg-red-50 active:bg-red-100 shadow-sm flex flex-col items-center gap-1">🗑️ <span>Delete</span></button>
                  </div>
                )}
                {/* Right: Actions */}
                <div className="flex-1 flex flex-col gap-1.5">
                  {m.status === "pending" && canScore && (
                    <button onClick={() => { startMatch(m.id); close(); }}
                      className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">▶ Start match</button>
                  )}
                  {isActive && canScore && (
                    <button onClick={() => { pauseMatch(m.id); close(); }}
                      className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">⏸️ Pause</button>
                  )}
                  {m.status === "paused" && canScore && (
                    <button onClick={() => { startMatch(m.id); close(); }}
                      className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">▶ Resume</button>
                  )}
                  {!isCompleted && (
                    <button onClick={() => { close(); window.open(`/events/${id}`, "_self"); }}
                      className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">📺 Focus view</button>
                  )}
                  {canScore && (
                    <button onClick={() => { close(); }}
                      className="py-2.5 rounded-xl text-xs font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">🔊 Announce</button>
                  )}
                </div>
              </div>
              <div className="px-4 pb-4 pt-2">
                <button onClick={close} className="w-full py-3 rounded-xl bg-gray-100 text-sm font-medium">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Player action sheet */}
      {playerActionId && event && (() => {
        const ep = event.players.find((p) => p.playerId === playerActionId);
        if (!ep) return null;
        const count = playerMatchCounts.get(ep.playerId) || 0;
        const close = () => setPlayerActionId(null);
        return (
          <div className="fixed inset-0 z-[90] bg-black/50 flex items-end justify-center" onClick={close}>
            <div className="bg-white rounded-t-2xl w-full max-w-[600px] shadow-2xl mb-0 mx-auto" onClick={(e) => e.stopPropagation()}>
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-2" />
              <div className="flex items-center gap-3 px-4 pb-3 border-b border-border">
                <span className="relative shrink-0">
                  <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="sm" />
                  {(ep.status === "checked_in" || ep.status === "paused") && (
                    <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                      ep.status === "paused" ? "bg-green-300 text-white" : "bg-green-500 text-white"
                    }`}>✓</span>
                  )}
                </span>
                <div>
                  <div className="text-sm font-semibold">{ep.player.name}</div>
                  <div className="text-xs text-muted">{count} match{count !== 1 ? "es" : ""} · {ep.status === "checked_in" ? "Checked in" : ep.status === "paused" ? "Paused" : "Registered"}</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 p-4">
                {ep.status === "registered" && (
                  <button onClick={() => { checkInPlayer(ep.playerId); close(); }}
                    className="py-3 rounded-xl text-sm font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">
                    <span className="w-5 h-5 bg-green-500 text-white rounded-full inline-flex items-center justify-center text-[10px] font-bold">✓</span>
                    Check in
                  </button>
                )}
                {ep.status === "checked_in" && (
                  <>
                    <button onClick={() => { checkInPlayer(ep.playerId); close(); }}
                      className="py-3 rounded-xl text-sm font-medium border border-red-200 bg-white text-danger hover:bg-red-50 active:bg-red-100 shadow-sm flex items-center justify-center gap-2">
                      <span className="text-base">✕</span>
                      Check out
                    </button>
                    <button onClick={() => { togglePausePlayer(ep.playerId); close(); }}
                      className="py-3 rounded-xl text-sm font-medium border border-amber-200 bg-white text-amber-700 hover:bg-amber-50 active:bg-amber-100 shadow-sm flex items-center justify-center gap-2">
                      <span className="text-base">⏸</span>
                      Pause
                    </button>
                  </>
                )}
                {ep.status === "paused" && (
                  <button onClick={() => { togglePausePlayer(ep.playerId); close(); }}
                    className="py-3 rounded-xl text-sm font-medium border border-border bg-white hover:bg-gray-50 active:bg-gray-100 shadow-sm flex items-center justify-center gap-2">
                    <span className="text-base">▶</span>
                    Unpause
                  </button>
                )}
              </div>
              <div className="px-4 pb-4">
                <button onClick={close} className="w-full py-3 rounded-xl bg-gray-100 text-sm font-medium">Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Expanded players overlay */}
      {expandedSection === "players" && (() => {
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
        return (
          <div className="fixed inset-0 bg-white z-50 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h2 className="text-lg font-bold">Players ({classPlayers.length})</h2>
              <button onClick={() => setExpandedSection(null)} className="text-action border border-action/30 p-1.5 rounded-lg" title="Close">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {rows
                .filter((row) => (byLevel.get(row.key) || []).length > 0)
                .map((row) => {
                  const players = (byLevel.get(row.key) || []).sort((a, b) => a.player.name.localeCompare(b.player.name));
                  return (
                    <div key={row.key}>
                      <div className="text-sm font-bold mb-2 pb-1 border-b border-border">
                        {row.label}
                        <span className="text-muted font-normal ml-2">({players.length})</span>
                      </div>
                      <div className="space-y-1">
                        {players.map((ep) => {
                          const count = playerMatchCounts.get(ep.playerId) || 0;
                          const isPaused = ep.status === "paused";
                          const isRegistered = ep.status === "registered";
                          const isCheckedIn = ep.status === "checked_in";
                          return (
                            <button
                              key={ep.id}
                              onClick={() => setPlayerActionId(ep.playerId)}
                              className={`flex items-center gap-3 w-full text-left rounded-xl px-3 py-2.5 transition-all active:bg-gray-100 ${
                                isPaused ? "bg-amber-50 opacity-70"
                                : isRegistered ? "bg-gray-50 opacity-60"
                                : "bg-gray-50"
                              }`}
                            >
                              <span className={`relative shrink-0 ${isRegistered ? "opacity-50" : ""}`}>
                                <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="md" />
                                {(isCheckedIn || isPaused) && (
                                  <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                                    isPaused ? "bg-green-300 text-white" : "bg-green-500 text-white"
                                  }`}>✓</span>
                                )}
                              </span>
                              <span className="flex-1 min-w-0">
                                <span className={`text-lg font-bold truncate block ${
                                  isPaused ? "line-through text-muted"
                                  : isRegistered ? "text-muted"
                                  : "text-foreground"
                                }`}>{ep.player.name}</span>
                              </span>
                              <span className="text-lg text-muted tabular-nums shrink-0">{count} <span className="text-sm">matches</span></span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })()}

      {/* Expanded status overlay */}
      {expandedSection === "status" && (() => {
        const allMatches2 = event.matches;
        const mc = new Map<string, number>();
        for (const m of allMatches2) for (const p of m.players) mc.set(p.playerId, (mc.get(p.playerId) || 0) + 1);
        const playingIds2 = new Set<string>();
        for (const m of allMatches2.filter((m) => m.status === "active" || m.status === "paused" || m.status === "pending")) {
          for (const p of m.players) playingIds2.add(p.playerId);
        }
        const sitting = classPlayers.filter((ep) => !playingIds2.has(ep.playerId) && ep.status === "checked_in");
        const paused2 = classPlayers.filter((ep) => ep.status === "paused");
        const notIn = classPlayers.filter((ep) => ep.status === "registered");
        const renderRow = (ep: typeof classPlayers[number], dimmed = false, strike = false) => (
          <button key={ep.playerId} onClick={() => setPlayerActionId(ep.playerId)}
            className={`flex items-center gap-3 py-2.5 px-3 rounded-lg active:bg-gray-100 w-full text-left ${dimmed ? "opacity-50" : ""}`}>
            <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="md" />
            <span className={`text-lg font-bold flex-1 ${strike ? "line-through text-muted" : ""}`}>{ep.player.name}</span>
            <span className="text-lg text-muted tabular-nums">{mc.get(ep.playerId) || 0} <span className="text-sm">matches</span></span>
          </button>
        );
        return (
          <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
            <div className="max-w-[600px] mx-auto px-4 py-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Player Status</h2>
                <button onClick={() => setExpandedSection(null)} className="text-action border border-action/30 p-1.5 rounded-lg" title="Close">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 3v4H3M13 3v4h4M7 17v-4H3M13 17v-4h4" />
                  </svg>
                </button>
              </div>
              {sitting.length > 0 && (
                <div>
                  <span className="text-sm font-bold text-amber-800 uppercase tracking-wider">Sitting out ({sitting.length})</span>
                  <div className="mt-1">{sitting.map((ep) => renderRow(ep))}</div>
                </div>
              )}
              {paused2.length > 0 && (
                <div className="bg-amber-50 -mx-4 px-4 py-3 rounded-lg">
                  <span className="text-sm font-bold text-amber-600 uppercase tracking-wider">Paused ({paused2.length})</span>
                  <div className="mt-1">{paused2.map((ep) => renderRow(ep, false, true))}</div>
                </div>
              )}
              {notIn.length > 0 && (
                <div>
                  <span className="text-sm font-bold text-gray-400 uppercase tracking-wider">Not checked in ({notIn.length})</span>
                  <div className="mt-1">{notIn.map((ep) => renderRow(ep, true))}</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
              value === opt.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"
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
              value === opt.value ? "bg-selected text-white" : "bg-gray-100 text-foreground"
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
