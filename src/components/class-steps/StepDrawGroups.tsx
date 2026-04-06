"use client";

import { useState } from "react";
import { CompetitionConfig } from "@/lib/competition/types";

interface PairPlayer {
  id: string;
  name: string;
  emoji: string;
  rating: number;
}

interface EventPair {
  id: string;
  player1: PairPlayer;
  player2: PairPlayer;
  groupLabel?: string | null;
  seed?: number | null;
}

interface Match {
  id: string;
  courtNum: number;
  round: number;
  status: string;
  groupLabel?: string | null;
  bracketStage?: string | null;
  bracketPosition?: number | null;
  matchFormat?: string | null;
  players: {
    id: string;
    playerId: string;
    team: number;
    score: number;
    player: PairPlayer;
  }[];
}

interface GroupStanding {
  pairId: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  pair: EventPair;
}

interface StepDrawGroupsProps {
  eventId: string;
  classId: string;
  config: CompetitionConfig;
  pairs: EventPair[];
  matches: Match[];
  canManage: boolean;
  numCourts: number;
  onRefresh: () => void;
}

function pairName(pair: EventPair): string {
  return `${pair.player1.name} & ${pair.player2.name}`;
}

function speakText(text: string) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

export function StepDrawGroups({ eventId, classId, config, pairs, matches, canManage, onRefresh }: StepDrawGroupsProps) {
  const [loading, setLoading] = useState(false);
  const [movingPairId, setMovingPairId] = useState<string | null>(null);

  const api = async (path: string, body: object) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/events/${eventId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, classId }),
      });
      const data = await r.json();
      if (!r.ok) alert(data.error || "Error");
      onRefresh();
      return data;
    } finally {
      setLoading(false);
    }
  };

  const groupLabels = [...new Set(pairs.map((p) => p.groupLabel).filter(Boolean))] as string[];
  groupLabels.sort();

  const groupMatches = matches.filter((m) => m.groupLabel);
  const bracketMatches = matches.filter((m) => m.bracketStage);
  const allGroupsComplete = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed");
  const hasGroupMatches = groupMatches.length > 0;

  // Calculate standings
  const pairById = new Map(pairs.map((p) => [p.id, p]));
  const pairByPlayerId = new Map<string, string>();
  for (const pair of pairs) {
    pairByPlayerId.set(pair.player1.id, pair.id);
    pairByPlayerId.set(pair.player2.id, pair.id);
  }

  function getGroupStandings(label: string): GroupStanding[] {
    const groupPairIds = pairs.filter((p) => p.groupLabel === label).map((p) => p.id);
    const standings = new Map<string, Omit<GroupStanding, "pair">>();

    for (const pairId of groupPairIds) {
      standings.set(pairId, {
        pairId, played: 0, wins: 0, losses: 0,
        pointsFor: 0, pointsAgainst: 0, pointDiff: 0,
      });
    }

    for (const match of groupMatches.filter((m) => m.groupLabel === label && m.status === "completed")) {
      const t1 = match.players.filter((p) => p.team === 1);
      const t2 = match.players.filter((p) => p.team === 2);
      const t1Score = t1.reduce((s, p) => s + p.score, 0);
      const t2Score = t2.reduce((s, p) => s + p.score, 0);

      const pair1Id = t1.length > 0 ? pairByPlayerId.get(t1[0].playerId) : undefined;
      const pair2Id = t2.length > 0 ? pairByPlayerId.get(t2[0].playerId) : undefined;
      if (!pair1Id || !pair2Id) continue;
      const s1 = standings.get(pair1Id);
      const s2 = standings.get(pair2Id);
      if (!s1 || !s2) continue;

      s1.played++; s2.played++;
      s1.pointsFor += t1Score; s1.pointsAgainst += t2Score;
      s2.pointsFor += t2Score; s2.pointsAgainst += t1Score;

      if (t1Score > t2Score) { s1.wins++; s2.losses++; }
      else if (t2Score > t1Score) { s2.wins++; s1.losses++; }
    }

    return [...standings.values()]
      .map((s) => ({ ...s, pointDiff: s.pointsFor - s.pointsAgainst, pair: pairById.get(s.pairId)! }))
      .sort((a, b) => b.wins - a.wins || b.pointDiff - a.pointDiff || b.pointsFor - a.pointsFor);
  }

  // No groups drawn yet
  if (groupLabels.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <p className="text-sm text-muted text-center">Groups not yet drawn. Seed pairs into groups to begin.</p>
        {pairs.length < config.numGroups * 2 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
            Need at least {config.numGroups * 2} pairs for {config.numGroups} groups. Currently {pairs.length} pair{pairs.length !== 1 ? "s" : ""}.
          </p>
        )}
        {canManage && pairs.length >= config.numGroups * 2 && (
          <button onClick={() => api("/competition/groups", { action: "seed" })}
            disabled={loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50">
            Draw Groups ({pairs.length} pairs → {config.numGroups} groups)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Redraw / Clear */}
      {canManage && (
        <div className="flex gap-2">
          <button onClick={() => {
            const msg = hasGroupMatches
              ? "This will delete all current group matches and redraw groups. Continue?"
              : "Redraw all groups?";
            if (confirm(msg)) api("/competition/groups", { action: "seed" });
          }}
            disabled={loading}
            className="flex-1 py-2 text-xs font-medium text-action border border-action/30 rounded-lg hover:bg-action/5 disabled:opacity-50">
            Redraw Groups
          </button>
          <button onClick={() => {
            const hasResults = groupMatches.some((m) => m.status === "completed");
            const msg = hasResults
              ? "WARNING: This will delete ALL group matches including scored results.\n\nClear all groups?"
              : hasGroupMatches
                ? "This will delete all group matches and clear group assignments. Continue?"
                : "Clear all group assignments?";
            if (confirm(msg)) api("/competition/groups", { action: "clear" });
          }}
            disabled={loading}
            className="py-2 px-3 text-xs font-medium text-danger border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
            Clear Groups
          </button>
        </div>
      )}

      {/* Move pair selector */}
      {movingPairId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-amber-800">Move to which group?</p>
          <div className="flex gap-2">
            {groupLabels.map((label) => (
              <button key={label} onClick={async () => {
                await api("/competition/groups", { action: "move_pair", pairId: movingPairId, targetGroup: label });
                setMovingPairId(null);
              }} className="flex-1 py-2 rounded-lg text-sm font-bold bg-white border border-amber-300 hover:bg-amber-100 transition-colors">
                {label}
              </button>
            ))}
            <button onClick={() => setMovingPairId(null)} className="px-3 py-2 text-xs text-muted hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}

      {/* Group tables */}
      {groupLabels.map((label) => {
        const standings = getGroupStandings(label);
        return (
          <div key={label} className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-border">
              <h4 className="font-bold text-sm">Group {label}</h4>
              <button onClick={() => {
                const names = standings.map((s) => pairName(s.pair)).join(", ");
                speakText(`Group ${label}: ${names}`);
              }} className="text-xl px-1" title="Announce group">🔊</button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-border">
                  <th className="text-left px-3 py-1.5">#</th>
                  <th className="text-left py-1.5">Team</th>
                  <th className="text-center py-1.5">P</th>
                  <th className="text-center py-1.5">W</th>
                  <th className="text-center py-1.5">L</th>
                  <th className="text-center py-1.5">+/-</th>
                  {canManage && <th className="w-6"></th>}
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => {
                  const isAdvancing = i < config.advanceToUpper;
                  const isLower = i >= config.advanceToUpper && i < config.advanceToUpper + config.advanceToLower;
                  const isMoving = movingPairId === s.pairId;
                  return (
                    <tr key={s.pairId} className={`border-b border-border last:border-b-0 ${isMoving ? "bg-amber-100" : isAdvancing ? "bg-green-50" : isLower ? "bg-amber-50" : ""}`}>
                      <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                      <td className="py-2">
                        <span className="font-medium">{s.pair.player1.emoji}{s.pair.player2.emoji} {pairName(s.pair)}</span>
                      </td>
                      <td className="text-center py-2">{s.played}</td>
                      <td className="text-center py-2 font-bold">{s.wins}</td>
                      <td className="text-center py-2">{s.losses}</td>
                      <td className="text-center py-2 font-medium">{s.pointDiff > 0 ? "+" : ""}{s.pointDiff}</td>
                      {canManage && (
                        <td className="py-2 pr-2">
                          <button onClick={() => setMovingPairId(isMoving ? null : s.pairId)}
                            className={`text-[10px] px-1.5 py-0.5 rounded ${isMoving ? "bg-amber-200 text-amber-800" : "text-muted hover:text-foreground hover:bg-gray-100"}`}
                            title="Move to another group">
                            ↔
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-3 py-1.5 text-[10px] text-muted flex gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Advances (upper)</span>
              {config.advanceToLower > 0 && (
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Lower bracket</span>
              )}
            </div>
          </div>
        );
      })}

      {/* Generate group matches or advance */}
      {canManage && !hasGroupMatches && (
        <button onClick={() => api("/competition/groups", { action: "generate_matches" })}
          disabled={loading}
          className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50">
          Generate Group Matches
        </button>
      )}

      {canManage && allGroupsComplete && bracketMatches.length === 0 && (
        <button onClick={() => api("/competition/bracket", { action: "advance" })}
          disabled={loading}
          className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50">
          Advance to Bracket Stage
        </button>
      )}

      {/* Announce next match */}
      {hasGroupMatches && !allGroupsComplete && (
        <button onClick={() => {
          const nextMatch = groupMatches.find((m) => m.status === "pending");
          if (nextMatch) {
            const t1 = nextMatch.players.filter((p) => p.team === 1);
            const t2 = nextMatch.players.filter((p) => p.team === 2);
            speakText(`Next match, Group ${nextMatch.groupLabel}, Court ${nextMatch.courtNum}: ${t1.map((p) => p.player.name).join(" and ")} versus ${t2.map((p) => p.player.name).join(" and ")}`);
          }
        }} className="w-full py-2.5 text-center rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/5">
          🔊 Announce Next Match
        </button>
      )}
    </div>
  );
}
