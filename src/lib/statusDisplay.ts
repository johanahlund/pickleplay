/**
 * Status taxonomy for League → Round → Event.
 *
 * Stored values are kept small. Display is derived (and may include a
 * date-based phase for `active`). Legacy values are normalised on read so
 * pre-migration data still shows sensible labels.
 */

// ── League ────────────────────────────────────────────────────────────
//   setup | open | closed | active | complete
//   (legacy: registration → open, forming → closed)

export type LeagueStatus = "setup" | "open" | "closed" | "active" | "complete";

export function normalizeLeagueStatus(raw: string | null | undefined): LeagueStatus {
  if (raw === "registration") return "open";
  if (raw === "forming") return "closed";
  if (raw === "setup" || raw === "open" || raw === "closed" || raw === "active" || raw === "complete") return raw;
  return "setup";
}

export function leagueDisplayLabel(raw: string | null | undefined): string {
  switch (normalizeLeagueStatus(raw)) {
    case "setup": return "Setup";
    case "open": return "Registration open";
    case "closed": return "Registration closed";
    case "active": return "Active";
    case "complete": return "Complete";
  }
}

// ── Event ─────────────────────────────────────────────────────────────
//   setup | open | closed | active
//   (legacy: visible → setup, draft → setup, completed → active)
//
// When stored=`active`, the display phase is derived from start/end dates:
//   start in future        → "scheduled"
//   start ≤ now ≤ end      → "in_progress"
//   end (or start) in past → "completed"

export type EventStatus = "setup" | "open" | "closed" | "active";

export type EventDisplayPhase =
  | "setup"
  | "open"
  | "closed"
  | "scheduled"
  | "in_progress"
  | "completed";

export function normalizeEventStatus(raw: string | null | undefined): EventStatus {
  if (raw === "visible" || raw === "draft") return "setup";
  if (raw === "completed") return "active";
  if (raw === "setup" || raw === "open" || raw === "closed" || raw === "active") return raw;
  return "setup";
}

export function eventDisplayPhase(
  event: { status: string | null | undefined; date?: string | Date | null; endDate?: string | Date | null },
): EventDisplayPhase {
  const stored = normalizeEventStatus(event.status);
  if (stored !== "active") return stored;
  const now = Date.now();
  const start = event.date ? new Date(event.date).getTime() : null;
  const end = event.endDate ? new Date(event.endDate).getTime() : null;
  if (end !== null) {
    if (now > end) return "completed";
    if (start !== null && now < start) return "scheduled";
    return "in_progress";
  }
  // No endDate: treat the event date itself as the day; "completed" once
  // 24h past start (so the day-of plays as "in progress").
  if (start !== null) {
    if (now < start) return "scheduled";
    if (now > start + 24 * 60 * 60 * 1000) return "completed";
    return "in_progress";
  }
  return "in_progress";
}

export function eventDisplayLabel(
  event: { status: string | null | undefined; date?: string | Date | null; endDate?: string | Date | null },
): string {
  switch (eventDisplayPhase(event)) {
    case "setup": return "Setup";
    case "open": return "Registration open";
    case "closed": return "Registration closed";
    case "scheduled": return "Scheduled";
    case "in_progress": return "In progress";
    case "completed": return "Completed";
  }
}
