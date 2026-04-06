import { describe, it, expect } from "vitest";
import { estimateGlobalRating } from "../ratings";

describe("estimateGlobalRating", () => {
  it("returns direct global rating with high confidence", () => {
    const result = estimateGlobalRating(850, 5, 1200, -350);
    expect(result.rating).toBe(850);
    expect(result.isEstimate).toBe(false);
    expect(result.confidence).toBe("high");
  });

  it("returns direct global rating with medium confidence", () => {
    const result = estimateGlobalRating(850, 2, 1200, -350);
    expect(result.rating).toBe(850);
    expect(result.isEstimate).toBe(false);
    expect(result.confidence).toBe("medium");
  });

  it("returns direct global rating with low confidence", () => {
    const result = estimateGlobalRating(850, 1, 1200, -350);
    expect(result.rating).toBe(850);
    expect(result.isEstimate).toBe(false);
    expect(result.confidence).toBe("low");
  });

  it("estimates from club offset when no global rating", () => {
    const result = estimateGlobalRating(null, 0, 1200, -350);
    expect(result.rating).toBe(850);
    expect(result.isEstimate).toBe(true);
    expect(result.confidence).toBe("estimated");
  });

  it("returns null when no global rating and no club offset", () => {
    const result = estimateGlobalRating(null, 0, 1200, null);
    expect(result.rating).toBeNull();
    expect(result.isEstimate).toBe(true);
    expect(result.confidence).toBe("none");
  });

  it("handles zero offset", () => {
    const result = estimateGlobalRating(null, 0, 1000, 0);
    expect(result.rating).toBe(1000);
    expect(result.isEstimate).toBe(true);
  });

  it("handles negative club rating with offset", () => {
    const result = estimateGlobalRating(null, 0, 800, 200);
    expect(result.rating).toBe(1000);
  });
});
