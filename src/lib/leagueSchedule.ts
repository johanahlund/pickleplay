/**
 * Auto-schedule helpers for league match-days.
 *
 * Source of truth for two things:
 *   • effective match duration for a given LeagueGame, with the cascade
 *     LeagueCategory → Event → LeagueRound → League → built-in default.
 *   • recalcCourt(eventId, courtNum) — walks the court's column in
 *     displayOrder, sets each match's scheduledAt according to the
 *     court's start time + each match's duration, preserving anchors.
 *
 * Anchors: a match with scheduleAnchored=true keeps its scheduledAt and
 * starts the chain forward from there. Everything after an anchor is
 * auto-derived (anchor_start + sum of subsequent durations). Manual
 * time-edit endpoints flip the anchor flag on. The "unanchor" path
 * clears it and re-derives.
 */

import { prisma } from "@/lib/db";

export const BUILT_IN_DURATION_MIN = 45;

interface DurationCascade {
  league: { matchDurationMin: number | null };
  round: {
    matchDurationMin: number | null;
    /** Round per-category override for THIS category (already looked up
     *  by the caller). */
    categoryDurationMin?: number | null;
  } | null;
  event: {
    matchDurationMin: number | null;
    /** Event per-category override for THIS category (already looked up
     *  by the caller). Wins over everything below. */
    categoryDurationMin?: number | null;
  };
  category: { matchDurationMin: number | null };
}

/**
 * Resolve the effective match-duration (in minutes) for a single game.
 * Cascade (most specific wins, top to bottom):
 *   1. Event per-category override           → this event, this category
 *   2. Event general override                → this event, any category
 *   3. Round per-category override           → this round, this category
 *   4. Round general override                → this round, any category
 *   5. League per-category (LeagueCategory)  → this category, every event
 *   6. League general                        → every event
 *   7. 45 min built-in default
 */
export function effectiveDurationMin(c: DurationCascade): number {
  return (
    c.event.categoryDurationMin
    ?? c.event.matchDurationMin
    ?? c.round?.categoryDurationMin
    ?? c.round?.matchDurationMin
    ?? c.category.matchDurationMin
    ?? c.league.matchDurationMin
    ?? BUILT_IN_DURATION_MIN
  );
}

interface RecalcContext {
  /** "1" | "2" | ... → ISO timestamp string for the court's start time */
  courtStartTimes: Record<string, string>;
  /** League default. */
  leagueMatchDurationMin: number | null;
  /** Round override (null = inherit league). */
  roundMatchDurationMin: number | null;
  /** Round per-category overrides: { [categoryId]: minutes }. Each key
   *  overrides both the round general and the league per-category for
   *  just that category in this round. */
  roundCategoryDurationOverrides: Record<string, number | null>;
  /** Event override (null = inherit round). */
  eventMatchDurationMin: number | null;
  /** Event per-category overrides: { [categoryId]: minutes }. Top of
   *  the cascade — wins over everything below. */
  eventCategoryDurationOverrides: Record<string, number | null>;
}

interface GameForRecalc {
  id: string;
  categoryId: string;
  courtNum: number | null;
  displayOrder: number | null;
  scheduledAt: Date | null;
  scheduleAnchored: boolean;
  category: { matchDurationMin: number | null };
}

/**
 * Compute the new scheduledAt for every game on a single court. Pure
 * function — returns a list of patches. The caller applies them in
 * one round-trip to the DB.
 *
 * Order is whatever displayOrder gives us (NULLs last), with scheduledAt
 * as a deterministic tiebreaker for unordered rows. Anchored matches
 * keep their scheduledAt and reset the chain from that point.
 */
