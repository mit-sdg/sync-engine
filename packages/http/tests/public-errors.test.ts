import { describe, expect, test } from "vite-plus/test";
import { FrameworkErrorCode } from "@sync-engine/boundary";
import type { HttpPublicErrorCategory } from "@mit-sdg/sync-engine-http/server";
import {
  publicErrorStatus,
  publicFrameworkCategoryOf,
  projectProductionHttpWire,
  registeredPublicCategoryOf,
} from "../src/server/public-errors.ts";

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
    expect(publicFrameworkCategoryOf(FrameworkErrorCode.INVALID_INPUT)).toBe("INVALID_REQUEST");
    expect(publicFrameworkCategoryOf(FrameworkErrorCode.NOT_FOUND)).toBe("NOT_FOUND");
    expect(publicFrameworkCategoryOf(FrameworkErrorCode.INTERNAL_ERROR)).toBe("INTERNAL_ERROR");
    expect(publicFrameworkCategoryOf(FrameworkErrorCode.TIMED_OUT)).toBe("INTERNAL_ERROR");
    expect(registeredPublicCategoryOf("SESSION_EXPIRED", categories)).toBe("UNAUTHORIZED");
    expect(registeredPublicCategoryOf("CONFLICT", categories)).toBe("INTERNAL_ERROR");
    expect(registeredPublicCategoryOf("PRIVATE", categories)).toBe("INTERNAL_ERROR");
  });

  test("ignores prototype and inherited runtime codes", () => {
    const inherited = Object.create({ INHERITED: "FORBIDDEN" }) as Record<
      string,
      HttpPublicErrorCategory
    >;
    for (const code of ["toString", "constructor", "__proto__", "INHERITED"]) {
      expect(registeredPublicCategoryOf(code, inherited)).toBe("INTERNAL_ERROR");
    }
  });

  test("fails closed for malformed categories even after invalid runtime casts", () => {
    const malformed = { BROKEN: "toString" } as unknown as Record<string, HttpPublicErrorCategory>;
    expect(registeredPublicCategoryOf("BROKEN", malformed)).toBe("INTERNAL_ERROR");
    expect(publicErrorStatus("toString" as never)).toBe(500);
  });

  test("keeps unmapped domain errors private in projected wire contracts", () => {
    const projected = projectProductionHttpWire(
      {
        endpoints: [{ errors: ["NOT_FOUND"], inputAdmissionError: false, openError: false }],
        appWide: [],
      } as never,
      { origin: "https://example.test", publicErrors: {} },
    );

    expect(projected.endpoints[0]?.errors).toEqual(["INTERNAL_ERROR"]);
  });

  test.each([
    [["INVALID_INPUT"], false, ["INTERNAL_ERROR"]],
    [["INVALID_INPUT"], true, ["INVALID_REQUEST"]],
    [["INVALID_INPUT", "INVALID_INPUT"], true, ["INTERNAL_ERROR", "INVALID_REQUEST"]],
  ] as const)(
    "distinguishes domain and admission INVALID_INPUT errors",
    (errors, admission, expected) => {
      const projected = projectProductionHttpWire(
        {
          endpoints: [{ errors, inputAdmissionError: admission, openError: false }],
          appWide: [],
        } as never,
        { origin: "https://example.test", publicErrors: {} },
      );

      expect(projected.endpoints[0]?.errors).toEqual(expected);
    },
  );
});
