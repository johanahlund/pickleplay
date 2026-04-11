"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";

interface PlayerInfo { id: string; name: string; emoji: string; photoUrl?: string | null }
interface MatchPlayer { id: string; playerId: string; team: number; score: number; player: PlayerInfo }
interface Match {
  id: string; courtNum: number; round: number; status: string; eloChange: number; createdAt: string;
  players: MatchPlayer[];
  event: { id: string; name: string; date: string; format: string; clubId?: string | null; club?: { name: string; emoji: string } | null };
}

export default function MatchesPageWrapper() {
  return <Suspense><MatchesPage /></Suspense>;
}

function MatchesPage() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const clubFilter = searchParams.get("club");
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [playedWithFilter, setPlayedWithFilter] = useState("");
  const [playedAgainstFilter, setPlayedAgainstFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetch("/api/matches/my")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMatches(clubFilter ? data.filter((m: Match) => m.event?.clubId === clubFilter) : data);
        }
        setLoading(false);
      });
  }, [clubFilter]);

  const { teammates, opponents } = useMemo(() => {
    const tMap = new Map<string, PlayerInfo>();
    const oMap = new Map<string, PlayerInfo>();
    for (const m of matches) {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) continue;
      for (const mp of m.players) {
        if (mp.playerId === userId) continue;
        (mp.team === myTeam ? tMap : oMap).set(mp.playerId, mp.player);
      }
    }
    const sort = (a: PlayerInfo, b: PlayerInfo) => a.name.localeCompare(b.name);
    return { teammates: Array.from(tMap.values()).sort(sort), opponents: Array.from(oMap.values()).sort(sort) };
  }, [matches, userId]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) return false;
      if (playedWithFilter && !m.players.some((mp) => mp.playerId === playedWithFilter && mp.team === myTeam)) return false;
      if (playedAgainstFilter && !m.players.some((mp) => mp.playerId === playedAgainstFilter && mp.team !== myTeam)) return false;
      const matchDate = m.event.date.split("T")[0];
      if (dateFrom && matchDate < dateFrom) return false;
      if (dateTo && matchDate > dateTo) return false;
      return true;
    });
  }, [matches, userId, playedWithFilter, playedAgainstFilter, dateFrom, dateTo]);

  const stats = useMemo(() => {
    let wins = 0, losses = 0;
    for (const m of filtered.filter((m) => m.status === "completed")) {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) continue;
      const myScore = m.players.filter((mp) => mp.team === myTeam).reduce((s, mp) => s + mp.score, 0);
      const oppScore = m.players.filter((mp) => mp.team !== myTeam).reduce((s, mp) => s + mp.score, 0);
      if (myScore > oppScore) wins++; else if (oppScore > myScore) losses++;
    }
    return { wins, losses, total: filtered.filter((m) => m.status === "completed").length };
  }, [filtered, userId]);

  if (loading) return <div className="text-center py-12 text-muted">Loading...</div>;

  // Filter pills
  const activeFilters: string[] = [];
  if (playedWithFilter) activeFilters.push(`With: ${teammates.find((t) => t.id === playedWithFilter)?.name || "?"}`);
  if (playedAgainstFilter) activeFilters.push(`Vs: ${opponents.find((t) => t.id === playedAgainstFilter)?.name || "?"}`);
  if (dateFrom) activeFilters.push(`From: ${dateFrom}`);
  if (dateTo) activeFilters.push(`To: ${dateTo}`);

  const clearFilters = () => { setPlayedWithFilter(""); setPlayedAgainstFilter(""); setDateFrom(""); setDateTo(""); };

  // Group matches
  const activeMatches = filtered.filter((m) => m.status === "active");
  const pausedMatches = filtered.filter((m) => m.status === "paused");
  const pendingMatches = filtered.filter((m) => m.status === "pending");
  const completedMatches = filtered.filter((m) => m.status === "completed");

  const renderMatchCard = (m: Match) => {
    const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
    const team1 = m.players.filter((mp) => mp.team === 1);
    const team2 = m.players.filter((mp) => mp.team === 2);
    const score1 = team1[0]?.score ?? 0;
    const score2 = team2[0]?.score ?? 0;
    const isCompleted = m.status === "completed";
    const won = isCompleted ? (myTeam === 1 ? score1 > score2 : score2 > score1) : false;
    const renderTeamRow = (players: MatchPlayer[], teamWon: boolean, teamLost: boolean, score: number, isMyTeam: boolean) => {
      const nameColor = isMyTeam && isCompleted ? (teamWon ? "text-green-700" : "text-red-600") : "";
      const scoreColor = isMyTeam && isCompleted ? (teamWon ? "text-green-600" : "text-red-500") : "text-gray-400";
      const bgColor = isMyTeam && isCompleted ? (teamWon ? "bg-green-50" : "bg-red-50") : "";
      return (
        <div className={`flex items-center gap-1 p-1.5 rounded-lg ${bgColor}`}>
          <div className="flex-1 min-w-0 space-y-0.5">
            {players.map((mp) => (
              <div key={mp.id} className="flex items-center gap-1.5">
                <PlayerAvatar name={mp.player.name} photoUrl={mp.player.photoUrl} size="xs" />
                <span className={`text-base truncate ${mp.playerId === userId ? "font-bold" : "font-medium"} ${nameColor}`}>{mp.player.name}</span>
              </div>
            ))}
          </div>
          <span className={`text-2xl font-bold tabular-nums min-w-[2.5rem] text-center ${scoreColor}`}>{isCompleted ? score : "-"}</span>
        </div>
      );
    };

    return (
      <Link key={m.id} href={`/events/${m.event.id}`} className="block bg-white rounded-xl border border-border overflow-hidden active:bg-gray-50">
        <div className="px-2.5 py-1.5 bg-gray-50 border-b border-border flex items-center gap-1.5">
          {m.event.club && <span className="text-[10px] text-muted">{m.event.club.emoji} {m.event.club.name} ·</span>}
          <span className="text-[10px] text-muted flex-1">{m.event.name} · {new Date(m.event.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          {isCompleted && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${won ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{won ? "W" : "L"}</span>}
          {!isCompleted && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">{m.status}</span>}
        </div>
        <div className="px-2 py-1.5 space-y-0.5">
          {renderTeamRow(team1, isCompleted && score1 > score2, isCompleted && score1 < score2, score1, myTeam === 1)}
          <div className="h-px bg-border mx-2" />
          {renderTeamRow(team2, isCompleted && score2 > score1, isCompleted && score2 < score1, score2, myTeam === 2)}
        </div>
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">My Matches</h2>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setShowFilters(!showFilters)}
          className={`text-sm px-2 py-1 rounded-lg transition-colors ${showFilters ? "bg-action text-white" : "bg-gray-100 text-muted hover:text-foreground"}`}>
          ☰ Filter
        </button>
        {activeFilters.length > 0 && (
          <>
            {activeFilters.map((f, i) => (
              <span key={i} className="text-[10px] bg-action/10 text-action px-2 py-0.5 rounded-full font-medium">{f}</span>
            ))}
            <button onClick={clearFilters} className="text-[10px] text-muted hover:text-foreground px-1">✕</button>
          </>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-2">
        <div className="flex-1 bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold">{stats.total}</div>
          <div className="text-[10px] text-muted">Played</div>
        </div>
        <div className="flex-1 bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold text-green-600">{stats.wins}</div>
          <div className="text-[10px] text-muted">Wins</div>
        </div>
        <div className="flex-1 bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold text-red-500">{stats.losses}</div>
          <div className="text-[10px] text-muted">Losses</div>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Played With</label>
              <select value={playedWithFilter} onChange={(e) => setPlayedWithFilter(e.target.value)}
                className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">Anyone</option>
                {teammates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Played Against</label>
              <select value={playedAgainstFilter} onChange={(e) => setPlayedAgainstFilter(e.target.value)}
                className="w-full border border-border rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">Anyone</option>
                {opponents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">From</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="w-full border border-border rounded-lg px-1.5 py-1.5 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">To</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="w-full border border-border rounded-lg px-1.5 py-1.5 text-xs" />
            </div>
          </div>
        </div>
      )}

      {/* Match list — grouped */}
      {!showFilters && (
        <>
          {/* Active */}
          {activeMatches.length > 0 && (
            <div className="bg-orange-50 -mx-4 px-4 py-3 border-y border-orange-200">
              <div className="flex items-center gap-2 mb-2"><div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" /><span className="text-xs font-bold text-orange-700 uppercase tracking-wider">In Play</span></div>
              <div className="space-y-2">{activeMatches.map(renderMatchCard)}</div>
            </div>
          )}

          {/* Paused */}
          {pausedMatches.length > 0 && (
            <div className="bg-amber-50 -mx-4 px-4 py-3 border-y border-amber-200">
              <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-amber-700 uppercase tracking-wider">Paused</span></div>
              <div className="space-y-2">{pausedMatches.map(renderMatchCard)}</div>
            </div>
          )}

          {/* Pending */}
          {pendingMatches.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Upcoming</span></div>
              <div className="space-y-2">{pendingMatches.map(renderMatchCard)}</div>
            </div>
          )}

          {/* Completed */}
          {completedMatches.length > 0 && (
            <div className="bg-gray-100 -mx-4 px-4 py-3 border-y border-gray-200">
              <div className="flex items-center gap-2 mb-2"><span className="text-xs font-bold text-muted uppercase tracking-wider">Completed</span></div>
              <div className="space-y-2">{[...completedMatches].sort((a, b) => new Date(b.event.date).getTime() - new Date(a.event.date).getTime()).map(renderMatchCard)}</div>
            </div>
          )}

          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted text-sm">No matches yet</p>
          )}
        </>
      )}
    </div>
  );
}
