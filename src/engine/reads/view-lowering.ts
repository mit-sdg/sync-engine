/** Lower authored view blocks and serialize registered relation views. */

import type { ViewIR, ViewOpIR, WhereOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { encodePattern, encodeWhereOp, PatternVariables, queryRefOf } from "./pattern-encoding.ts";
import type { ViewOp } from "./views.ts";

function encodeViewOp(op: ViewOp, vars: PatternVariables): ViewOpIR {
  if (op.op === "count") {
    return {
      op: "count",
      query: queryRefOf(op.query),
      in: encodePattern(op.in, vars),
      out: vars.nameOf(op.out),
    };
  }
  return encodeWhereOp(op, vars) as ViewOpIR;
}

export function lowerViewAlternatives(
  slotVars: readonly symbol[],
  alternatives: readonly (readonly ViewOp[])[],
): ViewOpIR[][] {
  const vars = new PatternVariables();
  for (const slotVar of slotVars) vars.nameOf(slotVar);
  return alternatives.map((block) => block.map((op) => encodeViewOp(op, vars)));
}

export function lowerRelationBlocks(
  named: ReadonlyMap<symbol, string>,
  alternatives: readonly (readonly ViewOp[])[],
): ViewOpIR[][] {
  const vars = new PatternVariables();
  for (const [variable, name] of named) vars.nameAs(variable, name);
  return alternatives.map((block) => block.map((op) => encodeViewOp(op, vars)));
}

/** Serialize one view: the registered alternatives already are IR. */
export function serializeView(ref: RelationView): ViewIR {
  return {
    name: ref.viewName,
    alternatives: ref.alternatives as ViewOpIR[][],
    ins: [...ref.ins],
    outs: [...ref.outs],
    bindings: [...ref.bindings],
    ...(ref.promise !== undefined ? { promise: ref.promise } : {}),
    ...(ref.holdsPredicate ? { holds: true as const } : {}),
  };
}

/** Whether a registered read operation names a view. */
export function viewLineIR(
  op: WhereOpIR | ViewOpIR,
): op is Extract<ViewOpIR, { op: "find" | "whether" | "no" }> & { view: string } {
  return (
    (op.op === "find" || op.op === "whether" || op.op === "no") &&
    "view" in op &&
    typeof op.view === "string"
  );
}
