/**
 * Normalize the arguments an authored `where` accepts into the two forms the
 * runtime understands: one frame closure, or a list of declarative condition
 * ops. Both `when(...)` and a chained stage state conditions the same way, so
 * the rejection messages stay identical wherever conditions are authored.
 */

import { conditionOp, isCondition } from "@engine/reads/where-ops";
import type { AnyWhereOp } from "@engine/reads/where-ops";
import { isCountOp } from "@engine/reads/views";
import type { WhereFn } from "../types.ts";

export interface NormalizedWhere {
  fn?: WhereFn;
  ops?: readonly AnyWhereOp[];
}

export function normalizeWhere(args: unknown[], site: string): NormalizedWhere {
  if (args.length === 1 && typeof args[0] === "function" && !isCondition(args[0])) {
    return { fn: args[0] as WhereFn };
  }
  if (args.some(isCountOp)) {
    throw new Error(
      `${site}(...): count(...) cannot be used in a reaction condition. ` +
        "To return a row count, use each(line).count() in a former. " +
        "To test a count as policy, define a view and read that view.",
    );
  }
  if (args.length === 0) {
    throw new Error(`${site}(...) states at least one condition line.`);
  }
  return { ops: args.map((arg) => conditionOp(arg as Parameters<typeof conditionOp>[0], site)) };
}
