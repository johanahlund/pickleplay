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
// Stored statuses: setup | open | closed.
//   (legacy on read: visible/draft → setup, active/completed → closed)
//
// "Active" / "running" / "completed" are no longer stored values —
// they're derived display phases of the closed status using the
// event's date window:
//   closed + start in future  → "scheduled"
//   closed + start ≤ now ≤ end → "in_progress"
//   closed + end (or start) in past → "completed"

export type EventStatus = "setup" | "open" | "closed";

export type EventDisplayPhase =
  | "setup"
  | "open"
  | "closed"
  | "scheduled"
  | "in_progress"
  | "completed";

export function normalizeEventStatus(raw: string | null | undefined): EventStatus {
  if (raw === "visible" || raw === "draft") return "setup";
  // The pre-migration "active" and "completed" values both collapse to
  // "closed" — the display phase below distinguishes between scheduled,
  // in-progress and completed using the date window.
  if (raw === "active" || raw === "completed") return "closed";
  if (raw === "setup" || raw === "open" || raw === "closed") return raw;
  return "setup";
}

export function eventDisplayPhase(
  event: { status: string | null | undefined; date?: string | Date | null; endDate?: string | Date | null },
): EventDisplayPhase {
  const stored = normalizeEventStatus(event.status);
  if (stored !== "closed") return stored;
  // For closed events, expand into a date-derived display phase so the
  // badge reads "Scheduled" / "In progress" / "Completed" instead of
  // just "Closed". Pure "closed" (no dates) keeps as-is.
  const now = Date.now();
  const start = event.date ? new Date(event.date).getTime() : null;
  const end = event.endDate ? new Date(event.endDate).getTime() : null;
  if (end !== null) {
    if (now > end) return "completed";
    if (start !== null && now < start) return "scheduled";
    return "in_progress";
  }
  if (start !== null) {
    if (now < start) return "scheduled";
    if (now > start + 24 * 60 * 60 * 1000) return "completed";
    return "in_progress";
  }
  return "closed";
}

export function eventDisplayLabel(
  event: { status: string | null | undefined; date?: string | Date | null; endDate?: string | Date | null },
): string {
  switch (eventDisplayPhase(event)) {
    case "setup": return "Setup";
    case "open": return "Open";
    case "closed": return "Closed";
    case "scheduled": return "Scheduled";
    case "in_progress": return "In progress";
    case "completed": return "Completed";
  }
}
