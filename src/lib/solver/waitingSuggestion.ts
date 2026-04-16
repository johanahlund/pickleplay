/**
 * Waiting suggestion — structural rule #1 from project_continuous_play.md
 *
 * When a court frees up before the others, what should happen next?
 * Input: total active players, number of courts, number of idle players
 * (players not currently on any court).
 *
 * Scope: 2 courts, 8–12 players, equal skill assumed. Other combos fall
 * through to "new_match" (let the regular solver handle it).
 */

export type WaitingAction =
  | {
      type: "new_match";
      headline: string;
      detail: string;
    }
  | {
      type: "filler";
      filler: "rematch-switch-sides" | "rematch-swap-partners" | "swap-one-in";
      headline: string;
      detail: string;
    }
  | {
      type: "wait";
      headline: string;
      detail: string;
    };

export function suggestWaitingAction(params: {
  totalActivePlayers: number;
  numCourts: number;
  idleCount: number;
}): WaitingAction {
  const { totalActivePlayers, numCourts, idleCount } = params;

  if (numCourts !== 2 || totalActivePlayers < 8 || totalActivePlayers > 12) {
    return {
      type: "new_match",
      headline: "Generate next match",
      detail: "Use the normal round logic.",
    };
  }

  // 12p / 2c: full bench team (4 idle). Clean swap.
  if (idleCount >= 4) {
    return {
      type: "new_match",
      headline: "Start a fresh match now",
      detail: `${idleCount} players are idle — put 4 fresh players on the freed court. Players from the just-ended match rest.`,
    };
  }

  // 10–11p / 2c: 2–3 idle. Mix idle with some from the freed court.
  if (idleCount >= 2) {
    return {
      type: "new_match",
      headline: "Swap idle in, start next match",
      detail: `${idleCount} idle + ${4 - idleCount} from the freed court = 4 fresh. The ${4 - idleCount} others from the freed court rest.`,
    };
  }

  // 9p / 2c: only 1 idle. Not enough for a fresh match.
  if (idleCount === 1) {
    return {
      type: "filler",
      filler: "swap-one-in",
      headline: "Swap 1 player, play a partner-swap rematch",
      detail:
        "Only 1 idle player. Bring them in for the player who just played the most; the 4 play a quick rematch with partners swapped (A+B vs C+D → A+C vs B+D) while the other court finishes.",
    };
  }

  // 8p / 2c: 0 idle. Everyone is playing. Rematch only.
  return {
    type: "filler",
    filler: "rematch-swap-partners",
    headline: "Partner-swap rematch",
    detail:
      "No idle players — everyone's on court. The 4 who just finished play a quick rematch with partners swapped (A+B vs C+D → A+C vs B+D). Fresh matchup without waiting.",
  };
}
