import { describe, expect, test } from "vite-plus/test";
import type { WhereOpIR } from "@sync-engine/internal/reads/ir";
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
});
