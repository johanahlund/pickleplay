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
  // For King of Court: who just won/lost on this court
  winners?: string[];
  losers?: string[];
}

export interface RotationResult {
  team1: string[];
  team2: string[];
  courtNum: number;
  shouldWait: boolean;
  waitReason?: string;
}

/**
 * Generate the next match for a freed court.
 * Returns the best match, or a suggestion to wait with reason.
 */
export function generateNextMatch(
  players: PlayerStats[],
  config: RotationConfig
): RotationResult | null {
  const playersPerTeam = config.format === "singles" ? 1 : 2;
  const playersNeeded = playersPerTeam * 2;

  // Available = not currently playing on another court
  const available = players.filter((p) => !p.isPlaying);

  if (available.length < playersNeeded) {
    return null; // Not enough players
  }

  // Score each available player for selection priority
  const scored = available.map((p) => ({
    ...p,
    score: calcPlayerScore(p, players, config),
  }));

  // Sort: highest score = should play next
  scored.sort((a, b) => b.score - a.score);

  // Pick top players
  const selected = scored.slice(0, playersNeeded);

  // Form teams based on pairing mode
  const { team1, team2 } = formTeams(selected, config);

  // Check if waiting would be significantly better
  const waitCheck = checkShouldWait(selected, scored, players, config);

  return {
    team1: team1.map((p) => p.id),
    team2: team2.map((p) => p.id),
    courtNum: config.courtNum,
    shouldWait: waitCheck.shouldWait,
    waitReason: waitCheck.reason,
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

  // Fairness: players with fewer matches get higher score
  // Always active, but weighted more when prioFairness is on
  const fairnessWeight = config.prioFairness ? 100 : 40;
  const matchDeficit = maxMatches - player.matchesPlayed;
  score += matchDeficit * fairnessWeight;

  // Speed: players who've been waiting longest get higher score
  // Always active, but weighted more when prioSpeed is on
  const speedWeight = config.prioSpeed ? 50 : 20;
  const waitTime = player.lastMatchEndedAt > 0
    ? (now - player.lastMatchEndedAt) / 60000 // minutes
    : 999; // never played = max wait
  score += Math.min(waitTime, 30) * speedWeight;

  // Skill: bonus for players whose skill level fits the court
  // For King of Court: higher skill → higher court preference
  if (config.prioSkill && player.skillLevel) {
    const skillWeight = 30;
    if (config.pairingMode === "king_of_court") {
      // Court 1 = best, Court N = worst
      // Match player skill to court rank
      const courtRank = config.numCourts - config.courtNum + 1; // 1=worst court, N=best
      const skillMatch = 3 - Math.abs(player.skillLevel - courtRank);
      score += skillMatch * skillWeight;
    } else {
      score += player.skillLevel * skillWeight;
    }
  }

  // King of Court: winners on this court get bonus to stay
  if (config.pairingMode === "king_of_court" && config.winners?.includes(player.id)) {
    score += 200; // Strong bonus to keep winners
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

  // Doubles: form balanced teams
  // Sort by rating
  const sorted = [...selected].sort((a, b) => b.rating - a.rating);

  if (config.pairingMode === "mixed_gender" || config.pairingMode === "skill_mixed_gender") {
    // Try to put M+F on each team
    const males = sorted.filter((p) => p.gender === "M");
    const females = sorted.filter((p) => p.gender === "F");
    const others = sorted.filter((p) => !p.gender || (p.gender !== "M" && p.gender !== "F"));

    if (males.length >= 2 && females.length >= 2) {
      // Best balance: strongest M + weakest F vs weakest M + strongest F
      return {
        team1: [males[0], females[females.length - 1]],
        team2: [males[1], females[0]],
      };
    }
    // Fallback: use others to fill
    const all = [...males, ...females, ...others];
    return {
      team1: [all[0], all[3]],
      team2: [all[1], all[2]],
    };
  }

  // Default: pair strongest with weakest for balance
  // 1st + 4th vs 2nd + 3rd
  return {
    team1: [sorted[0], sorted[3]],
    team2: [sorted[1], sorted[2]],
  };
}

function checkShouldWait(
  selected: PlayerStats[],
  allScored: PlayerStats[],
  allPlayers: PlayerStats[],
  config: RotationConfig
): { shouldWait: boolean; reason?: string } {
  // If speed is prioritized, never suggest waiting
  if (config.prioSpeed && !config.prioFairness && !config.prioSkill) {
    return { shouldWait: false };
  }

  // Check if there are players currently playing who have significantly fewer matches
  const playingPlayers = allPlayers.filter((p) => p.isPlaying);
  const minSelectedMatches = Math.min(...selected.map((p) => p.matchesPlayed));

  for (const p of playingPlayers) {
    // If someone playing has 2+ fewer matches than the least-played selected player
    if (config.prioFairness && p.matchesPlayed < minSelectedMatches - 1) {
      return {
        shouldWait: true,
        reason: `${p.name} has only played ${p.matchesPlayed} match${p.matchesPlayed !== 1 ? "es" : ""} — waiting for their current game to finish`,
      };
    }
  }

  return { shouldWait: false };
}
