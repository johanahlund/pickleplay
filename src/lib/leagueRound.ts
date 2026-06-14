import type { Prisma } from "@prisma/client";

/**
 * Round → League fallback for config + categories.
 *
 * A round can opt into different rules than its parent league by setting
 * `configOverride` and/or `categoriesOverride`. When unset, the league's
 * defaults apply. Pass the round and the league through these helpers
 * wherever you'd otherwise read `league.config` / `league.categories`.
 */

export interface LeagueConfigShape {
  maxRoster?: number;
  maxPointsPerMatchDay?: number;
  minMatchDaysForPlayoff?: number;
  maxMatchesPerEvent?: number;
  allowCrossCategoryPlay?: boolean;
  [k: string]: unknown;
}

export interface LeagueCategoryShape {
  id?: string;
  name: string;
  format: string;
  gender: string;
  ageGroup?: string;
  skillMin?: number | null;
  skillMax?: number | null;
  scoringFormat: string;
  winBy: string;
  status?: string;
  sortOrder?: number;
  maxPerEvent?: number | null;
}

export function resolveRoundConfig(
  round: { configOverride?: Prisma.JsonValue | null } | null | undefined,
  league: { config?: Prisma.JsonValue | null } | null | undefined,
): LeagueConfigShape {
  const override = round?.configOverride;
  if (override && typeof override === "object" && !Array.isArray(override)) {
    return override as LeagueConfigShape;
  }
  const base = league?.config;
  if (base && typeof base === "object" && !Array.isArray(base)) {
    return base as LeagueConfigShape;
  }
  return {};
}

export function resolveRoundCategories(
  round: { categoriesOverride?: Prisma.JsonValue | null } | null | undefined,
  leagueCategories: LeagueCategoryShape[] | null | undefined,
): LeagueCategoryShape[] {
  const base = leagueCategories ?? [];
  const override = round?.categoriesOverride;
  if (!Array.isArray(override)) return base;
  // The override is a PARTIAL per-category patch keyed by id (e.g. a round-
  // specific scoringFormat). Merge each patch onto the full league category so
  // name / winBy / format / gender survive — otherwise consumers get
  // categories missing those fields. Override fields win; the override defines
  // the round's category set + order.
  const baseById = new Map(base.map((c) => [c.id, c]));
  return (override as Array<Record<string, unknown>>)
    .filter((o) => o && typeof o === "object" && typeof o.id === "string")
    .map((o) => ({ ...(baseById.get(o.id as string) ?? {}), ...o })) as unknown as LeagueCategoryShape[];
}
