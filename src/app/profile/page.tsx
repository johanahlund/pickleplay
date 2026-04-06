"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { PlayerAvatar } from "@/components/PlayerAvatar";

interface RatingData {
  player: { id: string; name: string; emoji: string };
  legacy: { rating: number; wins: number; losses: number };
  global: { rating: number | null; confidence: number; wins: number; losses: number };
  dupr: { rating: number | null; id: string | null };
  clubs: {
    clubId: string; clubName: string; clubEmoji: string;
    clubRating: number; clubWins: number; clubLosses: number;
    estimatedGlobal: number | null; globalIsEstimate: boolean; globalConfidence: string;
  }[];
}

interface CompResult {
  id: string;
  eventId: string;
  classId: string;
  groupLabel?: string | null;
  groupPosition?: number | null;
  groupWins: number;
  groupLosses: number;
  bracketReached?: string | null;
  finalPlacement?: number | null;
}

interface RecentMatch {
  id: string;
  status: string;
  courtNum: number;
  createdAt: string;
  event: { id: string; name: string; date: string };
  class?: { format: string } | null;
  players: { playerId: string; team: number; score: number; player: { name: string; emoji: string } }[];
}

const BRACKET_LABELS: Record<string, string> = {
  winner: "🥇 Winner", f: "🥈 Finalist", "3rd": "🥉 3rd", sf: "Semi-final", qf: "Quarter-final",
};

export default function ProfilePage() {
  const { data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const [ratings, setRatings] = useState<RatingData | null>(null);
  const [results, setResults] = useState<CompResult[]>([]);
  const [matches, setMatches] = useState<RecentMatch[]>([]);
  const [tab, setTab] = useState<"all" | "social" | "competition">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    Promise.all([
      fetch(`/api/players/${userId}/ratings`).then((r) => r.ok ? r.json() : null),
      fetch("/api/matches/my").then((r) => r.ok ? r.json() : []),
    ]).then(([ratingsData, matchesData]) => {
      setRatings(ratingsData);
      setMatches(Array.isArray(matchesData) ? matchesData.slice(0, 30) : []);
      setLoading(false);
    });
  }, [userId]);

  if (!session?.user) return <p className="text-center py-12 text-muted">Please sign in</p>;
  if (loading) return <p className="text-center py-12 text-muted">Loading...</p>;

  const totalWins = ratings?.legacy.wins || 0;
  const totalLosses = ratings?.legacy.losses || 0;
  const totalMatches = totalWins + totalLosses;
  const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

  // Calculate streak
  let streak = 0;
  let streakType = "";
  for (const m of matches) {
    const myTeam = m.players.find((p) => p.playerId === userId)?.team;
    if (!myTeam || m.status !== "completed") continue;
    const team1Score = m.players.filter((p) => p.team === 1).reduce((s, p) => s + p.score, 0);
    const team2Score = m.players.filter((p) => p.team === 2).reduce((s, p) => s + p.score, 0);
    const won = (myTeam === 1 && team1Score > team2Score) || (myTeam === 2 && team2Score > team1Score);
    const type = won ? "W" : "L";
    if (!streakType) streakType = type;
    if (type === streakType) streak++;
    else break;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center py-4">
        <PlayerAvatar name={session.user.name || ""} size="lg" />
        <h2 className="text-xl font-bold mt-2">{session.user.name}</h2>
        <p className="text-sm text-muted">{session.user.email}</p>
      </div>

      {/* Rating cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{Math.round(ratings?.legacy.rating || 1000)}</div>
          <div className="text-[10px] text-muted">App Rating</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-2xl font-bold text-foreground">
            {ratings?.global.rating ? `${ratings.global.confidence < 4 ? "~" : ""}${Math.round(ratings.global.rating)}` : "—"}
          </div>
          <div className="text-[10px] text-muted">Global</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{ratings?.dupr.rating || "—"}</div>
          <div className="text-[10px] text-muted">DUPR</div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold">{totalMatches}</div>
          <div className="text-[9px] text-muted">Matches</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold">{winRate}%</div>
          <div className="text-[9px] text-muted">Win Rate</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold">{totalWins}</div>
          <div className="text-[9px] text-muted">Wins</div>
        </div>
        <div className="bg-card rounded-xl border border-border p-2 text-center">
          <div className="text-lg font-bold text-foreground">
            {streak > 0 ? `${streakType}${streak}` : "—"}
          </div>
          <div className="text-[9px] text-muted">Streak</div>
        </div>
      </div>

      {/* Club ratings */}
      {ratings && ratings.clubs.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 space-y-2">
          <h3 className="text-sm font-semibold">Club Ratings</h3>
          {ratings.clubs.map((c) => (
            <div key={c.clubId} className="flex items-center gap-2 py-1.5">
              <span className="text-lg">{c.clubEmoji}</span>
              <span className="text-sm font-medium flex-1">{c.clubName}</span>
              <div className="text-right">
                <span className="text-sm font-bold">{c.clubRating}</span>
                <span className="text-[10px] text-muted ml-1">{c.clubWins}W {c.clubLosses}L</span>
              </div>
              {c.estimatedGlobal && (
                <span className="text-[10px] text-muted bg-gray-100 px-1.5 py-0.5 rounded">
                  {c.globalIsEstimate ? "~" : ""}{c.estimatedGlobal} global
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tab toggle */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
        {(["all", "social", "competition"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
              tab === t ? "bg-white text-foreground shadow-sm" : "text-muted hover:text-foreground"
            }`}>{t}</button>
        ))}
      </div>

      {/* Recent matches */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Recent Matches</h3>
        {matches.length === 0 ? (
          <p className="text-xs text-muted text-center py-4">No matches yet</p>
        ) : (
          matches.slice(0, 15).map((m) => {
            const myTeam = m.players.find((p) => p.playerId === userId)?.team;
            const team1 = m.players.filter((p) => p.team === 1);
            const team2 = m.players.filter((p) => p.team === 2);
            const t1Score = team1.reduce((s, p) => s + p.score, 0);
            const t2Score = team2.reduce((s, p) => s + p.score, 0);
            const won = myTeam === 1 ? t1Score > t2Score : t2Score > t1Score;
            const myTeamPlayers = myTeam === 1 ? team1 : team2;
            const oppTeamPlayers = myTeam === 1 ? team2 : team1;

            return (
              <div key={m.id} className={`bg-card rounded-lg border px-3 py-2 ${won ? "border-green-200" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-1 text-xs">
                      {myTeamPlayers.map((p) => <span key={p.playerId}>{p.player.emoji}</span>)}
                      <span className="text-muted mx-1">vs</span>
                      {oppTeamPlayers.map((p) => <span key={p.playerId}>{p.player.emoji}</span>)}
                    </div>
                    <p className="text-[10px] text-muted mt-0.5">{m.event.name}</p>
                  </div>
                  <div className="text-right">
                    <span className={`text-sm font-bold ${won ? "text-green-600" : "text-gray-400"}`}>
                      {myTeam === 1 ? t1Score : t2Score}-{myTeam === 1 ? t2Score : t1Score}
                    </span>
                    <span className={`ml-1 text-xs font-medium ${won ? "text-green-600" : "text-danger"}`}>{won ? "W" : "L"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
