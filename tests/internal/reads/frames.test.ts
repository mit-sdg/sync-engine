import { describe, expect, test } from "vite-plus/test";
import {
  Frames,
  bindInputMapping,
  outputRow,
  readPatternValue,
  varKeyOf,
} from "@sync-engine/internal/reads/frames";

describe("Frames primitives", () => {
  test("reads authored and serialized variables and literal escapes", () => {
    const authored = Symbol("authored");
    const frame = { [authored]: 1, named: 2 };
    expect(varKeyOf(authored)).toBe(authored);
    expect(varKeyOf({ $var: "named" })).toBe("named");
    expect(readPatternValue({ $lit: { $var: "literal" } }, frame)).toEqual({
      isVariable: false,
      value: { $var: "literal" },
    });
    expect(bindInputMapping(frame, { a: authored, b: { $var: "missing" }, c: 3 })).toEqual({
      a: 1,
      c: 3,
    });
  });

  test("treats only own frame properties as bindings", () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(readPatternValue({ $var: name }, {})).toEqual({
        isVariable: true,
        bound: false,
        value: undefined,
      });
    }
  });

  test("makes a frame only of rows that contain and unify every output slot", () => {
    const value = Symbol("value");
    const output = Object.entries({ value, kind: "ok" });
    const frame = { [value]: { nested: 1 } };
    expect(outputRow(frame, { value: { nested: 1 }, kind: "ok" }, output)).toEqual(frame);
    expect(outputRow(frame, { value: { nested: 2 }, kind: "bad" }, output)).toBeUndefined();
    expect(outputRow(frame, null, output)).toBeUndefined();
    expect(outputRow(frame, null, [])).toEqual(frame);
  });

  test("unifies a variable repeated within one output pattern", () => {
    const value = Symbol("value");
    const output = Object.entries({ left: value, right: { inner: [value] } });
    const first = { tag: "a" };

    const matched = outputRow({}, { left: first, right: { inner: [{ tag: "a" }] } }, output);
    expect(matched?.[value]).toBe(first);
    expect(outputRow({}, { left: first, right: { inner: [{ tag: "b" }] } }, output)).toBe(
      undefined,
    );
    expect(outputRow({}, { left: 1, right: { inner: [2] } }, output)).toBeUndefined();
  });

  test("tests a name bound to undefined like any other binding", () => {
    const value = Symbol("value");
    const output = Object.entries({ left: value, right: value });
    const matched = outputRow({}, { left: undefined, right: undefined }, output);
    expect(matched).toBeDefined();
    expect(Object.hasOwn(matched!, value)).toBe(true);
    expect(outputRow({}, { left: undefined, right: null }, output)).toBeUndefined();
    expect(outputRow({ [value]: undefined }, { left: null, right: null }, output)).toBeUndefined();
  });

  test("extends the frame without changing it, keeping key order and row values", () => {
    const kept = Symbol("kept");
    const frame = { [kept]: 1, first: "frame" };
    const box = { tag: "box" };
    const output = Object.entries({
      a: { $var: "1" },
      b: { $var: "__proto__" },
      c: { $var: "constructor" },
    });

    const matched = outputRow(frame, { a: box, b: "proto", c: "made" }, output);
    expect(Object.keys(matched!)).toEqual(["1", "first", "__proto__", "constructor"]);
    expect(matched?.["1"]).toBe(box);
    expect(Object.getPrototypeOf(matched)).toBe(Object.prototype);
    expect(matched?.[kept]).toBe(1);
    expect(outputRow(frame, { a: box, b: "proto" }, output)).toBeUndefined();
    expect(frame).toEqual({ [kept]: 1, first: "frame" });
  });

  test("requires own row fields and safely binds Object.prototype names", () => {
    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(outputRow({}, {}, Object.entries({ [name]: Symbol(name) }))).toBeUndefined();

      const bound = outputRow({}, { value: name }, Object.entries({ value: { $var: name } }));
      expect(bound).toBeDefined();
      expect(Object.hasOwn(bound!, name)).toBe(true);
      expect(bound![name]).toBe(name);
    }
  });

  test("array-returning operations remain Frames", () => {
    const frames = new Frames({ n: 2 }, { n: 1 }, { n: 1 });
    expect(frames.filter(({ n }) => n > 0)).toBeInstanceOf(Frames);
    expect(frames.slice(1)).toBeInstanceOf(Frames);
    expect(frames.concat({ n: 3 })).toBeInstanceOf(Frames);
  });
});
