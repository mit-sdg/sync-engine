import { describe, expect, test } from "vite-plus/test";
import {
  canonicalDigest,
  canonicalJson,
  canonicallyEqual,
} from "../../../src/engine/utils/canonical-json.ts";

describe("canonical JSON", () => {
  test("sorts record keys while preserving authored array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, list: ["b", "a"] })).toBe(
      '{\n  "list": [\n    "b",\n    "a"\n  ],\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "z": 1\n}\n',
    );
  });

  test("defines property-order-independent equality and stable digests", () => {
    const left = { definition: { first: 1, second: 2 } };
    const right = { definition: { second: 2, first: 1 } };
    expect(canonicallyEqual(left, right)).toBe(true);
    expect(canonicalDigest(left)).toBe(canonicalDigest(right));
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 1n, () => {}, new Date()])(
    "rejects non-JSON value %s",
    (value) => {
      expect(() => canonicalJson({ value })).toThrow(/non-(finite number|JSON|plain object)/);
    },
  );

  test("rejects cycles", () => {
    const value: Record<string, unknown> = {};
    value.self = value;
    expect(() => canonicalJson(value)).toThrow("contains a cycle");
  });
});
