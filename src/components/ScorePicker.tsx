"use client";

import { useState } from "react";

interface ScorePickerProps {
  value: string;
  targetScore: number;
  winBy: number;
  otherTeamScore: string;
  onChange: (value: string) => void;
}

export function isValidPair(score1: number, score2: number, target: number, winBy: number): boolean {
  if (score1 === score2) return false;
  const winner = Math.max(score1, score2);
  const loser = Math.min(score1, score2);

  if (winner < target) return false;

  if (winner - loser < winBy) return false;

  if (winBy === 1) {
    return winner === target;
  }

  if (winner === target) return loser <= target - winBy;

  return loser >= target - 1 && winner - loser === winBy;
}

function getErrorMessage(score: number, otherScore: number, target: number, winBy: number): string | null {
  const winner = Math.max(score, otherScore);
  const loser = Math.min(score, otherScore);

  if (score === otherScore) return "Scores cannot be tied";
  if (winner < target) return `Winner must reach at least ${target}`;
  if (winner - loser < winBy) return `Need at least ${winBy} point${winBy > 1 ? "s" : ""} difference`;
  if (winBy === 1 && winner > target) return `With win-by-1, winner is always ${target}`;
  if (winner > target && loser < target - 1) return `${winner}-${loser} not possible — deuce starts at ${target - 1}-${target - 1}`;
  if (winner > target && winner - loser !== winBy) return `Above ${target}, difference must be exactly ${winBy}`;
  return null;
}

export function ScorePicker({ value, targetScore, winBy, otherTeamScore, onChange }: ScorePickerProps) {
  const [open, setOpen] = useState(false);
  const [extraRows, setExtraRows] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const baseRows = targetScore <= 11 ? 4 : targetScore <= 15 ? 5 : 6;
  const cols = 4;
  const visibleCount = (baseRows + extraRows) * cols;
  const numbers = Array.from({ length: visibleCount }, (_, i) => i);

  const otherScore = parseInt(otherTeamScore);
  const hasOtherScore = !isNaN(otherScore);

  const handleSelect = (n: number) => {
    if (hasOtherScore) {
      if (!isValidPair(n, otherScore, targetScore, winBy)) {
        const msg = getErrorMessage(n, otherScore, targetScore, winBy);
        setError(msg || `${n}-${otherScore} is not a valid score`);
        setTimeout(() => setError(null), 3000);
        return;
      }
    }
    onChange(String(n));
    setOpen(false);
    setError(null);
  };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setExtraRows(0); setError(null); }}
        className={`w-14 h-10 text-center border rounded-lg text-xl font-bold transition-colors ${
          value ? "border-action bg-action/5 text-action" : "border-border text-gray-400"
        }`}
      >
        {value || "-"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center" onClick={() => { setOpen(false); setError(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 mx-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-sm font-semibold text-muted">Select Score</span>
              {hasOtherScore && <span className="text-xs text-muted block mt-0.5">Other team: {otherScore}</span>}
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 text-center">
                <span className="text-xs text-red-600 font-medium">{error}</span>
              </div>
            )}
            <div className="grid grid-cols-4 gap-2.5">
              {numbers.map((n) => {
                const isSelected = String(n) === value;
                const isTarget = n === targetScore;
                const wouldBeInvalid = hasOtherScore && !isValidPair(n, otherScore, targetScore, winBy);
                return (
                  <button
                    key={n}
                    onClick={() => handleSelect(n)}
                    className={`h-14 rounded-xl text-xl font-bold transition-all ${
                      isSelected
                        ? "bg-action text-white ring-2 ring-action/50 scale-110"
                        : wouldBeInvalid
                          ? "bg-gray-50 text-gray-300"
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
