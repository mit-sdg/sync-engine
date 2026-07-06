import { describe, expect, test } from "bun:test";
import { declareVars, Frames, Where } from "@sync-engine/engine";

const { pipe, read } = Where;

describe("declareVars", () => {
  test("memoizes one stable symbol per name", () => {
    const v = declareVars<{ user: string; post: string }>();
    expect(v.user).toBe(v.user);
    expect(v.user).not.toBe(v.post);
  });

  test("the symbol's description is the variable name", () => {
    const { amount } = declareVars<{ amount: number }>();
    expect(amount.description).toBe("amount");
  });
});

describe("Where.read", () => {
  test("returns the binding typed as the variable's T", () => {
    const { user, count } = declareVars<{ user: string; count: number }>();
    const frame = { [user]: "xavier", [count]: 11 };
    const name: string = read(frame, user);
    const n: number = read(frame, count);
    expect(name).toBe("xavier");
    expect(n).toBe(11);
  });
});

describe("Where.pipe", () => {
  test("applies gates left-to-right, awaiting between stages", async () => {
    const { n } = declareVars<{ n: number }>();
    const frames = new Frames({ [n]: 1 }, { [n]: 2 }, { [n]: 3 });

    const keepEven = (fs: Frames) => fs.filter(($) => read($, n) % 2 === 0);
    const doubleAsync = async (fs: Frames) =>
      fs.map(($) => ({ ...$, [n]: read($, n) * 2 }));

    const result = await pipe(keepEven, doubleAsync)(frames);
    expect([...result].map(($) => read($, n))).toEqual([4]);
  });

  test("with no gates is the identity transform", async () => {
    const { n } = declareVars<{ n: number }>();
    const frames = new Frames({ [n]: 1 });
    const result = await pipe()(frames);
    expect(result).toBe(frames);
  });
});

describe("Frames.tap", () => {
  test("runs a side effect per frame and passes frames through unchanged", () => {
    const { n } = declareVars<{ n: number }>();
    const frames = new Frames({ [n]: 1 }, { [n]: 2 });
    const seen: number[] = [];
    const result = frames.tap(($) => seen.push(read($, n)));
    expect(seen).toEqual([1, 2]);
    expect(result).toBe(frames);
  });
});
