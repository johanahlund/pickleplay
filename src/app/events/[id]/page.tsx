"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
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
  players: { player: Player; checkedIn: boolean }[];
  matches: Match[];
}

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scores, setScores] = useState<Record<string, { team1: string; team2: string }>>({});
  const [editingEvent, setEditingEvent] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCourts, setEditCourts] = useState(2);
  const [managingPlayers, setManagingPlayers] = useState(false);

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

  const removePlayer = async (playerId: string, playerName: string) => {
    if (!confirm(`Remove ${playerName} from this event?`)) return;
    await fetch(`/api/events/${id}/players/${playerId}`, { method: "DELETE" });
    await fetchEvent();
  };

  const startEditEvent = () => {
    if (!event) return;
    setEditName(event.name);
    setEditCourts(event.numCourts);
    setEditingEvent(true);
  };

  const saveEditEvent = async () => {
    if (!editName.trim()) return;
    await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim(), numCourts: editCourts }),
    });
    setEditingEvent(false);
    await fetchEvent();
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
              {new Date(event.date).toLocaleDateString()} &middot;{" "}
              {event.numCourts} court{event.numCourts !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startEditEvent}
              className="text-xs text-muted px-2 py-1 rounded hover:bg-gray-100"
            >
              Edit
            </button>
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
          {!hasMatches && (
            <button
              onClick={() => setManagingPlayers(!managingPlayers)}
              className="text-xs text-primary font-medium"
            >
              {managingPlayers ? "Done" : "Manage"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {event.players.map((ep) => (
            <span
              key={ep.player.id}
              className="inline-flex items-center gap-1 bg-gray-50 rounded-full px-2.5 py-1 text-sm"
            >
              <span>{ep.player.emoji}</span>
              <span>{ep.player.name}</span>
              {managingPlayers && !hasMatches && (
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
      </div>

      {/* Generate button */}
      {!hasMatches && (
        <button
          onClick={generateMatches}
          disabled={generating || event.players.length < 4}
          className="w-full bg-primary text-white py-3 rounded-xl font-semibold text-lg shadow-md active:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "🎲 Generate Matches"}
        </button>
      )}

      {/* Regenerate button if all matches are done */}
      {allCompleted && (
        <button
          onClick={generateMatches}
          disabled={generating}
          className="w-full bg-accent text-foreground py-3 rounded-xl font-semibold shadow-md active:opacity-80 transition-colors disabled:opacity-50"
        >
          {generating ? "Generating..." : "🔄 Generate Next Rounds"}
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
              const team1Score = isCompleted ? team1[0]?.score ?? 0 : null;
              const team2Score = isCompleted ? team2[0]?.score ?? 0 : null;
              const team1Won = team1Score !== null && team2Score !== null && team1Score > team2Score;
              const team2Won = team1Score !== null && team2Score !== null && team2Score > team1Score;

              return (
                <div
                  key={match.id}
                  className="bg-card rounded-xl border border-border overflow-hidden"
                >
                  <div className="px-3 py-1.5 bg-gray-50 border-b border-border flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">
                      Court {match.courtNum}
                    </span>
                    {isCompleted && (
                      <span className="text-xs text-green-600 font-medium">
                        ✓ Final
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    {/* Team 1 */}
                    <div
                      className={`flex items-center gap-2 p-2 rounded-lg ${
                        team1Won ? "bg-green-50" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          {team1.map((mp) => (
                            <span key={mp.id} className="inline-flex items-center gap-0.5 text-sm">
                              <span>{mp.player.emoji}</span>
                              <span className={team1Won ? "font-semibold" : ""}>{mp.player.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {isCompleted ? (
                        <span
                          className={`text-xl font-bold min-w-[2rem] text-center ${
                            team1Won ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {team1Score}
                        </span>
                      ) : (
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
                      )}
                    </div>

                    <div className="text-center text-xs text-muted font-medium my-1">
                      vs
                    </div>

                    {/* Team 2 */}
                    <div
                      className={`flex items-center gap-2 p-2 rounded-lg ${
                        team2Won ? "bg-green-50" : ""
                      }`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          {team2.map((mp) => (
                            <span key={mp.id} className="inline-flex items-center gap-0.5 text-sm">
                              <span>{mp.player.emoji}</span>
                              <span className={team2Won ? "font-semibold" : ""}>{mp.player.name}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      {isCompleted ? (
                        <span
                          className={`text-xl font-bold min-w-[2rem] text-center ${
                            team2Won ? "text-green-600" : "text-gray-400"
                          }`}
                        >
                          {team2Score}
                        </span>
                      ) : (
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
                      )}
                    </div>

                    {/* Submit button */}
                    {!isCompleted && scores[match.id]?.team1 && scores[match.id]?.team2 && (
                      <button
                        onClick={() => submitScore(match.id)}
                        className="w-full mt-2 bg-primary text-white py-2 rounded-lg font-medium text-sm active:bg-primary-dark transition-colors"
                      >
                        Submit Score
                      </button>
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
