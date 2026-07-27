import { describe, expect, test } from "vite-plus/test";
import {
  actionPattern,
  earlier,
  when as rawWhen,
} from "@sync-engine/internal/reactions/authoring/words.ts";
import { request, when } from "./historical-authoring.ts";
import { declarationsOf } from "@sync-engine/internal/reactions/authoring/partitions.ts";
import { actionLine } from "@sync-engine/internal/reactions/authoring/nodes.ts";
import { brand, CountOpBrand } from "@sync-engine/internal/reads/brands";
import type { InstrumentedAction } from "@sync-engine/internal/reactions/types.ts";

function action(name: string): InstrumentedAction {
  const fn = Object.defineProperty(async () => ({}), "name", { value: name }) as InstrumentedAction;
  fn.concept = {};
  return fn;
}

describe("reaction words", () => {
  test("when and request build one declarative sentence", () => {
    const opened = action("opened");
    const notify = action("notify");
    const declaration = declarationsOf(
      when(opened, { id: "a" }).then(request(notify, { id: "a" })),
    )[0];
    expect(declaration.when).toHaveLength(1);
    expect(declaration.then[0].action.action).toBe(notify);
  });

  test("earlier is a branded non-consuming flow read", () => {
    const opened = action("opened");
    expect(earlier(opened, { id: "a" })).toMatchObject({
      op: "earlier",
      pattern: { action: opened, input: { id: "a" }, output: {} },
    });
  });

  test("when rejects arguments that are not step nodes", () => {
    expect(() => rawWhen({} as any).then(action("x") as any)).toThrow(
      "when(...) takes one callable action line or posture channel.",
    );
  });

  test("where rejects count operators", () => {
    const a = action("a");
    const step = actionLine(a, {});
    const countOp = brand({ op: "count", query: a as any, in: {}, out: Symbol() }, CountOpBrand);
    expect(() => rawWhen(step).where(countOp as any)).toThrow(
      "count(...) cannot be used in a reaction condition.",
    );
  });

  test("where rejects zero arguments", () => {
    const a = action("a");
    const step = actionLine(a, {});
    expect(() => rawWhen(step).where()).toThrow("states at least one condition line.");
  });

  test("actionPattern throws for an uninstrumented action", () => {
    const fn = Object.defineProperty(() => {}, "name", { value: "myAction" }) as InstrumentedAction;
    expect(() => actionPattern(fn, {})).toThrow("Action myAction is not instrumented.");
  });

  test("functional where accepts a plain function and embeds it in the declaration", () => {
    const a = action("a");
    const b = action("b");
    const step = actionLine(a, {});
    const thenStep = actionLine(b, {});
    const fn = (frames: any) => frames;

    const declaration = declarationsOf(
      rawWhen(step)
        .where(fn)
        .then(thenStep as any),
    )[0];

    expect(declaration.where).toBe(fn);
    expect(declaration.then[0].action.action).toBe(b);
  });
});
