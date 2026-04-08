"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { useViewRole, hasRole } from "@/components/RoleToggle";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { PlayerSelector } from "@/components/PlayerSelector";
import { CompetitionView } from "@/components/CompetitionView";
import { SpeakerMode, sendAnnouncement, formatMatchAnnouncement } from "@/components/SpeakerMode";
import { ClassesManager } from "@/components/ClassesManager";
import { ClassStepFlow } from "@/components/class-steps/ClassStepFlow";
import { SessionsManager } from "@/components/SessionsManager";
import { CompetitionResults } from "@/components/CompetitionResults";
import { RallyTracker } from "@/components/RallyTracker";

interface Player {
  id: string;
  name: string;
  emoji: string;
  photoUrl?: string | null;
  rating: number;
  globalRating?: number | null;
  globalRatingConfidence?: number;
  duprRating?: number | null;
  role?: string;
  gender?: string | null;
  phone?: string | null;
}

interface MatchPlayer {
  id: string;
  playerId: string;
  team: number;
  score: number;
  player: Player;
}

interface Match {
  id: string;
  courtNum: number;
  round: number;
  status: string;
  players: MatchPlayer[];
  scoreConfirmed?: boolean;
  rankingMode?: string;
  matchFormat?: string | null;
  classId?: string | null;
}

interface EventHelper {
  playerId: string;
  player: Player;
}

interface PairPlayer {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  gender?: string | null;
}

interface EventPair {
  id: string;
  player1: PairPlayer;
  player2: PairPlayer;
}

interface ClubLocation {
  id: string;
  name: string;
  googleMapsUrl?: string | null;
}

interface EventClassData {
  id: string;
  name: string;
  isDefault: boolean;
  format: string;
  gender: string;
  ageGroup: string;
  scoringFormat: string;
  winBy?: string;
  pairingMode: string;
  playMode?: string;
  prioSpeed?: boolean;
  prioFairness?: boolean;
  prioSkill?: boolean;
  rankingMode: string;
  minPlayers?: number | null;
  maxPlayers?: number | null;
  competitionMode?: string | null;
  competitionConfig?: Record<string, unknown> | null;
  competitionPhase?: string | null;
}

interface Event {
  id: string;
  name: string;
  date: string;
  endDate: string | null;
  status: string;
  numCourts: number;
  openSignup: boolean;
  visibility: string;
  createdById: string | null;
  createdBy?: { id: string; name: string; emoji: string } | null;
  players: { player: Player; classId?: string | null; status: string; skillLevel?: number | null }[];
  matches: Match[];
  helpers: EventHelper[];
  pairs: EventPair[];
  classes: EventClassData[];
  club?: { id: string; name: string; emoji: string; locations: ClubLocation[] } | null;
  // Legacy compat — derived from default class
  format: string;
  scoringFormat: string;
  pairingMode: string;
  rankingMode?: string;
  competitionMode?: string | null;
  competitionConfig?: Record<string, unknown> | null;
  competitionPhase?: string | null;
}