export function recalcCourtSchedule(
  games: GameForRecalc[],
  courtNum: number,
  ctx: RecalcContext,
): { id: string; scheduledAt: Date | null }[] {
  const startIso = ctx.courtStartTimes[String(courtNum)];
  if (!startIso) {
    // No court anchor → can't auto-derive. Leave times alone; caller
    // can still position matches manually.
    return [];
  }

  const sorted = games
    .filter((g) => g.courtNum === courtNum)
    .slice()
    .sort((a, b) => {
      const da = a.displayOrder ?? Number.POSITIVE_INFINITY;
      const db = b.displayOrder ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      const ta = a.scheduledAt ? a.scheduledAt.getTime() : Number.POSITIVE_INFINITY;
      const tb = b.scheduledAt ? b.scheduledAt.getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });

  let cursor = new Date(startIso).getTime();
  const patches: { id: string; scheduledAt: Date | null }[] = [];
  for (const g of sorted) {
    const roundCatOverride = ctx.roundCategoryDurationOverrides[g.categoryId] ?? null;
    const eventCatOverride = ctx.eventCategoryDurationOverrides[g.categoryId] ?? null;
    const dur = effectiveDurationMin({
      league: { matchDurationMin: ctx.leagueMatchDurationMin },
      round: {
        matchDurationMin: ctx.roundMatchDurationMin,
        categoryDurationMin: roundCatOverride,
      },
      event: {
        matchDurationMin: ctx.eventMatchDurationMin,
        categoryDurationMin: eventCatOverride,
      },
      category: g.category,
    });

    let assignedMs: number;
    if (g.scheduleAnchored && g.scheduledAt) {
      // Anchored — keep this match's time, advance the cursor from
      // here. Subsequent matches start at anchor + duration.
      assignedMs = g.scheduledAt.getTime();
    } else {
      assignedMs = cursor;
    }

    const assignedAt = new Date(assignedMs);
    if (!g.scheduledAt || g.scheduledAt.getTime() !== assignedMs) {
      patches.push({ id: g.id, scheduledAt: assignedAt });
    }
    cursor = assignedMs + dur * 60_000;
  }
  return patches;
}

/**
 * Apply a court recalc for the given event + courtNum. Loads the
 * needed context, computes patches, writes them atomically.
 * Returns the number of rows updated.
 */
export async function recalcCourtAndPersist(eventId: string, courtNum: number): Promise<number> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      matchDurationMin: true,
      categoryDurationOverrides: true,
      courtStartTimes: true,
      round: {
        select: {
          matchDurationMin: true,
          categoryDurationOverrides: true,
          league: { select: { matchDurationMin: true } },
        },
      },
      leagueGames: {
        where: { courtNum },
        select: {
          id: true,
          categoryId: true,
          courtNum: true,
          displayOrder: true,
          scheduledAt: true,
          scheduleAnchored: true,
          category: { select: { matchDurationMin: true } },
        },
      },
    },
  });
  if (!event || !event.round) return 0;

  const courtStartTimes = (event.courtStartTimes ?? {}) as Record<string, string>;
  const roundCategoryDurationOverrides = (event.round.categoryDurationOverrides ?? {}) as Record<string, number | null>;
  const eventCategoryDurationOverrides = (event.categoryDurationOverrides ?? {}) as Record<string, number | null>;
  const patches = recalcCourtSchedule(event.leagueGames, courtNum, {
    courtStartTimes,
    leagueMatchDurationMin: event.round.league.matchDurationMin,
    roundMatchDurationMin: event.round.matchDurationMin,
    roundCategoryDurationOverrides,
    eventMatchDurationMin: event.matchDurationMin,
    eventCategoryDurationOverrides,
  });
  if (patches.length === 0) return 0;

  await prisma.$transaction(
    patches.map((p) =>
      prisma.leagueGame.update({ where: { id: p.id }, data: { scheduledAt: p.scheduledAt } }),
    ),
  );
  return patches.length;
}

/**
 * Recalc every court for the given event. Useful when something
 * event-wide changed (default duration, category duration, court start
 * times bulk-set).
 */
export async function recalcAllCourtsAndPersist(eventId: string): Promise<number> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { numCourts: true },
  });
  if (!event) return 0;
  let total = 0;
  for (let n = 1; n <= event.numCourts; n++) {
    total += await recalcCourtAndPersist(eventId, n);
  }
  return total;
}
