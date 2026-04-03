import { describe, it, expect } from "vitest";
import { getNextBracketMatch, getMatchWinnerLoser } from "../progression";

describe("getNextBracketMatch", () => {
  it("QF position 1 winner goes to SF position 1 team 1", () => {
    const result = getNextBracketMatch("upper_qf", 1, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_sf",
      bracketPosition: 1,
      team: 1,
    });
  });

  it("QF position 2 winner goes to SF position 1 team 2", () => {
    const result = getNextBracketMatch("upper_qf", 2, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_sf",
      bracketPosition: 1,
      team: 2,
    });
  });

  it("QF position 3 winner goes to SF position 2 team 1", () => {
    const result = getNextBracketMatch("upper_qf", 3, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_sf",
      bracketPosition: 2,
      team: 1,
    });
  });

  it("QF position 4 winner goes to SF position 2 team 2", () => {
    const result = getNextBracketMatch("upper_qf", 4, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_sf",
      bracketPosition: 2,
      team: 2,
    });
  });

  it("SF position 1 winner goes to Final position 1 team 1", () => {
    const result = getNextBracketMatch("upper_sf", 1, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_f",
      bracketPosition: 1,
      team: 1,
    });
  });

  it("SF position 2 winner goes to Final position 1 team 2", () => {
    const result = getNextBracketMatch("upper_sf", 2, "upper", true);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_f",
      bracketPosition: 1,
      team: 2,
    });
  });

  it("SF losers go to 3rd place match when enabled", () => {
    const r1 = getNextBracketMatch("upper_sf", 1, "upper", true);
    expect(r1.loserNext).toEqual({
      bracketStage: "upper_3rd",
      bracketPosition: 1,
      team: 1,
    });

    const r2 = getNextBracketMatch("upper_sf", 2, "upper", true);
    expect(r2.loserNext).toEqual({
      bracketStage: "upper_3rd",
      bracketPosition: 1,
      team: 2,
    });
  });

  it("SF losers do NOT go to 3rd place when disabled", () => {
    const r1 = getNextBracketMatch("upper_sf", 1, "upper", false);
    expect(r1.loserNext).toBeNull();
  });

  it("Final has no next match", () => {
    const result = getNextBracketMatch("upper_f", 1, "upper", true);
    expect(result.winnerNext).toBeNull();
    expect(result.loserNext).toBeNull();
  });

  it("3rd place match has no next match", () => {
    const result = getNextBracketMatch("upper_3rd", 1, "upper", true);
    expect(result.winnerNext).toBeNull();
  });

  it("works for lower bracket", () => {
    const result = getNextBracketMatch("lower_sf", 1, "lower", false);
    expect(result.winnerNext).toEqual({
      bracketStage: "lower_f",
      bracketPosition: 1,
      team: 1,
    });
  });

  it("R16 position 1 winner goes to QF position 1 team 1", () => {
    const result = getNextBracketMatch("upper_r16", 1, "upper", false);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_qf",
      bracketPosition: 1,
      team: 1,
    });
  });

  it("R16 position 8 winner goes to QF position 4 team 2", () => {
    const result = getNextBracketMatch("upper_r16", 8, "upper", false);
    expect(result.winnerNext).toEqual({
      bracketStage: "upper_qf",
      bracketPosition: 4,
      team: 2,
    });
  });
});

describe("getMatchWinnerLoser", () => {
  it("identifies team 1 as winner when they have higher score", () => {
    const result = getMatchWinnerLoser([
      { playerId: "a", team: 1, score: 11 },
      { playerId: "b", team: 1, score: 0 },
      { playerId: "c", team: 2, score: 5 },
      { playerId: "d", team: 2, score: 0 },
    ]);
    expect(result.winnerTeam).toBe(1);
    expect(result.winnerPlayerIds).toEqual(["a", "b"]);
    expect(result.loserPlayerIds).toEqual(["c", "d"]);
  });

  it("identifies team 2 as winner when they have higher score", () => {
    const result = getMatchWinnerLoser([
      { playerId: "a", team: 1, score: 3 },
      { playerId: "b", team: 1, score: 0 },
      { playerId: "c", team: 2, score: 11 },
      { playerId: "d", team: 2, score: 0 },
    ]);
    expect(result.winnerTeam).toBe(2);
    expect(result.winnerPlayerIds).toEqual(["c", "d"]);
    expect(result.loserPlayerIds).toEqual(["a", "b"]);
  });
});