function toDateInput(iso: string) {
  return new Date(iso).toISOString().split("T")[0];
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function speakMatch(match: Match, event: Event) {
  if (!("speechSynthesis" in window)) return;
  const team1 = match.players.filter((p) => p.team === 1);
  const team2 = match.players.filter((p) => p.team === 2);
  const team1Names = team1.map((p) => p.player.name).join(" and ");
  const team2Names = team2.map((p) => p.player.name).join(" and ");
  const courtLabel = event.pairingMode === "king_of_court" && match.courtNum === 1
    ? "King Court"
    : `Court ${match.courtNum}`;
  const text = `${courtLabel}: ${team1Names} versus ${team2Names}`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function speakRound(matches: Match[], event: Event) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const parts: string[] = [];
  for (const match of matches.sort((a, b) => a.courtNum - b.courtNum)) {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const team1Names = team1.map((p) => p.player.name).join(" and ");
    const team2Names = team2.map((p) => p.player.name).join(" and ");
    const courtLabel = event.pairingMode === "king_of_court" && match.courtNum === 1
      ? "King Court"
      : `Court ${match.courtNum}`;
    parts.push(`${courtLabel}: ${team1Names} versus ${team2Names}`);
  }
  const utterance = new SpeechSynthesisUtterance(parts.join(". "));
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

function SwipeablePlayerRow({
  ep,
  canManage,
  hasMatches,
  showContact,
  onPause,
  onRemove,
  skillLevel,
  onSkillLevel,
}: {
  ep: { player: Player; status: string; skillLevel?: number | null };
  canManage: boolean;
  hasMatches: boolean;
  showContact: boolean;
  onPause: () => void;
  onRemove: () => void;
  skillLevel?: number | null;
  onSkillLevel?: (level: number | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swipeOffset = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const [localPaused, setLocalPaused] = useState(ep.status === "paused");

  // Sync with prop when it changes (after API response)
  useEffect(() => {
    setLocalPaused(ep.status === "paused");
  }, [ep.status]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canManage) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeOffset.current = 0;
    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      // Instantly toggle visual state
      setLocalPaused((prev) => !prev);
      if (navigator.vibrate) navigator.vibrate(50);
      // Then fire the API call
      onPause();
    }, 600);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canManage) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // If scrolling vertically, cancel gestures
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      return;
    }
    // Cancel long-press if finger moves
    if (Math.abs(dx) > 10) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    }
    if (dx < 0 && !hasMatches) {
      swipeOffset.current = dx;
      if (rowRef.current) {
        rowRef.current.style.transform = `translateX(${Math.max(dx, -100)}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (isLongPress.current) return;
    if (swipeOffset.current < -80 && !hasMatches && canManage) {
      if (confirm(`Remove ${ep.player.name} from this event?`)) {
        onRemove();
      }
    }
    if (rowRef.current) {
      rowRef.current.style.transform = "";
    }
    swipeOffset.current = 0;
  };

  return (
    <div
      ref={rowRef}
      className={`group flex items-center gap-2 rounded-lg px-3 py-1 transition-all select-none ${
        localPaused ? "opacity-40 bg-gray-100" : ""
      }`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="sm" />
      <span className={`text-lg font-medium flex-1 ${localPaused ? "line-through text-muted" : ""}`}>
        {ep.player.name}
      </span>
      {ep.player.role === "admin" && (
        <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
          Admin
        </span>
      )}
      {ep.player.phone && showContact && (
        <a
          href={`https://wa.me/${ep.player.phone.replace(/[^0-9+]/g, "").replace(/^\+/, "")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-green-500 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          💬
        </a>
      )}
      {ep.status === "checked_in" && (
        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
          In
        </span>
      )}
      {ep.status === "waitlisted" && (
        <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
          Waitlist
        </span>
      )}
      {localPaused && (
        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
          Paused
        </span>
      )}
      {/* Skill level */}
      {canManage && onSkillLevel && (
        <div className="flex gap-0.5">
          {[1, 2, 3].map((lvl) => (
            <button key={lvl} onClick={(e) => { e.stopPropagation(); onSkillLevel(skillLevel === lvl ? null : lvl); }}
              className={`w-5 h-5 rounded text-[9px] font-bold ${skillLevel === lvl ? "bg-selected text-white" : "bg-gray-100 text-muted"}`}>{lvl}</button>
          ))}
        </div>
      )}
      {!canManage && skillLevel && (
        <span className="text-[9px] text-muted bg-gray-100 px-1.5 py-0.5 rounded">Lvl {skillLevel}</span>
      )}
      {/* Desktop hover actions (hidden on touch) */}
      {canManage && (
        <div className="hidden group-hover:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onPause(); setLocalPaused((p) => !p); }}
            className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100" title={localPaused ? "Unpause" : "Pause"}>
            {localPaused ? "Unpause" : "Pause"}
          </button>
          {!hasMatches && (
            <button onClick={(e) => { e.stopPropagation(); if (confirm(`Remove ${ep.player.name} from this event?`)) onRemove(); }}
              className="text-xs px-2 py-1 rounded bg-red-50 text-danger hover:bg-red-100" title="Remove">
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const { viewRole } = useViewRole();
  const isAdmin = session?.user?.role === "admin" && hasRole(viewRole, "admin");
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const swrEvent = useSWR(id ? `/api/events/${id}` : null, (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); }), { revalidateOnFocus: true, dedupingInterval: 2000 });
  const [generating, setGenerating] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [editingEvent, setEditingEvent] = useState(false);
  const [hasEdits, setHasEdits] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("draft");
  const [editCourts, setEditCourts] = useState(2);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [bulkGenderFilter, setBulkGenderFilter] = useState<string | null>(null);
  const [bulkSearch, setBulkSearch] = useState("");
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addPlayerGender, setAddPlayerGender] = useState<string | null>(null);
  const [editFormat, setEditFormat] = useState("doubles");
  const [editScoringFormat, setEditScoringFormat] = useState("1x11");
  const [editWinBy, setEditWinBy] = useState("2");
  const [editPairingMode, setEditPairingMode] = useState("random");
  const [editPlayMode, setEditPlayMode] = useState("round_based");
  const [editPrioSpeed, setEditPrioSpeed] = useState(true);
  const [editPrioFairness, setEditPrioFairness] = useState(true);
  const [editPrioSkill, setEditPrioSkill] = useState(true);
  const [editRankingMode, setEditRankingMode] = useState("ranked");
  const [editSkillSource, setEditSkillSource] = useState<"rating" | "manual">("rating");
  const [resetting, setResetting] = useState(false);
  const [matchTab, setMatchTab] = useState<"current" | "previous" | "future">("current");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [editOpenSignup, setEditOpenSignup] = useState(true);
  const [editVisibility, setEditVisibility] = useState("visible");
  const [showAddMatch, setShowAddMatch] = useState(false);
  const [manualTeam1, setManualTeam1] = useState<string[]>([]);
  const [manualTeam2, setManualTeam2] = useState<string[]>([]);
  const [manualCourt, setManualCourt] = useState(1);
  const [numRounds, setNumRounds] = useState(3);
  const [activeSection, setActiveSection] = useState<"overview" | "when" | "admins" | "scoring" | "pairing" | "players" | "pairs" | "competition" | "rounds" | "manual">("overview");
  const [adminSearch, setAdminSearch] = useState("");
  const [pairMode, setPairMode] = useState<"rating" | "level" | "random" | "manual">("rating");
  const [pairMixed, setPairMixed] = useState(false);
  const [generatingPairs, setGeneratingPairs] = useState(false);
  const [manualPairSelect, setManualPairSelect] = useState<string | null>(null);
  const [pairingInProgress, setPairingInProgress] = useState<Set<string>>(new Set());
  const [waGroups, setWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [allWaGroups, setAllWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [rallyMatchId, setRallyMatchId] = useState<string | null>(null);
  const [rallyVisible, setRallyVisible] = useState(false);
  const [rallyLiveScore, setRallyLiveScore] = useState<{ team1: number; team2: number } | null>(null);
  const [showAddHelper, setShowAddHelper] = useState(false);

  const isOwner = !!(event && userId && event.createdById === userId) && hasRole(viewRole, "event");
  const isHelper = !!(event && userId && event.helpers?.some((h) => h.playerId === userId)) && hasRole(viewRole, "event");
  const canManage = isAdmin || isOwner || isHelper;

  // Sync SWR data → local event state with derived fields
  useEffect(() => {
    if (swrEvent.error) { router.push("/events"); return; }
    if (!swrEvent.data) return;
    const data = { ...swrEvent.data };
    const defaultClass = data.classes?.find((c: EventClassData) => c.isDefault) || data.classes?.[0];
    if (defaultClass) {
      data.format = defaultClass.format;
      data.scoringFormat = defaultClass.scoringFormat;
      data.pairingMode = defaultClass.pairingMode;
      data.rankingMode = defaultClass.rankingMode;
      data.competitionMode = defaultClass.competitionMode;
      data.competitionConfig = defaultClass.competitionConfig;
      data.competitionPhase = defaultClass.competitionPhase;
    }
    setEvent(data);
    setLoading(false);
  }, [swrEvent.data, swrEvent.error, router]);

  // fetchEvent = trigger SWR revalidation (used by existing code)
  const fetchEvent = useCallback(() => { swrEvent.mutate(); }, [swrEvent]);

  const fetchWaGroups = useCallback(async () => {
    const [linked, all] = await Promise.all([
      fetch(`/api/events/${id}/whatsapp-groups`).then((r) => r.json()),
      fetch("/api/whatsapp-groups").then((r) => r.json()),
    ]);
    if (Array.isArray(linked)) setWaGroups(linked);
    if (Array.isArray(all)) setAllWaGroups(all);
  }, [id]);

  useEffect(() => { fetchWaGroups(); }, [fetchWaGroups]);

  const buildWhatsAppMessage = () => {
    if (!event) return "";
    const date = new Date(event.date).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const time = new Date(event.date).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    const endTime = event.endDate
      ? new Date(event.endDate).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    const playerList = event.players
      .filter((ep) => ep.status === "registered" || ep.status === "checked_in")
      .map((ep) => ep.player.name)
      .join("\n");
    const checkedInCount = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in").length;

    return `🏓 *${event.name}*\n📅 ${date}\n⏰ ${time}${endTime ? ` – ${endTime}` : ""}\n🏟️ ${event.numCourts} court${event.numCourts > 1 ? "s" : ""} · ${event.format}\n\n👥 Players (${checkedInCount}):\n${playerList}`;
  };

  const sendToWhatsApp = (groupName: string) => {
    const text = buildWhatsAppMessage();
    const encoded = encodeURIComponent(text);
    // Copy to clipboard as fallback
    navigator.clipboard.writeText(text);
    setCopiedGroupId(groupName);
    setTimeout(() => setCopiedGroupId(null), 2000);
    // Open WhatsApp with pre-filled text
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  const deleteEvent = async () => {
    if (!confirm("Are you sure you want to delete this event? This cannot be undone.")) return;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    router.push("/events");
  };

  const generateMatches = async () => {
    setGenerating(true);
    await fetch(`/api/events/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numRounds }),
    });
    await fetchEvent();
    setGenerating(false);
  };

  const submitScore = async (matchId: string) => {
    const s = scores[matchId];
    if (!s || s.team1 === "" || s.team2 === "") return;
    const team1Score = parseInt(s.team1);
    const team2Score = parseInt(s.team2);
    if (isNaN(team1Score) || isNaN(team2Score)) return;
    if (team1Score === team2Score) {
      alert("Scores cannot be tied!");
      return;
    }
    await fetch(`/api/matches/${matchId}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team1Score, team2Score }),
    });
    setScores((prev) => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
    await fetchEvent();
  };

  const editScore = async (matchId: string) => {
    const s = scores[matchId];
    if (!s || s.team1 === "" || s.team2 === "") return;
    const team1Score = parseInt(s.team1);
    const team2Score = parseInt(s.team2);
    if (isNaN(team1Score) || isNaN(team2Score)) return;
    if (team1Score === team2Score) {
      alert("Scores cannot be tied!");
      return;
    }
    if (!confirm("Are you sure you want to edit this score? This will recalculate ELO ratings.")) return;
    await fetch(`/api/matches/${matchId}/score`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team1Score, team2Score }),
    });
    setEditingMatchId(null);
    setScores((prev) => {
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
    await fetchEvent();
  };

  const setMatchScore = (matchId: string, team: "team1" | "team2", value: string) => {
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        ...prev[matchId],
        team1: prev[matchId]?.team1 ?? "",
        team2: prev[matchId]?.team2 ?? "",
        [team]: value,
      },
    }));
  };

  const fetchAllPlayers = async () => {
    const r = await fetch("/api/players");
    const data = await r.json();
    setAllPlayers(data);
  };

  const signupForEvent = async () => {
    await fetch(`/api/events/${id}/signup`, { method: "POST" });
    await fetchEvent();
  };

  const unsignFromEvent = async () => {
    if (!confirm("Are you sure you want to leave this event?")) return;
    const r = await fetch(`/api/events/${id}/signup`, { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json();
      alert(data.error || "Cannot leave event");
      return;
    }
    await fetchEvent();
  };

  const addPlayerToEvent = async (playerId: string) => {
    await fetch(`/api/events/${id}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchEvent();
  };

  const togglePausePlayer = async (playerId: string) => {
    await fetch(`/api/events/${id}/players/${playerId}/pause`, { method: "POST" });
    await fetchEvent();
  };

  const checkInPlayer = async (playerId: string) => {
    await fetch(`/api/events/${id}/players/${playerId}/checkin`, { method: "POST" });
    await fetchEvent();
  };

  const swapMatchPlayer = async (matchId: string, oldPlayerId: string, newPlayerId: string) => {
    await fetch(`/api/matches/${matchId}/players`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPlayerId, newPlayerId }),
    });
    await fetchEvent();
  };

  const deleteMatch = async (matchId: string) => {
    const match = event?.matches.find((m) => m.id === matchId);
    const isScored = match?.status === "completed";
    const msg = isScored
      ? "Are you sure you want to delete this scored match? ELO changes will be reversed."
      : "Are you sure you want to delete this match?";
    if (!confirm(msg)) return;
    await fetch(`/api/matches/${matchId}/players`, { method: "DELETE" });
    await fetchEvent();
  };

  const removePlayer = async (playerId: string, playerName: string) => {
    if (!confirm(`Remove ${playerName} from this event?`)) return;
    const r = await fetch(`/api/events/${id}/players/${playerId}`, { method: "DELETE" });
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: "Failed to remove" }));
      alert(data.error || "Cannot remove player");
    }
    await fetchEvent();
  };

  // Sections that need explicit Save (edit fields + save button)
  const saveSections = new Set(["when", "scoring", "pairing", "competition"]);

  const startEditEvent = () => {
    if (!event) return;
    setHasEdits(false);
    setEditName(event.name);
    setEditStatus(event.status);
    setEditCourts(event.numCourts);
    setEditDate(toDateInput(event.date));
    setEditTime(toTimeInput(event.date));
    setEditFormat(event.format || "doubles");
    setEditScoringFormat(event.scoringFormat || "1x11");
    setEditWinBy(event.classes?.[0]?.winBy || "2");
    setEditPairingMode(event.pairingMode);
    const cls = event.classes?.[0];
    setEditPlayMode(cls?.playMode || "round_based");
    setEditPrioSpeed(cls?.prioSpeed ?? true);
    setEditPrioFairness(cls?.prioFairness ?? true);
    setEditPrioSkill(cls?.prioSkill ?? false);
    setEditRankingMode(event.rankingMode || "ranked");
    setEditOpenSignup(event.openSignup);
    setEditVisibility(event.visibility);
    if (event.endDate) {
      setEditEndDate(toDateInput(event.endDate));
      setEditEndTime(toTimeInput(event.endDate));
    } else {
      // Default: same date, 2 hours after start
      setEditEndDate(toDateInput(event.date));
      const end = new Date(event.date);
      end.setHours(end.getHours() + 2);
      setEditEndTime(toTimeInput(end.toISOString()));
    }
    setEditingEvent(true);
  };

  const saveEditEvent = async () => {
    if (!editName.trim()) return;
    const eventDate = new Date(`${editDate}T${editTime}`);
    const eventEndDate = new Date(`${editEndDate || editDate}T${editEndTime}`);
    if (eventEndDate <= eventDate) eventEndDate.setDate(eventEndDate.getDate() + 1);
    await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        status: editStatus,
        numCourts: editCourts,
        date: eventDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        format: editFormat,
        scoringFormat: editScoringFormat,
        winBy: editWinBy,
        pairingMode: editPairingMode,
        playMode: editPlayMode,
        prioSpeed: editPrioSpeed,
        prioFairness: editPrioFairness,
        prioSkill: editPrioSkill,
        rankingMode: editRankingMode,
        openSignup: editOpenSignup,
        visibility: editVisibility,
      }),
    });
    setEditingEvent(false);
    await fetchEvent();
  };

  const startEditMatch = (matchId: string, team1Score: number, team2Score: number) => {
    setEditingMatchId(matchId);
    setScores((prev) => ({
      ...prev,
      [matchId]: {
        team1: String(team1Score),
        team2: String(team2Score),
      },
    }));
  };

  const cancelEditMatch = () => {
    if (editingMatchId) {
      setScores((prev) => {
        const next = { ...prev };
        delete next[editingMatchId];
        return next;
      });
    }
    setEditingMatchId(null);
  };

  const resetEvent = async () => {
    if (!confirm("Are you sure you want to reset this event? This will delete ALL matches and reverse all ELO changes. This cannot be undone.")) return;
    setResetting(true);
    await fetch(`/api/events/${id}/reset`, { method: "POST" });
    await fetchEvent();
    setResetting(false);
  };

  const addHelper = async (playerId: string) => {
    await fetch(`/api/events/${id}/helpers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchEvent();
  };

  const removeHelper = async (playerId: string) => {
    await fetch(`/api/events/${id}/helpers`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    await fetchEvent();
  };

  const generatePairsAuto = async () => {
    setGeneratingPairs(true);
    await fetch(`/api/events/${id}/pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: pairMode, preferMixed: pairMixed }),
    });
    await fetchEvent();
    setGeneratingPairs(false);
  };

  const createManualPair = async (player1Id: string, player2Id: string) => {
    // Instant visual feedback
    setPairingInProgress(new Set([player1Id, player2Id]));
    setManualPairSelect(null);
    await fetch(`/api/events/${id}/pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player1Id, player2Id }),
    });
    setPairingInProgress(new Set());
    await fetchEvent();
  };

  const removePair = async (pairId: string) => {
    await fetch(`/api/events/${id}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId }),
    });
    await fetchEvent();
  };

  const clearAllPairs = async () => {
    if (!confirm("Remove all pairs?")) return;
    await fetch(`/api/events/${id}/pairs`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await fetchEvent();
  };

  const setSkillLevel = async (playerId: string, skillLevel: number | null) => {
    // Optimistic update
    setEvent((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: prev.players.map((ep) =>
          ep.player.id === playerId ? { ...ep, skillLevel } : ep
        ),
      };
    });
    // Save in background
    fetch(`/api/events/${id}/players/${playerId}/level`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillLevel }),
    });
  };

  const addManualMatch = async () => {
    if (manualTeam1.length === 0 || manualTeam2.length === 0) return;
    await fetch(`/api/events/${id}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team1PlayerIds: manualTeam1,
        team2PlayerIds: manualTeam2,
        courtNum: manualCourt,
      }),
    });
    setShowAddMatch(false);
    setManualTeam1([]);
    setManualTeam2([]);
    setManualCourt(1);
    await fetchEvent();
  };

  const toggleManualPlayer = (playerId: string, team: 1 | 2) => {
    const maxPerTeam = event?.format === "singles" ? 1 : 2;
    if (team === 1) {
      setManualTeam1((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= maxPerTeam ? prev : [...prev, playerId]
      );
      setManualTeam2((prev) => prev.filter((id) => id !== playerId));
    } else {
      setManualTeam2((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : prev.length >= maxPerTeam ? prev : [...prev, playerId]
      );
      setManualTeam1((prev) => prev.filter((id) => id !== playerId));
    }
  };

  if (loading || !event) {
    return <div className="text-center py-12 text-muted text-lg">Loading...</div>;
  }

  // Group matches by round
  const matchesByRound = event.matches.reduce<Record<number, Match[]>>((acc, m) => {
    if (!acc[m.round]) acc[m.round] = [];
    acc[m.round].push(m);
    return acc;
  }, {});

  const rounds = Object.keys(matchesByRound)
    .map(Number)
    .sort((a, b) => a - b);

  const allCompleted =
    event.matches.length > 0 &&
    event.matches.every((m) => m.status === "completed");

  const hasMatches = event.matches.length > 0;
  const minPlayers = event.format === "singles" ? 2 : 4;
  const activePlayers = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
  const pausedPlayers = event.players.filter((ep) => ep.status === "paused");
  const waitlistedPlayers = event.players.filter((ep) => ep.status === "waitlisted");
  const isIncremental = event.pairingMode === "king_of_court" || event.pairingMode === "swiss";

  // Courts currently in use (active match being played)
  const activeCourts = new Set(
    event.matches.filter((m) => m.status === "active").map((m) => m.courtNum)
  );
  // Next pending matches ready to play
  const pendingReadyMatches = event.matches
    .filter((m) => m.status === "pending" && m.players.length >= 2)
    .sort((a, b) => a.round - b.round || a.courtNum - b.courtNum);
  const nextMatchIdSet = new Set(pendingReadyMatches.slice(0, event.numCourts).map((m) => m.id));
  const courtFreeMatchIds = new Set(
    pendingReadyMatches.filter((m) => !activeCourts.has(m.courtNum)).map((m) => m.id)
  );

  // Navigate back to club events or global events list
  const closeEvent = () => {
    const clubId = typeof window !== "undefined" ? sessionStorage.getItem("activeClubId") : null;
    if (clubId) {
      router.push(`/clubs/${clubId}`);
    } else {
      router.push("/events");
    }
  };

  const location = event.club?.locations?.[0];

  const ownerName = event.createdBy?.name;
  const helperNames = event.helpers.map((h) => h.player.name);

  const eventHeader = (
    <div className="bg-card rounded-xl border border-border p-3 flex">
      {/* Left side — tap to edit */}
      <button onClick={() => { startEditEvent(); setActiveSection("when"); }}
        className="flex-1 min-w-0 text-left active:opacity-70 transition-opacity">
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-lg truncate">{event.name}</h2>
          {event.status !== "setup" && (
            <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              event.status === "active" ? "bg-green-100 text-green-700" :
              event.status === "completed" ? "bg-gray-100 text-muted" :
              "bg-blue-100 text-blue-700"
            }`}>{event.status}</span>
          )}
        </div>
        <p className="text-xs text-muted">
          {new Date(event.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" at "}
          {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {event.endDate && ` — ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
          {" · "}{event.numCourts} court{event.numCourts !== 1 ? "s" : ""}
        </p>
        <p className="text-xs text-muted mt-0.5">
          {ownerName || "—"}
          {helperNames.length > 0 && <span className="text-muted"> ({helperNames.join(", ")})</span>}
        </p>
      </button>
      {/* Right side — location link */}
      {location && (
        <div className="shrink-0 flex items-end ml-2">
          {location.googleMapsUrl ? (
            <a href={location.googleMapsUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
              📍 {location.name}
            </a>
          ) : (
            <span className="text-xs text-muted whitespace-nowrap">📍 {location.name}</span>
          )}
        </div>
      )}
    </div>
  );

  const sectionLabels: Record<string, string> = {
    when: "When",
    admins: "Organizer",
    scoring: "Format",
    pairing: "Pairing",
    players: "Players",
    pairs: "Pairs",
    competition: event.competitionMode ? "Competition" : "Ranked",
    rounds: "Matches",
  };

  const sectionOrder = event.competitionMode
    ? ["when", "admins", "scoring", "pairing", "players", "competition", "rounds"]
    : ["when", "admins", "scoring", "pairing", "players", "pairs", "rounds"];

  const sectionBar = (
    <div className="sticky z-30 bg-background pb-2 -mx-4 px-4 pt-1 shadow-sm" style={{ top: "var(--header-height, 0px)" }}>
      <div className="text-center pb-1">
        <span className="text-xs font-semibold">{event.name}</span>
        <span className="text-[10px] text-muted ml-1.5">
          {new Date(event.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          {" "}
          {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div className="flex gap-1">
        {sectionOrder
          .filter((s) => {
            if (s === "pairs" && (event.competitionMode || event.format !== "doubles" || event.pairs.length === 0)) return false;
            // competition section always visible (contains ranking)
            return true;
          })
          .map((s) => (
            <button key={s} className="flex-1 text-center" onClick={() => {
              if (s === activeSection) return;
              if (hasEdits && saveSections.has(activeSection)) {
                if (confirm("You have unsaved changes. Save them?")) {
                  saveEditEvent().then(() => { startEditEvent(); setActiveSection(s as typeof activeSection); });
                } else {
                  startEditEvent(); setActiveSection(s as typeof activeSection);
                }
              } else {
                if (saveSections.has(s)) startEditEvent();
                setActiveSection(s as typeof activeSection);
              }
            }}>
              <div className={`h-1 rounded-full transition-all duration-300 ${s === activeSection ? "bg-action" : "bg-gray-200"}`} />
              <span className={`text-[8px] leading-tight mt-0.5 block ${s === activeSection ? "text-action font-bold" : "text-foreground/60 hover:text-foreground"}`}>
                {sectionLabels[s]}
              </span>
            </button>
          ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className="w-16" />
        <span className="text-sm font-bold text-foreground">{sectionLabels[activeSection] || activeSection}</span>
        {saving ? (
          <span className="text-xs font-medium text-green-600 px-3 py-1 shrink-0">Saved ✓</span>
        ) : saveSections.has(activeSection) && hasEdits ? (
          <button onClick={async () => {
            setSaving(true);
            await saveEditEvent();
            setTimeout(() => { setSaving(false); setActiveSection("overview"); }, 800);
          }}
            className="bg-action-dark text-white px-3 py-1 rounded-lg text-xs font-medium shadow-sm shrink-0">
            Save
          </button>
        ) : (
          <button onClick={() => {
            if (hasEdits && saveSections.has(activeSection)) {
              if (confirm("You have unsaved changes. Save them?")) {
                saveEditEvent().then(() => setActiveSection("overview"));
              } else {
                setActiveSection("overview");
              }
            } else {
              setActiveSection("overview");
            }
          }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-action text-action active:bg-action/10 shrink-0 leading-tight text-center">
            Event<br/>Overview
          </button>
        )}
      </div>
    </div>
  );

  // ── Section: When (name + date/time) ──
  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setHasEdits(true); };

  const renderWhen = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Event Name</label>
        <input type="text" value={editName} onChange={(e) => { setEditName(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">Start Date</label>
          <input type="date" value={editDate} onChange={(e) => { setEditDate(e.target.value); if (!editEndDate) setEditEndDate(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">End Date</label>
          <input type="date" value={editEndDate} onChange={(e) => { setEditEndDate(e.target.value); setHasEdits(true); }}
            min={editDate}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">From</label>
          <input type="time" value={editTime} onChange={(e) => { setEditTime(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">To</label>
          <input type="time" value={editEndTime} onChange={(e) => { setEditEndTime(e.target.value); setHasEdits(true); }}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Courts</label>
        <select value={editCourts} onChange={(e) => { setEditCourts(parseInt(e.target.value)); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
            <option key={n} value={n}>{n} court{n !== 1 ? "s" : ""}</option>
          ))}
        </select>
      </div>
      {event.club?.locations && event.club.locations.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-muted mb-1">Location</label>
          {event.club.locations.length === 1 ? (
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-gray-50 text-sm">
              <span>📍</span>
              <span className="font-medium">{event.club.locations[0].name}</span>
            </div>
          ) : (
            <select className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50">
              {event.club.locations.map((loc: { id: string; name: string }) => (
                <option key={loc.id} value={loc.id}>📍 {loc.name}</option>
              ))}
            </select>
          )}
        </div>
      )}
      {/* Event status */}
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Status</label>
        <select value={editStatus} onChange={(e) => { setEditStatus(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="draft">Draft — only organizers can see</option>
          <option value="visible">Visible — everyone can see, no signup</option>
          <option value="open">Open — players can sign up</option>
          <option value="closed">Closed — no more signups</option>
          <option value="active">Active — event is running</option>
          <option value="completed">Done — event finished</option>
        </select>
      </div>
      {/* Competition toggle */}
      <div className="border-t border-border pt-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <div className={`w-11 h-6 rounded-full transition-colors relative ${event.competitionMode ? "bg-action" : "bg-gray-200"}`}
            onClick={() => {
              const newMode = event.competitionMode ? null : "groups_elimination";
              // Optimistic update
              setEvent((prev) => prev ? { ...prev, competitionMode: newMode } : prev);
              // Save in background
              fetch(`/api/events/${id}/competition`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: event.competitionMode ? "disable" : "enable" }),
              }).then(() => fetchEvent());
            }}>
            <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: event.competitionMode ? "translateX(22px)" : "translateX(0)" }} />
          </div>
          <div>
            <span className="text-sm font-medium">Competition Mode</span>
            <p className="text-xs text-muted">Groups → Elimination tournament</p>
          </div>
        </label>
      </div>
    </div>
  );

  // ── Section: Format (doubles/singles + scoring + ranking) ──
  const renderScoring = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <select value={editFormat} onChange={(e) => { setEditFormat(e.target.value); setHasEdits(true); }}
        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
        <option value="doubles">Doubles</option>
        <option value="singles">Singles</option>
      </select>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Scoring</label>
        <select value={editScoringFormat} onChange={(e) => { setEditScoringFormat(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <optgroup label="Normal — 1 Set">
            <option value="1x7">1 set to 7</option>
            <option value="1x9">1 set to 9</option>
            <option value="1x11">1 set to 11</option>
            <option value="1x15">1 set to 15</option>
          </optgroup>
          <optgroup label="Normal — Best of 3">
            <option value="3x11">Best of 3 to 11</option>
            <option value="3x15">Best of 3 to 15</option>
          </optgroup>
          <optgroup label="Rally — 1 Set">
            <option value="1xR15">1 set rally to 15</option>
            <option value="1xR21">1 set rally to 21</option>
          </optgroup>
          <optgroup label="Rally — Best of 3">
            <option value="3xR15">Best of 3 rally to 15</option>
            <option value="3xR21">Best of 3 rally to 21</option>
          </optgroup>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Win by</label>
        <select value={editWinBy} onChange={(e) => { setEditWinBy(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="cap13">Cap 13</option>
          <option value="cap15">Cap 15</option>
          <option value="cap17">Cap 17</option>
          <option value="cap18">Cap 18</option>
          <option value="cap23">Cap 23</option>
          <option value="cap25">Cap 25</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Ranking</label>
        <select value={editRankingMode} onChange={(e) => { setEditRankingMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="ranked">Ranked — scores count towards ratings</option>
          <option value="approval">Approval — scores need confirmation</option>
          <option value="none">Unranked — scores don&apos;t affect ratings</option>
        </select>
      </div>
    </div>
  );

  // ── Section: Pairing ──
  const pairingOptions = [
    { value: "random", icon: "🎲", label: "Random", desc: "Random matchups, everyone plays" },
    { value: "skill_balanced", icon: "📊", label: "Skill", desc: "Similar ratings play each other" },
    { value: "mixed_gender", icon: "👫", label: "Mixed", desc: "Each team has one male + one female" },
    { value: "skill_mixed_gender", icon: "📊👫", label: "Skill + Mix", desc: "Balanced ratings with mixed gender teams" },
    { value: "king_of_court", icon: "👑", label: "King", desc: "Winners move up courts, losers move down" },
    { value: "swiss", icon: "🇨🇭", label: "Swiss", desc: "Fixed pairs matched by win/loss record" },
    { value: "manual", icon: "✏️", label: "Manual", desc: "Create matches one by one" },
  ];

  const renderPairing = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Match Pairing</label>
        <select value={editPairingMode} onChange={(e) => { setEditPairingMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          {pairingOptions.map((m) => (
            <option key={m.value} value={m.value}>{m.label} — {m.desc}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Skill Source</label>
        <select value={editSkillSource} onChange={(e) => { setEditSkillSource(e.target.value as "rating" | "manual"); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="rating">App Rating</option>
          <option value="manual">Manual Level (1-3)</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Play Mode</label>
        <select value={editPlayMode} onChange={(e) => { setEditPlayMode(e.target.value); setHasEdits(true); }}
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm font-medium">
          <option value="round_based">Round-based — all matches finish before next round</option>
          <option value="continuous">Continuous — new match when a court is free</option>
        </select>
      </div>

      {/* Priority toggles — only for continuous */}
      {editPlayMode === "continuous" && (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted">Prioritize</label>
          {[
            { key: "speed", value: editPrioSpeed, set: setEditPrioSpeed, label: "Speed", desc: "Fill courts immediately" },
            { key: "fairness", value: editPrioFairness, set: setEditPrioFairness, label: "Fairness", desc: "Equal matches for everyone" },
            { key: "skill", value: editPrioSkill, set: setEditPrioSkill, label: "Skill", desc: "Group by level" },
          ].map((p) => (
            <label key={p.key} className={`flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer transition-all ${
                p.value ? "bg-selected/10 border border-selected/30" : "bg-gray-50 border border-transparent"
              }`}>
              <input type="checkbox" checked={p.value} onChange={() => { p.set(!p.value); setHasEdits(true); }}
                className="rounded border-border" />
              <div>
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs text-muted ml-1.5">{p.desc}</span>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  // ── Section: Ranking ──
  const renderRanking = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <p className="text-xs text-muted">Do matches count towards app player rankings?</p>
      <div className="flex gap-2">
        {[
          { value: "ranked", label: "Ranked" },
          { value: "approval", label: "Approval" },
          { value: "none", label: "Unranked" },
        ].map((m) => (
          <button key={m.value} type="button" onClick={() => { setEditRankingMode(m.value); setHasEdits(true); }}
            className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
              editRankingMode === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
            }`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {editRankingMode === "ranked" && "Scores count towards player ratings immediately after each match."}
        {editRankingMode === "approval" && "Scores are recorded but need confirmation before affecting ratings."}
        {editRankingMode === "none" && "Scores are recorded for the event but don't affect player ratings."}
      </p>
    </div>
  );

  // ── Section: Administrators ──
  const renderAdmins = () => {
    const availablePlayers = allPlayers
      .filter((p) => p.id !== event.createdById && !event.helpers.some((h) => h.playerId === p.id))
      .filter((p) => p.name.toLowerCase().includes(adminSearch.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));

    const owner = event.createdById
      ? event.players.find((ep) => ep.player.id === event.createdById)?.player
        ?? allPlayers.find((p) => p.id === event.createdById)
      : null;

    return (
      <div className="space-y-3">
        {/* Owner */}
        {owner && (
          <div>
            <h4 className="text-sm font-medium text-muted mb-1">Owner</h4>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-purple-50">
              <PlayerAvatar name={owner.name} photoUrl={owner.photoUrl} size="sm" />
              <span className="text-lg font-medium">{owner.name}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium ml-auto">Owner</span>
            </div>
            {(isOwner || isAdmin) && (
              <details className="mt-1">
                <summary className="text-[10px] text-muted cursor-pointer">Transfer ownership</summary>
                <select className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm"
                  defaultValue=""
                  onChange={async (e) => {
                    const newOwnerId = e.target.value;
                    if (!newOwnerId) return;
                    const newOwner = [...event.helpers.map((h) => h.player), ...event.players.map((ep) => ep.player)].find((p) => p.id === newOwnerId);
                    if (!confirm(`Transfer ownership to ${newOwner?.name}? You will become a helper.`)) { e.target.value = ""; return; }
                    await fetch(`/api/events/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ createdById: newOwnerId }),
                    });
                    fetchEvent();
                  }}>
                  <option value="">Select new owner...</option>
                  {event.helpers.map((h) => (
                    <option key={h.playerId} value={h.playerId}>{h.player.name} (helper)</option>
                  ))}
                  {event.players.filter((ep) => ep.player.id !== event.createdById && !event.helpers.some((h) => h.playerId === ep.player.id)).map((ep) => (
                    <option key={ep.player.id} value={ep.player.id}>{ep.player.name}</option>
                  ))}
                </select>
              </details>
            )}
          </div>
        )}

        {/* Current helpers */}
        <div>
          <h4 className="text-sm font-medium text-muted mb-1">Helpers ({event.helpers.length})</h4>
          {event.helpers.length > 0 ? (
            <div className="space-y-1">
              {event.helpers.map((h) => (
                <div key={h.playerId} className="flex items-center gap-2 rounded-lg px-3 py-2">
                  <PlayerAvatar name={h.player.name} photoUrl={h.player.photoUrl} size="sm" />
                  <span className="text-lg font-medium flex-1">{h.player.name}</span>
                  {(isOwner || isAdmin) && (
                    <button onClick={() => removeHelper(h.playerId)}
                      className="text-sm text-danger px-3 py-1.5 rounded-lg hover:bg-red-50 font-medium">Remove</button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted py-2">No helpers added yet</p>
          )}
        </div>

        {/* Add helper — owner/admin only */}
        {(isOwner || isAdmin) && (
          <div>
            {!showAddHelper ? (
              <button
                onClick={() => { fetchAllPlayers(); setShowAddHelper(true); setAdminSearch(""); }}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5 transition-all"
              >
                + Add Helper
              </button>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-muted">Add Helper</h4>
                  <button
                    onClick={() => setShowAddHelper(false)}
                    className="text-xs text-muted hover:text-foreground px-2 py-1 rounded bg-gray-100"
                  >
                    Close
                  </button>
                </div>
                {allPlayers.length === 0 ? (
                  <p className="text-sm text-muted py-2">Loading players...</p>
                ) : (
                  <>
                    <ClearInput value={adminSearch} onChange={setAdminSearch} placeholder="Search by name..." className="text-base mb-2" />
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {availablePlayers.map((p) => (
                        <button key={p.id} onClick={async () => { await addHelper(p.id); setShowAddHelper(false); }}
                          className="w-full text-left py-2.5 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors">
                          <PlayerAvatar name={p.name} size="sm" />
                          <span className="text-lg font-medium">{p.name}</span>
                        </button>
                      ))}
                      {availablePlayers.length === 0 && (
                        <p className="text-center py-4 text-muted text-sm">No players available to add</p>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {/* WhatsApp Groups hidden from UI */}
      </div>
    );
  };

  // ── Section: Pairs ──
  const renderPairs = () => {
    const pairedPlayerIds = new Set<string>();
    event.pairs.forEach((p) => { pairedPlayerIds.add(p.player1.id); pairedPlayerIds.add(p.player2.id); });
    const activePlayers2 = event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in");
    const unpaired = activePlayers2.filter((ep) => !pairedPlayerIds.has(ep.player.id) && !pairingInProgress.has(ep.player.id))
      .sort((a, b) => a.player.name.localeCompare(b.player.name));

    return (
      <div className="space-y-4">
        {/* Selected Pairs */}
        {event.pairs.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-muted">Selected Pairs ({event.pairs.length})</h4>
              {canManage && (
                <button onClick={clearAllPairs} className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50">Clear All</button>
              )}
            </div>
            {event.pairs.map((pair) => {
              const ep1 = event.players.find((ep) => ep.player.id === pair.player1.id);
              const ep2 = event.players.find((ep) => ep.player.id === pair.player2.id);
              const lvl1 = ep1?.skillLevel;
              const lvl2 = ep2?.skillLevel;
              const pairLevel = lvl1 && lvl2 ? Math.round((lvl1 + lvl2) / 2) : lvl1 || lvl2 || null;
              return (
                <div key={pair.id} className="group flex items-center gap-2 bg-card rounded-lg border border-border px-3 py-2">
                  <span className="text-sm shrink-0">{pair.player1.emoji}</span>
                  <span className="text-xs font-medium truncate">{pair.player1.name}</span>
                  <span className="text-[10px] text-muted">+</span>
                  <span className="text-sm shrink-0">{pair.player2.emoji}</span>
                  <span className="text-xs font-medium truncate">{pair.player2.name}</span>
                  {editSkillSource === "manual" && pairLevel && (
                    <span className="text-[9px] bg-gray-100 text-muted px-1 py-0.5 rounded">L{pairLevel}</span>
                  )}
                  <span className="text-[10px] text-muted ml-auto">{Math.round(pair.player1.rating + pair.player2.rating)}</span>
                  {canManage && (
                    <button onClick={() => removePair(pair.id)}
                      className="hidden group-hover:block text-xs text-danger px-1.5 py-0.5 rounded hover:bg-red-50 shrink-0">Remove</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Generation Method */}
        {canManage && (
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Generation Method</h4>
            <div className="flex gap-2">
              {([["rating", "Rating"], ["level", "Skill"], ["random", "Random"], ["manual", "Manual"]] as const).map(([val, label]) => (
                <button key={val} onClick={() => setPairMode(val as "rating" | "random")}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${pairMode === val ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Prefer mixed — not for Manual */}
            {pairMode !== "manual" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pairMixed} onChange={(e) => setPairMixed(e.target.checked)} className="rounded border-border" />
                Prefer mixed gender (M + F)
              </label>
            )}

            {/* Rating or Random → Generate button */}
            {(pairMode === "rating" || pairMode === "random") && (
              <button onClick={generatePairsAuto} disabled={generatingPairs || activePlayers2.length < 2}
                className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-base active:bg-action-dark disabled:opacity-50">
                {generatingPairs ? "Generating..." : event.pairs.length > 0 ? "Regenerate Pairs" : "Generate Pairs"}
              </button>
            )}

            {/* Skill → show players with level selectors then generate */}
            {pairMode === "level" && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted">Assign skill levels, then generate:</p>
                {unpaired.map((ep) => {
                  const currentLevel = event.players.find((p) => p.player.id === ep.player.id)?.skillLevel;
                  return (
                    <div key={ep.player.id} className="flex items-center gap-2 py-1">
                      <span className="text-xs font-medium flex-1 truncate">{ep.player.emoji} {ep.player.name}</span>
                      {[1, 2, 3].map((lvl) => (
                        <button key={lvl} onClick={() => setSkillLevel(ep.player.id, currentLevel === lvl ? null : lvl)}
                          className={`w-7 h-7 rounded text-xs font-bold transition-all ${currentLevel === lvl ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>{lvl}</button>
                      ))}
                    </div>
                  );
                })}
                <button onClick={generatePairsAuto} disabled={generatingPairs || unpaired.length < 2}
                  className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-sm active:bg-action-dark disabled:opacity-50 mt-2">
                  {generatingPairs ? "Generating..." : event.pairs.length > 0 ? "Regenerate Pairs" : "Generate Pairs"}
                </button>
              </div>
            )}

            {/* Manual → show unpaired players to tap-pair */}
            {pairMode === "manual" && unpaired.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted">{manualPairSelect ? "Tap second player to pair" : "Tap two players to pair them"}</p>
                {unpaired.map((ep) => (
                  <button key={ep.player.id}
                    disabled={pairingInProgress.size > 0}
                    onClick={() => {
                      if (manualPairSelect === ep.player.id) { setManualPairSelect(null); }
                      else if (manualPairSelect) { createManualPair(manualPairSelect, ep.player.id); }
                      else { setManualPairSelect(ep.player.id); }
                    }}
                    className={`w-full text-left py-2 px-3 rounded-lg flex items-center gap-2 transition-colors ${
                      manualPairSelect === ep.player.id ? "bg-selected/10 border border-selected/30" : manualPairSelect ? "hover:bg-green-50 border border-transparent" : "hover:bg-gray-50 border border-transparent"
                    }`}>
                    <span className="text-lg">{ep.player.emoji}</span>
                    <span className="text-sm font-medium flex-1">{ep.player.name}</span>
                    {ep.player.gender && <span className={`text-[10px] ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{ep.player.gender === "M" ? "♂" : "♀"}</span>}
                    {manualPairSelect === ep.player.id && <span className="text-xs text-selected font-medium">Selected</span>}
                    {manualPairSelect && manualPairSelect !== ep.player.id && <span className="text-xs text-green-600">Pair</span>}
                  </button>
                ))}
              </div>
            )}

            {pairMode === "manual" && unpaired.length === 0 && event.pairs.length > 0 && (
              <p className="text-xs text-green-600 text-center font-medium">All players paired!</p>
            )}
          </div>
        )}

        {!canManage && unpaired.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-sm font-medium text-muted">Unpaired ({unpaired.length})</h4>
            {unpaired.map((ep) => (
              <div key={ep.player.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="text-lg">{ep.player.emoji}</span>
                <span className="text-sm font-medium">{ep.player.name}</span>
              </div>
            ))}
          </div>
        )}

        {event.pairs.length === 0 && unpaired.length < 2 && (
          <p className="text-center py-6 text-muted text-sm">Need at least 2 active players to build pairs</p>
        )}
      </div>
    );
  };

  // ── Section: Players ──
  const renderAddPlayers = () => {
    const available = allPlayers
      .filter((p) => !event.players.some((ep) => ep.player.id === p.id))
      .filter((p) => p.name.toLowerCase().includes(addPlayerSearch.toLowerCase()))
      .filter((p) => !addPlayerGender || p.gender === addPlayerGender)
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div className="space-y-3">
        <button onClick={() => { setShowAddPlayer(false); setAddPlayerSearch(""); setAddPlayerGender(null); }}
          className="flex items-center gap-1 text-lg text-primary font-semibold active:opacity-70">
          ← Players
        </button>
        <h3 className="text-xl font-bold text-foreground">Add Players ({available.length} available)</h3>
        <ClearInput value={addPlayerSearch} onChange={setAddPlayerSearch} placeholder="Search by name..." className="text-base" />
        <div className="flex gap-2">
          {[
            { value: null, label: "All" },
            { value: "M", label: "♂ Male" },
            { value: "F", label: "♀ Female" },
          ].map((g) => (
            <button key={g.label} onClick={() => setAddPlayerGender(g.value)}
              className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${
                addPlayerGender === g.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
              }`}>{g.label}</button>
          ))}
        </div>
        <div className="space-y-1">
          {available.map((p) => (
            <button key={p.id} onClick={() => addPlayerToEvent(p.id)}
              className="w-full text-left py-2.5 px-3 rounded-lg hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 transition-colors">
              <PlayerAvatar name={p.name} size="sm" />
              <span className="text-lg font-medium">{p.name}</span>
              {p.gender && <span className={`text-sm ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{p.gender === "M" ? "♂" : "♀"}</span>}
              <span className="text-muted ml-auto">{Math.round(p.rating)}</span>
            </button>
          ))}
          {available.length === 0 && (
            <p className="text-center py-6 text-muted text-base">No players to add</p>
          )}
        </div>
      </div>
    );
  };

  const renderBulkSelect = () => {
    const eventPlayerIds = new Set(event.players.map((ep) => ep.player.id));
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Add Players</h3>
          <button onClick={() => setBulkSelectMode(false)}
            className="text-xs text-primary font-medium">Done</button>
        </div>
        <PlayerSelector
          players={allPlayers as { id: string; name: string; gender?: string | null }[]}
          selectedIds={eventPlayerIds}
          recentIds={eventPlayerIds}
          onToggle={async (pid) => {
            if (eventPlayerIds.has(pid)) {
              const p = allPlayers.find((pl) => pl.id === pid);
              await removePlayer(pid, p?.name || "");
            } else {
              await addPlayerToEvent(pid);
            }
          }}
        />
      </div>
    );
  };

  const renderPlayers = () => {
    // Competition mode: summary across classes, no add/leave at event level
    if (event.competitionMode) {
      // Deduplicate players (can be in multiple classes)
      // Build unique player list with their class memberships
      const playerClasses = new Map<string, { player: typeof event.players[0]; classNames: string[] }>();
      const classes = event.classes || [];
      const classNameMap = new Map(classes.map((c: { id: string; name: string }) => [c.id, c.name]));
      for (const ep of event.players) {
        const existing = playerClasses.get(ep.player.id);
        const className = classNameMap.get((ep as unknown as { classId?: string }).classId || "") || "";
        if (existing) {
          if (className && !existing.classNames.includes(className)) existing.classNames.push(className);
        } else {
          playerClasses.set(ep.player.id, { player: ep, classNames: className ? [className] : [] });
        }
      }
      // Filter out players with no class, sort: females first then males
      const genderOrder = (g: string | null | undefined) => g === "F" ? 0 : g === "M" ? 1 : 2;
      const allPlayers = [...playerClasses.values()]
        .filter((e) => e.classNames.length > 0)
        .sort((a, b) =>
          genderOrder(a.player.player.gender) - genderOrder(b.player.player.gender) || a.player.player.name.localeCompare(b.player.player.name)
        );
      const femaleCount = allPlayers.filter((e) => e.player.player.gender === "F").length;
      const maleCount = allPlayers.filter((e) => e.player.player.gender === "M").length;

      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-xl font-bold text-foreground">
              Players ({allPlayers.length})
            </h3>
            {(["F", "M"] as const).map((g) => (
              <button key={g} onClick={() => setPlayerSearch((prev) => prev === `__gender_${g}` ? "" : `__gender_${g}`)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  playerSearch === `__gender_${g}` ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                }`}>
                {g === "F" ? `♀ ${femaleCount}` : `♂ ${maleCount}`}
              </button>
            ))}
          </div>

          {allPlayers.length > 6 && (
            <ClearInput value={playerSearch.startsWith("__gender_") ? "" : playerSearch} onChange={setPlayerSearch} placeholder="Search players..." className="text-base" />
          )}
          <div className="space-y-0">
            {allPlayers
              .filter((entry) => {
                if (playerSearch === "__gender_F") return entry.player.player.gender === "F";
                if (playerSearch === "__gender_M") return entry.player.player.gender === "M";
                return entry.player.player.name.toLowerCase().includes(playerSearch.toLowerCase());
              })
              .map((entry) => {
                const p = entry.player.player;
                return (
                  <div key={p.id} className="flex items-center gap-2 py-2.5 px-3 border-b border-border last:border-b-0">
                    <PlayerAvatar name={p.name} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        {p.gender && (
                          <span className={`text-[10px] ${p.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>
                            {p.gender === "M" ? "♂" : "♀"}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {p.duprRating && <span className="text-[9px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">DUPR {p.duprRating.toFixed(2)}</span>}
                        <span className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">App {Math.round(p.rating)}</span>
                        {entry.classNames.map((cn) => (
                          <span key={cn} className="text-[9px] bg-gray-100 text-muted px-1.5 py-0.5 rounded-full">{cn}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      );
    }

    // Non-competition mode: standard player management
    if (bulkSelectMode && canManage) return renderBulkSelect();
    if (showAddPlayer && canManage) return renderAddPlayers();

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-foreground">
            Players ({activePlayers.length}{pausedPlayers.length > 0 ? ` + ${pausedPlayers.length} paused` : ""}{waitlistedPlayers.length > 0 ? ` + ${waitlistedPlayers.length} waitlist` : ""})
          </h3>
          {canManage && (
            <button onClick={() => { setBulkSelectMode(true); setBulkSearch(""); setBulkGenderFilter(null); fetchAllPlayers(); }}
              className="text-sm text-primary font-medium px-3 py-1.5 rounded-lg hover:bg-primary/10 transition-colors">
              Add
            </button>
          )}
        </div>
        {canManage && (
          <p className="text-xs text-muted">Long-press to pause{!hasMatches ? " · Swipe left to remove" : ""} · Hover for actions on desktop</p>
        )}
        {session?.user && !canManage && event.openSignup && (
          <div>
            {event.players.some((ep) => ep.player.id === (session.user as { id: string }).id) ? (
              <button onClick={unsignFromEvent} className="text-sm text-danger px-3 py-1.5 rounded hover:bg-red-50">Leave Event</button>
            ) : (
              <button onClick={signupForEvent} className="text-sm bg-action text-white px-4 py-1.5 rounded-lg font-medium">Join Event</button>
            )}
          </div>
        )}
        {event.players.length > 6 && (
          <ClearInput value={playerSearch} onChange={setPlayerSearch} placeholder="Search players..." className="text-base" />
        )}
        <div className="space-y-0">
          {[...event.players]
            .sort((a, b) => a.player.name.localeCompare(b.player.name))
            .filter((ep) => ep.player.name.toLowerCase().includes(playerSearch.toLowerCase()))
            .map((ep) => (
            <SwipeablePlayerRow key={ep.player.id} ep={ep} canManage={canManage} hasMatches={hasMatches}
              showContact={isAdmin || ep.player.id === userId}
              skillLevel={editSkillSource === "manual" ? ep.skillLevel : undefined}
              onSkillLevel={editSkillSource === "manual" ? (lvl) => setSkillLevel(ep.player.id, lvl) : undefined}
              onPause={() => togglePausePlayer(ep.player.id)} onRemove={() => removePlayer(ep.player.id, ep.player.name)} />
          ))}
        </div>
      </div>
    );
  };

  // ── Section: Rounds ──
  const completedMatches = event.matches.filter((m) => m.status === "completed");
  const activeMatches = event.matches.filter((m) => m.status === "active");
  const pendingMatches = event.matches.filter((m) => m.status === "pending");
  const freeCourts = Array.from({ length: event.numCourts }, (_, i) => i + 1)
    .filter((c) => !activeMatches.some((m) => m.courtNum === c) && !pendingMatches.some((m) => m.courtNum === c && m.players.length >= 2));

  const renderMatchCard = (match: Match) => {
    const team1 = match.players.filter((p) => p.team === 1);
    const team2 = match.players.filter((p) => p.team === 2);
    const isCompleted = match.status === "completed";
    const isActive = match.status === "active";
    const isPending = match.status === "pending";
    const isEditing = editingMatchId === match.id;
    const team1Score = isCompleted ? team1[0]?.score ?? 0 : null;
    const team2Score = isCompleted ? team2[0]?.score ?? 0 : null;
    const team1Won = team1Score !== null && team2Score !== null && team1Score > team2Score;
    const team2Won = team1Score !== null && team2Score !== null && team2Score > team1Score;
    const isMatchPlayer = session?.user ? [...team1, ...team2].some((mp) => mp.playerId === (session.user as { id: string }).id) : false;
    const canScore = canManage || isMatchPlayer;
    const showInputs = canScore && (isActive || isEditing);
    const isNextMatch = nextMatchIdSet.has(match.id);
    const isCourtFree = courtFreeMatchIds.has(match.id);
    const hasLiveScore = rallyMatchId === match.id && rallyLiveScore;

    return (
      <div key={match.id} className={`bg-card rounded-xl border overflow-hidden transition-all ${
        isActive
          ? "border-orange-400 ring-2 ring-orange-300/50 shadow-md shadow-orange-100"
          : isCourtFree && isPending
            ? "border-green-400 ring-2 ring-green-300/50 shadow-md shadow-green-100"
            : isNextMatch && isPending
              ? "border-blue-300 ring-1 ring-blue-200/50"
              : "border-border"
      }`}>
        <div className={`px-3 py-2 border-b flex items-center justify-between ${
          isActive
            ? "bg-orange-50 border-orange-200"
            : isCourtFree && isPending
              ? "bg-green-50 border-green-200"
              : isNextMatch && isPending
                ? "bg-blue-50 border-blue-200"
                : "bg-gray-50 border-border"
        }`}>
          <span className={`text-sm font-medium ${
            isActive ? "text-orange-600" : isCourtFree && !isCompleted ? "text-green-700" : isNextMatch && !isCompleted ? "text-blue-600" : "text-muted"
          }`}>
            Court {match.courtNum}
            {isActive && " — In Play"}
            {isPending && isCourtFree && " — Ready!"}
            {isPending && isNextMatch && !isCourtFree && " — Up next"}
          </span>
          <div className="flex items-center gap-2">
            {isPending && canScore && match.players.length >= 2 && (
              <button onClick={async () => {
                await fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
                fetchEvent();
              }}
                className="text-lg px-1.5 py-0.5 rounded hover:bg-green-100 transition-colors" title="Start match">▶️</button>
            )}
            {!isCompleted && match.players.length >= 2 && (
              <button onClick={() => { setRallyMatchId(match.id); setRallyVisible(true); }}
                className="text-lg px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors" title="Rally tracker (judge mode)">⚖️</button>
            )}
            <button onClick={() => {
              const t1 = match.players.filter((p) => p.team === 1).map((p) => p.player.name);
              const t2 = match.players.filter((p) => p.team === 2).map((p) => p.player.name);
              const text = formatMatchAnnouncement(match.courtNum, t1, t2, event.pairingMode === "king_of_court");
              sendAnnouncement(id as string, text);
            }}
              className="text-2xl px-1 py-0.5 rounded hover:bg-primary/10 transition-colors" title="Announce match">🔊</button>
            {isCompleted && !isEditing && (
              <span className={`text-sm font-medium ${match.rankingMode === "approval" && !match.scoreConfirmed ? "text-amber-600" : "text-green-600"}`}>
                {match.rankingMode === "approval" && !match.scoreConfirmed ? "⏳ Pending" : "✓ Final"}
              </span>
            )}
            {isCompleted && !isEditing && match.rankingMode === "approval" && !match.scoreConfirmed && (
              <button onClick={async () => { await fetch(`/api/matches/${match.id}/score`, { method: "PATCH" }); await fetchEvent(); }}
                className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-lg font-medium hover:bg-amber-200">Confirm</button>
            )}
            {isCompleted && canManage && !isEditing && (
              <button onClick={() => startEditMatch(match.id, team1Score!, team2Score!)}
                className="text-sm text-muted px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors">Edit</button>
            )}
            {isEditing && <span className="text-sm text-amber-600 font-medium">Editing...</span>}
            {canManage && (
              <button onClick={() => deleteMatch(match.id)}
                className="text-2xl px-1 py-0.5 rounded hover:bg-red-100 transition-colors" title="Delete match">🗑️</button>
            )}
          </div>
        </div>
        <div className="p-3">
          <div className={`flex items-center gap-2 p-2 rounded-lg ${team1Won && !isEditing ? "bg-green-50" : ""}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {team1.map((mp) => (
                  <span key={mp.id} className="inline-flex items-center gap-1 text-lg">
                    <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="xs" />
                    <span className={team1Won && !isEditing ? "font-bold" : "font-medium"}>{mp.player.name}</span>
                  </span>
                ))}
              </div>
            </div>
            {isCompleted && !isEditing ? (
              <span className={`text-2xl font-bold min-w-[2.5rem] text-center ${team1Won ? "text-green-600" : "text-gray-400"}`}>{team1Score}</span>
            ) : hasLiveScore ? (
              <span className="text-2xl font-bold min-w-[2.5rem] text-center text-orange-500 tabular-nums">{rallyLiveScore!.team1}</span>
            ) : showInputs ? (
              <input type="number" inputMode="numeric" value={scores[match.id]?.team1 ?? ""}
                onChange={(e) => setMatchScore(match.id, "team1", e.target.value)}
                className="w-16 text-center border border-border rounded-lg py-1.5 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="-" />
            ) : (
              <span className="text-2xl font-bold min-w-[2.5rem] text-center text-gray-400">-</span>
            )}
          </div>
          <div className="text-center text-sm text-muted font-medium my-1">vs</div>
          <div className={`flex items-center gap-2 p-2 rounded-lg ${team2Won && !isEditing ? "bg-green-50" : ""}`}>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {team2.map((mp) => (
                  <span key={mp.id} className="inline-flex items-center gap-1 text-lg">
                    <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="xs" />
                    <span className={team2Won && !isEditing ? "font-bold" : "font-medium"}>{mp.player.name}</span>
                  </span>
                ))}
              </div>
            </div>
            {isCompleted && !isEditing ? (
              <span className={`text-2xl font-bold min-w-[2.5rem] text-center ${team2Won ? "text-green-600" : "text-gray-400"}`}>{team2Score}</span>
            ) : hasLiveScore ? (
              <span className="text-2xl font-bold min-w-[2.5rem] text-center text-orange-500 tabular-nums">{rallyLiveScore!.team2}</span>
            ) : showInputs ? (
              <input type="number" inputMode="numeric" value={scores[match.id]?.team2 ?? ""}
                onChange={(e) => setMatchScore(match.id, "team2", e.target.value)}
                className="w-16 text-center border border-border rounded-lg py-1.5 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="-" />
            ) : (
              <span className="text-2xl font-bold min-w-[2.5rem] text-center text-gray-400">-</span>
            )}
          </div>
          {showInputs && !isEditing && scores[match.id]?.team1 && scores[match.id]?.team2 && (
            <button onClick={() => submitScore(match.id)}
              className="w-full mt-2 bg-action-dark text-white py-2.5 rounded-lg font-medium text-base transition-colors">Submit Score</button>
          )}
          {isEditing && (
            <div className="flex gap-2 mt-2">
              <button onClick={() => editScore(match.id)} disabled={!scores[match.id]?.team1 || !scores[match.id]?.team2}
                className="flex-1 bg-action-dark text-white py-2 rounded-lg font-medium text-base disabled:opacity-50">Save Edit</button>
              <button onClick={cancelEditMatch}
                className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-base">Cancel</button>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRounds = () => (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {([
          { key: "previous", label: "Previous", count: completedMatches.length },
          { key: "current", label: "Current", count: activeMatches.length },
          { key: "future", label: "Future", count: pendingMatches.length },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setMatchTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              matchTab === t.key ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>
            {t.label} {t.count > 0 && <span className="text-[10px] opacity-70">({t.count})</span>}
          </button>
        ))}
      </div>

      {/* Court availability alert */}
      {freeCourts.length > 0 && matchTab !== "previous" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
          <span className="text-lg">🟢</span>
          <span className="text-sm font-medium text-green-800">
            {freeCourts.length === 1
              ? `Court ${freeCourts[0]} is available!`
              : `Courts ${freeCourts.join(", ")} are available!`}
          </span>
        </div>
      )}

      {/* Current tab — active matches */}
      {matchTab === "current" && (
        <div className="space-y-2">
          {activeMatches.length === 0 ? (
            <p className="text-center py-6 text-muted text-sm">No matches in progress</p>
          ) : (
            activeMatches.sort((a, b) => a.courtNum - b.courtNum).map(renderMatchCard)
          )}
        </div>
      )}

      {/* Previous tab — completed matches */}
      {matchTab === "previous" && (
        <div className="space-y-2">
          {completedMatches.length === 0 ? (
            <p className="text-center py-6 text-muted text-sm">No completed matches yet</p>
          ) : (
            [...completedMatches].sort((a, b) => b.round - a.round || a.courtNum - b.courtNum).map(renderMatchCard)
          )}
        </div>
      )}

      {/* Future tab — actions + pending matches */}
      {matchTab === "future" && (
        <div className="space-y-3">
          {/* Action buttons */}
          {canManage && (
            <div className="space-y-2">
              {event.pairingMode !== "manual" && (
                <>
                  {!isIncremental && (
                    <div className="flex items-center gap-3 mb-2">
                      <label className="text-sm font-medium text-foreground">Rounds:</label>
                      <div className="flex items-center gap-0">
                        <button onClick={() => setNumRounds(Math.max(1, numRounds - 1))}
                          className="w-10 h-10 rounded-l-xl bg-gray-200 text-foreground font-bold text-xl flex items-center justify-center active:bg-gray-300">−</button>
                        <div className="w-10 h-10 bg-selected text-white font-bold text-xl flex items-center justify-center">{numRounds}</div>
                        <button onClick={() => setNumRounds(Math.min(20, numRounds + 1))}
                          className="w-10 h-10 rounded-r-xl bg-gray-200 text-foreground font-bold text-xl flex items-center justify-center active:bg-gray-300">+</button>
                      </div>
                    </div>
                  )}
                  <button onClick={generateMatches}
                    disabled={generating || activePlayers.length < minPlayers}
                    className="w-full bg-action text-white py-3 rounded-xl font-semibold text-base shadow-md active:bg-action-dark transition-colors disabled:opacity-50">
                    {generating ? "Generating..." : isIncremental ? "Generate Next Round" : `Generate ${numRounds} Round${numRounds > 1 ? "s" : ""}`}
                  </button>
                </>
              )}
              <button onClick={() => setActiveSection("manual")}
                className="w-full py-2.5 text-center rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/5 active:bg-primary/10 transition-colors">
                + Add Manual Match
              </button>
            </div>
          )}

          {/* Pending matches */}
          {pendingMatches.length === 0 ? (
            <p className="text-center py-4 text-muted text-sm">No pending matches</p>
          ) : (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">Pending ({pendingMatches.length})</h4>
              {pendingMatches.sort((a, b) => a.round - b.round || a.courtNum - b.courtNum).map(renderMatchCard)}
            </div>
          )}
        </div>
      )}

    </div>
  );

  // ── Section: Add Match Manually ──
  const renderManual = () => (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-lg font-semibold text-foreground">Court</span>
        <button type="button" onClick={() => setManualCourt(manualCourt >= event.numCourts ? 1 : manualCourt + 1)}
          className="w-14 h-14 rounded-xl bg-selected text-white font-bold text-3xl flex items-center justify-center active:opacity-80">{manualCourt}</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-lg font-semibold text-foreground mb-1">Team 1 ({manualTeam1.length})</label>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in").map((ep) => (
              <button key={ep.player.id} type="button" onClick={() => toggleManualPlayer(ep.player.id, 1)}
                className={`w-full text-left text-base py-2 px-2 rounded transition-all ${
                  manualTeam1.includes(ep.player.id) ? "bg-blue-100 text-blue-800 font-medium"
                  : manualTeam2.includes(ep.player.id) ? "opacity-30" : "hover:bg-gray-50"
                }`} disabled={manualTeam2.includes(ep.player.id)}>
                <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" /> {ep.player.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-lg font-semibold text-foreground mb-1">Team 2 ({manualTeam2.length})</label>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {event.players.filter((ep) => ep.status === "registered" || ep.status === "checked_in").map((ep) => (
              <button key={ep.player.id} type="button" onClick={() => toggleManualPlayer(ep.player.id, 2)}
                className={`w-full text-left text-base py-2 px-2 rounded transition-all ${
                  manualTeam2.includes(ep.player.id) ? "bg-red-100 text-red-800 font-medium"
                  : manualTeam1.includes(ep.player.id) ? "opacity-30" : "hover:bg-gray-50"
                }`} disabled={manualTeam1.includes(ep.player.id)}>
                <PlayerAvatar name={ep.player.name} photoUrl={ep.player.photoUrl} size="xs" /> {ep.player.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button onClick={addManualMatch} disabled={manualTeam1.length === 0 || manualTeam2.length === 0}
        className="w-full bg-action text-white py-3 rounded-xl font-semibold text-lg active:bg-action-dark disabled:opacity-50">Create Match</button>
    </div>
  );

  // ── Main render ──
  // When a class is selected in competition, show ClassStepFlow instead of section bar
  if (activeSection === "competition" && selectedClassId && event) {
    const cls = event.classes?.find((c: { id: string }) => c.id === selectedClassId);
    if (cls) {
      return (
        <div className="space-y-2">
          <ClassStepFlow
            eventId={id as string}
            eventName={event.name}
            eventDate={event.date}
            cls={cls as never}
            allClasses={(event.classes || []) as never}
            pairs={event.pairs}
            matches={event.matches}
            eventPlayers={event.players || []}
            canManage={canManage}
            numCourts={event.numCourts}
            onBack={() => { setSelectedClassId(null); fetchEvent(); if (!canManage) setActiveSection("overview"); }}
            onRefresh={fetchEvent}
          />
        </div>
      );
    }
  }

  // Competition mode: Players section without section bar
  if (event.competitionMode && activeSection === "players") {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={() => setActiveSection("overview")} className="text-xs text-action font-medium">← Event</button>
          <span className="text-[10px] text-muted">
            {event.name} · {new Date(event.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </span>
          <span className="w-12" />
        </div>
        {renderPlayers()}
      </div>
    );
  }

  const renderRallyTracker = () => {
    if (!rallyMatchId || !event) return null;
    const match = event.matches?.find((m: Match) => m.id === rallyMatchId);
    if (!match) return null;
    const team1 = match.players.filter((p: MatchPlayer) => p.team === 1).map((p: MatchPlayer) => ({ id: p.player.id, name: p.player.name, photoUrl: p.player.photoUrl }));
    const team2 = match.players.filter((p: MatchPlayer) => p.team === 2).map((p: MatchPlayer) => ({ id: p.player.id, name: p.player.name, photoUrl: p.player.photoUrl }));
    const cls = match.classId ? event.classes?.find((c: { id: string }) => c.id === match.classId) : event.classes?.[0];
    const fmt = match.matchFormat || cls?.scoringFormat || event.scoringFormat || "1x11";
    const wb = cls?.winBy || "2";
    return (
      <RallyTracker
        matchId={match.id}
        matchStatus={match.status}
        visible={rallyVisible}
        team1Players={team1}
        team2Players={team2}
        scoringFormat={fmt}
        winBy={wb}
        onStartMatch={async () => {
          await fetch(`/api/matches/${match.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
          fetchEvent();
        }}
        onSubmitScore={async (t1, t2) => {
          await fetch(`/api/matches/${match.id}/score`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team1Score: t1, team2Score: t2 }),
          });
          setRallyMatchId(null);
          setRallyVisible(false);
          fetchEvent();
        }}
        onScoreChange={(t1, t2) => setRallyLiveScore({ team1: t1, team2: t2 })}
        onClose={() => setRallyVisible(false)}
      />
    );
  };

  if (activeSection !== "overview") {
    return (
      <div className="space-y-2">
        {sectionBar}
        {activeSection === "when" && renderWhen()}
        {activeSection === "scoring" && renderScoring()}
        {activeSection === "pairing" && renderPairing()}
        {activeSection === "admins" && renderAdmins()}
        {activeSection === "players" && renderPlayers()}
        {activeSection === "pairs" && renderPairs()}
        {activeSection === "competition" && event && (
          <div className="space-y-3">
            {/* Ranking — always shown */}
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <p className="text-xs text-muted">Do matches count towards app player rankings?</p>
              <div className="flex gap-2">
                {[
                  { value: "ranked", label: "Ranked" },
                  { value: "approval", label: "Approval" },
                  { value: "none", label: "Unranked" },
                ].map((m) => (
                  <button key={m.value} type="button" onClick={() => { setEditRankingMode(m.value); setHasEdits(true); }}
                    className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                      editRankingMode === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
                    }`}>
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                {editRankingMode === "ranked" && "Scores count towards player ratings immediately."}
                {editRankingMode === "approval" && "Scores need confirmation before affecting ratings."}
                {editRankingMode === "none" && "Scores recorded but don't affect ratings."}
              </p>
            </div>

            {/* Classes — only when competition mode is on */}
            {event.competitionMode && (
              <>
                <ClassesManager
                  eventId={id as string}
                  classes={event.classes || []}
                  canManage={canManage}
                  onRefresh={fetchEvent}
                  onClassSelect={(classId) => setSelectedClassId(classId)}
                />
                <SessionsManager
                  eventId={id as string}
                  sessions={(event as { sessions?: { id: string; name: string; date: string; endDate?: string | null; numCourts: number; status: string; _count?: { matches: number } }[] }).sessions || []}
                  canManage={canManage}
                  onRefresh={fetchEvent}
                />
                <CompetitionResults
                  eventId={id as string}
                  classes={(event.classes || []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))}
                  players={event.players.map((ep) => ({ playerId: ep.player.id, player: { id: ep.player.id, name: ep.player.name, emoji: ep.player.emoji } }))}
                  canManage={canManage}
                />
              </>
            )}
          </div>
        )}
        {activeSection === "rounds" && renderRounds()}
        {activeSection === "manual" && renderManual()}
        {renderRallyTracker()}
      </div>
    );
  }

  const scoringFormatLabel = (v: string) => {
    const labels: Record<string, string> = { "1x7": "1 set to 7", "1x9": "1 set to 9", "1x11": "1 set to 11", "1x15": "1 set to 15", "3x11": "Bo3 to 11", "3x15": "Bo3 to 15", "1xR15": "Rally to 15", "1xR21": "Rally to 21", "3xR15": "Bo3 rally 15", "3xR21": "Bo3 rally 21" };
    return labels[v] || v;
  };
  const pairingLabel = (v: string) =>
    ({ random: "Random", skill_balanced: "Skill Balanced", mixed_gender: "Mixed Gender", skill_mixed_gender: "Skill + Mixed", king_of_court: "King of Court", swiss: "Swiss", manual: "Manual" }[v] || v);
  const rankingLabel = (v: string) =>
    ({ ranked: "Ranked", approval: "Approval", none: "Not counted" }[v] || v);

  const rowClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors w-full";
  const frameClass = "bg-card rounded-xl border border-border overflow-hidden";
  const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";

  const scoringDisplay = scoringFormatLabel(event.scoringFormat || "1x11");

  // Competition mode overview: classes list
  if (event.competitionMode) {
    const classes = event.classes || [];
    const uniquePlayerIds = new Set(event.players.map((ep) => ep.player.id));
    return (
      <div className="space-y-3">
        {eventHeader}
        <SpeakerMode eventId={id as string} userId={userId || ""} userName={session?.user?.name || ""} isManager={canManage} />

        {/* Total players */}
        <div className={frameClass}>
          <button onClick={() => setActiveSection("players")} className={rowClass}>
            <span className="text-sm text-muted">Players</span>
            <span className="text-sm font-medium">{uniquePlayerIds.size} signed up</span>
          </button>
        </div>

        {/* Classes — each as its own card */}
        {classes.map((cls: { id: string; name: string; competitionPhase?: string | null; maxPlayers?: number | null }) => {
          const classPlayers = event.players.filter((ep) => (ep as unknown as { classId?: string }).classId === cls.id);
          const mCount = classPlayers.filter((ep) => ep.player.gender === "M").length;
          const fCount = classPlayers.filter((ep) => ep.player.gender === "F").length;
          const max = cls.maxPlayers;
          const phase = (cls.competitionPhase || "draft") as string;
          const phaseLabel: Record<string, string> = { draft: "Draft", open: "Open", closed: "Closed", groups: "Group", bracket: "Bracket", bracket_upper: "Bracket", bracket_lower: "Bracket", completed: "Done" };
          const phaseStr = phaseLabel[phase] || phase;
          return (
            <button key={cls.id} onClick={() => { fetchEvent(); setActiveSection("competition"); setSelectedClassId(cls.id); }}
              className="w-full bg-card rounded-xl border border-border p-4 active:bg-gray-50 transition-colors text-left">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{cls.name}</span>
                <span className="text-[10px] text-muted font-medium bg-gray-100 px-2 py-0.5 rounded-full">{phaseStr}</span>
              </div>
              <div className="text-xs mt-1">
                {mCount > 0 && <span className="text-blue-500">♂ {mCount}{max ? `/${max}` : ""}</span>}
                {mCount > 0 && fCount > 0 && <span className="text-muted mx-1">·</span>}
                {fCount > 0 && <span className="text-pink-500">♀ {fCount}{max ? `/${max}` : ""}</span>}
                {mCount === 0 && fCount === 0 && <span className="text-muted">No players yet</span>}
              </div>
            </button>
          );
        })}
        {canManage && (
          <button onClick={() => setActiveSection("competition")}
            className="w-full py-2.5 text-xs text-action font-medium rounded-xl border border-action/30 hover:bg-action/5">
            Manage Classes ›
          </button>
        )}

        {/* Ranking */}
        <div className={frameClass}>
          <button onClick={() => { startEditEvent(); setActiveSection("competition"); }} className={rowClass}>
            <span className="text-sm text-muted">Ranking</span>
            <span className="text-sm font-medium">{rankingLabel(event.rankingMode || "ranked")}</span>
          </button>
        </div>

        {(isOwner || isAdmin) && (
          <button onClick={deleteEvent}
            className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors">
            Delete Event
          </button>
        )}
      </div>
    );
  }

  // Non-competition overview
  return (
    <div className="space-y-3">
      {eventHeader}

      {/* Speaker */}
      <SpeakerMode eventId={id as string} userId={userId || ""} userName={session?.user?.name || ""} isManager={canManage} />

      {/* Matches — first for quick access */}
      <div className={frameClass}>
        <button onClick={() => setActiveSection("rounds")} className={rowClass}>
          <span className="text-sm text-muted">Matches</span>
          <span className="text-sm font-medium">
            {event.matches.length === 0
              ? "None"
              : (() => {
                  const completed = event.matches.filter((m) => m.status === "completed").length;
                  const pending = event.matches.filter((m) => m.status === "pending").length;
                  const active = event.matches.filter((m) => m.status === "active").length;
                  const parts = [];
                  if (completed > 0) parts.push(`${completed} played`);
                  if (active > 0) parts.push(`${active} active`);
                  if (pending > 0) parts.push(`${pending} pending`);
                  return parts.join(", ");
                })()}
          </span>
        </button>
      </div>

      {/* Players & Pairs */}
      <div className={frameClass}>
        <button onClick={() => setActiveSection("players")} className={rowClass}>
          <span className="text-sm text-muted">Players</span>
          <span className="text-sm font-medium">
            {activePlayers.length}
            {pausedPlayers.length > 0 ? ` + ${pausedPlayers.length} paused` : ""}
            {waitlistedPlayers.length > 0 ? ` + ${waitlistedPlayers.length} waitlist` : ""}
          </span>
        </button>
        {event.format === "doubles" && event.pairs.length > 0 && (
          <button onClick={() => setActiveSection("pairs")} className={rowClass}>
            <span className="text-sm text-muted">Pairs</span>
            <span className="text-sm font-medium">
              {`${event.pairs.length} pair${event.pairs.length !== 1 ? "s" : ""}`}
            </span>
          </button>
        )}
      </div>

      {/* Scoring & Pairing */}
      <div className={frameClass}>
        <button onClick={() => { startEditEvent(); setActiveSection("scoring"); }} className={rowClass}>
          <span className="text-sm text-muted">Scoring</span>
          <span className="text-sm font-medium capitalize">{event.format} · {scoringDisplay}</span>
        </button>
        <button onClick={() => { startEditEvent(); setActiveSection("pairing"); }} className={rowClass}>
          <span className="text-sm text-muted">Pairing</span>
          <span className="text-sm font-medium">{pairingLabel(event.pairingMode)}</span>
        </button>
      </div>

      {/* Ranking */}
      <div className={frameClass}>
        <button onClick={() => { startEditEvent(); setActiveSection("competition"); }} className={rowClass}>
          <span className="text-sm text-muted">Ranking</span>
          <span className="text-sm font-medium">{rankingLabel(event.rankingMode || "ranked")}</span>
        </button>
      </div>

      {(isOwner || isAdmin) && (
        <button onClick={deleteEvent}
          className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors">
          Delete Event
        </button>
      )}

      {renderRallyTracker()}
    </div>
  );
}
