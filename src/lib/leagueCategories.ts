export const CATEGORY_FORMATS = ["doubles", "singles"] as const;
export const CATEGORY_GENDERS = ["male", "female", "mix", "open"] as const;
export const CATEGORY_AGE_GROUPS = ["open", "18+", "35+", "50+", "55+", "60+", "65+", "70+"] as const;
export const CATEGORY_SCORING_FORMATS = ["1x11", "3x11", "1x15", "1xR15", "1x21"] as const;
export const CATEGORY_WIN_BY = ["1", "2"] as const;
export const CATEGORY_STATUSES = ["draft", "active"] as const;

export type CategoryFormat = (typeof CATEGORY_FORMATS)[number];
export type CategoryGender = (typeof CATEGORY_GENDERS)[number];
export type CategoryAgeGroup = (typeof CATEGORY_AGE_GROUPS)[number];
export type CategoryScoringFormat = (typeof CATEGORY_SCORING_FORMATS)[number];
export type CategoryWinBy = (typeof CATEGORY_WIN_BY)[number];
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export interface CategoryInput {
  name: string;
  format: CategoryFormat;
  gender: CategoryGender;
  ageGroup: CategoryAgeGroup;
  skillMin: number | null;
  skillMax: number | null;
  scoringFormat: CategoryScoringFormat;
  winBy: CategoryWinBy;
  status: CategoryStatus;
}

export type ValidationResult =
  | { ok: true; data: CategoryInput }
  | { ok: false; error: string };

export type PartialValidationResult =
  | { ok: true; data: Partial<CategoryInput> }
  | { ok: false; error: string };

function inList<T extends string>(val: unknown, list: readonly T[]): val is T {
  return typeof val === "string" && (list as readonly string[]).includes(val);
}

function parseSkill(val: unknown): number | null | "invalid" {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : parseFloat(String(val));
  if (!Number.isFinite(n)) return "invalid";
  if (n < 1 || n > 8) return "invalid";
  return n;
}

/**
 * Validates and normalizes raw category input for POST (create).
 * Strips any unknown fields (prevents leagueId/sortOrder tampering).
 * Applies defaults for missing fields. Requires `name`.
 */
export function validateCategoryInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string") return { ok: false, error: "Name required" };
  const name = r.name.trim();
  if (!name) return { ok: false, error: "Name required" };
  if (name.length > 100) return { ok: false, error: "Name too long" };

  const format = r.format ?? "doubles";
  if (!inList(format, CATEGORY_FORMATS)) return { ok: false, error: "Invalid format" };

  const gender = r.gender ?? "open";
  if (!inList(gender, CATEGORY_GENDERS)) return { ok: false, error: "Invalid gender" };

  const ageGroup = r.ageGroup ?? "open";
  if (!inList(ageGroup, CATEGORY_AGE_GROUPS)) return { ok: false, error: "Invalid age group" };

  const scoringFormat = r.scoringFormat ?? "3x11";
  if (!inList(scoringFormat, CATEGORY_SCORING_FORMATS)) return { ok: false, error: "Invalid scoring format" };

  const winByRaw = r.winBy ?? "2";
  const winBy = typeof winByRaw === "number" ? String(winByRaw) : winByRaw;
  if (!inList(winBy, CATEGORY_WIN_BY)) return { ok: false, error: "Invalid winBy" };

  const status = r.status ?? "active";
  if (!inList(status, CATEGORY_STATUSES)) return { ok: false, error: "Invalid status" };

  const skillMin = parseSkill(r.skillMin);
  if (skillMin === "invalid") return { ok: false, error: "Invalid skillMin" };
  const skillMax = parseSkill(r.skillMax);
  if (skillMax === "invalid") return { ok: false, error: "Invalid skillMax" };
  if (skillMin !== null && skillMax !== null && skillMin > skillMax) {
    return { ok: false, error: "skillMin must be ≤ skillMax" };
  }

  return {
    ok: true,
    data: { name, format, gender, ageGroup, skillMin, skillMax, scoringFormat, winBy, status },
  };
}

