/**
 * Auto-assign a player's L1–L5 skill bucket from DUPR or app global rating.
 *
 * Priority:
 *   1. DUPR rating (if set)
 *   2. App global rating (if set)
 *   3. Default L3 (middle of the road)
 *
 * Bucket boundaries are hardcoded for v1. Can be made per-club tunable later
 * if real usage shows different clubs need different thresholds.
 */

import type { SkillLevel } from "./types";

export interface PlayerForAssign {
  duprRating?: number | null;
  globalRating?: number | null;
}

/**
 * Map a DUPR rating (typical scale 2.0–5.0) to an L1–L5 bucket.
 *
 *   < 2.5        → L1
 *   2.5 – 2.99   → L2
 *   3.0 – 3.49   → L3
 *   3.5 – 3.99   → L4
 *   ≥ 4.0        → L5
 */
export function duprToLevel(dupr: number): SkillLevel {
  if (dupr < 2.5) return 1;
  if (dupr < 3.0) return 2;
  if (dupr < 3.5) return 3;
  if (dupr < 4.0) return 4;
  return 5;
}

/**
 * Map an app global rating (1000-based ELO-ish) to an L1–L5 bucket.
 *
 *   < 950        → L1
 *   950 – 1049   → L2
 *   1050 – 1149  → L3
 *   1150 – 1249  → L4
 *   ≥ 1250       → L5
 */
export function ratingToLevel(rating: number): SkillLevel {
  if (rating < 950) return 1;
  if (rating < 1050) return 2;
  if (rating < 1150) return 3;
  if (rating < 1250) return 4;
  return 5;
}

/**
 * Pick the best skill level for a player at event-join time.
 * DUPR > App rating > fallback to L3.
 */
export function autoAssignSkillLevel(player: PlayerForAssign): SkillLevel {
  if (typeof player.duprRating === "number") return duprToLevel(player.duprRating);
  if (typeof player.globalRating === "number") return ratingToLevel(player.globalRating);
  return 3;
}
