import { describe, expect, test } from "vite-plus/test";
import type { WhereOpIR } from "@sync-engine/internal/reads/ir";
import type { ViewOpIR } from "@sync-engine/internal/reads/ir";
import { operationFootprint } from "@sync-engine/internal/reads/operation-footprint";
import type { AnyWhereOp } from "@sync-engine/internal/reads/where-ops";
import { scheduleBlock } from "@sync-engine/internal/reads/schedule";

const query = { concept: "Items", query: "_items" };

describe("where scheduling", () => {
  test("authored footprints retain duplicate symbol occurrences", () => {
    const input = Symbol("input");
    const output = Symbol("output");
    const denied = Symbol("denied");
    const op: AnyWhereOp = {
      op: "find",
      in: { first: input, second: input },
      out: { value: output },
      not: { state: denied },
    };

    const footprint = operationFootprint(op, "authored");
    const produced: symbol[] = footprint.produces;
    expect(footprint.requires).toEqual([input, input, denied]);
    expect(produced).toEqual([output]);
    expect(footprint.mentions).toEqual([input, input, output, denied]);
    expect(footprint.negative).toEqual([denied]);
  });

  test("IR footprints ignore authored-only excess properties", () => {
    const earlier = {
      op: "earlier",
      when: { kind: "action", concept: "C", action: "a", input: { x: { $var: "x" } }, output: {} },
      pattern: { input: { wrong: Symbol("wrong") }, output: {} },
    } as WhereOpIR;
    const holds = {
      op: "holds",
      computation: "ok",
      in: { expected: { $var: "expected" } },
      fused: { in: { wrong: Symbol("wrong") } },
    } as ViewOpIR;

    expect(operationFootprint(earlier, "ir").produces).toEqual(["x"]);
    expect(operationFootprint(holds, "ir").inputs).toEqual(["expected"]);
  });

  test("orders dependencies while preserving authored order among ready operations", () => {
    const firstReady: WhereOpIR = { op: "holds", computation: "ok", in: {} };
    const dependent: WhereOpIR = {
      op: "holds",
      computation: "ok",
      in: { value: { $var: "opened" } },
    };
    const secondReady: WhereOpIR = {
      op: "compute",
      computation: "make",
      in: {},
      out: "opened",
    };
    const scheduled = scheduleBlock(
      [firstReady, dependent, secondReady],
      new Set(),
      'Reaction "Stable"',
    );
    expect(scheduled.ordered).toEqual([firstReady, secondReady, dependent]);
    expect(scheduled.bound).toEqual(new Set(["opened"]));
  });

  test("reports an unopenable dependency deterministically", () => {
    const blocked: WhereOpIR = {
      op: "holds",
      computation: "ok",
      in: { value: { $var: "missing" } },
    };
    expect(() => scheduleBlock([blocked], new Set(), 'Reaction "Blocked"')).toThrow(
      'conditions cannot be ordered — holds ok needs "missing"',
    );
  });

  test("reports a compute op in the ordering error", () => {
    const computeOp: WhereOpIR = {
      op: "compute",
      computation: "add",
      in: { a: { $var: "x" } },
      out: "result",
    };
    expect(() => scheduleBlock([computeOp], new Set(), 'Reaction "Test"')).toThrow(
      'conditions cannot be ordered — compute add needs "x"',
    );
  });

  test("reports a count op in the ordering error", () => {
    const countOp: ViewOpIR = {
      op: "count",
      query: { concept: "Items", query: "_items" },
      in: { type: { $var: "x" } },
      out: "total",
    };
    expect(() => scheduleBlock([countOp], new Set(), 'Reaction "Test"')).toThrow(
      'conditions cannot be ordered — count Items._items needs "x"',
    );
  });

  test("reports a custom op in the ordering error", () => {
    const customOp: WhereOpIR = {
      op: "custom",
      fnRef: "myFn",
      opaque: true,
      in: ["x"],
      out: ["y"],
    };
    expect(() => scheduleBlock([customOp], new Set(), 'Reaction "Test"')).toThrow(
      'conditions cannot be ordered — custom myFn needs "x"',
    );
  });

  test("reports a new name inside not() as an ordering denial", () => {
    const findOp: WhereOpIR = {
      op: "find",
      query,
      in: {},
      out: { id: { $var: "id" } },
      not: { status: { $var: "freshStatus" } },
    };
    expect(() => scheduleBlock([findOp], new Set(), 'Reaction "Test"')).toThrow(
      '"freshStatus" is new inside find Items._items; no(...) can only test names bound by an earlier plain line.',
    );
  });

  test("reports a new name inside a no op as an ordering denial", () => {
    const noOp: WhereOpIR = {
      op: "no",
      query,
      in: {},
      out: { status: { $var: "fresh" } },
    };
    expect(() => scheduleBlock([noOp], new Set(), 'Reaction "Test"')).toThrow(
      '"fresh" is new inside no Items._items; no(...) can only test names bound by an earlier plain line.',
    );
  });
});
