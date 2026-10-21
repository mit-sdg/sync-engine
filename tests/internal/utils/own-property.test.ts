import { describe, expect, test } from "vite-plus/test";
import { setOwn } from "@engine/utils/own-property";

describe("setOwn", () => {
  test("keeps an own __proto__ key as data on plain and null-prototype targets", () => {
    const plain = setOwn({}, "__proto__", { admin: true });
    expect(Object.hasOwn(plain, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect((plain as { admin?: unknown }).admin).toBeUndefined();

    const bare = setOwn(Object.create(null) as object, "__proto__", 1);
    expect(Object.getPrototypeOf(bare)).toBe(null);
    expect(Object.getOwnPropertyDescriptor(bare, "__proto__")).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  test("never calls an inherited setter", () => {
    let calls = 0;
    Object.defineProperty(Object.prototype, "probeSetter", {
      set() {
        calls += 1;
      },
      configurable: true,
    });
    try {
      const target = setOwn({}, "probeSetter", 1);
      expect(calls).toBe(0);
      expect(Object.getOwnPropertyDescriptor(target, "probeSetter")?.value).toBe(1);
    } finally {
      delete (Object.prototype as { probeSetter?: unknown }).probeSetter;
    }
  });

  test("gives absent, inherited, and present keys the same descriptor and keeps key order", () => {
    const target = setOwn(setOwn(setOwn({}, "b", 1), "toString", 2), "a", 3);
    setOwn(target, "b", 4);
    expect(Object.keys(target)).toEqual(["b", "toString", "a"]);
    for (const key of ["a", "b", "toString"]) {
      expect(Object.getOwnPropertyDescriptor(target, key)).toMatchObject({
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    expect(target).toEqual({ b: 4, toString: 2, a: 3 });
  });
});
