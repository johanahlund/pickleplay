import { normalizeEventStatus, eventDisplayPhase, normalizeLeagueStatus } from "@/lib/statusDisplay";

/**
 * Single source of truth for status pill colours. Used wherever a
 * League/Event status is rendered as a coloured pill (cards, hero
 * headers, list rows). Replaces the ~3 separate ternary tables that
 * had drifted across `events/page.tsx`, `leagues/page.tsx`, and
 * `AppHeader.tsx`.
 */

export function leagueStatusBadgeClass(raw: string | null | undefined): string {
  switch (normalizeLeagueStatus(raw)) {
    case "active": return "bg-green-100 text-green-700";
    case "complete": return "bg-gray-100 text-muted";
    case "open": return "bg-amber-100 text-amber-700";
    case "closed": return "bg-orange-100 text-orange-700";
    case "setup":
    default: return "bg-blue-100 text-blue-700";
  }
}

export function eventStatusBadgeClass(
  event: { status: string | null | undefined; date?: string | Date | null; endDate?: string | Date | null },
): string {
  const stored = normalizeEventStatus(event.status);
  if (stored === "setup") return "bg-blue-100 text-blue-700";
  if (stored === "open") return "bg-amber-100 text-amber-700";
  if (stored === "closed") return "bg-orange-100 text-orange-700";
  // active → derive by date phase
  switch (eventDisplayPhase(event)) {
    case "scheduled": return "bg-emerald-100 text-emerald-700";
    case "in_progress": return "bg-green-100 text-green-700";
    case "completed": return "bg-gray-100 text-muted";
    default: return "bg-green-100 text-green-700";
  }
}
