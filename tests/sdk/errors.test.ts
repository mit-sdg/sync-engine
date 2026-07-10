import { describe, expect, test } from "vite-plus/test";
import { domainError, frameworkError, FrameworkErrorCode, success } from "@sync-engine/sdk";
import type { InvocationResult } from "@sync-engine/sdk";

describe("success", () => {
  test("wraps value in ok result", () => {
    const result = success({ token: "abc" });
    expect(result).toEqual({ ok: true, value: { token: "abc" } });
  });

  test("handles null value", () => {
    const result = success(null);
    expect(result).toEqual({ ok: true, value: null });
  });

  test("handles primitive value", () => {
    const result = success(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });
});

describe("domainError", () => {
  test("wraps value in domain error result", () => {
    const result = domainError({ code: "INVALID", detail: "bad input" });
    expect(result).toEqual({
      ok: false,
      error: { kind: "domain", value: { code: "INVALID", detail: "bad input" } },
    });
  });

  test("handles string domain error", () => {
    const result = domainError("ERR");
    expect(result).toEqual({
      ok: false,
      error: { kind: "domain", value: "ERR" },
    });
  });
});

describe("frameworkError", () => {
  test("wraps code in framework error result", () => {
    const result = frameworkError(FrameworkErrorCode.TIMED_OUT);
    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FrameworkErrorCode.TIMED_OUT },
    });
  });

  test("includes detail when provided", () => {
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
  test("success result has ok: true", () => {
    const result: InvocationResult<string, never> = success("hello");
    if (result.ok) {
      expect(typeof result.value).toBe("string");
    } else {
      expect.unreachable("expected success");
    }
  });

  test("domain error has ok: false with kind: domain", () => {
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

  test("framework error has ok: false with kind: framework", () => {
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
