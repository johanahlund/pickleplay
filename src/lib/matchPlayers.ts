import { normalizeForSearch } from "./searchUtil";
import type { ParsedLine } from "./parsePlayerList";

export interface MatchPlayer {
  id: string;
  name: string;
  gender?: string | null;
  photoUrl?: string | null;
}

export type MatchStatus = "exact" | "ambiguous" | "new";

export interface MatchResult {
  line: ParsedLine;
  status: MatchStatus;
  candidates: MatchPlayer[];
}

/**
 * Match each parsed line against `players`:
 *   - exact normalized equality → "exact" (1 candidate)
 *   - one substring hit either direction → "exact"
 *   - 2+ candidates → "ambiguous"
 *   - 0 candidates → "new"
 *
 * Substring matches both ways so "Fernando B" finds "Fernando Barbosa" AND
 * "Vitor" finds "Vitor Branco", while "Ana" still surfaces all four Anas.
 */
export function matchPlayers(parsed: ParsedLine[], players: MatchPlayer[]): MatchResult[] {
  return parsed.map((line) => {
    const target = normalizeForSearch(line.name);
    if (!target) return { line, status: "new" as const, candidates: [] };

    const equal = players.filter((p) => normalizeForSearch(p.name) === target);
    if (equal.length === 1) return { line, status: "exact" as const, candidates: equal };
    if (equal.length > 1) return { line, status: "ambiguous" as const, candidates: equal };

    const partial = players.filter((p) => {
      const n = normalizeForSearch(p.name);
      return n.includes(target) || target.includes(n);
    });
    if (partial.length === 1) return { line, status: "exact" as const, candidates: partial };
    if (partial.length > 1) return { line, status: "ambiguous" as const, candidates: partial };

    return { line, status: "new" as const, candidates: [] };
  });
}
