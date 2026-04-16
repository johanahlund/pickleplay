import { describe, it, expect } from "vitest";
import { suggestWaitingAction } from "./waitingSuggestion";

describe("suggestWaitingAction — 2 courts, 8–12 players", () => {
  it("8 players: 0 idle → partner-swap rematch", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 8, numCourts: 2, idleCount: 0 });
    expect(r.type).toBe("filler");
    if (r.type === "filler") expect(r.filler).toBe("rematch-swap-partners");
  });

  it("9 players: 1 idle → swap one in, rematch", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 9, numCourts: 2, idleCount: 1 });
    expect(r.type).toBe("filler");
    if (r.type === "filler") expect(r.filler).toBe("swap-one-in");
  });

  it("10 players: 2 idle → new match (2 idle + 2 freed)", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 10, numCourts: 2, idleCount: 2 });
    expect(r.type).toBe("new_match");
    expect(r.headline).toMatch(/swap|start/i);
  });

  it("11 players: 3 idle → new match", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 11, numCourts: 2, idleCount: 3 });
    expect(r.type).toBe("new_match");
  });

  it("12 players: 4 idle → clean fresh match", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 12, numCourts: 2, idleCount: 4 });
    expect(r.type).toBe("new_match");
    expect(r.detail).toMatch(/fresh/i);
  });
});

describe("suggestWaitingAction — out of scope", () => {
  it("3 courts falls through to normal new_match", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 12, numCourts: 3, idleCount: 0 });
    expect(r.type).toBe("new_match");
    expect(r.detail).toMatch(/normal/i);
  });

  it("13 players on 2 courts falls through (rolling mode territory)", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 13, numCourts: 2, idleCount: 5 });
    expect(r.type).toBe("new_match");
    expect(r.detail).toMatch(/normal/i);
  });

  it("7 players on 2 courts falls through", () => {
    const r = suggestWaitingAction({ totalActivePlayers: 7, numCourts: 2, idleCount: 3 });
    expect(r.type).toBe("new_match");
  });
});