/**
 * Validates a partial category update (PATCH). Only fields explicitly present
 * are returned in `data`. Unknown fields are stripped. Defaults are NOT applied.
 */
export function validateCategoryPatch(raw: unknown): PartialValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Invalid body" };
  const r = raw as Record<string, unknown>;
  const data: Partial<CategoryInput> = {};

  if (r.name !== undefined) {
    if (typeof r.name !== "string") return { ok: false, error: "Name must be a string" };
    const name = r.name.trim();
    if (!name) return { ok: false, error: "Name required" };
    if (name.length > 100) return { ok: false, error: "Name too long" };
    data.name = name;
  }
  if (r.format !== undefined) {
    if (!inList(r.format, CATEGORY_FORMATS)) return { ok: false, error: "Invalid format" };
    data.format = r.format;
  }
  if (r.gender !== undefined) {
    if (!inList(r.gender, CATEGORY_GENDERS)) return { ok: false, error: "Invalid gender" };
    data.gender = r.gender;
  }
  if (r.ageGroup !== undefined) {
    if (!inList(r.ageGroup, CATEGORY_AGE_GROUPS)) return { ok: false, error: "Invalid age group" };
    data.ageGroup = r.ageGroup;
  }
  if (r.scoringFormat !== undefined) {
    if (!inList(r.scoringFormat, CATEGORY_SCORING_FORMATS)) return { ok: false, error: "Invalid scoring format" };
    data.scoringFormat = r.scoringFormat;
  }
  if (r.winBy !== undefined) {
    const wb = typeof r.winBy === "number" ? String(r.winBy) : r.winBy;
    if (!inList(wb, CATEGORY_WIN_BY)) return { ok: false, error: "Invalid winBy" };
    data.winBy = wb;
  }
  if (r.status !== undefined) {
    if (!inList(r.status, CATEGORY_STATUSES)) return { ok: false, error: "Invalid status" };
    data.status = r.status;
  }
  if (r.skillMin !== undefined) {
    const v = parseSkill(r.skillMin);
    if (v === "invalid") return { ok: false, error: "Invalid skillMin" };
    data.skillMin = v;
  }
  if (r.skillMax !== undefined) {
    const v = parseSkill(r.skillMax);
    if (v === "invalid") return { ok: false, error: "Invalid skillMax" };
    data.skillMax = v;
  }
  if (data.skillMin != null && data.skillMax != null && data.skillMin > data.skillMax) {
    return { ok: false, error: "skillMin must be ≤ skillMax" };
  }

  return { ok: true, data };
}

/**
 * Generates an auto category name from its attributes.
 * Examples:
 *   autoCatName({format:"doubles",gender:"male",ageGroup:"55+"}) → "Men's Doubles 55+"
 *   autoCatName({format:"doubles",gender:"open",ageGroup:"open"}) → "Doubles"
 *   autoCatName({format:"singles",gender:"female",skillMin:3.0}) → "Women's Singles 3.0+"
 *   autoCatName({format:"doubles",skillMin:3.0,skillMax:4.0}) → "Doubles 3.0-4.0"
 */
export function autoCatName(opts: {
  format?: string;
  gender?: string;
  ageGroup?: string;
  skillMin?: number | string | null;
  skillMax?: number | string | null;
}): string {
  const { format = "doubles", gender = "open", ageGroup = "open" } = opts;
  const sMin = opts.skillMin === "" || opts.skillMin === null || opts.skillMin === undefined ? null : String(opts.skillMin);
  const sMax = opts.skillMax === "" || opts.skillMax === null || opts.skillMax === undefined ? null : String(opts.skillMax);

  const parts: string[] = [];
  if (gender !== "open") parts.push(gender === "male" ? "Men's" : gender === "female" ? "Women's" : "Mixed");
  parts.push(format === "doubles" ? "Doubles" : "Singles");
  if (ageGroup !== "open") parts.push(ageGroup);
  if (sMin && sMax) parts.push(`${sMin}-${sMax}`);
  else if (sMin) parts.push(`${sMin}+`);
  else if (sMax) parts.push(`≤${sMax}`);

  return parts.join(" ");
}
