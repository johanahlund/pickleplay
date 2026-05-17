"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import Link from "next/link";
import { ClubBadge } from "@/components/ClubBadge";
import { frameClass } from "@/components/Card";
import { useUrlState } from "@/lib/hooks";
import { LoadingState } from "@/components/LoadingState";

interface PlayerInfo { id: string; name: string; emoji: string; photoUrl?: string | null }
interface MatchPlayer { id: string; playerId: string; team: number; score: number; player: PlayerInfo }
interface Match {
  id: string; courtNum: number; round: number; status: string; eloChange: number; createdAt: string;
  players: MatchPlayer[];
  setScores?: number[][] | null;
  event: { id: string; name: string; date: string; format: string; clubId?: string | null; club?: { name: string; shortName?: string | null; emoji: string; logoUrl?: string | null } | null };
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
  // Filters live in the URL so back-nav from an event detail restores
  // them. `showFilters` (panel expanded?) stays in local state — it's
  // a UI affordance, not a meaningful piece of filter state.
  const [showFilters, setShowFilters] = useState(false);
  const [playedWithFilter, setPlayedWithFilter] = useUrlState("with", "");
  const [playedAgainstFilter, setPlayedAgainstFilter] = useUrlState("vs", "");
  const [dateFrom, setDateFrom] = useUrlState("from", "");
  const [dateTo, setDateTo] = useUrlState("to", "");

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

  // Loading handled inline

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
    const isCompleted = m.status === "completed";
    // Defensively narrow Json? → number[][]. Same shape the league
    // schedule card and ScorerTracker write; falling back to the
    // MatchPlayer.score totals lets single-set matches still
    // render a single column for parity.
    const setScores: number[][] = Array.isArray(m.setScores)
      ? (m.setScores as unknown[])
          .filter((s): s is number[] => Array.isArray(s) && s.length >= 2 && typeof s[0] === "number" && typeof s[1] === "number")
          .map((s) => s as number[])
      : [];
    const isBo3 = setScores.length > 0;
    const team1Scores: number[] = isBo3 ? setScores.map((s) => s[0]!) : [team1[0]?.score ?? 0];
    const team2Scores: number[] = isBo3 ? setScores.map((s) => s[1]!) : [team2[0]?.score ?? 0];
    const t1Sets = isBo3
      ? setScores.filter(([a, b]) => a > b).length
      : (team1Scores[0]! > team2Scores[0]! ? 1 : 0);
    const t2Sets = isBo3
      ? setScores.filter(([a, b]) => b > a).length
      : (team2Scores[0]! > team1Scores[0]! ? 1 : 0);
    const team1WonMatch = isCompleted && t1Sets > t2Sets;
    const team2WonMatch = isCompleted && t2Sets > t1Sets;
    const won = isCompleted && myTeam ? (myTeam === 1 ? team1WonMatch : team2WonMatch) : false;
    const mySets = myTeam === 1 ? t1Sets : t2Sets;
    const otherSets = myTeam === 1 ? t2Sets : t1Sets;

    const renderTeamRow = (
      players: MatchPlayer[],
      teamWonMatch: boolean,
      teamScoresArr: number[],
      otherScoresArr: number[],
      isMyTeam: boolean,
    ) => {
      // Background reflects MATCH result for my team — the per-set
      // text colours handle set-by-set independently. So if I won
      // a set but lost the match the row is red and that set's
      // number is green inside the red row.
      const nameColor = isMyTeam && isCompleted ? (teamWonMatch ? "text-green-700" : "text-red-600") : "";
      const bgColor = isMyTeam && isCompleted ? (teamWonMatch ? "bg-green-50" : "bg-red-50") : "";
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
          {isCompleted ? (
            <div className="flex items-center gap-1 shrink-0">
              {teamScoresArr.map((s, i) => {
                const otherS = otherScoresArr[i] ?? 0;
                const wonSet = s > otherS;
                const lostSet = s < otherS;
                const setColor = wonSet ? "text-green-600" : lostSet ? "text-red-500" : "text-gray-400";
                return (
                  <span key={i} className={`text-xl font-bold tabular-nums w-7 text-center ${setColor}`}>{s}</span>
                );
              })}
            </div>
          ) : (
            <span className="text-2xl font-bold tabular-nums min-w-[2.5rem] text-center text-gray-400">-</span>
          )}
        </div>
      );
    };

    return (
      <div key={m.id} className={`bg-white rounded-xl border border-l-4 overflow-hidden ${
        isCompleted ? (won ? "border-green-500" : "border-red-400") : "border-action"
      }`}>
        {/* Header strip is the only clickable surface — opens the
            event detail. The team rows below stay non-interactive
            so a tap on a name doesn't accidentally navigate. */}
        <Link
          href={`/events/${m.event.id}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-50 border-b border-border active:bg-gray-100"
        >
          {m.event.club && (
            <span className="text-[10px] text-muted inline-flex items-center gap-1">
              <ClubBadge logoUrl={m.event.club.logoUrl} size={12} />
              {(m.event.club.shortName?.trim() || m.event.club.name)} ·
            </span>
          )}
          <span className="text-[10px] text-muted flex-1">{m.event.name} · {new Date(m.event.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          {/* Replace the old W/L circle with an N-N pill (my sets
              first, opponent sets second), tinted green if I won
              the match and red if I lost. */}
          {isCompleted && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${won ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
              {mySets}-{otherSets}
            </span>
          )}
          {!isCompleted && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">{m.status}</span>}
        </Link>
        <div className="px-2 py-1.5 space-y-0.5">
          {renderTeamRow(team1, team1WonMatch, team1Scores, team2Scores, myTeam === 1)}
          <div className="h-px bg-border mx-2" />
          {renderTeamRow(team2, team2WonMatch, team2Scores, team1Scores, myTeam === 2)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Sticky header */}
      <div className="sticky top-0 z-30 bg-background -mx-4 px-4 pt-2 pb-2 space-y-2 shadow-sm">
        <h2 className="text-xl font-bold">My Matches</h2>

        {/* Filter bar */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setShowFilters(!showFilters)}
            className={`text-sm px-2 py-1 rounded-lg transition-colors ${showFilters ? "bg-black text-white" : "bg-gray-100 text-muted hover:text-foreground"}`}>
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

        {/* Stats — compact */}
        <div className="flex gap-2">
          <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1 text-center flex items-center justify-center gap-1.5">
            <span className="text-sm font-bold">{stats.total}</span>
            <span className="text-[10px] text-muted">Played</span>
          </div>
          <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1 text-center flex items-center justify-center gap-1.5">
            <span className="text-sm font-bold text-green-600">{stats.wins}</span>
            <span className="text-[10px] text-muted">Wins</span>
          </div>
          <div className="flex-1 bg-card rounded-lg border border-border px-2 py-1 text-center flex items-center justify-center gap-1.5">
            <span className="text-sm font-bold text-red-500">{stats.losses}</span>
            <span className="text-[10px] text-muted">Losses</span>
          </div>
        </div>
      </div>{/* end sticky */}

      {/* Filter panel */}
      {showFilters && (
        <div className={`${frameClass} p-3 space-y-3`}>
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

      {/* Match list — grouped. The sticky header + stats render
          even while loading; only the data area shows the spinner. */}
      {loading ? (
        <LoadingState label="Loading your matches…" />
      ) : !showFilters && (
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
