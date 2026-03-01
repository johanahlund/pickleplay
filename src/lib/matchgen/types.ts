export interface PlayerInfo {
  id: string;
  name: string;
  rating: number;
  gender?: string | null; // "M" | "F" | null
}

export type MatchResult = {
  court: number;
  team1: PlayerInfo[];
  team2: PlayerInfo[];
};

export type PairingMode = "random" | "skill_balanced" | "mixed_gender" | "skill_mixed_gender" | "king_of_court" | "swiss";

export interface CompletedMatch {
  id: string;
  round: number;
  courtNum: number;
  players: {
    playerId: string;
    team: number;
    score: number;
  }[];
}
