import { describe, it, expect } from "vitest";
import { generateDuprCsv, toDuprScoringFormat } from "../dupr-export";

describe("toDuprScoringFormat", () => {
  it("maps standard scoring types to STANDARD", () => {
    expect(toDuprScoringFormat("normal_11")).toBe("STANDARD");
    expect(toDuprScoringFormat("normal_15")).toBe("STANDARD");
    expect(toDuprScoringFormat("normal_9")).toBe("STANDARD");
    expect(toDuprScoringFormat("timed")).toBe("STANDARD");
  });

  it("maps rally scoring types to RALLY", () => {
    expect(toDuprScoringFormat("rally_21")).toBe("RALLY");
    expect(toDuprScoringFormat("rally_15")).toBe("RALLY");
  });
});

describe("generateDuprCsv", () => {
  it("generates correct CSV header", () => {
    const csv = generateDuprCsv([]);
    const lines = csv.split("\n");
    expect(lines[0]).toContain("Match Date");
    expect(lines[0]).toContain("Team 1 Player 1 DUPR ID");
    expect(lines[0]).toContain("Team 2 Score");
  });

  it("generates correct data rows", () => {
    const csv = generateDuprCsv([{
      matchDate: "2026-04-05",
      matchType: "DOUBLES",
      scoringFormat: "STANDARD",
      team1Player1Name: "Johan",
      team1Player1DuprId: "D123",
      team1Player2Name: "Kim",
      team1Player2DuprId: "D456",
      team2Player1Name: "Mike",
      team2Player1DuprId: "D789",
      team2Player2Name: "Lisa",
      team2Player2DuprId: "D012",
      team1Score: 11,
      team2Score: 7,
    }]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[1]).toContain("Johan");
    expect(lines[1]).toContain("D123");
    expect(lines[1]).toContain("11");
    expect(lines[1]).toContain("7");
  });

  it("handles empty DUPR IDs", () => {
    const csv = generateDuprCsv([{
      matchDate: "2026-04-05",
      matchType: "SINGLES",
      scoringFormat: "RALLY",
      team1Player1Name: "Johan",
      team1Player1DuprId: "",
      team1Player2Name: "",
      team1Player2DuprId: "",
      team2Player1Name: "Mike",
      team2Player1DuprId: "",
      team2Player2Name: "",
      team2Player2DuprId: "",
      team1Score: 21,
      team2Score: 15,
    }]);
    expect(csv).toContain("SINGLES");
    expect(csv).toContain("RALLY");
  });

  it("handles multiple matches", () => {
    const matches = Array.from({ length: 5 }, (_, i) => ({
      matchDate: `2026-04-0${i + 1}`,
      matchType: "DOUBLES" as const,
      scoringFormat: "STANDARD" as const,
      team1Player1Name: `P${i * 4 + 1}`,
      team1Player1DuprId: "",
      team1Player2Name: `P${i * 4 + 2}`,
      team1Player2DuprId: "",
      team2Player1Name: `P${i * 4 + 3}`,
      team2Player1DuprId: "",
      team2Player2Name: `P${i * 4 + 4}`,
      team2Player2DuprId: "",
      team1Score: 11,
      team2Score: i + 3,
    }));
    const csv = generateDuprCsv(matches);
    expect(csv.split("\n").length).toBe(6); // header + 5 rows
  });
});
