"use client";

import { useState } from "react";

interface ScorePickerProps {
  value: string;
  targetScore: number;
  onChange: (value: string) => void;
}

export function ScorePicker({ value, targetScore, onChange }: ScorePickerProps) {
  const [open, setOpen] = useState(false);
  const [extraRows, setExtraRows] = useState(0);

  // Base rows: to 11 → 4 rows, to 15 → 5 rows, to 21 → 6 rows
  const baseRows = targetScore <= 11 ? 4 : targetScore <= 15 ? 5 : 6;
  const cols = 4;
  const visibleCount = (baseRows + extraRows) * cols;
  const numbers = Array.from({ length: visibleCount }, (_, i) => i);

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
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {numbers.map((n) => (
                <button
                  key={n}
                  onClick={() => { onChange(String(n)); setOpen(false); }}
                  className={`h-14 rounded-xl text-xl font-bold transition-all ${
                    String(n) === value
                      ? "bg-action text-white ring-2 ring-action/50 scale-110"
                      : n === targetScore
                        ? "bg-green-500 text-white shadow-md"
                        : "bg-gray-100 text-foreground hover:bg-gray-200 active:bg-gray-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <button onClick={() => setExtraRows(extraRows + 1)} className="w-full mt-3 py-1.5 text-xs text-action font-medium hover:underline">
              More numbers...
            </button>
            <button onClick={() => setOpen(false)} className="w-full py-1.5 text-xs text-muted hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
