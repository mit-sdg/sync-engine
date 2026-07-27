import { describe, expect, test } from "vite-plus/test";
import type { WhereOpIR } from "@sync-engine/internal/reads/ir";
import type { ViewOpIR } from "@sync-engine/internal/reads/ir";
import {
  opNamesIR,
  opNeedsIR,
  opOpensIR,
  scheduleBlock,
} from "@sync-engine/internal/reads/schedule";

const query = { concept: "Items", query: "_items" };

describe("where scheduling", () => {
  test("classifies the bindings read, opened, and mentioned by each op", () => {
    const find: WhereOpIR = {
      op: "find",
      query,
      in: { owner: { $var: "owner" } },
      out: { item: { $var: "item" } },
      not: { state: { $var: "blocked" } },
    };
    expect(opNeedsIR(find)).toEqual(["owner", "blocked"]);
    expect(opOpensIR(find, new Set(["owner", "blocked"]))).toEqual(["item"]);
    expect(opNamesIR(find)).toEqual(["owner", "item", "blocked"]);

    const earlier: WhereOpIR = {
      op: "earlier",
      when: {
        kind: "action",
        concept: "Items",
        action: "add",
        input: { item: { $var: "prior" } },
        output: {},
      },
    };
    expect(opNeedsIR(earlier)).toEqual([]);
    expect(opOpensIR(earlier, new Set())).toEqual(["prior"]);
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
      'conditions cannot be ordered — ok needs "missing", which no line opens',
    );
  });

  test("opNamesIR lists all names from a no op's in and out patterns", () => {
    const noOp: WhereOpIR = {
      op: "no",
      query,
      in: { type: { $var: "t" } },
      out: { status: { $var: "s" } },
    };
    expect(opNamesIR(noOp)).toEqual(["t", "s"]);
  });

  test("opNamesIR lists all names from an earlier op's when patterns", () => {
    const earlierOp: WhereOpIR = {
      op: "earlier",
      when: {
        kind: "action",
        concept: "Items",
        action: "add",
        input: { item: { $var: "prior" } },
        output: { id: { $var: "priorId" } },
      },
    };
    expect(opNamesIR(earlierOp)).toEqual(["prior", "priorId"]);
  });

  test("reports a compute op in the ordering error", () => {
    const computeOp: WhereOpIR = {
      op: "compute",
      computation: "add",
      in: { a: { $var: "x" } },
      out: "result",
    };
    expect(() => scheduleBlock([computeOp], new Set(), 'Reaction "Test"')).toThrow(
      'conditions cannot be ordered — compute add needs "x", which no line opens',
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
      'conditions cannot be ordered — count Items._items needs "x", which no line opens',
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
      'conditions cannot be ordered — custom myFn needs "x", which no line opens',
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
      '"freshStatus" is new inside Items._items; no(...) can only test names bound by an earlier plain line.',
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
