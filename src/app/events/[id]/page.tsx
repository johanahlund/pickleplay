"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  role?: string;
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

interface Event {
  id: string;
  name: string;
  date: string;
  status: string;
  numCourts: number;
  format: string;
  numSets: number;
  scoringType: string;
  pairingMode: string;
  players: { player: Player; checkedIn: boolean }[];
  matches: Match[];
}

function toDateInput(iso: string) {
  return new Date(iso).toISOString().split("T")[0];
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";

  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [editingEvent, setEditingEvent] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCourts, setEditCourts] = useState(2);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [managingPlayers, setManagingPlayers] = useState(false);
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [editNumSets, setEditNumSets] = useState(1);
  const [editScoringType, setEditScoringType] = useState("normal_11");
  const [editPairingMode, setEditPairingMode] = useState("random");
  const [resetting, setResetting] = useState(false);
  const [showAddMatch, setShowAddMatch] = useState(false);
  const [manualTeam1, setManualTeam1] = useState<string[]>([]);
  const [manualTeam2, setManualTeam2] = useState<string[]>([]);
  const [manualCourt, setManualCourt] = useState(1);

  const fetchEvent = useCallback(async () => {
    const r = await fetch(`/api/events/${id}`);
    if (!r.ok) {
      router.push("/events");
      return;
    }
    const data = await r.json();
    setEvent(data);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const generateMatches = async () => {
    setGenerating(true);
    await fetch(`/api/events/${id}/generate`, { method: "POST" });
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
    setEditingEvent(true);
  };

  const saveEditEvent = async () => {
    if (!editName.trim()) return;
    const eventDate = new Date(`${editDate}T${editTime}`);
    await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        numCourts: editCourts,
        date: eventDate.toISOString(),
        numSets: editNumSets,
        scoringType: editScoringType,
        pairingMode: editPairingMode,
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
    if (team === 1) {
      setManualTeam1((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
      );
      // Remove from other team
      setManualTeam2((prev) => prev.filter((id) => id !== playerId));
    } else {
      setManualTeam2((prev) =>
        prev.includes(playerId) ? prev.filter((id) => id !== playerId) : [...prev, playerId]
      );
      setManualTeam1((prev) => prev.filter((id) => id !== playerId));
    }
  };

  if (loading || !event) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
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

  return (
    <div className="space-y-4">
      {/* Header */}
      {editingEvent ? (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Event Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoFocus
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-muted mb-1">Date</label>
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-muted mb-1">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={(e) => setEditTime(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Courts</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setEditCourts(n)}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${
                    editCourts === n
                      ? "bg-primary text-white"
                      : "bg-gray-100 text-foreground"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Sets</label>
            <div className="flex gap-2">
              {[1, 3].map((n) => (
                <button key={n} type="button" onClick={() => setEditNumSets(n)}
                  className={`flex-1 py-2 rounded-lg font-medium transition-all ${editNumSets === n ? "bg-primary text-white" : "bg-gray-100 text-foreground"}`}>
                  {n === 1 ? "1 Set" : "Best of 3"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Scoring</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "normal_11", label: "11" },
                { value: "normal_15", label: "15" },
                { value: "rally_21", label: "R21" },
                { value: "timed", label: "Time" },
              ].map((s) => (
                <button key={s.value} type="button" onClick={() => setEditScoringType(s.value)}
                  className={`py-2 rounded-lg font-medium transition-all text-sm ${editScoringType === s.value ? "bg-primary text-white" : "bg-gray-100 text-foreground"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted mb-1">Pairing</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "random", label: "🎲 Random" },
                { value: "skill_balanced", label: "📊 Skill" },
                { value: "mixed_gender", label: "👫 Mixed" },
                { value: "skill_mixed_gender", label: "📊👫 Skill+Mix" },
                { value: "king_of_court", label: "👑 King" },
                { value: "swiss", label: "🏆 Swiss" },
                { value: "manual", label: "✏️ Manual" },
              ].map((m) => (
                <button key={m.value} type="button" onClick={() => setEditPairingMode(m.value)}
                  className={`py-2 rounded-lg font-medium transition-all text-sm ${editPairingMode === m.value ? "bg-primary text-white" : "bg-gray-100 text-foreground"}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveEditEvent}
              className="flex-1 bg-primary text-white py-2 rounded-lg font-medium text-sm"
            >
              Save
            </button>
            <button
              onClick={() => setEditingEvent(false)}
              className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">{event.name}</h2>
            <p className="text-sm text-muted">
              {new Date(event.date).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              at{" "}
              {new Date(event.date).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              &middot; {event.numCourts} court
              {event.numCourts !== 1 ? "s" : ""} &middot; {event.format}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {event.numSets === 1 ? "1 set" : `Best of ${event.numSets}`} &middot;{" "}
              {event.scoringType === "normal_11" ? "11" : event.scoringType === "normal_15" ? "15" : event.scoringType === "rally_21" ? "R21" : "Time"} &middot;{" "}
              {event.pairingMode === "random" ? "Random" : event.pairingMode === "skill_balanced" ? "Skill Balanced" : event.pairingMode === "mixed_gender" ? "Mixed Gender" : event.pairingMode === "skill_mixed_gender" ? "Skill+Mixed" : event.pairingMode === "king_of_court" ? "King of Court" : event.pairingMode === "manual" ? "Manual" : "Swiss"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                onClick={startEditEvent}
                className="text-xs text-muted px-2 py-1 rounded hover:bg-gray-100"
              >
                Edit
              </button>
            )}
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                event.status === "active"
                  ? "bg-green-100 text-green-700"
                  : event.status === "completed"
                  ? "bg-gray-100 text-gray-600"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              {event.status}
            </span>
          </div>
        </div>
      )}

      {/* Players */}
      <div className="bg-card rounded-xl border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-muted">
            Players ({event.players.length})
          </h3>
          {!hasMatches && isAdmin && (
            <button
              onClick={() => setManagingPlayers(!managingPlayers)}
              className="text-xs text-primary font-medium"
            >
              {managingPlayers ? "Done" : "Manage"}
            </button>
          )}
        </div>
        {session?.user && !isAdmin && (
          <div className="mb-2">
            {event.players.some((ep) => ep.player.id === (session.user as { id: string }).id) ? (
              <button
                onClick={unsignFromEvent}
                className="text-xs text-danger px-2 py-1 rounded hover:bg-red-50"
              >
                Leave Event
              </button>
            ) : (
              <button
                onClick={signupForEvent}
                className="text-xs bg-primary text-white px-3 py-1 rounded-lg font-medium"
              >
                Join Event
              </button>
            )}
          </div>
        )}
        {event.players.length > 6 && (
          <input
            type="text"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
            placeholder="Search players..."
            className="w-full border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/50 text-sm mb-2"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {event.players
            .filter((ep) => ep.player.name.toLowerCase().includes(playerSearch.toLowerCase()))
            .map((ep) => (
            <span
              key={ep.player.id}
              className="inline-flex items-center gap-1 bg-gray-50 rounded-full px-2.5 py-1 text-sm"
            >
              <span>{ep.player.emoji}</span>
              <span>{ep.player.name}</span>
              {ep.player.role === "admin" && (
                <span className="text-[9px] bg-purple-100 text-purple-700 px-1 py-0 rounded-full font-medium">
                  Admin
                </span>
              )}
              {managingPlayers && !hasMatches && isAdmin && (
                <button
                  onClick={() => removePlayer(ep.player.id, ep.player.name)}
                  className="ml-0.5 text-danger hover:bg-red-100 rounded-full w-4 h-4 flex items-center justify-center text-xs"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
        {managingPlayers && isAdmin && (
          <div className="mt-2 pt-2 border-t border-border">
            <button
              onClick={() => { setShowAddPlayer(!showAddPlayer); if (!showAddPlayer) fetchAllPlayers(); }}
              className="text-xs text-primary font-medium"
            >
              {showAddPlayer ? "Close" : "+ Add Player"}
            </button>
            {showAddPlayer && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {allPlayers
                  .filter((p) => !event.players.some((ep) => ep.player.id === p.id))
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addPlayerToEvent(p.id)}
                      className="w-full text-left text-xs py-1.5 px-2 rounded hover:bg-gray-50 flex items-center gap-1.5"
                    >
                      <span>{p.emoji}</span>
                      <span>{p.name}</span>
                      <span className="text-muted ml-auto">{Math.round(p.rating)}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Generate button */}
      {!hasMatches && isAdmin && event.pairingMode !== "manual" && (
        <button
          onClick={generateMatches}
          disabled={generating || event.players.length < minPlayers}
          className="w-full bg-primary text-white py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "🎲 Generate Matches"}
        </button>
      )}

      {/* Regenerate button if all matches are done */}
      {allCompleted && isAdmin && event.pairingMode !== "manual" && (
        <button
          onClick={generateMatches}
          disabled={generating}
          className="w-full bg-accent text-foreground py-3 rounded-xl font-semibold shadow-md active:opacity-80 transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "🔄 Generate Next Rounds"}
        </button>
      )}

      {isAdmin && (
        <div>
          <button
            onClick={() => setShowAddMatch(!showAddMatch)}
            className="w-full bg-card text-foreground border border-border py-2.5 rounded-xl font-medium text-sm active:bg-gray-50 transition-colors"
          >
            {showAddMatch ? "Cancel" : "➕ Add Match Manually"}
          </button>
          {showAddMatch && event && (
            <div className="mt-2 bg-card rounded-xl border border-border p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-muted mb-1">Court</label>
                <div className="flex gap-2">
                  {Array.from({ length: event.numCourts }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setManualCourt(n)}
                      className={`flex-1 py-1.5 rounded-lg font-medium text-sm transition-all ${
                        manualCourt === n ? "bg-primary text-white" : "bg-gray-100 text-foreground"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Team 1 ({manualTeam1.length})
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {event.players.map((ep) => (
                      <button
                        key={ep.player.id}
                        type="button"
                        onClick={() => toggleManualPlayer(ep.player.id, 1)}
                        className={`w-full text-left text-xs py-1.5 px-2 rounded transition-all ${
                          manualTeam1.includes(ep.player.id)
                            ? "bg-blue-100 text-blue-800 font-medium"
                            : manualTeam2.includes(ep.player.id)
                            ? "opacity-30"
                            : "hover:bg-gray-50"
                        }`}
                        disabled={manualTeam2.includes(ep.player.id)}
                      >
                        {ep.player.emoji} {ep.player.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">
                    Team 2 ({manualTeam2.length})
                  </label>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {event.players.map((ep) => (
                      <button
                        key={ep.player.id}
                        type="button"
                        onClick={() => toggleManualPlayer(ep.player.id, 2)}
                        className={`w-full text-left text-xs py-1.5 px-2 rounded transition-all ${
                          manualTeam2.includes(ep.player.id)
                            ? "bg-red-100 text-red-800 font-medium"
                            : manualTeam1.includes(ep.player.id)
                            ? "opacity-30"
                            : "hover:bg-gray-50"
                        }`}
                        disabled={manualTeam1.includes(ep.player.id)}
                      >
                        {ep.player.emoji} {ep.player.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={addManualMatch}
                disabled={manualTeam1.length === 0 || manualTeam2.length === 0}
                className="w-full bg-primary text-white py-2 rounded-lg font-medium text-sm disabled:opacity-50"
              >
                Create Match
              </button>
            </div>
          )}
        </div>
      )}

      {hasMatches && isAdmin && (
        <button
          onClick={resetEvent}
          disabled={resetting}
          className="w-full bg-red-50 text-danger border border-red-200 py-2.5 rounded-xl font-medium text-sm active:bg-red-100 transition-colors disabled:opacity-50"
        >
          {resetting ? "Resetting..." : "🗑️ Reset Event (Delete All Matches)"}
        </button>
      )}

      {/* Matches by round */}
      {rounds.map((round) => (
        <div key={round} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted uppercase tracking-wider">
            Round {round}
          </h3>
          {matchesByRound[round]
            .sort((a, b) => a.courtNum - b.courtNum)
            .map((match) => {
              const team1 = match.players.filter((p) => p.team === 1);
              const team2 = match.players.filter((p) => p.team === 2);
              const isCompleted = match.status === "completed";
              const isEditing = editingMatchId === match.id;
              const team1Score = isCompleted ? team1[0]?.score ?? 0 : null;
              const team2Score = isCompleted ? team2[0]?.score ?? 0 : null;
              const team1Won = team1Score !== null && team2Score !== null && team1Score > team2Score;
              const team2Won = team1Score !== null && team2Score !== null && team2Score > team1Score;
              const isMatchPlayer = session?.user ? [...team1, ...team2].some((mp) => mp.playerId === (session.user as { id: string }).id) : false;
              const canScore = isAdmin || isMatchPlayer;
              const showInputs = canScore && (!isCompleted || isEditing);

              return (
                <div
                  key={match.id}
                  className="bg-card rounded-xl border border-border overflow-hidden"
                >
                  <div className="px-3 py-1.5 bg-gray-50 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">
                      Court {match.courtNum}
                      {event.pairingMode === "king_of_court" && match.courtNum === 1 && (
                        <span className="ml-1 text-amber-500">👑</span>
                      )}
                      {event.pairingMode === "king_of_court" && match.courtNum === event.numCourts && event.numCourts > 1 && (
                        <span className="ml-1 text-gray-400">🔰</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {isCompleted && !isEditing && (
                        <span className="text-xs text-green-600 font-medium">
                          ✓ Final
                        </span>
                      )}
                      {isCompleted && isAdmin && !isEditing && (
                        <button
                          onClick={() => startEditMatch(match.id, team1Score!, team2Score!)}
                          className="text-xs text-muted px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors"
                        >
                          Edit
                        </button>
                      )}
                      {isEditing && (
                        <span className="text-xs text-amber-600 font-medium">
                          Editing...
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          onClick={() => deleteMatch(match.id)}
                          className="text-xs text-danger px-1.5 py-0.5 rounded hover:bg-red-100 transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="p-3">
                    {/* Team 1 */}
                    <div
                      className={`flex items-center gap-2 p-2 rounded-lg ${
                        team1Won && !isEditing ? "bg-green-50" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          {team1.map((mp) => (
                            <span key={mp.id} className="inline-flex items-center gap-0.5 text-sm">
                              <span>{mp.player.emoji}</span>
                              <span className={team1Won && !isEditing ? "font-semibold" : ""}>{mp.player.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {isCompleted && !isEditing ? (
                        <span
                          className={`text-xl font-bold min-w-[2rem] text-center ${
                            team1Won ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {team1Score}
                        </span>
                      ) : showInputs ? (
                        <input
                          type="number"
                          inputMode="numeric"
                          value={scores[match.id]?.team1 ?? ""}
                          onChange={(e) =>
                            setMatchScore(match.id, "team1", e.target.value)
                          }
                          className="w-14 text-center border border-border rounded-lg py-1 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
                          placeholder="-"
                        />
                      ) : (
                        <span className="text-xl font-bold min-w-[2rem] text-center text-gray-400">-</span>
                      )}
                    </div>

                    <div className="text-center text-xs text-muted font-medium my-1">
                      vs
                    </div>

                    {/* Team 2 */}
                    <div
                      className={`flex items-center gap-2 p-2 rounded-lg ${
                        team2Won && !isEditing ? "bg-green-50" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          {team2.map((mp) => (
                            <span key={mp.id} className="inline-flex items-center gap-0.5 text-sm">
                              <span>{mp.player.emoji}</span>
                              <span className={team2Won && !isEditing ? "font-semibold" : ""}>{mp.player.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {isCompleted && !isEditing ? (
                        <span
                          className={`text-xl font-bold min-w-[2rem] text-center ${
                            team2Won ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {team2Score}
                        </span>
                      ) : showInputs ? (
                        <input
                          type="number"
                          inputMode="numeric"
                          value={scores[match.id]?.team2 ?? ""}
                          onChange={(e) =>
                            setMatchScore(match.id, "team2", e.target.value)
                          }
                          className="w-14 text-center border border-border rounded-lg py-1 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50"
                          placeholder="-"
                        />
                      ) : (
                        <span className="text-xl font-bold min-w-[2rem] text-center text-gray-400">-</span>
                      )}
                    </div>

                    {/* Submit / Edit buttons */}
                    {showInputs && !isEditing && scores[match.id]?.team1 && scores[match.id]?.team2 && (
                      <button
                        onClick={() => submitScore(match.id)}
                        className="w-full mt-2 bg-primary text-white py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
                      >
                        Submit Score
                      </button>
                    )}
                    {isEditing && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => editScore(match.id)}
                          disabled={!scores[match.id]?.team1 || !scores[match.id]?.team2}
                          className="flex-1 bg-primary text-white py-2 rounded-lg font-medium text-sm disabled:opacity-50"
                        >
                          Save Edit
                        </button>
                        <button
                          onClick={cancelEditMatch}
                          className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
