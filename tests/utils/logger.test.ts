import { describe, expect, test } from "vite-plus/test";
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
