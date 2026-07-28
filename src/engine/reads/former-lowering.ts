/** Lower authored former trees and serialize registered formers. */

import type { Arranged, FormerNode, FormerRef } from "./former-nodes.ts";
import { withLive } from "./ir.ts";
import type { ArrangedIR, FormerIR, FormerNodeIR, FormerSourceIR, FormerWhereOpIR } from "./ir.ts";
import { encodePattern, encodeWhereOp, PatternVariables } from "./pattern-encoding.ts";
import type { WhereOp } from "./where-ops.ts";

function encodeArranged(ordering: Arranged, vars: PatternVariables): ArrangedIR {
  if ("by" in ordering) return { by: vars.nameOf(ordering.by), order: ordering.order };
  return { order: ordering.order };
}

function encodeFormerWhere(
  where: readonly WhereOp[],
  vars: PatternVariables,
): { where?: FormerWhereOpIR[] } {
  if (where.length === 0) return {};
  return { where: where.map((op) => encodeWhereOp(op, vars) as FormerWhereOpIR) };
}

function encodeFormerNode(node: FormerNode, vars: PatternVariables): FormerNodeIR {
  switch (node.node) {
    case "leaf":
      return { node: "leaf", var: vars.nameOf(node.var) };
    case "record": {
      const entries: Record<string, FormerNodeIR> = {};
      for (const [key, child] of node.entries) entries[key] = encodeFormerNode(child, vars);
      const splices = node.splices.map((use) =>
        withLive(
          {
            fragment: use.fused.former.formerName,
            in: encodePattern(use.fused.in, vars),
            ...(use.whether ? { whether: true as const } : {}),
          },
          use.fused.former,
        ),
      );
      return {
        node: "record",
        ...encodeFormerWhere(node.where, vars),
        entries,
        ...(splices.length > 0 ? { splices } : {}),
      };
    }
    case "former":
      return withLive(
        {
          node: "former" as const,
          former: node.use.fused.former.formerName,
          in: encodePattern(node.use.fused.in, vars),
          ...(node.use.whether ? { whether: true as const } : {}),
        },
        node.use.fused.former,
      );
    case "each":
      return {
        node: "each",
        from: encodeWhereOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        ...(node.arranged !== undefined ? { arranged: encodeArranged(node.arranged, vars) } : {}),
        as: encodeFormerNode(node.as, vars),
      };
    case "count":
      return {
        node: "count",
        from: encodeWhereOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
      };
    case "first":
      return {
        node: "first",
        from: encodeWhereOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        ...(node.arranged !== undefined ? { arranged: encodeArranged(node.arranged, vars) } : {}),
        value: vars.nameOf(node.value),
      };
    case "distinct":
      return {
        node: "distinct",
        from: encodeWhereOp(node.from, vars) as FormerSourceIR,
        ...encodeFormerWhere(node.where, vars),
        value: vars.nameOf(node.value),
      };
  }
}

export function lowerFormerBody(slotVars: readonly symbol[], body: FormerNode): FormerNodeIR {
  const vars = new PatternVariables();
  for (const slotVar of slotVars) vars.nameOf(slotVar);
  return encodeFormerNode(body, vars);
}

/** Serialize one former: the registered body already is IR. */
export function serializeFormer(ref: FormerRef): FormerIR {
  return {
    name: ref.formerName,
    ins: [...ref.ins],
    bindings: [...ref.bindings],
    promise: ref.promise,
    body: ref.body,
  };
}
