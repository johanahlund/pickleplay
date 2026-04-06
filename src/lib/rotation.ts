/**
 * Continuous rotation engine.
 * Generates the next match for a freed court based on priority weights.
 */

interface PlayerStats {
  id: string;
  name: string;
  rating: number;
  gender?: string | null;
  skillLevel?: number | null;
  matchesPlayed: number;
  lastMatchEndedAt: number; // timestamp, 0 = never played
  isPlaying: boolean; // currently on another court
}

interface RotationConfig {
  format: "singles" | "doubles";
  pairingMode: string;
  prioSpeed: boolean;
  prioFairness: boolean;
  prioSkill: boolean;
  courtNum: number;
  numCourts: number;
  winners?: string[];
  losers?: string[];
}

export interface RotationResult {
  team1: string[];
  team2: string[];
  team1Names: string[];
  team2Names: string[];
  courtNum: number;
  shouldWait: boolean;
  isHardStop: boolean; // true = cannot generate, no override possible
  waitReason?: string;
  // If shouldWait && !isHardStop, also include the better matchup
  betterMatchup?: {
    team1Names: string[];
    team2Names: string[];
    reason: string;
  };
}

/**
 * Generate the next match for a freed court.
 */
export function generateNextMatch(
  players: PlayerStats[],
  config: RotationConfig
): RotationResult | null {
  const playersPerTeam = config.format === "singles" ? 1 : 2;
  const playersNeeded = playersPerTeam * 2;
  const available = players.filter((p) => !p.isPlaying);
  const playing = players.filter((p) => p.isPlaying);

  // Hard stop: not enough players
  if (available.length < playersNeeded) {
    const availNames = available.map((p) => p.name).join(", ");
    if (available.length === 0 && playing.length > 0) {
      return {
        team1: [], team2: [], team1Names: [], team2Names: [],
        courtNum: config.courtNum,
        shouldWait: true,
        isHardStop: true,
        waitReason: `All ${playing.length} players are on court. Next match when a court finishes.`,
      };
    }
    return {
      team1: [], team2: [], team1Names: [], team2Names: [],
      courtNum: config.courtNum,
      shouldWait: true,
      isHardStop: true,
      waitReason: `Court ${config.courtNum} free — only ${available.length} player${available.length !== 1 ? "s" : ""} available (${availNames}). Need ${playersNeeded} for ${config.format}.`,
    };
  }

  // Score and select players
  const scored = available.map((p) => ({
    ...p,
    score: calcPlayerScore(p, players, config),
  }));
  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, playersNeeded);
  const { team1, team2 } = formTeams(selected, config);

  const nowTeam1Rating = team1.reduce((s, p) => s + p.rating, 0);
  const nowTeam2Rating = team2.reduce((s, p) => s + p.rating, 0);

  // Check for soft wait reasons
  const waitCheck = checkShouldWait(selected, scored, players, config, team1, team2);

  return {
    team1: team1.map((p) => p.id),
    team2: team2.map((p) => p.id),
    team1Names: team1.map((p) => p.name),
    team2Names: team2.map((p) => p.name),
    courtNum: config.courtNum,
    shouldWait: waitCheck.shouldWait,
    isHardStop: false,
    waitReason: waitCheck.reason,
    betterMatchup: waitCheck.betterMatchup,
  };
}

function calcPlayerScore(
  player: PlayerStats,
  allPlayers: PlayerStats[],
  config: RotationConfig
): number {
  let score = 0;
  const maxMatches = Math.max(...allPlayers.map((p) => p.matchesPlayed), 1);
  const now = Date.now();

  const fairnessWeight = config.prioFairness ? 100 : 40;
  const matchDeficit = maxMatches - player.matchesPlayed;
  score += matchDeficit * fairnessWeight;

  const speedWeight = config.prioSpeed ? 50 : 20;
  const waitTime = player.lastMatchEndedAt > 0
    ? (now - player.lastMatchEndedAt) / 60000
    : 999;
  score += Math.min(waitTime, 30) * speedWeight;

  if (config.prioSkill && player.skillLevel) {
    const skillWeight = 30;
    if (config.pairingMode === "king_of_court") {
      const courtRank = config.numCourts - config.courtNum + 1;
      const skillMatch = 3 - Math.abs(player.skillLevel - courtRank);
      score += skillMatch * skillWeight;
    } else {
      score += player.skillLevel * skillWeight;
    }
  }

  if (config.pairingMode === "king_of_court" && config.winners?.includes(player.id)) {
    score += 200;
  }

  return score;
}

