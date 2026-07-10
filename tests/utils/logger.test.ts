import { describe, expect, test, vi } from "vite-plus/test";
import { serializeError } from "@sync-engine/utils";

describe("serializeError", () => {
  test("serializes Error with message, name, and stack", () => {
    const err = new Error("something broke");
    const result = serializeError(err);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("something broke");
    expect(typeof result.stack).toBe("string");
    expect(result.stack).toContain("something broke");
  });

  test("serializes non-Error as { message: String(err) }", () => {
    const result = serializeError("plain string error");
    expect(result).toEqual({ message: "plain string error" });
  });

  test("serializes Error with cause chain", () => {
    const cause = new Error("root cause");
    const err = new Error("wrapper", { cause });
    const result = serializeError(err);
    expect(result.message).toBe("wrapper");
    expect(typeof result.cause).toBe("object");
    expect((result.cause as Record<string, unknown>).message).toBe("root cause");
    expect(typeof (result.cause as Record<string, unknown>).stack).toBe("string");
  });

  test("serializes nested cause chain", () => {
    const deepest = new Error("deepest");
    const middle = new Error("middle", { cause: deepest });
    const top = new Error("top", { cause: middle });
    const result = serializeError(top);
    expect(result.message).toBe("top");
    const middleResult = result.cause as Record<string, unknown>;
    expect(middleResult.message).toBe("middle");
    const deepestResult = middleResult.cause as Record<string, unknown>;
    expect(deepestResult.message).toBe("deepest");
    expect(typeof deepestResult.stack).toBe("string");
  });

  test("serializes TypeError with name preserved", () => {
    const err = new TypeError("type mismatch");
    const result = serializeError(err);
    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("type mismatch");
  });

  test("serializes null as { message: 'null' }", () => {
    const result = serializeError(null);
    expect(result).toEqual({ message: "null" });
  });

  test("serializes undefined as { message: 'undefined' }", () => {
    const result = serializeError(undefined);
    expect(result).toEqual({ message: "undefined" });
  });
});

describe("logger", () => {
  test("withRequestId creates a child logger with distinct requestId", async () => {
    const original = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "info";
      vi.resetModules();
      const mod = await import("@sync-engine/utils");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const child = mod.logger.withRequestId("req-123");

      expect(child.requestId).toBe("req-123");
      expect(mod.logger.requestId).toBeUndefined();

      child.info("child message");

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain("req-123");

      logSpy.mockRestore();
    } finally {
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });

  test("LOG_LEVEL=debug allows debug messages", async () => {
    const original = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "debug";
      vi.resetModules();
      const mod = await import("@sync-engine/utils");

      const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
      mod.logger.debug("debug msg");
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("debug msg"));
      spy.mockRestore();
    } finally {
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });

  test("LOG_LEVEL=error suppresses info and warn", async () => {
    const original = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "error";
      vi.resetModules();
      const mod = await import("@sync-engine/utils");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      mod.logger.info("should not appear");
      mod.logger.warn("should not appear");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      warnSpy.mockRestore();
    } finally {
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });

  test("redacts sensitive metadata in log output", async () => {
    const original = process.env.LOG_LEVEL;
    try {
      process.env.LOG_LEVEL = "info";
      vi.resetModules();
      const mod = await import("@sync-engine/utils");

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      mod.logger.info("msg", { password: "secret" });

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).not.toContain("secret");
      expect(output).toContain("[redacted]");

      logSpy.mockRestore();
    } finally {
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });
});
