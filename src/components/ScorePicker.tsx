"use client";

import { useState, useEffect } from "react";

interface ScorePickerProps {
  value: string;
  targetScore: number;
  winBy: number;
  otherTeamScore: string;
  teamLabel?: string;
  autoOpen?: boolean;
  onAutoOpened?: () => void;
  onChange: (value: string) => void;
  onClearBoth?: () => void;
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

export function ScorePicker({ value, targetScore, winBy, otherTeamScore, teamLabel, autoOpen, onAutoOpened, onChange, onClearBoth }: ScorePickerProps) {
  const [open, setOpen] = useState(false);
  const [extraRows, setExtraRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // Auto-open when requested (for team 2 after team 1 is selected)
  useEffect(() => {
    if (autoOpen && !open) {
      setOpen(true);
      setExtraRows(0);
      setError(null);
      setFlash(true);
      setTimeout(() => setFlash(false), 1500);
      onAutoOpened?.();
    }
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseRows = targetScore <= 11 ? 4 : targetScore <= 15 ? 5 : 6;
  const cols = 4;
  const visibleCount = (baseRows + extraRows) * cols;

  const otherScore = parseInt(otherTeamScore);
  const hasOtherScore = !isNaN(otherScore);

  // When other score is set, generate enough numbers to include winning scores
  const maxNum = hasOtherScore
    ? Math.max(visibleCount, otherScore + winBy + 4)
    : visibleCount;
  const allNumbers = Array.from({ length: maxNum }, (_, i) => i);

  // Only show valid numbers when the other team's score is already set
  const numbers = hasOtherScore
    ? allNumbers.filter((n) => isValidPair(n, otherScore, targetScore, winBy))
    : allNumbers;

  const handleSelect = (n: number) => {
    setError(null);
    onChange(String(n));
    setOpen(false);
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
            <div className={`text-center mb-4 py-2 rounded-xl transition-all ${flash ? "bg-action/10 scale-105" : ""}`}>
              <span className={`font-bold ${flash ? "text-xl text-action animate-pulse" : "text-lg"}`}>{teamLabel || "Select Score"}</span>
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
                return (
                  <button
                    key={n}
                    onClick={() => handleSelect(n)}
                    className={`h-14 rounded-xl text-xl font-bold transition-all ${
                      isSelected
                        ? "bg-action text-white ring-2 ring-action/50 scale-110"
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
            <div className="flex mt-3">
              {!hasOtherScore && (
                <button onClick={() => setExtraRows(extraRows + 1)} className="flex-1 py-1.5 text-xs text-action font-medium hover:underline">
                  More numbers...
                </button>
              )}
              {hasOtherScore && onClearBoth && (
                <button onClick={() => { onClearBoth(); setError(null); }} className="py-1.5 text-xs text-red-500 font-medium hover:underline px-2">
                  Clear both scores
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
