import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  Match,
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  Team,
  SkillLevel,
} from "./types";

function mkPlayer(id: string, level: SkillLevel, matchCount = 0): SolverPlayer {
  return { id, name: id, skillLevel: level, gender: null, matchCount };
}

const base: PairingSettings = {
  base: "king",
  teams: "fixed",
  gender: "random",
  skillWindow: Infinity,
  matchCountWindow: Infinity,
  varietyWindow: Infinity,
  maxWaitWindow: Infinity,
};

function pair(a: string, b: string): Team { return { player1Id: a, player2Id: b }; }

function run(
  players: SolverPlayer[],
  fixedTeams: Team[],
  numCourts: number,
  history: MatchHistoryEntry[] = [],
  settingsOverride: Partial<PairingSettings> = {},
) {
  const input: SolverInput = {
    players,
    fixedTeams,
    numCourts,
    settings: { ...base, ...settingsOverride },
    history,
    locks: [],
  };
  return generateRound(input);
}

function teamSetForCourt(m: Match): Set<string> {
  return new Set([m.team1.player1Id, m.team1.player2Id, m.team2.player1Id, m.team2.player2Id]);
}

describe("King fixed-teams — round 1 seeds by team skill", () => {
  it("top-skill team → C1, bottom → highest court", () => {
    const players = [
      mkPlayer("a1", 5), mkPlayer("a2", 5),
      mkPlayer("b1", 3), mkPlayer("b2", 3),
      mkPlayer("c1", 1), mkPlayer("c2", 1),
      mkPlayer("d1", 1), mkPlayer("d2", 1),
    ];
    const teams = [pair("a1", "a2"), pair("b1", "b2"), pair("c1", "c2"), pair("d1", "d2")];
    const r = run(players, teams, 2);
    expect(r.round).toHaveLength(2);
    const c1 = teamSetForCourt(r.round[0]);
    expect(c1.has("a1") && c1.has("a2")).toBe(true);
    expect(c1.has("b1") && c1.has("b2")).toBe(true);
  });
});

describe("King fixed-teams — winners climb / losers fall as units", () => {
  it("8 players (4 teams) on 2 courts: C2 winners climb to C1 as a team", () => {
    const players = [
      mkPlayer("a1", 5, 1), mkPlayer("a2", 5, 1),
      mkPlayer("b1", 4, 1), mkPlayer("b2", 4, 1),
      mkPlayer("c1", 3, 1), mkPlayer("c2", 3, 1),
      mkPlayer("d1", 1, 1), mkPlayer("d2", 1, 1),
    ];
    const teams = [pair("a1", "a2"), pair("b1", "b2"), pair("c1", "c2"), pair("d1", "d2")];
    // Round 1: C1 = team a vs team b, team a won. C2 = team c vs team d, team c won.
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: ["a1", "a2"], team2Ids: ["b1", "b2"], winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: ["c1", "c2"], team2Ids: ["d1", "d2"], winningTeam: 1 },
    ];
    const r = run(players, teams, 2, history);
    expect(r.round).toHaveLength(2);
    const c1 = teamSetForCourt(r.round[0]);
    const c2 = teamSetForCourt(r.round[1]);
    // Round 2: team a stays (winner stays), team c climbs from C2 → C1.
    expect(c1).toEqual(new Set(["a1", "a2", "c1", "c2"]));
    // Team b falls C1 → C2, team d stays at bottom.
    expect(c2).toEqual(new Set(["b1", "b2", "d1", "d2"]));
  });
});

describe("King fixed-teams — team-level ejection when bench needed", () => {
  it("5 teams on 2 courts: 1 team benches; pairs never split", () => {
    const players = [
      mkPlayer("a1", 5, 1), mkPlayer("a2", 5, 1),
      mkPlayer("b1", 4, 1), mkPlayer("b2", 4, 1),
      mkPlayer("c1", 3, 1), mkPlayer("c2", 3, 1),
      mkPlayer("d1", 2, 1), mkPlayer("d2", 2, 1),
      mkPlayer("e1", 1, 0), mkPlayer("e2", 1, 0),
    ];
    const teams = [pair("a1", "a2"), pair("b1", "b2"), pair("c1", "c2"), pair("d1", "d2"), pair("e1", "e2")];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: ["a1", "a2"], team2Ids: ["b1", "b2"], winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: ["c1", "c2"], team2Ids: ["d1", "d2"], winningTeam: 1 },
    ];
    const r = run(players, teams, 2, history);

    // Bench is one whole team — exactly 2 players. The team is one of the
    // four that played round 1 (highest match count). Tiebreak prefers a
    // losing team.
    expect(r.sittingOut).toHaveLength(2);
    // Bench is a complete team pair.
    const benchSet = new Set(r.sittingOut);
    const benchIsValidTeam = teams.some(
      (t) => benchSet.has(t.player1Id) && benchSet.has(t.player2Id),
    );
    expect(benchIsValidTeam).toBe(true);

    // Both courts have full teams that never split across courts.
    for (const m of r.round) {
      const inMatch = teamSetForCourt(m);
      const allTeamsIntact = teams.every((t) => {
        const a = inMatch.has(t.player1Id);
        const b = inMatch.has(t.player2Id);
        return a === b; // both or neither
      });
      expect(allTeamsIntact).toBe(true);
    }
  });
});

describe("King fixed-teams — activeMode = random (variety override)", () => {
  it("shake mode prefers fresh team matchups", () => {
    // 4 teams, history forces "team a vs b" and "team c vs d" repeated.
    const players = [
      mkPlayer("a1", 3, 3), mkPlayer("a2", 3, 3),
      mkPlayer("b1", 3, 3), mkPlayer("b2", 3, 3),
      mkPlayer("c1", 3, 3), mkPlayer("c2", 3, 3),
      mkPlayer("d1", 3, 3), mkPlayer("d2", 3, 3),
    ];
    const teams = [pair("a1", "a2"), pair("b1", "b2"), pair("c1", "c2"), pair("d1", "d2")];
    const history: MatchHistoryEntry[] = [];
    for (let r = 1; r <= 3; r++) {
      history.push({ round: r, courtNum: 1, team1Ids: ["a1", "a2"], team2Ids: ["b1", "b2"], winningTeam: r % 2 === 0 ? 1 : 2 });
      history.push({ round: r, courtNum: 2, team1Ids: ["c1", "c2"], team2Ids: ["d1", "d2"], winningTeam: r % 2 === 0 ? 1 : 2 });
    }
    const r = run(players, teams, 2, history, { activeMode: "random" });

    // Shake should produce a-vs-c or a-vs-d (cross pairs) instead of
    // the repeated a-vs-b / c-vs-d.
    const matchKeys = r.round.map((m) => {
      const a = `${m.team1.player1Id}+${m.team1.player2Id}`;
      const b = `${m.team2.player1Id}+${m.team2.player2Id}`;
      return [a, b].sort().join(" vs ");
    });
    const hasRepeatedAvsB = matchKeys.some((k) => k.includes("a1+a2") && k.includes("b1+b2"));
    const hasRepeatedCvsD = matchKeys.some((k) => k.includes("c1+c2") && k.includes("d1+d2"));
    expect(hasRepeatedAvsB && hasRepeatedCvsD).toBe(false);
  });
});
