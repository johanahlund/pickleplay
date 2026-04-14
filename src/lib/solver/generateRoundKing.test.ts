import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
} from "./types";

function mkPlayer(id: string, level: SkillLevel): SolverPlayer {
  return { id, name: id, skillLevel: level, gender: null, matchCount: 0 };
}

const baseSettings: PairingSettings = {
  base: "king",
  teams: "rotating",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: Infinity,
  varietyWindow: Infinity,
  maxWaitWindow: Infinity,
};

function run(players: SolverPlayer[], numCourts: number, history: MatchHistoryEntry[] = []) {
  const input: SolverInput = {
    players,
    numCourts,
    settings: baseSettings,
    history,
    locks: [],
  };
  return generateRound(input);
}

// Helper: collect the 4 player IDs on a given court's match.
function courtPlayerIds(m: ReturnType<typeof generateRound>["round"][number]): Set<string> {
  return new Set([m.team1.player1Id, m.team1.player2Id, m.team2.player1Id, m.team2.player2Id]);
}

describe("generateRound — King round 1 seeding", () => {
  it("top-skill players go to court 1, lowest to the highest court number", () => {
    const players = [
      mkPlayer("e1", 5), mkPlayer("e2", 5), mkPlayer("e3", 5), mkPlayer("e4", 5), // experts
      mkPlayer("b1", 1), mkPlayer("b2", 1), mkPlayer("b3", 1), mkPlayer("b4", 1), // beginners
    ];
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    const court1 = result.round[0];
    const court2 = result.round[1];
    const c1Ids = courtPlayerIds(court1);
    const c2Ids = courtPlayerIds(court2);
    // Court 1 = experts
    expect(c1Ids.has("e1") && c1Ids.has("e2") && c1Ids.has("e3") && c1Ids.has("e4")).toBe(true);
    // Court 2 = beginners
    expect(c2Ids.has("b1") && c2Ids.has("b2") && c2Ids.has("b3") && c2Ids.has("b4")).toBe(true);
  });
});

describe("generateRound — King winners up / losers down", () => {
  it("winners from court 2 move up to court 1, losers from court 1 stay", () => {
    const players = [
      mkPlayer("top1", 5), mkPlayer("top2", 5), mkPlayer("top3", 5), mkPlayer("top4", 5),
      mkPlayer("bot1", 1), mkPlayer("bot2", 1), mkPlayer("bot3", 1), mkPlayer("bot4", 1),
    ];
    // Round 1: top players on court 1, bot on court 2.
    // Round 1 results: court 1 = top1+top2 won vs top3+top4 losing.
    //                  court 2 = bot1+bot2 won vs bot3+bot4 losing.
    // Round 2 expected:
    //   Court 1 winners (top1, top2) STAY on court 1 (can't move above 1)
    //   Court 1 losers (top3, top4) move DOWN to court 2
    //   Court 2 winners (bot1, bot2) move UP to court 1
    //   Court 2 losers (bot3, bot4) STAY on court 2 (can't move below last)
    const history: MatchHistoryEntry[] = [
      {
        round: 1, courtNum: 1,
        team1Ids: ["top1", "top2"], team2Ids: ["top3", "top4"],
        winningTeam: 1,
      },
      {
        round: 1, courtNum: 2,
        team1Ids: ["bot1", "bot2"], team2Ids: ["bot3", "bot4"],
        winningTeam: 1,
      },
    ];
    const result = run(players, 2, history);
    expect(result.round).toHaveLength(2);

    const c1 = courtPlayerIds(result.round[0]);
    const c2 = courtPlayerIds(result.round[1]);

    // Court 1: top1, top2 (stayed) + bot1, bot2 (moved up)
    expect(c1.has("top1") && c1.has("top2")).toBe(true);
    expect(c1.has("bot1") && c1.has("bot2")).toBe(true);

    // Court 2: top3, top4 (moved down) + bot3, bot4 (stayed)
    expect(c2.has("top3") && c2.has("top4")).toBe(true);
    expect(c2.has("bot3") && c2.has("bot4")).toBe(true);
  });
});

describe("generateRound — King edge cases", () => {
  it("3 courts: middle court winners move to 2, losers to 4th... but only 3 courts", () => {
    const players = [
      mkPlayer("a1", 5), mkPlayer("a2", 5), mkPlayer("a3", 5), mkPlayer("a4", 5),
      mkPlayer("b1", 3), mkPlayer("b2", 3), mkPlayer("b3", 3), mkPlayer("b4", 3),
      mkPlayer("c1", 1), mkPlayer("c2", 1), mkPlayer("c3", 1), mkPlayer("c4", 1),
    ];
    const result = run(players, 3);
    expect(result.round).toHaveLength(3);
    const c1 = courtPlayerIds(result.round[0]);
    const c3 = courtPlayerIds(result.round[2]);
    expect(c1.has("a1") && c1.has("a2") && c1.has("a3") && c1.has("a4")).toBe(true);
    expect(c3.has("c1") && c3.has("c2") && c3.has("c3") && c3.has("c4")).toBe(true);
  });

  it("fewer players than fully fills the courts → sits out from the bottom", () => {
    const players = Array.from({ length: 7 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    // 7 players on 2 courts = 1 full court (4 players), 3 sitting out.
    expect(result.round).toHaveLength(1);
    expect(result.sittingOut).toHaveLength(3);
  });
});
