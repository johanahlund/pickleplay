"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";

interface Player { id: string; name: string; photoUrl?: string | null; rating: number; gender?: string | null }
interface LeagueTeam {
  id: string; name: string; logoUrl: string | null;
  club?: { id: string; name: string; emoji: string; logoUrl?: string | null } | null;
  captain?: { id: string; name: string; photoUrl?: string | null } | null;
  viceCaptain?: { id: string; name: string; photoUrl?: string | null } | null;
  players: { id: string; playerId: string; player: Player }[];
  _count: { players: number };
}
interface LeagueCategory { id: string; name: string; format: string; gender: string; scoringFormat: string; winBy: string; sortOrder: number }
interface LeagueGame {
  id: string; categoryId: string;
  category: { id: string; name: string };
  team1: { id: string; name: string };
  team2: { id: string; name: string };
  winner?: { id: string; name: string } | null;
  matchId?: string | null;
}
interface LeagueMatchDay {
  id: string; date: string | null; status: string; hostTeamId: string | null;
  teams: { teamId: string; points: number; team: { id: string; name: string; logoUrl: string | null } }[];
  games: LeagueGame[];
  event?: { id: string; name: string; date: string; status: string } | null;
}
interface LeagueRound { id: string; roundNumber: number; name: string | null; suggestedDate: string | null; status: string; matchDays: LeagueMatchDay[] }
interface League {
  id: string; name: string; description: string | null; season: string | null; status: string;
  config: { maxRoster?: number; maxPointsPerMatchDay?: number } | null;
  createdBy?: { id: string; name: string } | null;
  teams: LeagueTeam[]; rounds: LeagueRound[]; categories: LeagueCategory[];
}
interface Standing { teamId: string; teamName: string; logoUrl: string | null; played: number; won: number; lost: number; drawn: number; points: number; totalCategoryWins: number }

type Tab = "standings" | "rounds" | "teams" | "settings";

