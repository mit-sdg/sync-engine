import { describe, expect, test } from "vite-plus/test";
import { structurallyEqual as equal } from "@engine/reads/value-equality";

// eslint-disable-next-line no-sparse-arrays -- holes are the case under test.
const holey = (): unknown[] => [, 1];

describe("structurallyEqual", () => {
  test("compares a hole as undefined, on either side", () => {
    expect(equal(holey(), [5, 1])).toBe(false);
    expect(equal([5, 1], holey())).toBe(false);
    expect(equal(holey(), [undefined, 1])).toBe(true);
    expect(equal([undefined, 1], holey())).toBe(true);
    expect(equal({ x: holey() }, { x: [{ a: 1 }, 1] })).toBe(false);
  });

  test("compares arrays by length and index only", () => {
    expect(equal(Object.assign([1], { note: "x" }), [1])).toBe(true);
    expect(equal([1], [1, undefined])).toBe(false);
  });

  test("compares cyclic arrays and records by shape", () => {
    const a: unknown[] = [];
    a.push(a);
    const b: unknown[] = [];
    b.push([b]);
    expect(equal(a, b)).toBe(true);

    const c: unknown[] = [];
    c.push(c, 1);
    const d: unknown[] = [];
    d.push(d, 2);
    expect(equal(c, d)).toBe(false);

    const left: { items: unknown[] } = { items: [] };
    left.items.push(left);
    const right: { items: unknown[] } = { items: [] };
    right.items.push({ items: [right] });
    expect(equal(left, right)).toBe(true);
  });

  test("compares a pair of arrays met by many paths once", () => {
    let reads = 0;
    const tower = (depth: number): unknown => {
      let value: unknown = 0;
      for (let level = 0; level < depth; level += 1) {
        const child = value;
        const pair: unknown[] = [];
        for (const index of [0, 1]) {
          Object.defineProperty(pair, index, {
            get: () => {
              reads += 1;
              return child;
            },
            enumerable: true,
          });
        }
        value = pair;
      }
      return value;
    };
    expect(equal(tower(12), tower(12))).toBe(true);
    expect(reads).toBe(4 * 12);
  });
});