function formTeams(
  selected: PlayerStats[],
  config: RotationConfig
): { team1: PlayerStats[]; team2: PlayerStats[] } {
  if (config.format === "singles") {
    return { team1: [selected[0]], team2: [selected[1]] };
  }

  const sorted = [...selected].sort((a, b) => b.rating - a.rating);

  if (config.pairingMode === "mixed_gender" || config.pairingMode === "skill_mixed_gender") {
    const males = sorted.filter((p) => p.gender === "M");
    const females = sorted.filter((p) => p.gender === "F");
    const others = sorted.filter((p) => !p.gender || (p.gender !== "M" && p.gender !== "F"));

    if (males.length >= 2 && females.length >= 2) {
      return {
        team1: [males[0], females[females.length - 1]],
        team2: [males[1], females[0]],
      };
    }
    const all = [...males, ...females, ...others];
    return { team1: [all[0], all[3]], team2: [all[1], all[2]] };
  }

  // Default: 1st+4th vs 2nd+3rd for balance
  return { team1: [sorted[0], sorted[3]], team2: [sorted[1], sorted[2]] };
}

function checkShouldWait(
  selected: PlayerStats[],
  allScored: PlayerStats[],
  allPlayers: PlayerStats[],
  config: RotationConfig,
  nowTeam1: PlayerStats[],
  nowTeam2: PlayerStats[]
): {
  shouldWait: boolean;
  reason?: string;
  betterMatchup?: { team1Names: string[]; team2Names: string[]; reason: string };
} {
  // If speed is the only priority, never wait
  if (config.prioSpeed && !config.prioFairness && !config.prioSkill) {
    return { shouldWait: false };
  }

  const playersPerTeam = config.format === "singles" ? 1 : 2;
  const playersNeeded = playersPerTeam * 2;
  const playing = allPlayers.filter((p) => p.isPlaying);
  const minSelectedMatches = Math.min(...selected.map((p) => p.matchesPlayed));
  const nowT1Rating = nowTeam1.reduce((s, p) => s + p.rating, 0);
  const nowT2Rating = nowTeam2.reduce((s, p) => s + p.rating, 0);
  const nowRatingDiff = Math.abs(nowT1Rating - nowT2Rating);

  // Fairness check: someone on court has much fewer matches
  if (config.prioFairness) {
    for (const p of playing) {
      if (p.matchesPlayed < minSelectedMatches - 1) {
        // Simulate what the match would look like if this player were available
        const simAvailable = [...allPlayers.filter((pl) => !pl.isPlaying), p]
          .sort((a, b) => calcPlayerScore(b, allPlayers, config) - calcPlayerScore(a, allPlayers, config));
        const simSelected = simAvailable.slice(0, playersNeeded);

        if (simSelected.length >= playersNeeded) {
          const { team1: betterT1, team2: betterT2 } = formTeams(simSelected, config);
          const betterT1Rating = betterT1.reduce((s, pl) => s + pl.rating, 0);
          const betterT2Rating = betterT2.reduce((s, pl) => s + pl.rating, 0);

          return {
            shouldWait: true,
            reason: `Court ${config.courtNum} free — suggesting to wait. ${p.name} has played only ${p.matchesPlayed} match${p.matchesPlayed !== 1 ? "es" : ""} while ${selected.map((s) => s.name).join(", ")} have played ${selected.map((s) => s.matchesPlayed).join("-")} each.`,
            betterMatchup: {
              team1Names: betterT1.map((pl) => pl.name),
              team2Names: betterT2.map((pl) => pl.name),
              reason: `Better match if we wait: ${betterT1.map((pl) => pl.name).join(" + ")} vs ${betterT2.map((pl) => pl.name).join(" + ")} (rating ${betterT1Rating} vs ${betterT2Rating}). ${p.name} gets to play.`,
            },
          };
        }
      }
    }
  }

  // Skill balance check: would waiting give a significantly better matchup?
  if (config.prioSkill && nowRatingDiff > 150) {
    // Check if any playing player would improve the balance
    for (const p of playing) {
      const simAvailable = [...allPlayers.filter((pl) => !pl.isPlaying), p]
        .sort((a, b) => calcPlayerScore(b, allPlayers, config) - calcPlayerScore(a, allPlayers, config));
      const simSelected = simAvailable.slice(0, playersNeeded);

      if (simSelected.length >= playersNeeded) {
        const { team1: betterT1, team2: betterT2 } = formTeams(simSelected, config);
        const betterT1Rating = betterT1.reduce((s, pl) => s + pl.rating, 0);
        const betterT2Rating = betterT2.reduce((s, pl) => s + pl.rating, 0);
        const betterDiff = Math.abs(betterT1Rating - betterT2Rating);

        if (betterDiff < nowRatingDiff * 0.5) {
          return {
            shouldWait: true,
            reason: `Court ${config.courtNum} free — could start ${nowTeam1.map((pl) => pl.name).join(" + ")} vs ${nowTeam2.map((pl) => pl.name).join(" + ")} now (rating gap: ${nowRatingDiff}). But better matchup possible when ${p.name} finishes.`,
            betterMatchup: {
              team1Names: betterT1.map((pl) => pl.name),
              team2Names: betterT2.map((pl) => pl.name),
              reason: `Better: ${betterT1.map((pl) => pl.name).join(" + ")} vs ${betterT2.map((pl) => pl.name).join(" + ")} (rating ${betterT1Rating} vs ${betterT2Rating}, gap only ${betterDiff}).`,
            },
          };
        }
      }
    }
  }

  return { shouldWait: false };
}
