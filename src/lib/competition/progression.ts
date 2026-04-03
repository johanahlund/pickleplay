/**
 * Bracket match progression — auto-fill winners into next round.
 * Dynamic court assignment — assign freed courts to pending matches.
 */

import { getBracketStages } from "./types";

interface MatchWithPlayers {
  id: string;
  eventId: string;
  courtNum: number;
  status: string;
  bracketStage: string | null;
  bracketPosition: number | null;
  groupLabel: string | null;
  players: { playerId: string; team: number; score: number }[];
}

/**
 * Given a completed bracket match, determine where the winner and loser go next.
 *
 * Returns:
 * - winnerMatch: { bracketStage, bracketPosition, team } — where winner plays next
 * - loserMatch: { bracketStage, bracketPosition, team } — for 3rd place match (if applicable)
 */
export function getNextBracketMatch(
  completedStage: string, // e.g. "upper_sf"
  completedPosition: number, // 1-based
  prefix: "upper" | "lower",
  hasThirdPlace: boolean
): {
  winnerNext: { bracketStage: string; bracketPosition: number; team: number } | null;
  loserNext: { bracketStage: string; bracketPosition: number; team: number } | null;
} {
  const stageKey = completedStage.replace(`${prefix}_`, "");

  // Map stage to next stage
  const stageOrder = ["r32", "r16", "qf", "sf", "f"];
  const stageIdx = stageOrder.indexOf(stageKey);

  // Final — no next match
  if (stageKey === "f" || stageKey === "3rd") {
    return { winnerNext: null, loserNext: null };
  }

  if (stageIdx === -1 || stageIdx >= stageOrder.length - 1) {
    return { winnerNext: null, loserNext: null };
  }

  const nextStage = `${prefix}_${stageOrder[stageIdx + 1]}`;
  // Position in next round: positions 1,2 feed into position 1; positions 3,4 feed into position 2; etc.
  const nextPosition = Math.ceil(completedPosition / 2);
  // Team: odd positions become team 1, even positions become team 2
  const team = completedPosition % 2 === 1 ? 1 : 2;

  const winnerNext = { bracketStage: nextStage, bracketPosition: nextPosition, team };

  // Loser goes to 3rd place match only from semifinals
  let loserNext = null;
  if (stageKey === "sf" && hasThirdPlace) {
    loserNext = {
      bracketStage: `${prefix}_3rd`,
      bracketPosition: 1,
      team: completedPosition % 2 === 1 ? 1 : 2,
    };
  }

  return { winnerNext, loserNext };
}

/**
 * Find the winning pair from a completed match.
 * Returns { winnerPairPlayerIds, loserPairPlayerIds }.
 */
export function getMatchWinnerLoser(
  players: { playerId: string; team: number; score: number }[]
): {
  winnerPlayerIds: string[];
  loserPlayerIds: string[];
  winnerTeam: number;
} {
  const team1 = players.filter((p) => p.team === 1);
  const team2 = players.filter((p) => p.team === 2);
  const team1Score = team1.reduce((s, p) => s + p.score, 0);
  const team2Score = team2.reduce((s, p) => s + p.score, 0);

  if (team1Score > team2Score) {
    return {
      winnerPlayerIds: team1.map((p) => p.playerId),
      loserPlayerIds: team2.map((p) => p.playerId),
      winnerTeam: 1,
    };
  }
  return {
    winnerPlayerIds: team2.map((p) => p.playerId),
    loserPlayerIds: team1.map((p) => p.playerId),
    winnerTeam: 2,
  };
}

/**
 * Find the next pending match that should be assigned to a freed court.
 * Priority: bracket matches with all players assigned > group matches > other pending matches.
 * Within same priority, prefer lower round numbers (earlier matches first).
 */
export function findNextPendingMatch(
  matches: MatchWithPlayers[],
  freedCourt: number
): MatchWithPlayers | null {
  const pending = matches.filter(
    (m) => m.status === "pending" && m.players.length > 0
  );

  if (pending.length === 0) return null;

  // Sort: bracket matches with players ready first, then group matches, then by round
  pending.sort((a, b) => {
    // Bracket matches with all 4 players ready are highest priority
    const aReady = a.bracketStage && a.players.length >= 2 ? 0 : 1;
    const bReady = b.bracketStage && b.players.length >= 2 ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;

    // Group matches next
    const aGroup = a.groupLabel ? 0 : 1;
    const bGroup = b.groupLabel ? 0 : 1;
    if (aGroup !== bGroup) return aGroup - bGroup;

    // By round number (lower first)
    return a.courtNum - b.courtNum;
  });

  return pending[0];
}
