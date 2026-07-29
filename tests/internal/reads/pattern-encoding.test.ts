import { describe, expect, test } from "vite-plus/test";
import type { FormerNode } from "@sync-engine/internal/reads/former-nodes";
import { lowerFormerBody } from "@sync-engine/internal/reads/former-lowering";
import { encodePattern, PatternVariables } from "@sync-engine/internal/reads/pattern-encoding";

describe("prototype-named design keys", () => {
  test("pattern encoding preserves own keys recursively without prototype mutation", () => {
    const source = JSON.parse(
      '{"__proto__":{"constructor":1,"prototype":2},"constructor":3,"prototype":4}',
    );
    const encoded = encodePattern(source, new PatternVariables()) as Record<string, unknown>;
    const nested = encoded.__proto__ as Record<string, unknown>;

    expect(encoded).toEqual(source);
    expect(Object.getPrototypeOf(encoded)).toBe(Object.prototype);
    expect(Object.hasOwn(encoded, "__proto__")).toBe(true);
    expect(Object.hasOwn(nested, "constructor")).toBe(true);
    expect(Object.hasOwn(nested, "prototype")).toBe(true);
  });

  test("former lowering preserves prototype-named record entries recursively", () => {
    const value = Symbol("value");
    const leaf = { node: "leaf", var: value } as const;
    const nested: FormerNode = {
      node: "record",
      where: [],
      entries: [
        ["__proto__", leaf],
        ["constructor", leaf],
        ["prototype", leaf],
      ],
      splices: [],
    };
    const body: FormerNode = {
      node: "record",
      where: [],
      entries: [
        ["__proto__", nested],
        ["constructor", leaf],
        ["prototype", leaf],
      ],
      splices: [],
    };
    const lowered = lowerFormerBody([value], body);
    if (lowered.node !== "record") throw new Error("expected a record");
    const loweredNested = lowered.entries.__proto__;
    if (loweredNested.node !== "record") throw new Error("expected a nested record");

    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(Object.hasOwn(lowered.entries, key)).toBe(true);
      expect(Object.hasOwn(loweredNested.entries, key)).toBe(true);
    }
    expect(Object.getPrototypeOf(lowered.entries)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(loweredNested.entries)).toBe(Object.prototype);
  });
});
