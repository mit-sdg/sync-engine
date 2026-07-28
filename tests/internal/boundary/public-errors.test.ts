import { describe, expect, test } from "vite-plus/test";
import { FrameworkErrorCode } from "@sync-engine/boundary";
import {
  publicCategoryOf,
  publicErrorStatus,
} from "@sync-engine/internal/boundary/protocol/public-errors";

describe("HTTP public error projection", () => {
  test.each([
    ["INVALID_REQUEST", 400],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["INTERNAL_ERROR", 500],
  ] as const)("maps %s to status %s", (category, status) => {
    expect(publicErrorStatus(category)).toBe(status);
  });

  test("projects framework, registered domain, and unknown codes", () => {
    const categories = { SESSION_EXPIRED: "UNAUTHORIZED" } as const;
    expect(publicCategoryOf(FrameworkErrorCode.INVALID_INPUT, categories)).toBe("INVALID_REQUEST");
    expect(publicCategoryOf(FrameworkErrorCode.NOT_FOUND, categories)).toBe("NOT_FOUND");
    expect(publicCategoryOf(FrameworkErrorCode.INTERNAL_ERROR, {})).toBe("INTERNAL_ERROR");
    expect(publicCategoryOf(FrameworkErrorCode.TIMED_OUT, categories)).toBe("INTERNAL_ERROR");
    expect(publicCategoryOf("SESSION_EXPIRED", categories)).toBe("UNAUTHORIZED");
    expect(publicCategoryOf("PRIVATE", categories)).toBe("INTERNAL_ERROR");
  });
});
