/**
 * The "edit this row" affordance — used on every editable card row.
 * Stays at w-3.5 h-3.5 (per the codebase's UI consistency convention).
 *
 * Visual identity: outline pencil, 2px stroke, no fill.
 */
export function PenIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
      />
    </svg>
  );
}
