/**
 * The former binding analysis: every leaf and every `value` must be
 * traceable to a binding — an input, an enclosing selection's output, or a
 * where line's output. A name bound by nothing is a definition error, caught
 * here rather than at evaluation. Runs over lowered IR, so a definition and
 * a registration from data answer with one algorithm; resolver-backed
 * promise lints run only when a hook supplies them.
 */

import type { FormerNodeIR, PatternIR, ViewOpIR } from "./ir.ts";
import { varNamesInPattern } from "./operation-footprint.ts";
import type { QueryPromise } from "./query-metadata.ts";
import { scheduleBlock } from "./schedule.ts";

interface FormerBindingHooks {
  /** Resolve a source line's promise for the fold lints; omit to skip them. */
  promiseOf?(
    line: Extract<ViewOpIR, { op: "find" | "whether" | "no" }>,
    site: string,
  ): QueryPromise;
}

export function assertFormerBindings(
  node: FormerNodeIR,
  inherited: ReadonlySet<string>,
  site: string,
  hooks: FormerBindingHooks = {},
): void {
  const requireBound = (pattern: PatternIR, phrase: string, scope: ReadonlySet<string>): void => {
    for (const name of varNamesInPattern(pattern)) {
      if (!scope.has(name)) {
        throw new Error(`Former "${site}": ${phrase} uses "${name}" before it is bound.`);
      }
    }
  };
  if (node.node === "leaf") {
    if (!inherited.has(node.var)) {
      throw new Error(`Former "${site}": leaf "${node.var}" is bound by nothing.`);
    }
    return;
  }
  if (node.node === "literal") return;
  if (node.node === "record") {
    const scheduled = scheduleBlock(node.where ?? [], inherited, `Former "${site}"`);
    if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
    for (const op of scheduled.ordered) {
      if (op.op !== "find" && op.op !== "whether") continue;
      const opens = scheduled.opens.get(op) ?? [];
      if (opens.length > 0 && hooks.promiseOf?.(op, `Former "${site}"`) === "many") {
        throw new Error(
          `Former "${site}": this record's where may match many rows; ` +
            "wrap the source in each(...) when the result should contain rows.",
        );
      }
    }
    for (const child of Object.values(node.entries)) {
      assertFormerBindings(child, scheduled.bound, site, hooks);
    }
    for (const splice of node.splices ?? []) {
      requireBound(splice.in, `splice "${splice.fragment}" anchor`, scheduled.bound);
    }
    return;
  }
  if (node.node === "former") {
    requireBound(node.in, `former "${node.former}" anchor`, inherited);
    return;
  }
  if (node.from.op !== "find") {
    throw new Error(
      `Former "${site}": each(...) starts production from one plain query or view line.`,
    );
  }
  requireBound(node.from.in, `${node.node}(...) input`, inherited);
  requireBound(node.from.not ?? {}, `${node.node}(...).is.not(...) test`, inherited);
  const scope = new Set(inherited);
  for (const name of varNamesInPattern(node.from.out)) scope.add(name);
  const scheduled = scheduleBlock(node.where ?? [], scope, `Former "${site}"`);
  if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
  const afterWhere = scheduled.bound;
  if (node.node === "each") assertFormerBindings(node.as, afterWhere, site, hooks);
  if (
    (node.node === "count" || node.node === "first" || node.node === "distinct") &&
    hooks.promiseOf !== undefined &&
    hooks.promiseOf(node.from, `Former "${site}"`) !== "many"
  ) {
    throw new Error(
      `Former "${site}": the source already promises at most one row; ` +
        "use a plain line or whether(...), not a fold.",
    );
  }
  if ((node.node === "first" || node.node === "distinct") && !afterWhere.has(node.value)) {
    throw new Error(
      `Former "${site}": ${node.node}(...) value "${node.value}" is bound by nothing.`,
    );
  }
  if (
    (node.node === "each" || node.node === "first") &&
    node.arranged !== undefined &&
    "by" in node.arranged &&
    !afterWhere.has(node.arranged.by)
  ) {
    throw new Error(
      `Former "${site}": arranged(...) value "${node.arranged.by}" is bound by nothing.`,
    );
  }
}
