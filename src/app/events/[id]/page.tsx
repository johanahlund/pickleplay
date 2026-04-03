"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { ClearInput } from "@/components/ClearInput";
import { CompetitionView } from "@/components/CompetitionView";

interface Player {
  id: string;
  name: string;
  emoji: string;
  photoUrl?: string | null;
  rating: number;
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
  numSets: number;
  scoringType: string;
  pairingMode: string;
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
  players: { player: Player; status: string; skillLevel?: number | null }[];
  matches: Match[];
  helpers: EventHelper[];
  pairs: EventPair[];
  classes: EventClassData[];
  club?: { id: string; name: string; emoji: string; locations: ClubLocation[] } | null;
  // Legacy compat — derived from default class
  format: string;
  numSets: number;
  scoringType: string;
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
}: {
  ep: { player: Player; status: string };
  canManage: boolean;
  hasMatches: boolean;
  showContact: boolean;
  onPause: () => void;
  onRemove: () => void;
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
      <PlayerAvatar name={ep.player.name} size="sm" />
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
  const isAdmin = session?.user?.role === "admin";
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [editingEvent, setEditingEvent] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCourts, setEditCourts] = useState(2);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [addPlayerSearch, setAddPlayerSearch] = useState("");
  const [addPlayerGender, setAddPlayerGender] = useState<string | null>(null);
  const [editNumSets, setEditNumSets] = useState(1);
  const [editScoringType, setEditScoringType] = useState("normal_11");
  const [editPairingMode, setEditPairingMode] = useState("random");
  const [resetting, setResetting] = useState(false);
  const [editOpenSignup, setEditOpenSignup] = useState(true);
  const [editVisibility, setEditVisibility] = useState("visible");
  const [showAddMatch, setShowAddMatch] = useState(false);
  const [manualTeam1, setManualTeam1] = useState<string[]>([]);
  const [manualTeam2, setManualTeam2] = useState<string[]>([]);
  const [manualCourt, setManualCourt] = useState(1);
  const [numRounds, setNumRounds] = useState(3);
  const [activeSection, setActiveSection] = useState<"overview" | "when" | "admins" | "courts" | "format" | "players" | "pairs" | "competition" | "rounds" | "manual">("overview");
  const [adminSearch, setAdminSearch] = useState("");
  const [pairMode, setPairMode] = useState<"rating" | "level" | "random">("rating");
  const [pairMixed, setPairMixed] = useState(false);
  const [generatingPairs, setGeneratingPairs] = useState(false);
  const [manualPairSelect, setManualPairSelect] = useState<string | null>(null);
  const [waGroups, setWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [allWaGroups, setAllWaGroups] = useState<{ id: string; name: string }[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [showAddHelper, setShowAddHelper] = useState(false);

  const isOwner = !!(event && userId && event.createdById === userId);
  const isHelper = !!(event && userId && event.helpers?.some((h) => h.playerId === userId));
  const canManage = isAdmin || isOwner || isHelper;

  const fetchEvent = useCallback(async () => {
    const r = await fetch(`/api/events/${id}`);
    if (!r.ok) {
      router.push("/events");
      return;
    }
    const data = await r.json();
    // Derive legacy fields from default class for backwards compat
    const defaultClass = data.classes?.find((c: EventClassData) => c.isDefault) || data.classes?.[0];
    if (defaultClass) {
      data.format = defaultClass.format;
      data.numSets = defaultClass.numSets;
      data.scoringType = defaultClass.scoringType;
      data.pairingMode = defaultClass.pairingMode;
      data.rankingMode = defaultClass.rankingMode;
      data.competitionMode = defaultClass.competitionMode;
      data.competitionConfig = defaultClass.competitionConfig;
      data.competitionPhase = defaultClass.competitionPhase;
    }
    setEvent(data);
    setLoading(false);
  }, [id, router]);

  const fetchWaGroups = useCallback(async () => {
    const [linked, all] = await Promise.all([
      fetch(`/api/events/${id}/whatsapp-groups`).then((r) => r.json()),
      fetch("/api/whatsapp-groups").then((r) => r.json()),
    ]);
    if (Array.isArray(linked)) setWaGroups(linked);
    if (Array.isArray(all)) setAllWaGroups(all);
  }, [id]);

  useEffect(() => {
    fetchEvent();
    fetchWaGroups();
  }, [fetchEvent, fetchWaGroups]);

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
    if (!confirm(`Are you sure you want to remove ${playerName} from this event?`)) return;
    await fetch(`/api/events/${id}/players/${playerId}`, { method: "DELETE" });
    await fetchEvent();
  };

  const startEditEvent = () => {
    if (!event) return;
    setEditName(event.name);
    setEditCourts(event.numCourts);
    setEditDate(toDateInput(event.date));
    setEditTime(toTimeInput(event.date));
    setEditNumSets(event.numSets);
    setEditScoringType(event.scoringType);
    setEditPairingMode(event.pairingMode);
    setEditOpenSignup(event.openSignup);
    setEditVisibility(event.visibility);
    if (event.endDate) {
      setEditEndTime(toTimeInput(event.endDate));
    } else {
      // Default: 2 hours after start
      const end = new Date(event.date);
      end.setHours(end.getHours() + 2);
      setEditEndTime(toTimeInput(end.toISOString()));
    }
    setEditingEvent(true);
  };

  const saveEditEvent = async () => {
    if (!editName.trim()) return;
    const eventDate = new Date(`${editDate}T${editTime}`);
    const eventEndDate = new Date(`${editDate}T${editEndTime}`);
    if (eventEndDate <= eventDate) eventEndDate.setDate(eventEndDate.getDate() + 1);
    await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        numCourts: editCourts,
        date: eventDate.toISOString(),
        endDate: eventEndDate.toISOString(),
        numSets: editNumSets,
        scoringType: editScoringType,
        pairingMode: editPairingMode,
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
    await fetch(`/api/events/${id}/pairs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player1Id, player2Id }),
    });
    setManualPairSelect(null);
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
    await fetch(`/api/events/${id}/players/${playerId}/level`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillLevel }),
    });
    await fetchEvent();
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

  const eventHeader = (
    <div className="bg-card rounded-xl border border-border p-3">
      <div className="flex-1 min-w-0">
        <h2 className="font-bold text-lg truncate">{event.name}</h2>
        <p className="text-xs text-muted">
          {new Date(event.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          {" at "}
          {new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          {event.endDate && ` — ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`}
          {event.status !== "setup" && (
            <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
              event.status === "active" ? "bg-green-100 text-green-700" :
              event.status === "completed" ? "bg-gray-100 text-muted" :
              "bg-blue-100 text-blue-700"
            }`}>{event.status}</span>
          )}
        </p>
        {location && (
          <p className="text-xs text-muted mt-0.5">
            {location.googleMapsUrl ? (
              <a href={location.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                📍 {location.name}
              </a>
            ) : (
              <span>📍 {location.name}</span>
            )}
          </p>
        )}
      </div>
    </div>
  );

  const sectionLabels: Record<string, string> = {
    when: "When",
    admins: "Organizer",
    courts: "Courts",
    format: "Format",
    players: "Players",
    pairs: "Pairs",
    competition: "Competition",
    rounds: "Matches",
    manual: "Add Match",
  };

  const sectionOrder = ["when", "admins", "courts", "format", "players", "pairs", "competition", "rounds", "manual"];

  const sectionBar = (
    <div className="sticky -top-1 z-30 bg-background pb-2 -mx-4 px-4 pt-2 shadow-sm">
      <div className="flex gap-1">
        {sectionOrder
          .filter((s) => {
            if (s === "pairs" && event.format !== "doubles") return false;
            if (s === "competition" && event.format !== "doubles") return false;
            return true;
          })
          .map((s) => (
            <div key={s} className="flex-1 text-center">
              <div className={`h-1 rounded-full transition-all duration-300 ${s === activeSection ? "bg-action" : "bg-gray-200"}`} />
              <span className={`text-[8px] leading-tight mt-0.5 block ${s === activeSection ? "text-action font-semibold" : "text-gray-300"}`}>
                {sectionLabels[s]}
              </span>
            </div>
          ))}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <button onClick={() => setActiveSection("overview")} className="text-xs text-action font-medium active:opacity-70">← Overview</button>
        <span className="text-base font-bold text-foreground">{sectionLabels[activeSection] || activeSection}</span>
        <span className="w-16" />
      </div>
    </div>
  );

  // ── Section: When (name + date/time) ──
  const renderWhen = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Event Name</label>
        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Date</label>
        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">From</label>
          <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-muted mb-1">To</label>
          <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>
      <button onClick={saveEditEvent} className="w-full bg-action-dark text-white py-2 rounded-lg font-medium text-sm">Save</button>
    </div>
  );

  // ── Section: Courts ──
  const renderCourts = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Number of Courts</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" onClick={() => setEditCourts(n)}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all ${editCourts === n ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"}`}>{n}</button>
          ))}
        </div>
      </div>
      <button onClick={saveEditEvent} className="w-full bg-action-dark text-white py-2 rounded-lg font-medium text-sm">Save</button>
    </div>
  );

  // ── Section: Format (matches wizard step 4) ──
  const pairingOptions = [
    { value: "random", icon: "🎲", label: "Random", desc: "Random matchups, everyone plays" },
    { value: "skill_balanced", icon: "📊", label: "Skill", desc: "Similar ratings play each other" },
    { value: "mixed_gender", icon: "👫", label: "Mixed", desc: "Each team has one male + one female" },
    { value: "skill_mixed_gender", icon: "📊👫", label: "Skill + Mix", desc: "Balanced ratings with mixed gender teams" },
    { value: "king_of_court", icon: "👑", label: "King", desc: "Winners move up courts, losers move down" },
    { value: "swiss", icon: "🇨🇭", label: "Swiss", desc: "Teams with similar records play each other" },
    { value: "manual", icon: "✏️", label: "Manual", desc: "Create matches one by one" },
  ];

  const renderFormat = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Format</label>
        <div className="flex gap-2">
          {(["doubles", "singles"] as const).map((f) => (
            <button key={f} type="button" onClick={() => { /* format change not supported after creation */ }}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${event.format === f ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
              {f === "doubles" ? "🤝 Doubles" : "👤 Singles"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Sets</label>
        <div className="flex gap-2">
          {[1, 3].map((n) => (
            <button key={n} type="button" onClick={() => setEditNumSets(n)}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${editNumSets === n ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"}`}>
              {n === 1 ? "1 Set" : "Best of 3"}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Scoring</label>
        <div className="flex gap-2">
          {[
            { value: "normal_11", label: "11" },
            { value: "normal_15", label: "15" },
            { value: "rally_21", label: "R21" },
            { value: "timed", label: "Time" },
          ].map((s) => (
            <button key={s.value} type="button" onClick={() => setEditScoringType(s.value)}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${editScoringType === s.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Pairing</label>
        <div className="flex gap-1.5">
          {pairingOptions.map((m) => (
            <button key={m.value} type="button" onClick={() => setEditPairingMode(m.value)}
              className={`flex-1 py-2 rounded-lg text-center transition-all ${
                editPairingMode === m.value ? "bg-selected text-white ring-1 ring-selected/50" : "bg-gray-100 hover:bg-gray-200"
              }`} title={m.label}>
              <span className="text-lg">{m.icon}</span>
            </button>
          ))}
        </div>
        {(() => {
          const sel = pairingOptions.find((m) => m.value === editPairingMode);
          return sel ? (
            <div className="mt-1.5">
              <span className="text-sm font-medium">{sel.label}</span>
              <span className="text-xs text-muted ml-1.5">{sel.desc}</span>
            </div>
          ) : null;
        })()}
      </div>
      <div>
        <label className="block text-sm font-medium text-muted mb-1">Rankings</label>
        <div className="flex gap-2">
          {[
            { value: "ranked", label: "Ranked" },
            { value: "approval", label: "Approval" },
            { value: "none", label: "Unranked" },
          ].map((m) => (
            <button key={m.value} type="button" onClick={() => { /* rankingMode edit — save via editPairingMode for now */ }}
              className={`flex-1 py-2.5 rounded-lg font-medium transition-all text-sm ${
                (event.rankingMode || "ranked") === m.value ? "bg-selected text-white" : "bg-gray-100 text-foreground hover:bg-gray-200"
              }`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted mt-1.5">
          {(event.rankingMode || "ranked") === "ranked" && "Scores count towards player ratings immediately after each match."}
          {event.rankingMode === "approval" && "Scores are recorded but need confirmation before affecting ratings."}
          {event.rankingMode === "none" && "Scores are recorded for the event but don't affect player ratings."}
        </p>
      </div>
      <button onClick={saveEditEvent} className="w-full bg-action-dark text-white py-2 rounded-lg font-medium text-sm">Save</button>
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
              <PlayerAvatar name={owner.name} size="sm" />
              <span className="text-lg font-medium">{owner.name}</span>
              <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium ml-auto">Owner</span>
            </div>
          </div>
        )}

        {/* Current helpers */}
        <div>
          <h4 className="text-sm font-medium text-muted mb-1">Helpers ({event.helpers.length})</h4>
          {event.helpers.length > 0 ? (
            <div className="space-y-1">
              {event.helpers.map((h) => (
                <div key={h.playerId} className="flex items-center gap-2 rounded-lg px-3 py-2">
                  <PlayerAvatar name={h.player.name} size="sm" />
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
    const unpaired = event.players
      .filter((ep) => (ep.status === "registered" || ep.status === "checked_in") && !pairedPlayerIds.has(ep.player.id))
      .sort((a, b) => a.player.name.localeCompare(b.player.name));

    return (
      <div className="space-y-4">
        {/* Current pairs */}
        {event.pairs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Pairs ({event.pairs.length})</h3>
              {canManage && (
                <button onClick={clearAllPairs} className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50">Clear All</button>
              )}
            </div>
            {event.pairs.map((pair) => (
              <div key={pair.id} className="flex items-center gap-2 bg-card rounded-xl border border-border p-3">
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="text-lg">{pair.player1.emoji}</span>
                  <span className="text-sm font-medium">{pair.player1.name}</span>
                  {pair.player1.gender && <span className={`text-xs ${pair.player1.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{pair.player1.gender === "M" ? "\u2642" : "\u2640"}</span>}
                </div>
                <span className="text-xs text-muted font-medium">+</span>
                <div className="flex-1 flex items-center gap-1.5">
                  <span className="text-lg">{pair.player2.emoji}</span>
                  <span className="text-sm font-medium">{pair.player2.name}</span>
                  {pair.player2.gender && <span className={`text-xs ${pair.player2.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{pair.player2.gender === "M" ? "\u2642" : "\u2640"}</span>}
                </div>
                <span className="text-xs text-muted">{Math.round(pair.player1.rating + pair.player2.rating)}</span>
                {canManage && (
                  <button onClick={() => removePair(pair.id)} className="text-xs text-danger px-1.5 py-1 rounded hover:bg-red-50">✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Unpaired players */}
        {unpaired.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted">Unpaired ({unpaired.length})</h4>
            {canManage && (
              <div className="space-y-1">
                {unpaired.map((ep) => (
                  <button key={ep.player.id}
                    onClick={() => {
                      if (manualPairSelect === ep.player.id) {
                        setManualPairSelect(null);
                      } else if (manualPairSelect) {
                        createManualPair(manualPairSelect, ep.player.id);
                      } else {
                        setManualPairSelect(ep.player.id);
                      }
                    }}
                    className={`w-full text-left py-2.5 px-3 rounded-lg flex items-center gap-2 transition-colors ${
                      manualPairSelect === ep.player.id
                        ? "bg-selected/10 border border-selected/30 ring-1 ring-selected/20"
                        : manualPairSelect
                          ? "hover:bg-green-50 active:bg-green-100 border border-transparent"
                          : "hover:bg-gray-50 active:bg-gray-100 border border-transparent"
                    }`}>
                    <span className="text-2xl">{ep.player.emoji}</span>
                    <span className="text-base font-medium flex-1">{ep.player.name}</span>
                    {ep.player.gender && <span className={`text-xs ${ep.player.gender === "M" ? "text-blue-500" : "text-pink-500"}`}>{ep.player.gender === "M" ? "\u2642" : "\u2640"}</span>}
                    <span className="text-xs text-muted">{Math.round(ep.player.rating)}</span>
                    {manualPairSelect && manualPairSelect !== ep.player.id && (
                      <span className="text-xs text-green-600 font-medium">Tap to pair</span>
                    )}
                    {manualPairSelect === ep.player.id && (
                      <span className="text-xs text-selected font-medium">Selected</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!canManage && (
              <div className="space-y-1">
                {unpaired.map((ep) => (
                  <div key={ep.player.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-2xl">{ep.player.emoji}</span>
                    <span className="text-base font-medium">{ep.player.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Auto-generate controls */}
        {canManage && unpaired.length >= 2 && (
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h4 className="text-sm font-semibold">Auto-generate pairs</h4>
            <div>
              <label className="block text-xs text-muted mb-1">Balance by</label>
              <div className="flex gap-2">
                {([["rating", "Rating"], ["level", "Skill Level"], ["random", "Random"]] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setPairMode(val)}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${pairMode === val ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pairMixed} onChange={(e) => setPairMixed(e.target.checked)}
                className="rounded border-border" />
              Prefer mixed gender (M + F)
            </label>
            {pairMode === "level" && (
              <div className="space-y-1">
                <p className="text-xs text-muted">Assign skill levels first:</p>
                {unpaired.map((ep) => {
                  const currentLevel = event.players.find((p) => p.player.id === ep.player.id)?.skillLevel;
                  return (
                    <div key={ep.player.id} className="flex items-center gap-2 py-1">
                      <span className="text-sm flex-1">{ep.player.emoji} {ep.player.name}</span>
                      {[1, 2, 3].map((lvl) => (
                        <button key={lvl} onClick={() => setSkillLevel(ep.player.id, currentLevel === lvl ? null : lvl)}
                          className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                            currentLevel === lvl ? "bg-selected text-white" : "bg-gray-100 text-foreground"
                          }`}>{lvl}</button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={generatePairsAuto} disabled={generatingPairs || unpaired.length < 2}
              className="w-full bg-action text-white py-2.5 rounded-xl font-semibold text-base active:bg-action-dark disabled:opacity-50">
              {generatingPairs ? "Generating..." : event.pairs.length > 0 ? "Regenerate All Pairs" : "Generate Pairs"}
            </button>
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

  const renderPlayers = () => {
    if (showAddPlayer && canManage) return renderAddPlayers();

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-foreground">
            Players ({activePlayers.length}{pausedPlayers.length > 0 ? ` + ${pausedPlayers.length} paused` : ""}{waitlistedPlayers.length > 0 ? ` + ${waitlistedPlayers.length} waitlist` : ""})
          </h3>
          {canManage && (
            <button onClick={() => { setShowAddPlayer(true); fetchAllPlayers(); }}
              className="text-lg text-primary font-semibold px-4 py-2 rounded-lg hover:bg-primary/10 transition-colors">
              + Add
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
              onPause={() => togglePausePlayer(ep.player.id)} onRemove={() => removePlayer(ep.player.id, ep.player.name)} />
          ))}
        </div>
      </div>
    );
  };

  // ── Section: Rounds ──
  const renderRounds = () => (
    <div className="space-y-4">
      {/* Generate / Regenerate */}
      {((!hasMatches && canManage && event.pairingMode !== "manual") || (allCompleted && canManage && event.pairingMode !== "manual")) && (
        <div className="space-y-3">
          {!isIncremental && (
            <div className="flex items-center gap-3">
              <label className="text-lg font-medium text-foreground">Rounds:</label>
              <div className="flex items-center gap-0">
                <button onClick={() => setNumRounds(Math.max(1, numRounds - 1))}
                  className="w-14 h-14 rounded-l-xl bg-gray-200 text-foreground font-bold text-3xl flex items-center justify-center active:bg-gray-300">−</button>
                <div className="w-14 h-14 bg-selected text-white font-bold text-3xl flex items-center justify-center">{numRounds}</div>
                <button onClick={() => setNumRounds(Math.min(20, numRounds + 1))}
                  className="w-14 h-14 rounded-r-xl bg-gray-200 text-foreground font-bold text-3xl flex items-center justify-center active:bg-gray-300">+</button>
              </div>
            </div>
          )}
          <button onClick={generateMatches}
            disabled={generating || (!allCompleted && activePlayers.length < minPlayers)}
            className="w-full bg-action text-white py-3.5 rounded-xl font-semibold text-xl shadow-md active:bg-action-dark transition-colors disabled:opacity-50">
            {generating ? "Generating..." : hasMatches
              ? "🔄 Generate Next Rounds"
              : `🎲 Generate ${isIncremental ? "Next Round" : `${numRounds} Round${numRounds > 1 ? "s" : ""}`}`}
          </button>
        </div>
      )}

      {/* Match cards by round */}
      {rounds.map((round) => (
        <div key={round} className="space-y-2">
          <h3 className="text-base font-semibold text-muted uppercase tracking-wider">Round {round}</h3>
          {matchesByRound[round].sort((a, b) => a.courtNum - b.courtNum).map((match) => {
            const team1 = match.players.filter((p) => p.team === 1);
            const team2 = match.players.filter((p) => p.team === 2);
            const isCompleted = match.status === "completed";
            const isEditing = editingMatchId === match.id;
            const team1Score = isCompleted ? team1[0]?.score ?? 0 : null;
            const team2Score = isCompleted ? team2[0]?.score ?? 0 : null;
            const team1Won = team1Score !== null && team2Score !== null && team1Score > team2Score;
            const team2Won = team1Score !== null && team2Score !== null && team2Score > team1Score;
            const isMatchPlayer = session?.user ? [...team1, ...team2].some((mp) => mp.playerId === (session.user as { id: string }).id) : false;
            const canScore = canManage || isMatchPlayer;
            const showInputs = canScore && (!isCompleted || isEditing);

            const isNextMatch = nextMatchIdSet.has(match.id);
            const isCourtFree = courtFreeMatchIds.has(match.id);

            return (
              <div key={match.id} className={`bg-card rounded-xl border overflow-hidden transition-all ${
                isCourtFree && !isCompleted
                  ? "border-green-400 ring-2 ring-green-300/50 shadow-md shadow-green-100"
                  : isNextMatch && !isCompleted
                    ? "border-blue-300 ring-1 ring-blue-200/50"
                    : "border-border"
              }`}>
                <div className={`px-3 py-2 border-b flex items-center justify-between ${
                  isCourtFree && !isCompleted
                    ? "bg-green-50 border-green-200"
                    : isNextMatch && !isCompleted
                      ? "bg-blue-50 border-blue-200"
                      : "bg-gray-50 border-border"
                }`}>
                  <span className={`text-sm font-medium ${
                    isCourtFree && !isCompleted ? "text-green-700" : isNextMatch && !isCompleted ? "text-blue-600" : "text-muted"
                  }`}>
                    Court {match.courtNum}
                    {isCourtFree && !isCompleted && " — Ready!"}
                    {isNextMatch && !isCourtFree && !isCompleted && " — Up next"}
                    {event.pairingMode === "king_of_court" && match.courtNum === 1 && <span className="ml-1 text-amber-500">👑</span>}
                    {event.pairingMode === "king_of_court" && match.courtNum === event.numCourts && event.numCourts > 1 && <span className="ml-1 text-gray-400">🔰</span>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => speakMatch(match, event)}
                      className="text-2xl px-1 py-0.5 rounded hover:bg-primary/10 transition-colors" title="Announce match">🔊</button>
                    {isCompleted && !isEditing && <span className="text-sm text-green-600 font-medium">✓ Final</span>}
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
                            <PlayerAvatar name={mp.player.name} size="xs" />
                            <span className={team1Won && !isEditing ? "font-bold" : "font-medium"}>{mp.player.name}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    {isCompleted && !isEditing ? (
                      <span className={`text-2xl font-bold min-w-[2.5rem] text-center ${team1Won ? "text-green-600" : "text-gray-400"}`}>{team1Score}</span>
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
                            <PlayerAvatar name={mp.player.name} size="xs" />
                            <span className={team2Won && !isEditing ? "font-bold" : "font-medium"}>{mp.player.name}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    {isCompleted && !isEditing ? (
                      <span className={`text-2xl font-bold min-w-[2.5rem] text-center ${team2Won ? "text-green-600" : "text-gray-400"}`}>{team2Score}</span>
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
          })}
        </div>
      ))}
      {!hasMatches && (
        <div className="text-center py-8 text-muted text-lg">No matches yet</div>
      )}

      {/* Add match actions */}
      {canManage && (
        <div className="space-y-2 pt-2">
          <button
            onClick={() => setActiveSection("manual")}
            className="w-full py-3 text-center rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/5 active:bg-primary/10 transition-colors"
          >
            + Add Individual Match
          </button>
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
                <PlayerAvatar name={ep.player.name} size="xs" /> {ep.player.name}
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
                <PlayerAvatar name={ep.player.name} size="xs" /> {ep.player.name}
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
  if (activeSection !== "overview") {
    return (
      <div className="space-y-2">
        {sectionBar}
        {activeSection === "when" && renderWhen()}
        {activeSection === "courts" && renderCourts()}
        {activeSection === "format" && renderFormat()}
        {activeSection === "admins" && renderAdmins()}
        {activeSection === "players" && renderPlayers()}
        {activeSection === "pairs" && renderPairs()}
        {activeSection === "competition" && event && (
          <CompetitionView
            eventId={id as string}
            pairs={event.pairs}
            matches={event.matches as never}
            competitionMode={event.competitionMode ?? null}
            competitionConfig={event.competitionConfig as never}
            competitionPhase={event.competitionPhase ?? null}
            canManage={canManage}
            numCourts={event.numCourts}
            onRefresh={fetchEvent}
          />
        )}
        {activeSection === "rounds" && renderRounds()}
        {activeSection === "manual" && renderManual()}
      </div>
    );
  }

  const scoringLabel = (v: string) =>
    ({ normal_11: "To 11", normal_15: "To 15", rally_21: "Rally 21", timed: "Timed" }[v] || v);
  const pairingLabel = (v: string) =>
    ({ random: "Random", skill_balanced: "Skill Balanced", mixed_gender: "Mixed Gender", skill_mixed_gender: "Skill + Mixed", king_of_court: "King of Court", swiss: "Swiss", manual: "Manual" }[v] || v);
  const rankingLabel = (v: string) =>
    ({ ranked: "Ranked", approval: "Approval", none: "Not counted" }[v] || v);

  const rowClass = "flex justify-between items-center py-2.5 px-3 border-b border-border last:border-b-0 hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors w-full";
  const frameClass = "bg-card rounded-xl border border-border overflow-hidden";
  const frameTitleClass = "text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium";

  const ownerName = event.createdBy?.name;
  const helperNames = event.helpers.map((h) => h.player.name);

  const scoringDisplay = `${event.numSets === 1 ? "1 set" : "Best of 3"} ${scoringLabel(event.scoringType).toLowerCase()}`;

  // Show club only when not in club context (i.e., opened from "My Events")
  const hasClubContext = typeof window !== "undefined" && !!sessionStorage.getItem("activeClubId");
  const showClub = event.club && !hasClubContext;

  const whenDisplay = `${new Date(event.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}${event.endDate ? ` – ${new Date(event.endDate).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}`;

  return (
    <div className="space-y-3">
      {eventHeader}

      {/* Organizer & Courts */}
      <div className={frameClass}>
        {showClub && (
          <div className={rowClass}>
            <span className="text-sm text-muted">Club</span>
            <span className="text-sm font-medium">{event.club!.emoji} {event.club!.name}</span>
          </div>
        )}
        <button onClick={() => { startEditEvent(); setActiveSection("when"); }} className={rowClass}>
          <span className="text-sm text-muted">When</span>
          <span className="text-sm font-medium">{whenDisplay}</span>
        </button>
        <button onClick={() => { fetchAllPlayers(); setAdminSearch(""); setActiveSection("admins"); }} className={rowClass}>
          <span className="text-sm text-muted">Organizer</span>
          <span className="text-sm font-medium text-right ml-4 truncate">
            <span>{ownerName || "—"}</span>
            {helperNames.length > 0 && (
              <span className="block text-xs text-muted">({helperNames.join(", ")})</span>
            )}
          </span>
        </button>
        <button onClick={() => { startEditEvent(); setActiveSection("courts"); }} className={rowClass}>
          <span className="text-sm text-muted">Courts</span>
          <span className="text-sm font-medium">{event.numCourts}</span>
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
        {event.format === "doubles" && (
          <button onClick={() => setActiveSection("pairs")} className={rowClass}>
            <span className="text-sm text-muted">Pairs</span>
            <span className="text-sm font-medium">
              {event.pairs.length === 0
                ? "Not set"
                : `${event.pairs.length} pair${event.pairs.length !== 1 ? "s" : ""}`}
            </span>
          </button>
        )}
        {/* Competition */}
        {event.format === "doubles" && (
          <button onClick={() => setActiveSection("competition")} className={rowClass}>
            <span className="text-sm text-muted">Competition</span>
            <span className="text-sm font-medium">
              {!event.competitionMode
                ? "Not enabled"
                : event.competitionPhase === "groups"
                  ? "Group Stage"
                  : event.competitionPhase?.startsWith("bracket")
                    ? "Bracket Stage"
                    : event.competitionPhase === "completed"
                      ? "Completed"
                      : "Setup"}
            </span>
          </button>
        )}
      </div>

      {/* Default Format */}
      <div className={frameClass}>
        <p className={frameTitleClass}>Default Format</p>
        <button onClick={() => { startEditEvent(); setActiveSection("format"); }} className={rowClass}>
          <span className="text-sm text-muted">Format</span>
          <span className="text-sm font-medium capitalize">{event.format}</span>
        </button>
        <button onClick={() => { startEditEvent(); setActiveSection("format"); }} className={rowClass}>
          <span className="text-sm text-muted">Scoring</span>
          <span className="text-sm font-medium">{scoringDisplay}</span>
        </button>
        <button onClick={() => { startEditEvent(); setActiveSection("format"); }} className={rowClass}>
          <span className="text-sm text-muted">Pairing</span>
          <span className="text-sm font-medium">{pairingLabel(event.pairingMode)}</span>
        </button>
        <button onClick={() => { startEditEvent(); setActiveSection("format"); }} className={rowClass}>
          <span className="text-sm text-muted">Rankings</span>
          <span className="text-sm font-medium">{rankingLabel(event.rankingMode || "ranked")}</span>
        </button>
      </div>

      {/* Matches */}
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

      {(isOwner || isAdmin) && (
        <button
          onClick={deleteEvent}
          className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors"
        >
          Delete Event
        </button>
      )}
    </div>
  );
}
