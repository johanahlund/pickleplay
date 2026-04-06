/**
 * Generate DUPR-compatible CSV from match data.
 * Format matches the DUPR Club Directors Results Template.
 */

interface DuprMatchRow {
  matchDate: string;
  matchType: "SINGLES" | "DOUBLES";
  scoringFormat: "STANDARD" | "RALLY";
  team1Player1Name: string;
  team1Player1DuprId: string;
  team1Player2Name: string;
  team1Player2DuprId: string;
  team2Player1Name: string;
  team2Player1DuprId: string;
  team2Player2Name: string;
  team2Player2DuprId: string;
  team1Score: number;
  team2Score: number;
}

export function generateDuprCsv(matches: DuprMatchRow[]): string {
  const headers = [
    "Match Date",
    "Match Type",
    "Scoring Format",
    "Team 1 Player 1 Name",
    "Team 1 Player 1 DUPR ID",
    "Team 1 Player 2 Name",
    "Team 1 Player 2 DUPR ID",
    "Team 2 Player 1 Name",
    "Team 2 Player 1 DUPR ID",
    "Team 2 Player 2 Name",
    "Team 2 Player 2 DUPR ID",
    "Team 1 Score",
    "Team 2 Score",
  ];

  const rows = matches.map((m) => [
    m.matchDate,
    m.matchType,
    m.scoringFormat,
    m.team1Player1Name,
    m.team1Player1DuprId,
    m.team1Player2Name,
    m.team1Player2DuprId,
    m.team2Player1Name,
    m.team2Player1DuprId,
    m.team2Player2Name,
    m.team2Player2DuprId,
    m.team1Score,
    m.team2Score,
  ].map((v) => `"${v}"`).join(","));

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Map our scoring format to DUPR format
 */
export function toDuprScoringFormat(scoringFormat: string): "STANDARD" | "RALLY" {
  if (scoringFormat.includes("R")) return "RALLY";
  return "STANDARD";
}
