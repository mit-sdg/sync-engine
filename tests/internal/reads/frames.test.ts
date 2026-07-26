import { describe, expect, test } from "vite-plus/test";
import {
  Frames,
  bindInputMapping,
  distinctFrames,
  expandOutputRows,
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

  test("expands only rows that contain and unify every output slot", () => {
    const value = Symbol("value");
    const result = new Frames();
    expandOutputRows(
      result,
      { [value]: { nested: 1 } },
      [{ value: { nested: 1 }, kind: "ok" }, { value: { nested: 2 }, kind: "bad" }, null],
      { value, kind: "ok" },
    );
    expect(result).toEqual(new Frames({ [value]: { nested: 1 } }));
  });

  test("array-returning operations remain Frames and distinct keeps first occurrence", () => {
    const frames = new Frames({ n: 2 }, { n: 1 }, { n: 1 });
    expect(frames.filter(({ n }) => n > 0)).toBeInstanceOf(Frames);
    expect(frames.slice(1)).toBeInstanceOf(Frames);
    expect(frames.concat({ n: 3 })).toBeInstanceOf(Frames);
    expect(distinctFrames(frames)).toEqual(new Frames({ n: 2 }, { n: 1 }));
  });
});
