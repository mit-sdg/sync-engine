import { describe, expect, test } from "vite-plus/test";
import {
  canonicalDigest,
  canonicalJson,
  canonicalValue,
  canonicallyEqual,
} from "@engine/utils/canonical-json";

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

  test("round-trips prototype-named keys as own canonical data", () => {
    const source = JSON.parse(
      '{"prototype":3,"constructor":2,"__proto__":{"nested":{"__proto__":1,"constructor":2,"prototype":3}}}',
    ) as Record<string, unknown>;
    const canonical = canonicalValue(source) as Record<string, unknown>;
    const nested = (canonical.__proto__ as Record<string, unknown>).nested as Record<
      string,
      unknown
    >;

    for (const key of ["__proto__", "constructor", "prototype"]) {
      expect(Object.hasOwn(canonical, key)).toBe(true);
      expect(Object.hasOwn(nested, key)).toBe(true);
    }
    expect(Object.getPrototypeOf(canonical)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);

    const rendered = canonicalJson(source);
    const roundTripped = JSON.parse(rendered) as Record<string, unknown>;
    expect(roundTripped).toEqual(source);
    expect(Object.hasOwn(roundTripped, "__proto__")).toBe(true);
    expect(canonicalDigest(source)).toBe(canonicalDigest(roundTripped));
    const withoutProto = JSON.parse(rendered) as Record<string, unknown>;
    delete withoutProto.__proto__;
    expect(canonicalDigest(source)).not.toBe(canonicalDigest(withoutProto));
  });
});
