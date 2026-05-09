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
  const override = round?.categoriesOverride;
  if (Array.isArray(override)) return override as unknown as LeagueCategoryShape[];
  return leagueCategories ?? [];
}
