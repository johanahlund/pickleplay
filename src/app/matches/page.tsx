"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";

interface PlayerInfo {
  id: string;
  name: string;
  emoji: string;
}

interface MatchPlayer {
  id: string;
  playerId: string;
  team: number;
  score: number;
  player: PlayerInfo;
}

interface Match {
  id: string;
  courtNum: number;
  round: number;
  status: string;
  eloChange: number;
  createdAt: string;
  players: MatchPlayer[];
  event: { id: string; name: string; date: string; format: string };
}

export default function MatchesPage() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [playedWithFilter, setPlayedWithFilter] = useState("");
  const [playedAgainstFilter, setPlayedAgainstFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    fetch("/api/matches/my")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMatches(data);
        setLoading(false);
      });
  }, []);

  // Build unique list of all players the user has played with/against
  const { teammates, opponents } = useMemo(() => {
    const teammateMap = new Map<string, PlayerInfo>();
    const opponentMap = new Map<string, PlayerInfo>();
    for (const m of matches) {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) continue;
      for (const mp of m.players) {
        if (mp.playerId === userId) continue;
        if (mp.team === myTeam) {
          teammateMap.set(mp.playerId, mp.player);
        } else {
          opponentMap.set(mp.playerId, mp.player);
        }
      }
    }
    const sort = (a: PlayerInfo, b: PlayerInfo) => a.name.localeCompare(b.name);
    return {
      teammates: Array.from(teammateMap.values()).sort(sort),
      opponents: Array.from(opponentMap.values()).sort(sort),
    };
  }, [matches, userId]);

  const filtered = useMemo(() => {
    return matches.filter((m) => {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) return false;

      // Played with filter
      if (playedWithFilter) {
        const hasTeammate = m.players.some(
          (mp) => mp.playerId === playedWithFilter && mp.team === myTeam
        );
        if (!hasTeammate) return false;
      }

      // Played against filter
      if (playedAgainstFilter) {
        const hasOpponent = m.players.some(
          (mp) => mp.playerId === playedAgainstFilter && mp.team !== myTeam
        );
        if (!hasOpponent) return false;
      }

      // Date range
      const matchDate = m.event.date.split("T")[0];
      if (dateFrom && matchDate < dateFrom) return false;
      if (dateTo && matchDate > dateTo) return false;

      return true;
    });
  }, [matches, userId, playedWithFilter, playedAgainstFilter, dateFrom, dateTo]);

  // Stats
  const stats = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const m of filtered) {
      const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
      if (!myTeam) continue;
      const myScore = m.players
        .filter((mp) => mp.team === myTeam)
        .reduce((sum, mp) => sum + mp.score, 0);
      const oppScore = m.players
        .filter((mp) => mp.team !== myTeam)
        .reduce((sum, mp) => sum + mp.score, 0);
      if (myScore > oppScore) wins++;
      else if (oppScore > myScore) losses++;
    }
    return { wins, losses, total: filtered.length };
  }, [filtered, userId]);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const hasFilters = playedWithFilter || playedAgainstFilter || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">My Matches</h2>

      {/* Filters */}
      <div className="bg-card rounded-xl border border-border p-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Played With</label>
            <select
              value={playedWithFilter}
              onChange={(e) => setPlayedWithFilter(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
            >
              <option value="">Anyone</option>
              {teammates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Played Against</label>
            <select
              value={playedAgainstFilter}
              onChange={(e) => setPlayedAgainstFilter(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 bg-white"
            >
              <option value="">Anyone</option>
              {opponents.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setPlayedWithFilter("");
              setPlayedAgainstFilter("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-xs text-primary font-medium"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stats summary */}
      <div className="flex gap-3">
        <div className="flex-1 bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-lg font-bold">{stats.total}</div>
          <div className="text-xs text-muted">Matches</div>
        </div>
        <div className="flex-1 bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-lg font-bold text-green-600">{stats.wins}</div>
          <div className="text-xs text-muted">Wins</div>
        </div>
        <div className="flex-1 bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-lg font-bold text-red-500">{stats.losses}</div>
          <div className="text-xs text-muted">Losses</div>
        </div>
      </div>

      {/* Match list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted text-center py-8">
          {matches.length === 0 ? "No completed matches yet" : "No matches match your filters"}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => {
            const myTeam = m.players.find((mp) => mp.playerId === userId)?.team;
            const team1 = m.players.filter((mp) => mp.team === 1);
            const team2 = m.players.filter((mp) => mp.team === 2);
            const score1 = team1.reduce((s, mp) => s + mp.score, 0);
            const score2 = team2.reduce((s, mp) => s + mp.score, 0);
            const won =
              myTeam === 1 ? score1 > score2 : score2 > score1;

            return (
              <div
                key={m.id}
                className={`bg-card rounded-xl border p-3 ${
                  won ? "border-green-200" : "border-red-200"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted">
                    {m.event.name} &middot;{" "}
                    {new Date(m.event.date).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      won
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {won ? "W" : "L"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`flex-1 text-sm ${myTeam === 1 ? "font-semibold" : ""}`}>
                    {team1.map((mp) => (
                      <span key={mp.id} className="mr-1">
                        {mp.player.emoji}
                        <span className="text-xs">{mp.player.name.split(" ")[0]}</span>
                      </span>
                    ))}
                  </div>
                  <div className="text-center font-bold text-sm tabular-nums min-w-[50px]">
                    {score1} - {score2}
                  </div>
                  <div className={`flex-1 text-sm text-right ${myTeam === 2 ? "font-semibold" : ""}`}>
                    {team2.map((mp) => (
                      <span key={mp.id} className="ml-1">
                        {mp.player.emoji}
                        <span className="text-xs">{mp.player.name.split(" ")[0]}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
