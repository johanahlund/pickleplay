"use client";

import {
  MATCH_FORMATS,
  BRACKET_STAGE_LABELS,
} from "@/lib/competition/types";

interface PairPlayer {
  id: string;
  name: string;
  emoji: string;
  rating: number;
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

interface StepManageBracketProps {
  bracket: "upper" | "lower";
  matches: Match[];
  numCourts: number;
}

export function StepManageBracket({ bracket, matches, numCourts }: StepManageBracketProps) {
  const prefix = bracket;
  const bracketMatches = matches.filter((m) => m.bracketStage?.startsWith(`${prefix}_`));

  if (bracketMatches.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-sm text-muted text-center">
          {bracket === "upper" ? "Upper" : "Lower"} bracket not started yet. Complete group stage and advance first.
        </p>
      </div>
    );
  }

  // Courts currently in use
  const busyCourts = new Set(
    matches.filter((m) => m.status === "active").map((m) => m.courtNum)
  );

  // Next pending matches
  const pendingReady = bracketMatches
    .filter((m) => m.status === "pending" && m.players.length >= 2)
    .sort((a, b) => (a.bracketPosition || 0) - (b.bracketPosition || 0));
  const nextMatchIds = new Set(pendingReady.slice(0, numCourts).map((m) => m.id));

  const courtAvailableMatchIds = new Set<string>();
  for (const m of pendingReady) {
    if (!busyCourts.has(m.courtNum)) courtAvailableMatchIds.add(m.id);
  }

  // Group by stage
  const stageOrder = ["r32", "r16", "qf", "sf", "f", "3rd"];
  const grouped = new Map<string, Match[]>();
  for (const m of bracketMatches) {
    const stage = m.bracketStage!;
    if (!grouped.has(stage)) grouped.set(stage, []);
    grouped.get(stage)!.push(m);
  }
  const stages = [...grouped.entries()].sort((a, b) => {
    const aIdx = stageOrder.indexOf(a[0].replace(`${prefix}_`, ""));
    const bIdx = stageOrder.indexOf(b[0].replace(`${prefix}_`, ""));
    return aIdx - bIdx;
  });

  return (
    <div className="space-y-3">
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
                    courtFree ? "bg-green-50 border-green-200" : isNext ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-border"
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
}
