"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Current value in minutes. null = inherit (displayed as "–"). */
  value: number | null;
  /** Called whenever the value changes (number or null to clear). */
  onChange: (next: number | null) => void;
  /** Step size in minutes (default 5). */
  step?: number;
  /** Minimum value when set (default 5). Going below clears to null. */
  min?: number;
  /** Maximum value (default 240). */
  max?: number;
  /** Default value when stepping up from null (default 45). */
  defaultMin?: number;
  /** Optional aria label / tooltip. */
  label?: string;
  /** When `compact`, the stepper renders as a small clickable chip
   *  showing only the value; tapping reveals the -/+ buttons. Tap-
   *  outside collapses. When false, the stepper is always expanded. */
  compact?: boolean;
}

/**
 * Inline duration stepper. "–" represents "inherit" (null); ± steps in
 * 5-min intervals. Stepping below `min` clears back to null.
 *
 * Compact mode shows just the value as a small chip until tapped — keeps
 * dense lists (per-category overrides per round) readable.
 */
export function DurationStepper({
  value,
  onChange,
  step = 5,
  min = 5,
  max = 240,
  defaultMin = 45,
  label,
  compact = false,
}: Props) {
  const [expanded, setExpanded] = useState(!compact);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside collapses (compact mode only). Skip when always-expanded.
  useEffect(() => {
    if (!compact || !expanded) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [compact, expanded]);

  const display = value == null ? "–" : String(value);

  const stepDown = () => {
    if (value == null) return;
    const next = value - step;
    onChange(next < min ? null : next);
  };
  const stepUp = () => {
    onChange(value == null ? defaultMin : Math.min(max, value + step));
  };

  if (compact && !expanded) {
    return (
      <button
        type="button"
        ref={(el) => { ref.current = el ? el.parentElement as HTMLDivElement : null; }}
        onClick={() => setExpanded(true)}
        aria-label={label || "Edit duration"}
        title={label || "Tap to edit"}
        className="inline-flex items-center justify-center w-10 h-7 rounded-lg border border-border bg-white text-sm font-semibold text-foreground tabular-nums hover:bg-gray-50"
      >
        {display}
      </button>
    );
  }

  return (
    <div ref={ref} className="inline-flex items-center border border-border rounded-lg overflow-hidden bg-white">
      <button
        type="button"
        onClick={stepDown}
        disabled={value == null}
        aria-label="Decrease duration"
        title={value === min ? "Clear (inherit)" : "Decrease by " + step + " min"}
        className="w-7 h-7 flex items-center justify-center text-foreground hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
      >–</button>
      <span className="w-9 text-center text-sm font-semibold text-foreground tabular-nums select-none">{display}</span>
      <button
        type="button"
        onClick={stepUp}
        aria-label="Increase duration"
        title={"Increase by " + step + " min"}
        className="w-7 h-7 flex items-center justify-center text-foreground hover:bg-gray-100"
      >+</button>
    </div>
  );
}
