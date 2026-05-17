"use client";

interface Props {
  /** Optional copy displayed under the spinner. Keep short ("Loading matches…"). */
  label?: string;
  /** Compact variant — tighter padding, smaller spinner. Use inline inside cards. */
  compact?: boolean;
  /** Extra classes on the outer wrapper (e.g. min-height for above-the-fold). */
  className?: string;
}

/**
 * Standard data-area loader used while a page or section is fetching.
 *
 * Render this INSIDE the page chrome (header / filter bar / tabs) so
 * navigation surfaces stay clickable instantly and only the data
 * portion shows the spinner. Pair with the entityPreview pattern
 * (sessionStorage carried from the previous page) when a preview is
 * available — that wins over the spinner.
 *
 * Visual: subtle animated ring + soft label, matches mobile-app
 * conventions ("loading content" rather than a full-page splash).
 */
export function LoadingState({ label, compact = false, className = "" }: Props) {
  const ringSize = compact ? "w-5 h-5 border-2" : "w-7 h-7 border-[3px]";
  const padding = compact ? "py-4" : "py-10";
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${padding} ${className}`}>
      <div className={`${ringSize} border-action/30 border-t-action rounded-full animate-spin`} />
      {label && <span className="text-xs text-muted font-medium">{label}</span>}
    </div>
  );
}
