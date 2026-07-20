import { describe, expect, test } from "vite-plus/test";
import {
  domainError,
  frameworkError,
  FrameworkErrorCode,
  success,
} from "@sync-engine/internal/boundary";
import type { InvocationResult } from "@sync-engine/internal/boundary";

describe("success", () => {
  test("success returns the value in the ok branch", () => {
    const result = success({ token: "abc" });
    expect(result).toEqual({ ok: true, value: { token: "abc" } });
  });

  test("success preserves null", () => {
    const result = success(null);
    expect(result).toEqual({ ok: true, value: null });
  });

  test("success preserves a primitive", () => {
    const result = success(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe("domainError", () => {
  test("domainError returns the value in the domain branch", () => {
    const result = domainError({ code: "INVALID", detail: "bad input" });
    expect(result).toEqual({
      ok: false,
      error: { kind: "domain", value: { code: "INVALID", detail: "bad input" } },
    });
  });

  test("domainError preserves a string value", () => {
    const result = domainError("ERR");
    expect(result).toEqual({
      ok: false,
      error: { kind: "domain", value: "ERR" },
    });
  });
});

describe("frameworkError", () => {
  test("frameworkError returns the code in the framework branch", () => {
    const result = frameworkError(FrameworkErrorCode.TIMED_OUT);
    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });
  });

  test("frameworkError includes supplied detail", () => {
    const result = frameworkError(FrameworkErrorCode.NOT_FOUND, "Endpoint /x not found");
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: FrameworkErrorCode.NOT_FOUND,
        detail: "Endpoint /x not found",
      },
    });
  });
});

describe("InvocationResult type guarding", () => {
  test("ok narrows an InvocationResult to its success value", () => {
    const result: InvocationResult<string, never> = success("hello");
    if (result.ok) {
      expect(typeof result.value).toBe("string");
    } else {
      expect.unreachable("expected success");
    }
  });

  test("a domain kind narrows an InvocationResult to its domain value", () => {
    const result: InvocationResult<never, string> = domainError("broken");
    if (result.ok) {
      expect.unreachable("expected error");
    } else {
      expect(result.error.kind).toBe("domain");
      if (result.error.kind === "domain") {
        expect(result.error.value).toBe("broken");
      }
    }
  });

  test("a framework kind narrows an InvocationResult to its framework code", () => {
    const result: InvocationResult<never, never> = frameworkError(FrameworkErrorCode.TIMED_OUT);
    if (result.ok) {
      expect.unreachable("expected error");
    } else {
      expect(result.error.kind).toBe("framework");
      if (result.error.kind === "framework") {
        expect(result.error.code).toBe(FrameworkErrorCode.TIMED_OUT);
      }
    }
  });
});