export default function LeagueDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string })?.id;

  const [league, setLeague] = useState<League | null>(null);
  const [standings, setStandings] = useState<{ general: Standing[]; categoryStandings: Record<string, { teamId: string; teamName: string; wins: number; losses: number }[]>; categories: LeagueCategory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("standings");
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [allClubs, setAllClubs] = useState<{ id: string; name: string; emoji: string }[]>([]);

  // Add team state
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamClubId, setNewTeamClubId] = useState("");

  // Add round state
  const [showAddRound, setShowAddRound] = useState(false);
  const [newRoundNumber, setNewRoundNumber] = useState(1);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundDate, setNewRoundDate] = useState("");
  const [newRoundTeam1, setNewRoundTeam1] = useState("");
  const [newRoundTeam2, setNewRoundTeam2] = useState("");

  // Add player to team state
  const [addingPlayerTeamId, setAddingPlayerTeamId] = useState<string | null>(null);
  const [playerSearch, setPlayerSearch] = useState("");

  const fetchLeague = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}`);
    if (!r.ok) { router.push("/leagues"); return; }
    const data = await r.json();
    setLeague(data);
    setLoading(false);
    // Set next round number
    setNewRoundNumber((data.rounds?.length || 0) + 1);
  }, [id, router]);

  const fetchStandings = useCallback(async () => {
    const r = await fetch(`/api/leagues/${id}/standings`);
    if (r.ok) setStandings(await r.json());
  }, [id]);

  useEffect(() => { fetchLeague(); fetchStandings(); }, [fetchLeague, fetchStandings]);

  const fetchPlayers = async () => { if (allPlayers.length) return; const r = await fetch("/api/players"); if (r.ok) setAllPlayers(await r.json()); };
  const fetchClubs = async () => { if (allClubs.length) return; const r = await fetch("/api/clubs"); if (r.ok) setAllClubs(await r.json()); };

  if (loading || !league) return <div className="text-center py-12 text-muted">Loading...</div>;

  const addTeam = async () => {
    if (!newTeamName.trim()) return;
    await fetch(`/api/leagues/${id}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTeamName.trim(), clubId: newTeamClubId || undefined }),
    });
    setNewTeamName(""); setNewTeamClubId(""); setShowAddTeam(false);
    fetchLeague();
  };

  const removeTeam = async (teamId: string) => {
    if (!confirm("Remove this team?")) return;
    await fetch(`/api/leagues/${id}/teams/${teamId}`, { method: "DELETE" });
    fetchLeague();
  };

  const addPlayerToTeam = async (teamId: string, playerId: string) => {
    await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchLeague();
  };

  const removePlayerFromTeam = async (teamId: string, playerId: string) => {
    await fetch(`/api/leagues/${id}/teams/${teamId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    fetchLeague();
  };

  const addRound = async () => {
    const matchDays = newRoundTeam1 && newRoundTeam2 ? [{ teamIds: [newRoundTeam1, newRoundTeam2], hostTeamId: newRoundTeam1, date: newRoundDate || undefined }] : [];
    await fetch(`/api/leagues/${id}/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roundNumber: newRoundNumber, name: newRoundName.trim() || undefined, suggestedDate: newRoundDate || undefined, matchDays }),
    });
    setShowAddRound(false); setNewRoundName(""); setNewRoundDate(""); setNewRoundTeam1(""); setNewRoundTeam2("");
    fetchLeague(); fetchStandings();
  };

  const createEvent = async (matchDayId: string) => {
    const r = await fetch(`/api/leagues/${id}/match-days/${matchDayId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_event" }),
    });
    if (r.ok) { fetchLeague(); }
    else { const d = await r.json().catch(() => ({})); alert(d.error || "Failed"); }
  };

  const setGameWinner = async (matchDayId: string, gameId: string, winnerId: string | null) => {
    await fetch(`/api/leagues/${id}/match-days/${matchDayId}/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gameId, winnerId }),
    });
    fetchLeague(); fetchStandings();
  };

  const allTeamPlayerIds = new Set(league.teams.flatMap((t) => t.players.map((p) => p.playerId)));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{league.name}</h2>
            {league.season && <span className="text-sm text-muted">{league.season}</span>}
          </div>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            league.status === "active" ? "bg-green-100 text-green-700" : league.status === "completed" ? "bg-gray-100 text-muted" : "bg-blue-100 text-blue-700"
          }`}>{league.status}</span>
        </div>
        {league.description && <p className="text-sm text-muted mt-1">{league.description}</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(["standings", "rounds", "teams", "settings"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
              tab === t ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>{t}</button>
        ))}
      </div>

      {/* ── Standings Tab ── */}
      {tab === "standings" && standings && (
        <div className="space-y-4">
          {/* General standings */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">General Standings</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-muted uppercase border-b border-border">
                  <th className="text-left px-3 py-1">#</th>
                  <th className="text-left px-2 py-1">Team</th>
                  <th className="text-center px-1 py-1">P</th>
                  <th className="text-center px-1 py-1">W</th>
                  <th className="text-center px-1 py-1">L</th>
                  <th className="text-center px-1 py-1">D</th>
                  <th className="text-center px-2 py-1 font-bold">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.general.map((s, i) => (
                  <tr key={s.teamId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                    <td className="px-2 py-2 font-medium">{s.teamName}</td>
                    <td className="text-center px-1 py-2 text-muted">{s.played}</td>
                    <td className="text-center px-1 py-2 text-green-600">{s.won}</td>
                    <td className="text-center px-1 py-2 text-red-500">{s.lost}</td>
                    <td className="text-center px-1 py-2 text-muted">{s.drawn}</td>
                    <td className="text-center px-2 py-2 font-bold">{s.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Category standings */}
          {standings.categories.map((cat) => (
            <div key={cat.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="text-[10px] text-muted px-3 pt-2 pb-1 uppercase tracking-wider font-medium">{cat.name}</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] text-muted uppercase border-b border-border">
                    <th className="text-left px-3 py-1">#</th>
                    <th className="text-left px-2 py-1">Team</th>
                    <th className="text-center px-2 py-1">W</th>
                    <th className="text-center px-2 py-1">L</th>
                  </tr>
                </thead>
                <tbody>
                  {(standings.categoryStandings[cat.id] || []).map((s, i) => (
                    <tr key={s.teamId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                      <td className="px-2 py-2 font-medium">{s.teamName}</td>
                      <td className="text-center px-2 py-2 text-green-600">{s.wins}</td>
                      <td className="text-center px-2 py-2 text-red-500">{s.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── Rounds Tab ── */}
      {tab === "rounds" && (
        <div className="space-y-3">
          {league.rounds.map((round) => (
            <div key={round.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold">{round.name || `Round ${round.roundNumber}`}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  round.status === "completed" ? "bg-green-100 text-green-700" : round.status === "in_progress" ? "bg-orange-100 text-orange-700" : "bg-gray-100 text-muted"
                }`}>{round.status}</span>
              </div>
              {round.matchDays.map((md) => (
                <div key={md.id} className="px-3 py-3 border-b border-border last:border-0">
                  {/* Teams */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {md.teams.map((t, i) => (
                        <span key={t.teamId} className="text-sm font-medium">
                          {i > 0 && <span className="text-muted mx-1">vs</span>}
                          {t.team.name}
                          {t.teamId === md.hostTeamId && <span className="text-[9px] text-muted ml-1">(H)</span>}
                        </span>
                      ))}
                    </div>
                    {md.date && <span className="text-xs text-muted">{new Date(md.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                  </div>

                  {/* Team points summary */}
                  <div className="flex gap-2 mb-2">
                    {md.teams.map((t) => (
                      <span key={t.teamId} className="text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                        {t.team.name}: <span className="font-bold">{t.points}</span> pts
                      </span>
                    ))}
                  </div>

                  {/* Games */}
                  {md.games.length > 0 && (
                    <div className="space-y-1">
                      {md.games.map((game) => (
                        <div key={game.id} className="flex items-center gap-2 text-xs">
                          <span className="text-muted w-24 truncate">{game.category.name}</span>
                          <span className={`flex-1 font-medium ${game.winner?.id === game.team1.id ? "text-green-600" : ""}`}>{game.team1.name}</span>
                          <span className="text-muted">vs</span>
                          <span className={`flex-1 font-medium text-right ${game.winner?.id === game.team2.id ? "text-green-600" : ""}`}>{game.team2.name}</span>
                          {/* Winner selector */}
                          <select value={game.winner?.id || ""} onChange={(e) => setGameWinner(md.id, game.id, e.target.value || null)}
                            className="text-[10px] border border-border rounded px-1 py-0.5 w-20">
                            <option value="">TBD</option>
                            <option value={game.team1.id}>{game.team1.name}</option>
                            <option value={game.team2.id}>{game.team2.name}</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Event link or create */}
                  <div className="mt-2">
                    {md.event ? (
                      <Link href={`/events/${md.event.id}`} className="text-xs text-action font-medium hover:underline">
                        📅 {md.event.name} ({md.event.status})
                      </Link>
                    ) : (
                      <button onClick={() => createEvent(md.id)} className="text-xs text-action font-medium hover:underline">
                        + Create Event
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Add round */}
          {!showAddRound ? (
            <button onClick={() => setShowAddRound(true)}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Round
            </button>
          ) : (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex gap-3">
                <div className="w-20">
                  <label className="block text-xs text-muted mb-1">Round #</label>
                  <input type="number" value={newRoundNumber} onChange={(e) => setNewRoundNumber(parseInt(e.target.value) || 1)} min={1}
                    className="w-full border border-border rounded-lg px-2 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-muted mb-1">Name</label>
                  <input type="text" value={newRoundName} onChange={(e) => setNewRoundName(e.target.value)}
                    placeholder={`Jornada ${newRoundNumber}`}
                    className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Date</label>
                <input type="date" value={newRoundDate} onChange={(e) => setNewRoundDate(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              {league.teams.length >= 2 && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-muted mb-1">Home Team</label>
                    <select value={newRoundTeam1} onChange={(e) => setNewRoundTeam1(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select...</option>
                      {league.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <span className="self-end pb-2 text-muted">vs</span>
                  <div className="flex-1">
                    <label className="block text-xs text-muted mb-1">Away Team</label>
                    <select value={newRoundTeam2} onChange={(e) => setNewRoundTeam2(e.target.value)}
                      className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                      <option value="">Select...</option>
                      {league.teams.filter((t) => t.id !== newRoundTeam1).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={addRound} disabled={!newRoundNumber}
                  className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Add Round</button>
                <button onClick={() => setShowAddRound(false)}
                  className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Teams Tab ── */}
      {tab === "teams" && (
        <div className="space-y-3">
          {league.teams.map((team) => (
            <div key={team.id} className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {team.club?.logoUrl ? <img src={team.club.logoUrl} alt="" className="w-6 h-6 rounded object-cover" /> : <span>{team.club?.emoji || "🏓"}</span>}
                  <span className="font-semibold text-sm">{team.name}</span>
                  <span className="text-xs text-muted">({team._count.players} players)</span>
                </div>
                <button onClick={() => removeTeam(team.id)} className="text-xs text-danger hover:underline">Remove</button>
              </div>
              {/* Captain / Vice */}
              <div className="px-3 py-1.5 text-xs text-muted flex gap-3 border-b border-border">
                {team.captain && <span>Captain: <span className="font-medium text-foreground">{team.captain.name}</span></span>}
                {team.viceCaptain && <span>Vice: <span className="font-medium text-foreground">{team.viceCaptain.name}</span></span>}
              </div>
              {/* Player roster */}
              <div className="px-3 py-2 space-y-1">
                {team.players.map((tp) => (
                  <div key={tp.id} className="flex items-center gap-2 py-1">
                    <PlayerAvatar name={tp.player.name} photoUrl={tp.player.photoUrl} size="xs" />
                    <span className="text-sm font-medium flex-1">{tp.player.name}</span>
                    <span className="text-xs text-muted">{tp.player.rating.toFixed(0)}</span>
                    <button onClick={() => removePlayerFromTeam(team.id, tp.playerId)} className="text-xs text-danger px-1 hover:underline">✕</button>
                  </div>
                ))}
                {addingPlayerTeamId === team.id ? (
                  <div className="pt-1">
                    <input type="text" value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)}
                      placeholder="Search player..." autoFocus
                      className="w-full border border-border rounded-lg px-2 py-1.5 text-sm mb-1" />
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {allPlayers.filter((p) => !allTeamPlayerIds.has(p.id) && p.name.toLowerCase().includes(playerSearch.toLowerCase())).slice(0, 10).map((p) => (
                        <button key={p.id} onClick={() => { addPlayerToTeam(team.id, p.id); setPlayerSearch(""); }}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 text-left">
                          <PlayerAvatar name={p.name} photoUrl={p.photoUrl} size="xs" />
                          <span className="text-sm">{p.name}</span>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => { setAddingPlayerTeamId(null); setPlayerSearch(""); }} className="text-xs text-muted mt-1">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => { setAddingPlayerTeamId(team.id); fetchPlayers(); }}
                    className="text-xs text-primary font-medium mt-1">+ Add Player</button>
                )}
              </div>
            </div>
          ))}

          {/* Add team */}
          {!showAddTeam ? (
            <button onClick={() => { setShowAddTeam(true); fetchClubs(); }}
              className="w-full py-2.5 rounded-xl text-sm font-medium text-primary border border-primary/30 hover:bg-primary/5">
              + Add Team
            </button>
          ) : (
            <div className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">Team Name</label>
                <input type="text" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)}
                  placeholder="e.g. Leiria" autoFocus
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Link to Club (optional)</label>
                <select value={newTeamClubId} onChange={(e) => { setNewTeamClubId(e.target.value); if (!newTeamName && e.target.value) { const c = allClubs.find((c) => c.id === e.target.value); if (c) setNewTeamName(c.name); } }}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm">
                  <option value="">No club</option>
                  {allClubs.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={addTeam} disabled={!newTeamName.trim()}
                  className="flex-1 bg-action-dark text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">Add Team</button>
                <button onClick={() => setShowAddTeam(false)}
                  className="flex-1 bg-gray-100 py-2 rounded-lg text-sm font-medium">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Settings Tab ── */}
      {tab === "settings" && (
        <div className="space-y-3">
          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">League Info</h3>
            <div className="text-sm text-muted space-y-1">
              <p>Created by: {league.createdBy?.name || "Unknown"}</p>
              <p>Max roster: {league.config?.maxRoster || "No limit"}</p>
              <p>Max points per match day: {league.config?.maxPointsPerMatchDay || "No limit"}</p>
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Categories ({league.categories.length})</h3>
            <div className="space-y-1">
              {league.categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-2 text-sm py-1">
                  <span className="font-medium flex-1">{cat.name}</span>
                  <span className="text-xs text-muted">{cat.format} · {cat.gender} · {cat.scoringFormat}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            {league.status === "draft" && (
              <button onClick={async () => {
                await fetch(`/api/leagues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "active" }) });
                fetchLeague();
              }} className="flex-1 bg-green-600 text-white py-2.5 rounded-xl font-medium text-sm">Start League</button>
            )}
            {league.status === "active" && (
              <button onClick={async () => {
                await fetch(`/api/leagues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "completed" }) });
                fetchLeague();
              }} className="flex-1 bg-gray-600 text-white py-2.5 rounded-xl font-medium text-sm">Complete League</button>
            )}
          </div>

          <button onClick={async () => {
            if (!confirm("Delete this league?") || !confirm("Are you sure? This cannot be undone!")) return;
            await fetch(`/api/leagues/${id}`, { method: "DELETE" });
            router.push("/leagues");
          }} className="w-full py-2.5 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50">
            Delete League
          </button>
        </div>
      )}
    </div>
  );
}
