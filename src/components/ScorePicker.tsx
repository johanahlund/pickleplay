"use client";

import { useState } from "react";

interface ScorePickerProps {
  value: string;
  targetScore: number;
  winBy: number;
  otherTeamScore: string; // the other team's current score
  onChange: (value: string) => void;
}

export function isValidPair(score1: number, score2: number, target: number, winBy: number): boolean {
  if (score1 === score2) return false; // no ties
  const winner = Math.max(score1, score2);
  const loser = Math.min(score1, score2);

  // Winner must reach target
  if (winner < target) return false;

  // Diff must be at least winBy
  if (winner - loser < winBy) return false;

  if (winBy === 1) {
    // Win-by-1: winner is always exactly target (game ends immediately)
    return winner === target;
  }

  // Win-by-2+:
  // At exactly target — loser can be 0 to target-winBy (e.g., 11-9 max for win-by-2)
  if (winner === target) return loser <= target - winBy;

  // Above target — must have gone through deuce
  // Loser must be at least target-1, and diff must be exactly winBy
  return loser >= target - 1 && winner - loser === winBy;
}

export function ScorePicker({ value, targetScore, winBy, otherTeamScore, onChange }: ScorePickerProps) {
  const [open, setOpen] = useState(false);
  const [extraRows, setExtraRows] = useState(0);

  const baseRows = targetScore <= 11 ? 4 : targetScore <= 15 ? 5 : 6;
  const cols = 4;
  const visibleCount = (baseRows + extraRows) * cols;
  const numbers = Array.from({ length: visibleCount }, (_, i) => i);

  const otherScore = parseInt(otherTeamScore);
  const hasOtherScore = !isNaN(otherScore);

  return (
    <>
      <button
        onClick={() => { setOpen(true); setExtraRows(0); }}
        className={`w-14 h-10 text-center border rounded-lg text-xl font-bold transition-colors ${
          value ? "border-action bg-action/5 text-action" : "border-border text-gray-400"
        }`}
      >
        {value || "-"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-sm font-semibold text-muted">Select Score</span>
              {hasOtherScore && <span className="text-xs text-muted block mt-0.5">Other team: {otherScore}</span>}
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {numbers.map((n) => {
                // Check if this score is valid given the other team's score
                const valid = !hasOtherScore || isValidPair(n, otherScore, targetScore, winBy) || n < targetScore;
                const isSelected = String(n) === value;
                const isTarget = n === targetScore;
                return (
                  <button
                    key={n}
                    onClick={() => { onChange(String(n)); setOpen(false); }}
                    disabled={hasOtherScore && !valid && !isSelected}
                    className={`h-14 rounded-xl text-xl font-bold transition-all ${
                      isSelected
                        ? "bg-action text-white ring-2 ring-action/50 scale-110"
                        : hasOtherScore && !valid
                          ? "bg-gray-50 text-gray-200 cursor-not-allowed"
                          : isTarget
                            ? "bg-green-500 text-white shadow-md"
                            : "bg-gray-100 text-foreground hover:bg-gray-200 active:bg-gray-300"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setExtraRows(extraRows + 1)} className="w-full mt-3 py-1.5 text-xs text-action font-medium hover:underline">
              More numbers...
            </button>
          </div>
        </div>
      )}
    </>
  );
}
