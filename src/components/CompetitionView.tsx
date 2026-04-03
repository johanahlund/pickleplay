"use client";

import { useState } from "react";
import {
  CompetitionConfig,
  DEFAULT_COMPETITION_CONFIG,
  MATCH_FORMATS,
  getBracketStages,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";

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
}

interface CompetitionViewProps {
  eventId: string;
  pairs: EventPair[];
  matches: Match[];
  competitionMode: string | null;
  competitionConfig: CompetitionConfig | null;
  competitionPhase: string | null;
  canManage: boolean;
  numCourts: number;
  onRefresh: () => void;
}

function speakText(text: string) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

function pairName(pair: EventPair): string {
  return `${pair.player1.name} & ${pair.player2.name}`;
}

export function CompetitionView({
  eventId,
  pairs,
  matches,
  competitionMode,
  competitionConfig,
  competitionPhase,
  canManage,
  numCourts,
  onRefresh,
}: CompetitionViewProps) {
  const config: CompetitionConfig = competitionConfig
    ? { ...DEFAULT_COMPETITION_CONFIG, ...competitionConfig }
    : DEFAULT_COMPETITION_CONFIG;
  const [loading, setLoading] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);
  const [localConfig, setLocalConfig] = useState<CompetitionConfig>(config);

  const api = async (path: string, body: object) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/events/${eventId}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) alert(data.error || "Error");
      onRefresh();
      return data;
    } finally {
      setLoading(false);
    }
  };

  // ── Not enabled yet ──
  if (!competitionMode) {
    if (!canManage) return null;
    return (
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <h3 className="text-lg font-bold">Competition Mode</h3>
        <p className="text-sm text-muted">
          Run a Groups → Elimination tournament. Pairs are divided into groups
          for round-robin play, then top teams advance to a knockout bracket.
        </p>
        {pairs.length < 2 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-medium">Set up pairs first</p>
            <p className="text-xs mt-1">Go back and create at least 4 pairs in the Pairs section before enabling competition mode.</p>
          </div>
        ) : pairs.length < 4 ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            <p className="font-medium">Need more pairs</p>
            <p className="text-xs mt-1">You have {pairs.length} pair{pairs.length !== 1 ? "s" : ""}. Add at least {4 - pairs.length} more to enable competition mode.</p>
          </div>
        ) : (
          <button
            onClick={() => api("/competition", { action: "enable" })}
            disabled={loading}
            className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50"
          >
            Enable Competition Mode ({pairs.length} pairs)
          </button>
        )}
      </div>
    );
  }

  // Group data
  const groupLabels = [...new Set(pairs.map((p) => p.groupLabel).filter(Boolean))] as string[];
  groupLabels.sort();

  const groupMatches = matches.filter((m) => m.groupLabel);
  const bracketMatches = matches.filter((m) => m.bracketStage);
  const allGroupsComplete = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed");
  const hasGroupMatches = groupMatches.length > 0;

  // Courts currently in use (have an active/pending-but-playing match)
  const busyCourts = new Set(
    matches
      .filter((m) => m.status === "active" || (m.status === "pending" && m.players.length > 0))
      .filter((m) => m.status === "active")
      .map((m) => m.courtNum)
  );

  // Next pending matches (ready to play = have players assigned)
  const pendingReady = matches
    .filter((m) => m.status === "pending" && m.players.length >= 2)
    .sort((a, b) => {
      // Bracket ready matches first, then group, then by round
      const aP = a.bracketStage ? 0 : 1;
      const bP = b.bracketStage ? 0 : 1;
      if (aP !== bP) return aP - bP;
      return a.round - b.round;
    });
  const nextMatchIds = new Set(pendingReady.slice(0, numCourts).map((m) => m.id));

  // Which of the next matches have a free court?
  const courtAvailableMatchIds = new Set<string>();
  for (const m of pendingReady) {
    if (!busyCourts.has(m.courtNum)) {
      courtAvailableMatchIds.add(m.id);
    }
  }

  // Calculate standings per group (client-side for display)
  const pairById = new Map(pairs.map((p) => [p.id, p]));
  const pairByPlayerId = new Map<string, string>();
  for (const pair of pairs) {
    pairByPlayerId.set(pair.player1.id, pair.id);
    pairByPlayerId.set(pair.player2.id, pair.id);
  }

  function getGroupStandings(label: string): (GroupStanding & { pair: EventPair })[] {
    const groupPairIds = pairs.filter((p) => p.groupLabel === label).map((p) => p.id);
    const standings = new Map<string, GroupStanding>();

    for (const pairId of groupPairIds) {
      standings.set(pairId, {
        pairId,
        played: 0, wins: 0, losses: 0,
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

  // ── Config editor ──
  const renderConfig = () => (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">Competition Settings</h3>
        {canManage && !editingConfig && (
          <button onClick={() => { setLocalConfig(config); setEditingConfig(true); }}
            className="text-sm text-primary font-medium">Edit</button>
        )}
      </div>

      {editingConfig ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Groups</label>
            <div className="flex items-center gap-0">
              <button onClick={() => setLocalConfig({ ...localConfig, numGroups: Math.max(1, localConfig.numGroups - 1) })}
                className="w-12 h-12 rounded-l-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">−</button>
              <div className="w-12 h-12 bg-selected text-white font-bold text-2xl flex items-center justify-center">{localConfig.numGroups}</div>
              <button onClick={() => setLocalConfig({ ...localConfig, numGroups: Math.min(10, localConfig.numGroups + 1) })}
                className="w-12 h-12 rounded-r-xl bg-gray-200 text-foreground font-bold text-2xl flex items-center justify-center active:bg-gray-300">+</button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Matches per matchup in group</label>
            <div className="flex gap-2">
              {[1, 2].map((n) => (
                <button key={n} onClick={() => setLocalConfig({ ...localConfig, matchesPerMatchup: n })}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${localConfig.matchesPerMatchup === n ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {n === 1 ? "Once" : "Twice"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Group seeding</label>
            <div className="flex gap-2">
              {(["rating", "skill_level", "random"] as const).map((s) => (
                <button key={s} onClick={() => setLocalConfig({ ...localConfig, groupSeeding: s })}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${localConfig.groupSeeding === s ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {s === "rating" ? "Rating" : s === "skill_level" ? "Skill Level" : "Random"}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Advance to upper bracket</label>
              <div className="flex gap-1">
                {[1, 2, 3].map((n) => (
                  <button key={n} onClick={() => setLocalConfig({ ...localConfig, advanceToUpper: n })}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm ${localConfig.advanceToUpper === n ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Advance to lower bracket</label>
              <div className="flex gap-1">
                {[0, 1, 2].map((n) => (
                  <button key={n} onClick={() => setLocalConfig({ ...localConfig, advanceToLower: n })}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm ${localConfig.advanceToLower === n ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                    {n === 0 ? "None" : String(n)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Wildcards</label>
              <div className="flex gap-1">
                {[0, 1, 2].map((n) => (
                  <button key={n} onClick={() => setLocalConfig({ ...localConfig, wildcardCount: n })}
                    className={`flex-1 py-2 rounded-lg font-medium text-sm ${localConfig.wildcardCount === n ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {localConfig.wildcardCount > 0 && (
              <div className="flex-1">
                <label className="block text-xs text-muted mb-1">Wildcard criteria</label>
                <div className="flex gap-1">
                  {(["point_diff", "wins", "total_points"] as const).map((c) => (
                    <button key={c} onClick={() => setLocalConfig({ ...localConfig, wildcardCriteria: c })}
                      className={`flex-1 py-1.5 rounded-lg font-medium text-[11px] ${localConfig.wildcardCriteria === c ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                      {c === "point_diff" ? "Pt diff" : c === "wins" ? "Wins" : "Total pts"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Bracket seeding</label>
            <div className="flex gap-2">
              {(["cross_group", "snake", "random"] as const).map((s) => (
                <button key={s} onClick={() => setLocalConfig({ ...localConfig, bracketSeeding: s })}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-all ${localConfig.bracketSeeding === s ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {s === "cross_group" ? "Cross-group" : s === "snake" ? "Snake" : "Random"}
                </button>
              ))}
            </div>
          </div>

          {/* Bracket format per round */}
          {(() => {
            const numAdvancing = localConfig.numGroups * localConfig.advanceToUpper + localConfig.wildcardCount;
            const stages = getBracketStages(numAdvancing);
            if (stages.length === 0) return null;
            return (
              <div>
                <label className="block text-xs text-muted mb-1">Upper bracket match format</label>
                <div className="space-y-1">
                  {stages.map((stage) => (
                    <div key={stage} className="flex items-center gap-2">
                      <span className="text-xs text-muted w-16">{BRACKET_STAGE_LABELS[stage] || stage}</span>
                      <select
                        value={localConfig.upperBracketFormats[stage] || "to_11"}
                        onChange={(e) => {
                          const newFormats = { ...localConfig.upperBracketFormats };
                          newFormats[stage] = e.target.value;
                          // Cascade: set subsequent stages to same value if not already set
                          const stageIdx = stages.indexOf(stage);
                          for (let i = stageIdx + 1; i < stages.length; i++) {
                            if (!localConfig.upperBracketFormats[stages[i]]) {
                              newFormats[stages[i]] = e.target.value;
                            }
                          }
                          setLocalConfig({ ...localConfig, upperBracketFormats: newFormats });
                        }}
                        className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5"
                      >
                        {MATCH_FORMATS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={localConfig.upperThirdPlace}
              onChange={(e) => setLocalConfig({ ...localConfig, upperThirdPlace: e.target.checked })}
              className="rounded border-border" />
            3rd place match (upper bracket)
          </label>

          {/* Lower bracket config */}
          {localConfig.advanceToLower > 0 && (() => {
            const numLower = localConfig.numGroups * localConfig.advanceToLower;
            const lowerStages = getBracketStages(numLower);
            if (lowerStages.length === 0) return null;
            return (
              <>
                <div className="border-t border-border pt-3 mt-2">
                  <p className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">Lower Bracket</p>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Lower bracket match format</label>
                  <div className="space-y-1">
                    {lowerStages.map((stage) => (
                      <div key={stage} className="flex items-center gap-2">
                        <span className="text-xs text-muted w-16">{BRACKET_STAGE_LABELS[stage] || stage}</span>
                        <select
                          value={localConfig.lowerBracketFormats[stage] || "to_11"}
                          onChange={(e) => {
                            const newFormats = { ...localConfig.lowerBracketFormats };
                            newFormats[stage] = e.target.value;
                            const stageIdx = lowerStages.indexOf(stage);
                            for (let i = stageIdx + 1; i < lowerStages.length; i++) {
                              if (!localConfig.lowerBracketFormats[lowerStages[i]]) {
                                newFormats[lowerStages[i]] = e.target.value;
                              }
                            }
                            setLocalConfig({ ...localConfig, lowerBracketFormats: newFormats });
                          }}
                          className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5"
                        >
                          {MATCH_FORMATS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={localConfig.lowerThirdPlace}
                    onChange={(e) => setLocalConfig({ ...localConfig, lowerThirdPlace: e.target.checked })}
                    className="rounded border-border" />
                  3rd place match (lower bracket)
                </label>
              </>
            );
          })()}

          <div className="flex gap-2">
            <button onClick={async () => {
              await api("/competition", { action: "update_config", config: localConfig });
              setEditingConfig(false);
            }} disabled={loading} className="flex-1 bg-action-dark text-white py-2 rounded-lg font-medium text-sm disabled:opacity-50">Save</button>
            <button onClick={() => setEditingConfig(false)} className="flex-1 bg-gray-100 text-foreground py-2 rounded-lg font-medium text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted">Groups</span><span className="font-medium">{config.numGroups}</span></div>
          <div className="flex justify-between"><span className="text-muted">Matches per matchup</span><span className="font-medium">{config.matchesPerMatchup === 1 ? "Once" : "Twice"}</span></div>
          <div className="flex justify-between"><span className="text-muted">Seeding</span><span className="font-medium capitalize">{config.groupSeeding.replace("_", " ")}</span></div>
          <div className="flex justify-between"><span className="text-muted">Advance upper</span><span className="font-medium">{config.advanceToUpper} per group{config.wildcardCount > 0 ? ` + ${config.wildcardCount} wildcard` : ""}</span></div>
          {config.advanceToLower > 0 && (
            <div className="flex justify-between"><span className="text-muted">Advance lower</span><span className="font-medium">{config.advanceToLower} per group</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted">Bracket seeding</span><span className="font-medium capitalize">{config.bracketSeeding.replace("_", " ")}</span></div>
          <div className="flex justify-between"><span className="text-muted">3rd place (upper)</span><span className="font-medium">{config.upperThirdPlace ? "Yes" : "No"}</span></div>
          {config.advanceToLower > 0 && (
            <>
              <div className="flex justify-between"><span className="text-muted">Lower bracket</span><span className="font-medium">{config.advanceToLower} per group</span></div>
              <div className="flex justify-between"><span className="text-muted">3rd place (lower)</span><span className="font-medium">{config.lowerThirdPlace ? "Yes" : "No"}</span></div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-muted">Tiebreakers</span>
            <span className="font-medium text-xs">{config.tiebreakers.map((t) => t.replace("_", " ")).join(" → ")}</span>
          </div>
        </div>
      )}
    </div>
  );

  // ── Group stage ──
  const renderGroups = () => (
    <div className="space-y-3">
      {groupLabels.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-4 space-y-3">
          <p className="text-sm text-muted text-center">Groups not yet drawn. Seed pairs into groups to begin.</p>
          {canManage && (
            <button onClick={() => api("/competition/groups", { action: "seed" })}
              disabled={loading}
              className="w-full bg-action text-white py-2.5 rounded-xl font-semibold active:bg-action-dark disabled:opacity-50">
              Draw Groups
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Group tables */}
          {groupLabels.map((label) => {
            const standings = getGroupStandings(label);
            const groupMatchList = groupMatches.filter((m) => m.groupLabel === label);
            return (
              <div key={label} className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-border">
                  <h4 className="font-bold text-sm">Group {label}</h4>
                  <button onClick={() => {
                    const names = standings.map((s) => pairName(s.pair)).join(", ");
                    speakText(`Group ${label}: ${names}`);
                  }} className="text-xl px-1" title="Announce group">🔊</button>
                </div>
                {/* Standings table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted border-b border-border">
                      <th className="text-left px-3 py-1.5">#</th>
                      <th className="text-left py-1.5">Team</th>
                      <th className="text-center py-1.5">P</th>
                      <th className="text-center py-1.5">W</th>
                      <th className="text-center py-1.5">L</th>
                      <th className="text-center py-1.5">+/-</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s, i) => {
                      const isAdvancing = i < config.advanceToUpper;
                      const isLower = i >= config.advanceToUpper && i < config.advanceToUpper + config.advanceToLower;
                      return (
                        <tr key={s.pairId} className={`border-b border-border last:border-b-0 ${isAdvancing ? "bg-green-50" : isLower ? "bg-amber-50" : ""}`}>
                          <td className="px-3 py-2 font-bold text-muted">{i + 1}</td>
                          <td className="py-2">
                            <span className="font-medium">{s.pair.player1.emoji}{s.pair.player2.emoji} {pairName(s.pair)}</span>
                          </td>
                          <td className="text-center py-2">{s.played}</td>
                          <td className="text-center py-2 font-bold">{s.wins}</td>
                          <td className="text-center py-2">{s.losses}</td>
                          <td className="text-center py-2 font-medium">{s.pointDiff > 0 ? "+" : ""}{s.pointDiff}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Group legend */}
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

          {/* Announce next match button */}
          {hasGroupMatches && !allGroupsComplete && (
            <button onClick={() => {
              const nextMatch = groupMatches.find((m) => m.status === "pending");
              if (nextMatch) {
                const t1 = nextMatch.players.filter((p) => p.team === 1);
                const t2 = nextMatch.players.filter((p) => p.team === 2);
                const t1Names = t1.map((p) => p.player.name).join(" and ");
                const t2Names = t2.map((p) => p.player.name).join(" and ");
                speakText(`Next match, Group ${nextMatch.groupLabel}, Court ${nextMatch.courtNum}: ${t1Names} versus ${t2Names}`);
              }
            }} className="w-full py-2.5 text-center rounded-xl text-sm font-semibold border border-primary text-primary hover:bg-primary/5">
              🔊 Announce Next Match
            </button>
          )}
        </>
      )}
    </div>
  );

  // ── Bracket stage ──
  const renderBracket = () => {
    if (bracketMatches.length === 0) return null;

    const upperMatches = bracketMatches.filter((m) => m.bracketStage?.startsWith("upper_"));
    const lowerMatches = bracketMatches.filter((m) => m.bracketStage?.startsWith("lower_"));

    // Group by stage
    const stageOrder = ["r32", "r16", "qf", "sf", "f", "3rd"];
    const groupByStage = (matches: Match[], prefix: string) => {
      const grouped = new Map<string, Match[]>();
      for (const m of matches) {
        const stage = m.bracketStage!;
        if (!grouped.has(stage)) grouped.set(stage, []);
        grouped.get(stage)!.push(m);
      }
      // Sort stages
      return [...grouped.entries()].sort((a, b) => {
        const aIdx = stageOrder.indexOf(a[0].replace(`${prefix}_`, ""));
        const bIdx = stageOrder.indexOf(b[0].replace(`${prefix}_`, ""));
        return aIdx - bIdx;
      });
    };

    const renderBracketSection = (title: string, stages: [string, Match[]][], prefix: string) => (
      <div className="space-y-3">
        <h3 className="text-lg font-bold">{title}</h3>
        {stages.map(([stage, stageMatches]) => {
          const stageLabel = BRACKET_STAGE_LABELS[stage.replace(`${prefix}_`, "")] || stage;
          return (
            <div key={stage} className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-muted uppercase tracking-wider">{stageLabel}</h4>
                {stageMatches.some((m) => m.matchFormat) && (
                  <span className="text-[10px] text-muted">
                    {MATCH_FORMATS.find((f) => f.value === stageMatches[0].matchFormat)?.label || stageMatches[0].matchFormat}
                  </span>
                )}
              </div>
              {stageMatches.sort((a, b) => (a.bracketPosition || 0) - (b.bracketPosition || 0)).map((match) => {
                const t1 = match.players.filter((p) => p.team === 1);
                const t2 = match.players.filter((p) => p.team === 2);
                const isCompleted = match.status === "completed";
                const t1Score = isCompleted ? t1.reduce((s, p) => s + p.score, 0) : null;
                const t2Score = isCompleted ? t2.reduce((s, p) => s + p.score, 0) : null;
                const t1Won = t1Score !== null && t2Score !== null && t1Score > t2Score;
                const t2Won = t1Score !== null && t2Score !== null && t2Score > t1Score;
                const hasPairs = t1.length > 0 && t2.length > 0;
                const isNext = nextMatchIds.has(match.id);
                const courtFree = courtAvailableMatchIds.has(match.id);

                return (
                  <div key={match.id} className={`bg-card rounded-xl border overflow-hidden transition-all ${
                    courtFree
                      ? "border-green-400 ring-2 ring-green-300/50 shadow-md shadow-green-100"
                      : isNext
                        ? "border-blue-300 ring-1 ring-blue-200/50"
                        : "border-border"
                  }`}>
                    <div className={`px-3 py-1.5 border-b flex items-center justify-between ${
                      courtFree
                        ? "bg-green-50 border-green-200"
                        : isNext
                          ? "bg-blue-50 border-blue-200"
                          : "bg-gray-50 border-border"
                    }`}>
                      <span className={`text-xs font-medium ${courtFree ? "text-green-700" : isNext ? "text-blue-600" : "text-muted"}`}>
                        Court {match.courtNum}
                        {courtFree && " — Ready to play!"}
                        {isNext && !courtFree && " — Up next"}
                      </span>
                      {isCompleted && <span className="text-xs text-green-600 font-medium">Final</span>}
                      {!hasPairs && !isNext && <span className="text-xs text-muted italic">TBD</span>}
                    </div>
                    {hasPairs ? (
                      <div className="p-3 space-y-1">
                        <div className={`flex items-center gap-2 p-1.5 rounded ${t1Won ? "bg-green-50" : ""}`}>
                          <div className="flex-1 flex items-center gap-1 text-sm">
                            {t1.map((p) => (
                              <span key={p.id}>{p.player.emoji} <span className={t1Won ? "font-bold" : "font-medium"}>{p.player.name}</span></span>
                            ))}
                          </div>
                          {t1Score !== null && (
                            <span className={`text-lg font-bold ${t1Won ? "text-green-600" : "text-gray-400"}`}>{t1Score}</span>
                          )}
                        </div>
                        <div className="text-center text-[10px] text-muted">vs</div>
                        <div className={`flex items-center gap-2 p-1.5 rounded ${t2Won ? "bg-green-50" : ""}`}>
                          <div className="flex-1 flex items-center gap-1 text-sm">
                            {t2.map((p) => (
                              <span key={p.id}>{p.player.emoji} <span className={t2Won ? "font-bold" : "font-medium"}>{p.player.name}</span></span>
                            ))}
                          </div>
                          {t2Score !== null && (
                            <span className={`text-lg font-bold ${t2Won ? "text-green-600" : "text-gray-400"}`}>{t2Score}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 text-center text-sm text-muted">Waiting for previous matches</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );

    return (
      <div className="space-y-4">
        {upperMatches.length > 0 && renderBracketSection("Upper Bracket", groupByStage(upperMatches, "upper"), "upper")}
        {lowerMatches.length > 0 && renderBracketSection("Lower Bracket", groupByStage(lowerMatches, "lower"), "lower")}
      </div>
    );
  };

  // ── Main render ──
  return (
    <div className="space-y-4">
      {renderConfig()}
      {renderGroups()}
      {renderBracket()}

      {/* Disable competition */}
      {canManage && (
        <button onClick={() => {
          if (confirm("Disable competition mode? This will remove all group and bracket data from matches.")) {
            api("/competition", { action: "disable" });
          }
        }} className="w-full py-2 text-xs text-danger font-medium rounded-xl border border-red-200 hover:bg-red-50">
          Disable Competition Mode
        </button>
      )}
    </div>
  );
}
