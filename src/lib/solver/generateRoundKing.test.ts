import { describe, it, expect } from "vitest";
import { generateRound } from "./generateRound";
import type {
  Match,
  MatchHistoryEntry,
  PairingSettings,
  SolverInput,
  SolverPlayer,
  SkillLevel,
} from "./types";

function mkPlayer(
  id: string,
  level: SkillLevel,
  matchCount = 0,
  extras: Partial<SolverPlayer> = {},
): SolverPlayer {
  return {
    id,
    name: id,
    skillLevel: level,
    gender: null,
    matchCount,
    ...extras,
  };
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

function run(
  players: SolverPlayer[],
  numCourts: number,
  history: MatchHistoryEntry[] = [],
  settingsOverride: Partial<PairingSettings> = {},
) {
  const input: SolverInput = {
    players,
    numCourts,
    settings: { ...baseSettings, ...settingsOverride },
    history,
    locks: [],
  };
  return generateRound(input);
}

function courtPlayerIds(m: Match): Set<string> {
  return new Set([m.team1.player1Id, m.team1.player2Id, m.team2.player1Id, m.team2.player2Id]);
}

function team(p1: string, p2: string): [string, string] {
  return [p1, p2];
}

describe("King round 1 — seed by skill", () => {
  it("top-skill players → C1, bottom → highest court, lowest skill → bench", () => {
    const players = [
      mkPlayer("e1", 5), mkPlayer("e2", 5), mkPlayer("e3", 5), mkPlayer("e4", 5),
      mkPlayer("b1", 1), mkPlayer("b2", 1), mkPlayer("b3", 1), mkPlayer("b4", 1),
    ];
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    const c1 = courtPlayerIds(result.round[0]);
    const c2 = courtPlayerIds(result.round[1]);
    for (const id of ["e1", "e2", "e3", "e4"]) expect(c1.has(id)).toBe(true);
    for (const id of ["b1", "b2", "b3", "b4"]) expect(c2.has(id)).toBe(true);
    expect(result.sittingOut).toHaveLength(0);
  });

  it("10p / 2c: bottom 2 by skill go to bench", () => {
    const players = [
      mkPlayer("a", 5), mkPlayer("b", 5), mkPlayer("c", 5), mkPlayer("d", 5),
      mkPlayer("e", 4), mkPlayer("f", 4), mkPlayer("g", 4), mkPlayer("h", 4),
      mkPlayer("i", 1), mkPlayer("j", 1),
    ];
    const result = run(players, 2);
    expect(result.round).toHaveLength(2);
    expect(result.sittingOut).toHaveLength(2);
    expect(new Set(result.sittingOut)).toEqual(new Set(["i", "j"]));
  });
});

describe("King round 2 special case — send losers from lowest court first", () => {
  it("10p/2c: bench gets the round-1 C2 losers", () => {
    // After round 1: A-H all have matchCount=1, I,J have 0.
    // C1: a,b,c,d. C2: e,f,g,h. Bench: i,j.
    // Round 1 results: c1 = a+b beat c+d; c2 = e+f beat g+h.
    const players = [
      mkPlayer("a", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("b", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("c", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "d", lastRoundCourt: 1 }),
      mkPlayer("d", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "c", lastRoundCourt: 1 }),
      mkPlayer("e", 4, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("f", 4, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("g", 4, 1, { lostLastRound: true, lastRoundLosingPartnerId: "h", lastRoundCourt: 2 }),
      mkPlayer("h", 4, 1, { lostLastRound: true, lastRoundLosingPartnerId: "g", lastRoundCourt: 2 }),
      mkPlayer("i", 1, 0),
      mkPlayer("j", 1, 0),
    ];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: team("a", "b"), team2Ids: team("c", "d"), winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: team("e", "f"), team2Ids: team("g", "h"), winningTeam: 1 },
    ];
    const result = run(players, 2, history);

    // Bench should be g, h (C2 losers). i, j come on at C2.
    expect(new Set(result.sittingOut)).toEqual(new Set(["g", "h"]));

    const c1 = courtPlayerIds(result.round[0]);
    const c2 = courtPlayerIds(result.round[1]);
    // C1 winners (a, b) stay, C2 winners (e, f) climb → C1 = {a, b, e, f}.
    expect(c1).toEqual(new Set(["a", "b", "e", "f"]));
    // C1 losers (c, d) fall + bench (i, j) come on → C2 = {c, d, i, j}.
    expect(c2).toEqual(new Set(["c", "d", "i", "j"]));
  });

  it("after round 2: tied matchCount, prefer losing pair", () => {
    // Set up post-round-2 state: a,b,c,d,e,f played 2 rounds; g,h played 1; i,j played 1.
    // Round 2 played by: a-f + i,j (g,h benched). C1: a-d, C2: e,f,i,j.
    // Round 2 results: C1 a+c beat b+d → b,d losing pair. C2 e+i beat f+j.
    const players = [
      mkPlayer("a", 5, 2, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("b", 5, 2, { lostLastRound: true, lastRoundLosingPartnerId: "d", lastRoundCourt: 1 }),
      mkPlayer("c", 5, 2, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("d", 5, 2, { lostLastRound: true, lastRoundLosingPartnerId: "b", lastRoundCourt: 1 }),
      mkPlayer("e", 4, 2, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("f", 4, 2, { lostLastRound: true, lastRoundLosingPartnerId: "j", lastRoundCourt: 2 }),
      mkPlayer("g", 4, 1),
      mkPlayer("h", 4, 1),
      mkPlayer("i", 1, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("j", 1, 1, { lostLastRound: true, lastRoundLosingPartnerId: "f", lastRoundCourt: 2 }),
    ];
    const history: MatchHistoryEntry[] = [
      // Round 1
      { round: 1, courtNum: 1, team1Ids: team("a", "b"), team2Ids: team("c", "d"), winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: team("e", "f"), team2Ids: team("g", "h"), winningTeam: 1 },
      // Round 2 — g,h benched
      { round: 2, courtNum: 1, team1Ids: team("a", "c"), team2Ids: team("b", "d"), winningTeam: 1 },
      { round: 2, courtNum: 2, team1Ids: team("e", "i"), team2Ids: team("f", "j"), winningTeam: 1 },
    ];
    const result = run(players, 2, history);

    // Highest matchCount = a-f at 2. Among them, b+d is a losing pair from
    // round 2. Algorithm prefers losing pair → bench should be {b, d}.
    expect(new Set(result.sittingOut)).toEqual(new Set(["b", "d"]));
    expect(result.round).toHaveLength(2);
  });
});

describe("King bench size 4 — 12 players, 2 courts", () => {
  it("round 2: send 4 losers from round 1 (both courts)", () => {
    const players = [
      mkPlayer("a", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("b", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("c", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "d", lastRoundCourt: 1 }),
      mkPlayer("d", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "c", lastRoundCourt: 1 }),
      mkPlayer("e", 4, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("f", 4, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("g", 4, 1, { lostLastRound: true, lastRoundLosingPartnerId: "h", lastRoundCourt: 2 }),
      mkPlayer("h", 4, 1, { lostLastRound: true, lastRoundLosingPartnerId: "g", lastRoundCourt: 2 }),
      mkPlayer("i", 1, 0),
      mkPlayer("j", 1, 0),
      mkPlayer("k", 1, 0),
      mkPlayer("l", 1, 0),
    ];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: team("a", "b"), team2Ids: team("c", "d"), winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: team("e", "f"), team2Ids: team("g", "h"), winningTeam: 1 },
    ];
    const result = run(players, 2, history);

    // All 4 round-1 losers (c, d, g, h) sit out.
    expect(new Set(result.sittingOut)).toEqual(new Set(["c", "d", "g", "h"]));

    // 8 remaining play: a, b, e, f (winners) + i, j, k, l (bench arrivals).
    const allOnCourt = new Set<string>();
    for (const m of result.round) {
      for (const id of courtPlayerIds(m)) allOnCourt.add(id);
    }
    expect(allOnCourt).toEqual(new Set(["a", "b", "e", "f", "i", "j", "k", "l"]));
  });
});

describe("King — full court fits exactly, no bench", () => {
  it("8p/2c: nobody sits out, normal winners-up/losers-down applies", () => {
    const players = [
      mkPlayer("top1", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("top2", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("top3", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "top4", lastRoundCourt: 1 }),
      mkPlayer("top4", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "top3", lastRoundCourt: 1 }),
      mkPlayer("bot1", 1, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("bot2", 1, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("bot3", 1, 1, { lostLastRound: true, lastRoundLosingPartnerId: "bot4", lastRoundCourt: 2 }),
      mkPlayer("bot4", 1, 1, { lostLastRound: true, lastRoundLosingPartnerId: "bot3", lastRoundCourt: 2 }),
    ];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: team("top1", "top2"), team2Ids: team("top3", "top4"), winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: team("bot1", "bot2"), team2Ids: team("bot3", "bot4"), winningTeam: 1 },
    ];
    const result = run(players, 2, history);
    expect(result.sittingOut).toHaveLength(0);

    const c1 = courtPlayerIds(result.round[0]);
    const c2 = courtPlayerIds(result.round[1]);
    // C1 winners stay (top1, top2). C2 winners climb (bot1, bot2). → C1 = those.
    expect(c1).toEqual(new Set(["top1", "top2", "bot1", "bot2"]));
    // C1 losers fall (top3, top4). C2 losers stay (bot3, bot4). → C2 = those.
    expect(c2).toEqual(new Set(["top3", "top4", "bot3", "bot4"]));
  });
});

describe("King — pair splitting within a court", () => {
  it("8p/2c: round 2 splits the previous winning pair across teams", () => {
    // Round 1: C1 = top1+top2 (won) vs top3+top4 (lost).
    //          C2 = bot1+bot2 (won) vs bot3+bot4 (lost).
    // Round 2 C1: top1, top2 (winners stay) + bot1, bot2 (climbers).
    // Pair-split should mean top1 and top2 are NOT teammates again
    // (since they partnered in round 1), AND bot1 and bot2 are NOT
    // teammates again.
    const players = [
      mkPlayer("top1", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("top2", 5, 1, { lostLastRound: false, lastRoundCourt: 1 }),
      mkPlayer("top3", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "top4", lastRoundCourt: 1 }),
      mkPlayer("top4", 5, 1, { lostLastRound: true, lastRoundLosingPartnerId: "top3", lastRoundCourt: 1 }),
      mkPlayer("bot1", 1, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("bot2", 1, 1, { lostLastRound: false, lastRoundCourt: 2 }),
      mkPlayer("bot3", 1, 1, { lostLastRound: true, lastRoundLosingPartnerId: "bot4", lastRoundCourt: 2 }),
      mkPlayer("bot4", 1, 1, { lostLastRound: true, lastRoundLosingPartnerId: "bot3", lastRoundCourt: 2 }),
    ];
    const history: MatchHistoryEntry[] = [
      { round: 1, courtNum: 1, team1Ids: team("top1", "top2"), team2Ids: team("top3", "top4"), winningTeam: 1 },
      { round: 1, courtNum: 2, team1Ids: team("bot1", "bot2"), team2Ids: team("bot3", "bot4"), winningTeam: 1 },
    ];
    const result = run(players, 2, history);

    // C1 in round 2: {top1, top2, bot1, bot2}. Pair-split should mean
    // top1 and top2 are not on the same team (they were partners in r1),
    // bot1 and bot2 are not on the same team (they were partners in r1).
    const c1Match = result.round[0];
    const t1 = new Set([c1Match.team1.player1Id, c1Match.team1.player2Id]);
    const t2 = new Set([c1Match.team2.player1Id, c1Match.team2.player2Id]);

    // top1 and top2 on opposite teams:
    expect((t1.has("top1") && t2.has("top2")) || (t1.has("top2") && t2.has("top1"))).toBe(true);
    // bot1 and bot2 on opposite teams:
    expect((t1.has("bot1") && t2.has("bot2")) || (t1.has("bot2") && t2.has("bot1"))).toBe(true);
  });
});

describe("King shake mode — ignores skill tiering, optimises variety", () => {
  it("8p/2c: top-skill and bottom-skill mix across courts when shake = true", () => {
    // After 4 rounds of normal play with the same 8 players, partnerships
    // get exhausted. Flipping shake should let the solver re-shuffle.
    const players = [
      mkPlayer("a", 5, 4), mkPlayer("b", 5, 4), mkPlayer("c", 5, 4), mkPlayer("d", 5, 4),
      mkPlayer("e", 1, 4), mkPlayer("f", 1, 4), mkPlayer("g", 1, 4), mkPlayer("h", 1, 4),
    ];
    // Rich history so the variety scorer has something to push against:
    // every round of regular king play paired the top 4 together and
    // bottom 4 together.
    const history: MatchHistoryEntry[] = [];
    for (let r = 1; r <= 4; r++) {
      history.push({
        round: r, courtNum: 1,
        team1Ids: team("a", "b"), team2Ids: team("c", "d"),
        winningTeam: r % 2 === 0 ? 1 : 2,
      });
      history.push({
        round: r, courtNum: 2,
        team1Ids: team("e", "f"), team2Ids: team("g", "h"),
        winningTeam: r % 2 === 0 ? 1 : 2,
      });
    }
    const result = run(players, 2, history, { activeMode: "random", varietyWindow: 0 });

    // In shake mode the algorithm prefers to mix top and bottom skill
    // because they've never been paired. Each court should now contain
    // both top-skill and bottom-skill players.
    const c1 = courtPlayerIds(result.round[0]);
    const c2 = courtPlayerIds(result.round[1]);
    const topInC1 = [...c1].filter((id) => "abcd".includes(id)).length;
    const topInC2 = [...c2].filter((id) => "abcd".includes(id)).length;
    expect(topInC1).toBeGreaterThan(0);
    expect(topInC1).toBeLessThan(4);
    expect(topInC2).toBeGreaterThan(0);
    expect(topInC2).toBeLessThan(4);
  });
});

describe("King — fewer players than courts", () => {
  it("7p/2c → 1 court runs, 3 sit out", () => {
    const players = Array.from({ length: 7 }, (_, i) => mkPlayer(`p${i}`, 3));
    const result = run(players, 2);
    expect(result.round).toHaveLength(1);
    expect(result.sittingOut).toHaveLength(3);
  });
});
