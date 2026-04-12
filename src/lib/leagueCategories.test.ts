import { describe, it, expect } from "vitest";
import {
  autoCatName,
  validateCategoryInput,
  validateCategoryPatch,
} from "./leagueCategories";

describe("autoCatName", () => {
  it("formats Men's Doubles 55+", () => {
    expect(autoCatName({ format: "doubles", gender: "male", ageGroup: "55+" })).toBe("Men's Doubles 55+");
  });

  it("formats Women's Singles", () => {
    expect(autoCatName({ format: "singles", gender: "female", ageGroup: "open" })).toBe("Women's Singles");
  });

  it("formats Mixed Doubles", () => {
    expect(autoCatName({ format: "doubles", gender: "mix", ageGroup: "open" })).toBe("Mixed Doubles");
  });

  it("defaults to Doubles when gender open", () => {
    expect(autoCatName({})).toBe("Doubles");
  });

  it("appends skill range without trailing +", () => {
    expect(autoCatName({ format: "doubles", skillMin: 3.0, skillMax: 4.0 })).toBe("Doubles 3-4");
  });

  it("appends skillMin only with +", () => {
    expect(autoCatName({ format: "singles", gender: "female", skillMin: "3.5" })).toBe("Women's Singles 3.5+");
  });

  it("appends skillMax only with ≤", () => {
    expect(autoCatName({ format: "doubles", skillMax: 4.0 })).toBe("Doubles ≤4");
  });

  it("treats empty strings as missing", () => {
    expect(autoCatName({ skillMin: "", skillMax: "" })).toBe("Doubles");
  });
});

describe("validateCategoryInput (POST)", () => {
  const ok = (over: object = {}) => ({ name: "Men's Doubles", ...over });

  it("accepts a minimal valid input and applies defaults", () => {
    const r = validateCategoryInput(ok());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        name: "Men's Doubles",
        format: "doubles",
        gender: "open",
        ageGroup: "open",
        skillMin: null,
        skillMax: null,
        scoringFormat: "3x11",
        winBy: "2",
        status: "active",
      });
    }
  });

  it("trims name", () => {
    const r = validateCategoryInput(ok({ name: "  Foo  " }));
    expect(r.ok && r.data.name).toBe("Foo");
  });

  it("rejects empty name", () => {
    expect(validateCategoryInput(ok({ name: "   " })).ok).toBe(false);
    expect(validateCategoryInput({}).ok).toBe(false);
  });

  it("rejects non-object body", () => {
    expect(validateCategoryInput(null).ok).toBe(false);
    expect(validateCategoryInput("string").ok).toBe(false);
  });

  it("strips unknown fields (no leagueId tampering)", () => {
    const r = validateCategoryInput(ok({ leagueId: "evil", sortOrder: 999, id: "x" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.data as unknown as Record<string, unknown>).leagueId).toBeUndefined();
      expect((r.data as unknown as Record<string, unknown>).sortOrder).toBeUndefined();
      expect((r.data as unknown as Record<string, unknown>).id).toBeUndefined();
    }
  });

  it("rejects invalid format", () => {
    expect(validateCategoryInput(ok({ format: "triples" })).ok).toBe(false);
  });

  it("rejects invalid gender", () => {
    expect(validateCategoryInput(ok({ gender: "robot" })).ok).toBe(false);
  });

  it("rejects invalid age group", () => {
    expect(validateCategoryInput(ok({ ageGroup: "100+" })).ok).toBe(false);
  });

  it("rejects invalid scoring format", () => {
    expect(validateCategoryInput(ok({ scoringFormat: "5x99" })).ok).toBe(false);
  });

  it("rejects invalid winBy", () => {
    expect(validateCategoryInput(ok({ winBy: "5" })).ok).toBe(false);
  });

  it("accepts numeric winBy", () => {
    const r = validateCategoryInput(ok({ winBy: 2 }));
    expect(r.ok && r.data.winBy).toBe("2");
  });

  it("rejects invalid status", () => {
    expect(validateCategoryInput(ok({ status: "archived" })).ok).toBe(false);
  });

  it("parses skillMin/skillMax from numbers", () => {
    const r = validateCategoryInput(ok({ skillMin: 3.0, skillMax: 4.0 }));
    expect(r.ok && r.data.skillMin).toBe(3.0);
    expect(r.ok && r.data.skillMax).toBe(4.0);
  });

  it("parses skill values from strings", () => {
    const r = validateCategoryInput(ok({ skillMin: "3.5" }));
    expect(r.ok && r.data.skillMin).toBe(3.5);
  });

  it("rejects skill values out of range", () => {
    expect(validateCategoryInput(ok({ skillMin: 0 })).ok).toBe(false);
    expect(validateCategoryInput(ok({ skillMax: 99 })).ok).toBe(false);
  });

  it("rejects non-numeric skill", () => {
    expect(validateCategoryInput(ok({ skillMin: "abc" })).ok).toBe(false);
  });

  it("rejects skillMin > skillMax", () => {
    const r = validateCategoryInput(ok({ skillMin: 4.0, skillMax: 3.0 }));
    expect(r.ok).toBe(false);
  });

  it("rejects name longer than 100 chars", () => {
    expect(validateCategoryInput(ok({ name: "x".repeat(101) })).ok).toBe(false);
  });
});

describe("validateCategoryPatch (PATCH)", () => {
  it("returns only the fields that were provided", () => {
    const r = validateCategoryPatch({ status: "draft" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ status: "draft" });
  });

  it("does NOT apply defaults for missing fields", () => {
    const r = validateCategoryPatch({ name: "New Name" });
    if (r.ok) {
      expect(r.data.format).toBeUndefined();
      expect(r.data.gender).toBeUndefined();
    }
  });

  it("strips unknown fields", () => {
    const r = validateCategoryPatch({ name: "Foo", leagueId: "evil", sortOrder: 1 });
    if (r.ok) {
      expect((r.data as unknown as Record<string, unknown>).leagueId).toBeUndefined();
      expect((r.data as unknown as Record<string, unknown>).sortOrder).toBeUndefined();
    }
  });

  it("validates partial enums", () => {
    expect(validateCategoryPatch({ status: "bogus" }).ok).toBe(false);
    expect(validateCategoryPatch({ format: "x" }).ok).toBe(false);
  });

  it("allows empty patch object (caller decides)", () => {
    const r = validateCategoryPatch({});
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.data).length).toBe(0);
  });

  it("rejects empty trimmed name", () => {
    expect(validateCategoryPatch({ name: "   " }).ok).toBe(false);
  });

  it("rejects skillMin > skillMax even in patch", () => {
    expect(validateCategoryPatch({ skillMin: 4, skillMax: 3 }).ok).toBe(false);
  });

  it("allows clearing skillMin via null", () => {
    const r = validateCategoryPatch({ skillMin: null });
    expect(r.ok && r.data.skillMin).toBeNull();
  });
});
