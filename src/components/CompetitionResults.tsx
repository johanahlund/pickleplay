"use client";

import { useState, useEffect } from "react";

interface Result {
  id: string;
  classId: string;
  playerId: string;
  pairId?: string | null;
  groupLabel?: string | null;
  groupPosition?: number | null;
  groupWins: number;
  groupLosses: number;
  groupPointDiff: number;
  bracketLevel?: string | null;
  bracketReached?: string | null;
  finalPlacement?: number | null;
}

interface CompetitionResultsProps {
  eventId: string;
  classes: { id: string; name: string }[];
  players: { playerId: string; player: { id: string; name: string; emoji: string } }[];
  canManage: boolean;
}

const PLACEMENT_LABELS: Record<string, string> = {
  winner: "🥇 Winner", f: "🥈 Finalist", "3rd": "🥉 3rd Place",
  sf: "Semi-final", qf: "Quarter-final", r16: "Round of 16", r32: "Round of 32",
};

export function CompetitionResults({ eventId, classes, players, canManage }: CompetitionResultsProps) {
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string>("all");

  useEffect(() => {
    fetch(`/api/events/${eventId}/results`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { setResults(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [eventId]);

  const generateResults = async () => {
    setGenerating(true);
    await fetch(`/api/events/${eventId}/results`, { method: "POST" });
    const r = await fetch(`/api/events/${eventId}/results`);
    const data = await r.json();
    setResults(Array.isArray(data) ? data : []);
    setGenerating(false);
  };

  const playerMap = new Map(players.map((p) => [p.playerId, p.player]));
  const classMap = new Map(classes.map((c) => [c.id, c.name]));

  const filtered = selectedClass === "all" ? results : results.filter((r) => r.classId === selectedClass);
  const sorted = [...filtered].sort((a, b) => (a.finalPlacement || 999) - (b.finalPlacement || 999));

  if (loading) return <p className="text-xs text-muted py-2">Loading results...</p>;

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Results</h4>
        {canManage && (
          <button onClick={generateResults} disabled={generating}
            className="text-xs text-action font-medium disabled:opacity-50">
            {generating ? "Generating..." : results.length > 0 ? "Refresh" : "Generate"}
          </button>
        )}
      </div>

      {results.length === 0 ? (
        <p className="text-xs text-muted text-center py-2">No results yet. Complete matches and generate results.</p>
      ) : (
        <>
          {/* Class filter */}
          {classes.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setSelectedClass("all")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${selectedClass === "all" ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                All
              </button>
              {classes.map((c) => (
                <button key={c.id} onClick={() => setSelectedClass(c.id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${selectedClass === c.id ? "bg-selected text-white" : "bg-gray-100 text-foreground"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {/* Results table */}
          <div className="space-y-1">
            {sorted.map((r) => {
              const player = playerMap.get(r.playerId);
              if (!player) return null;
              return (
                <div key={r.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
                  {r.finalPlacement && r.finalPlacement <= 3 && (
                    <span className="text-lg w-6 text-center">{r.finalPlacement === 1 ? "🥇" : r.finalPlacement === 2 ? "🥈" : "🥉"}</span>
                  )}
                  {(!r.finalPlacement || r.finalPlacement > 3) && (
                    <span className="text-xs text-muted w-6 text-center font-bold">{r.finalPlacement || "–"}</span>
                  )}
                  <span className="text-sm">{player.emoji}</span>
                  <span className="text-sm font-medium flex-1">{player.name}</span>
                  {selectedClass === "all" && classes.length > 1 && (
                    <span className="text-[9px] text-muted bg-gray-100 px-1.5 py-0.5 rounded">{classMap.get(r.classId)}</span>
                  )}
                  {r.groupLabel && (
                    <span className="text-[9px] text-muted">Grp {r.groupLabel} #{r.groupPosition}</span>
                  )}
                  <span className="text-[10px] text-muted">{r.groupWins}W {r.groupLosses}L</span>
                  {r.bracketReached && (
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                      r.bracketReached === "winner" ? "bg-amber-100 text-amber-700" :
                      r.bracketReached === "f" ? "bg-gray-200 text-gray-700" :
                      "text-muted"
                    }`}>
                      {PLACEMENT_LABELS[r.bracketReached] || r.bracketReached}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
