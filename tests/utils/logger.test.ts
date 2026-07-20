import { describe, expect, test, vi } from "vite-plus/test";
import { serializeError } from "@sync-engine/utils";

describe("serializeError", () => {
  test("keeps only an Error's stable class", () => {
    const err = new Error("mongodb://admin:password@example.test/private?token=setup-secret");
    Object.assign(err, {
      path: "/Users/private/application.ts",
      nested: { query: "?credential=sentinel" },
    });
    const result = serializeError(err);
    expect(result).toEqual({ name: "Error" });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("/Users/private");
    expect(JSON.stringify(result)).not.toContain("sentinel");
  });

  test("classifies a non-Error throw without stringifying it", () => {
    const result = serializeError("plain string error");
    expect(result).toEqual({ name: "NonErrorThrown" });
  });

  test("omits an Error cause chain", () => {
    const deepest = new Error("setup-secret-in-cause");
    const middle = new Error("mongodb://user:pass@example.test/db", { cause: deepest });
    const top = new Error("wrapper", { cause: middle });
    const result = serializeError(top);
    expect(result).toEqual({ name: "Error" });
    expect(JSON.stringify(result)).not.toContain("setup-secret");
    expect(JSON.stringify(result)).not.toContain("user:pass");
  });

  test("serializes TypeError with name preserved", () => {
    const err = new TypeError("type mismatch");
    const result = serializeError(err);
    expect(result).toEqual({ name: "TypeError" });
  });

  test("uses the constructor class instead of a mutable Error name", () => {
    class DriverFailure extends Error {}
    const err = new DriverFailure("driver failed");
    err.name = "mongodb://name-user:name-password@example.test/private";
    expect(serializeError(err)).toEqual({ name: "DriverFailure" });
  });

  test("classifies null without stringifying it", () => {
    const result = serializeError(null);
    expect(result).toEqual({ name: "NonErrorThrown" });
  });

  test("classifies undefined without stringifying it", () => {
    const result = serializeError(undefined);
    expect(result).toEqual({ name: "NonErrorThrown" });
  });
});

describe("fault logging", () => {
  test("a reacting fault log keeps context but omits exception detail", async () => {
    const original = process.env.LOG_LEVEL;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.LOG_LEVEL = "error";
      vi.resetModules();
      const { Reacting, request, when } = await import("@sync-engine/internal/reactions");

      class Starting {
        run(_: Record<PropertyKey, never>) {
          return {};
        }
      }
      class Failing {
        run(_: Record<PropertyKey, never>) {
          const cause = new Error("setup-secret-in-cause");
          const error = new TypeError(
            "mongodb://logger-user:logger-password@example.test/private?token=driver-token",
            { cause },
          );
          Object.assign(error, {
            path: "/Users/private/application.ts",
            nested: { credential: "nested-secret" },
          });
          throw error;
        }
      }

      const engine = new Reacting();
      const { Starting: Start, Failing: Fail } = engine.instrument({
        Starting: new Starting(),
        Failing: new Failing(),
      });
      engine.register({
        FailAfterStart: () => when(Start.run, {}).then(request(Fail.run, {})),
      });

      await Start.run({});

      const outputs = errorSpy.mock.calls.map(([output]) => String(output));
      const entry = outputs
        .map((output) => JSON.parse(output))
        .find(
          (candidate: Record<string, unknown>) =>
            candidate.message === "Consequence action faulted",
        ) as Record<string, unknown> | undefined;
      expect(entry).toMatchObject({
        action: "run",
        error: { name: "TypeError" },
        level: "error",
      });
      expect(Object.keys(entry?.error as Record<string, unknown>)).toEqual(["name"]);
      expect(outputs.join("\n")).not.toContain("logger-user");
      expect(outputs.join("\n")).not.toContain("logger-password");
      expect(outputs.join("\n")).not.toContain("driver-token");
      expect(outputs.join("\n")).not.toContain("/Users/private");
      expect(outputs.join("\n")).not.toContain("nested-secret");
      expect(outputs.join("\n")).not.toContain("setup-secret");
      expect(engine.Action._getMatchingRecordCount()).toBe(0);
    } finally {
      errorSpy.mockRestore();
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });

  test("an instrumenting fault log keeps correlation but omits exception detail", async () => {
    const original = process.env.LOG_LEVEL;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      process.env.LOG_LEVEL = "error";
      vi.resetModules();
      const { Reacting } = await import("@sync-engine/internal/reactions");

      class Failing {
        run(_: Record<PropertyKey, never>) {
          throw new Error("mongodb://source-user:source-password@example.test/source");
        }
      }

      const engine = new Reacting();
      vi.spyOn(engine, "react").mockRejectedValue(
        new Error(
          "mongodb://secondary-user:secondary-password@example.test/private?token=setup-secret",
        ),
      );
      const { Failing: Fail } = engine.instrument({ Failing: new Failing() });

      await expect(Fail.run({})).rejects.toThrow("source-password");

      const outputs = errorSpy.mock.calls.map(([output]) => String(output));
      const entry = outputs
        .map((output) => JSON.parse(output))
        .find(
          (candidate: Record<string, unknown>) =>
            candidate.message === "Reaction body failed after the action fault was recorded",
        ) as Record<string, unknown> | undefined;
      expect(entry).toMatchObject({
        action: "bound run",
        concept: "Failing",
        error: { name: "Error" },
        level: "error",
      });
      expect(entry?.actionId).toEqual(expect.any(String));
      expect(Object.keys(entry?.error as Record<string, unknown>)).toEqual(["name"]);
      expect(outputs.join("\n")).not.toContain("source-user");
      expect(outputs.join("\n")).not.toContain("source-password");
      expect(outputs.join("\n")).not.toContain("secondary-user");
      expect(outputs.join("\n")).not.toContain("secondary-password");
      expect(outputs.join("\n")).not.toContain("setup-secret");
      expect(engine.Action._getMatchingRecordCount()).toBe(0);
    } finally {
      errorSpy.mockRestore();
      process.env.LOG_LEVEL = original;
      vi.resetModules();
    }
  });
});

describe("logger", () => {
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
