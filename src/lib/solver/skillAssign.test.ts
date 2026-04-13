import { describe, it, expect } from "vitest";
import { duprToLevel, ratingToLevel, autoAssignSkillLevel } from "./skillAssign";

describe("duprToLevel", () => {
  it("< 2.5 → L1", () => {
    expect(duprToLevel(2.0)).toBe(1);
    expect(duprToLevel(2.49)).toBe(1);
  });
  it("2.5–2.99 → L2", () => {
    expect(duprToLevel(2.5)).toBe(2);
    expect(duprToLevel(2.99)).toBe(2);
  });
  it("3.0–3.49 → L3", () => {
    expect(duprToLevel(3.0)).toBe(3);
    expect(duprToLevel(3.49)).toBe(3);
  });
  it("3.5–3.99 → L4", () => {
    expect(duprToLevel(3.5)).toBe(4);
    expect(duprToLevel(3.99)).toBe(4);
  });
  it("≥ 4.0 → L5", () => {
    expect(duprToLevel(4.0)).toBe(5);
    expect(duprToLevel(5.0)).toBe(5);
  });
});

describe("ratingToLevel", () => {
  it("< 950 → L1", () => {
    expect(ratingToLevel(800)).toBe(1);
    expect(ratingToLevel(949)).toBe(1);
  });
  it("950–1049 → L2", () => {
    expect(ratingToLevel(950)).toBe(2);
    expect(ratingToLevel(1049)).toBe(2);
  });
  it("1050–1149 → L3", () => {
    expect(ratingToLevel(1050)).toBe(3);
    expect(ratingToLevel(1000)).toBe(2); // sanity
    expect(ratingToLevel(1149)).toBe(3);
  });
  it("1150–1249 → L4", () => {
    expect(ratingToLevel(1150)).toBe(4);
    expect(ratingToLevel(1249)).toBe(4);
  });
  it("≥ 1250 → L5", () => {
    expect(ratingToLevel(1250)).toBe(5);
    expect(ratingToLevel(1500)).toBe(5);
  });
});

describe("autoAssignSkillLevel", () => {
  it("prefers DUPR when both are set", () => {
    expect(autoAssignSkillLevel({ duprRating: 3.6, globalRating: 800 })).toBe(4);
  });
  it("falls back to app rating when DUPR missing", () => {
    expect(autoAssignSkillLevel({ duprRating: null, globalRating: 1200 })).toBe(4);
  });
  it("defaults to L3 when neither is set", () => {
    expect(autoAssignSkillLevel({})).toBe(3);
    expect(autoAssignSkillLevel({ duprRating: null, globalRating: null })).toBe(3);
  });
});
