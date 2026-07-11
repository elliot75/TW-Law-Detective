import { describe, expect, it } from "vitest";
import {
  ExplanationValidationError,
  hasOverturnedUpperCourt,
  TLRBundleSchema,
  validateExplanation,
} from "@/lib/contracts";
import { validBundle, validExplanation } from "./fixtures";

describe("TLR Bundle contract", () => {
  it("accepts a valid v1 bundle", () => {
    expect(TLRBundleSchema.parse(validBundle).allowed_citations).toEqual([
      "J1",
      "J2",
    ]);
  });

  it("rejects a citation that is both allowed and unread", () => {
    const invalid = {
      ...validBundle,
      unread_candidates: [{ citation_id: "J1", reason: "not read" }],
    };
    expect(() => TLRBundleSchema.parse(invalid)).toThrow(/同時出現/);
  });

  it("detects an overturned upper-court record", () => {
    expect(hasOverturnedUpperCourt(validBundle.judgments[1])).toBe(true);
    expect(hasOverturnedUpperCourt(validBundle.judgments[0])).toBe(false);
  });
});

describe("AI explanation validation", () => {
  it("accepts only allowed J citations", () => {
    expect(validateExplanation(validExplanation, validBundle)).toEqual(
      validExplanation,
    );
  });

  it("fails closed on an out-of-bundle citation", () => {
    const invalid = {
      ...validExplanation,
      legalIssues: [
        {
          ...validExplanation.legalIssues[0],
          citationIds: ["J9"],
        },
      ],
    };
    expect(() => validateExplanation(invalid, validBundle)).toThrow(
      ExplanationValidationError,
    );
  });

  it("rejects model-authored raw case numbers", () => {
    const invalid = {
      ...validExplanation,
      summary: "臺灣測試地方法院 112 年度訴字第 1 號支持這個結論。",
    };
    expect(() => validateExplanation(invalid, validBundle)).toThrow(/判決字號/);
  });
});
