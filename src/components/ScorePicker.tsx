"use client";

import { useState, useRef, useEffect } from "react";

interface ScorePickerProps {
  value: string;
  targetScore: number;
  onChange: (value: string) => void;
}

export function ScorePicker({ value, targetScore, onChange }: ScorePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const maxScore = Math.max(targetScore + 5, 21);
  const numbers = Array.from({ length: maxScore + 1 }, (_, i) => i);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-14 h-10 text-center border rounded-lg text-xl font-bold transition-colors ${
          value ? "border-action bg-action/5 text-action" : "border-border text-gray-400"
        }`}
      >
        {value || "-"}
      </button>
      {open && (
        <div className="absolute bottom-12 right-0 bg-white rounded-xl shadow-2xl border border-border z-50 p-2 min-w-[200px]">
          <div className="grid grid-cols-6 gap-1">
            {numbers.map((n) => (
              <button
                key={n}
                onClick={() => { onChange(String(n)); setOpen(false); }}
                className={`w-8 h-8 rounded-lg text-sm font-bold transition-all ${
                  String(n) === value
                    ? "bg-action text-white ring-2 ring-action/50"
                    : n === targetScore
                      ? "bg-green-100 text-green-700 border border-green-300"
                      : "bg-gray-50 text-foreground hover:bg-gray-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
