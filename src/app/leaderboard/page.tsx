"use client";

import { useEffect, useState } from "react";
import { PlayerAvatar } from "@/components/PlayerAvatar";

interface Player {
  id: string;
  name: string;
  emoji: string;
  rating: number;
  wins: number;
  losses: number;
  role?: string;
}

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/players")
      .then((r) => r.json())
      .then((data) => {
        setPlayers(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="text-center py-12 text-muted">Loading...</div>;
  }

  const ranked = players
    .filter((p) => p.wins + p.losses > 0)
    .sort((a, b) => b.rating - a.rating);

  const unranked = players.filter((p) => p.wins + p.losses === 0);

  const getMedal = (i: number) => {
    if (i === 0) return "🥇";
    if (i === 1) return "🥈";
    if (i === 2) return "🥉";
    return `#${i + 1}`;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">🏆 Leaderboard</h2>

      {ranked.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">🏆</div>
          <p className="text-muted">No ranked players yet.</p>
          <p className="text-sm text-muted mt-1">Play some matches to see rankings!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ranked.map((p, i) => (
            <div
              key={p.id}
              className={`bg-card rounded-xl border p-3 flex items-center gap-3 ${
                i === 0
                  ? "border-yellow-400 bg-yellow-50"
                  : i === 1
                  ? "border-gray-300 bg-gray-50"
                  : i === 2
                  ? "border-amber-600/30 bg-amber-50"
                  : "border-border"
              }`}
            >
              <span className="text-2xl w-10 text-center font-bold">
                {getMedal(i)}
              </span>
              <PlayerAvatar name={p.name} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="font-semibold truncate">{p.name}</span>
                  {p.role === "admin" && (
                    <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                      Admin
                    </span>
                  )}
                </div>
                <div className="text-sm text-muted">
                  {p.wins}W / {p.losses}L &middot;{" "}
                  {p.wins + p.losses > 0
                    ? Math.round((p.wins / (p.wins + p.losses)) * 100)
                    : 0}
                  % win rate
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-primary">
                  {Math.round(p.rating)}
                </div>
                <div className="text-[11px] text-muted">ELO</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {unranked.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-muted mt-6">
            Unranked ({unranked.length})
          </h3>
          <div className="space-y-2">
            {unranked.map((p) => (
              <div
                key={p.id}
                className="bg-card rounded-xl border border-border p-3 flex items-center gap-3 opacity-60"
              >
                <span className="text-2xl w-10 text-center">-</span>
                <PlayerAvatar name={p.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold truncate">{p.name}</span>
                    {p.role === "admin" && (
                      <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted">No games played</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-muted">1000</div>
                  <div className="text-[11px] text-muted">ELO</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
