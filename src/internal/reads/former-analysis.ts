/** Definition-time static checks a former runs over its nodes before it registers. */

import { walkValueTree } from "./value-tree.ts";
import { isVarIR } from "./ir.ts";
import type { PatternIR } from "./ir.ts";
import type { FormerNode } from "./former-nodes.ts";
import type { Mapping } from "../reactions/types.ts";
import type { WhereOp } from "./where-ops.ts";

export function symbolsInMapping(mapping: Mapping): symbol[] {
  const found: symbol[] = [];
  walkValueTree(mapping, (value) => {
    if (typeof value === "symbol") found.push(value);
  });
  return found;
}

/** Every `{ $var }` name an IR pattern reads through, deep. */
export function varNamesInPattern(pattern: PatternIR): string[] {
  const found: string[] = [];
  walkValueTree(pattern, (value) => {
    if (isVarIR(value)) {
      found.push(value.$var);
      return false;
    }
  });
  return found;
}

function whereOpBindings(op: WhereOp): symbol[] {
  switch (op.op) {
    case "find":
    case "whether":
      return symbolsInMapping(op.out);
    case "no":
    case "holds":
      return [];
    case "compute":
      return [op.out];
    case "custom":
      return [...op.out];
  }
}

function whereOpRequirements(op: WhereOp): Array<readonly [symbol, string]> {
  if (op.op === "holds") {
    return symbolsInMapping(op.fused.in).map((variable) => [variable, "condition line"]);
  }
  if (op.op === "custom") {
    return op.in.map((variable) => [variable, "custom(...) input"]);
  }
  const required: Array<readonly [symbol, string]> = symbolsInMapping(op.in).map((variable) => [
    variable,
    `${op.op}(...) input`,
  ]);
  if (op.op === "no") {
    required.push(
      ...symbolsInMapping(op.out).map((variable) => [variable, "no(...) test"] as const),
    );
  }
  if (op.op === "find") {
    required.push(
      ...symbolsInMapping(op.not ?? {}).map(
        (variable) => [variable, "find(...).is.not(...) test"] as const,
      ),
    );
  }
  return required;
}

function variableName(variable: symbol): string {
  return String(variable.description ?? variable.toString());
}

function conditionName(op: WhereOp): string {
  switch (op.op) {
    case "find":
    case "whether":
    case "no": {
      const query = op.query as
        | (NonNullable<typeof op.query> & { refConcept?: string; refQuery?: string })
        | undefined;
      const queryName =
        query?.queryLabel ??
        (query?.refConcept !== undefined && query.refQuery !== undefined
          ? `${query.refConcept}.${query.refQuery}`
          : undefined);
      return `${op.op} ${queryName ?? op.view?.viewName ?? "unnamed line"}`;
    }
    case "holds":
      return op.fused.computation.computationName;
    case "compute":
      return `compute ${op.computation.computationName}`;
    case "custom":
      return `custom ${op.name}`;
  }
}

function unresolvedConditions(pending: readonly WhereOp[], scope: ReadonlySet<symbol>): string {
  return pending
    .map((op) => {
      const missing = whereOpRequirements(op)
        .filter(([variable]) => !scope.has(variable))
        .map(([variable]) => `"${variableName(variable)}"`);
      return `${conditionName(op)} needs ${missing.join(", ")}`;
    })
    .join("; ");
}

/**
 * Every leaf and every `value` must be traceable to a binding: an input, an
 * enclosing selection's output, or a where line's output. A name bound by
 * nothing is a definition error — caught here, not at evaluation.
 */
export function assertBound(
  name: string,
  node: FormerNode,
  bound: ReadonlySet<symbol>,
  free: ReadonlySet<symbol> = new Set(),
): void {
  const requireBound = (
    variable: symbol,
    role: string,
    scope: ReadonlySet<symbol> = bound,
  ): void => {
    if (!scope.has(variable)) {
      const partition = free.has(variable) ? "free binding" : role;
      throw new Error(
        `Former "${name}": ${partition} "${String(variable.description ?? variable.toString())}" is bound by nothing — ` +
          "declare it as an input, or bind it as a selection or where-line output.",
      );
    }
  };
  switch (node.node) {
    case "leaf":
      requireBound(node.var, "leaf");
      return;
    case "record": {
      const scope = new Set(bound);
      const pending = [...node.where];
      while (pending.length > 0) {
        const ready = pending.findIndex((op) =>
          whereOpRequirements(op).every(([variable]) => scope.has(variable)),
        );
        if (ready < 0) {
          throw new Error(
            `Former "${name}": record conditions are unresolved — ${unresolvedConditions(pending, scope)}.`,
          );
        }
        const [op] = pending.splice(ready, 1);
        for (const variable of whereOpBindings(op)) scope.add(variable);
      }
      for (const [, child] of node.entries) assertBound(name, child, scope, free);
      for (const use of node.splices) {
        for (const variable of symbolsInMapping(use.fused.in)) {
          requireBound(variable, `splice "${use.fused.former.formerName}" anchor`, scope);
        }
      }
      return;
    }
    case "former":
      for (const variable of symbolsInMapping(node.use.fused.in)) {
        requireBound(variable, `former "${node.use.fused.former.formerName}" anchor`);
      }
      return;
    case "each":
    case "count":
    case "first":
    case "distinct": {
      const scope = new Set(bound);
      for (const variable of symbolsInMapping(node.from.in)) {
        requireBound(variable, `${node.node} selection input`, scope);
      }
      for (const variable of symbolsInMapping(node.from.not ?? {})) {
        requireBound(variable, `${node.node} selection negated test`, scope);
      }
      for (const variable of symbolsInMapping(node.from.out)) scope.add(variable);
      const pending = [...node.where];
      while (pending.length > 0) {
        const ready = pending.findIndex((op) =>
          whereOpRequirements(op).every(([variable]) => scope.has(variable)),
        );
        if (ready < 0) {
          throw new Error(
            `Former "${name}": selection conditions are unresolved — ${unresolvedConditions(pending, scope)}.`,
          );
        }
        const [op] = pending.splice(ready, 1);
        for (const variable of whereOpBindings(op)) scope.add(variable);
      }
      if (node.node === "each") assertBound(name, node.as, scope, free);
      if (node.node === "first" || node.node === "distinct") {
        requireBound(
          node.value,
          `${node.node === "first" ? "firstOf" : "distinctOf"} value`,
          scope,
        );
      }
      if (
        (node.node === "each" || node.node === "first") &&
        node.arranged !== undefined &&
        "by" in node.arranged
      ) {
        requireBound(node.arranged.by, "arranged.by variable", scope);
      }
      return;
    }
  }
}

export function symbolsUsed(node: FormerNode, into: Set<symbol>): void {
  const fromMapping = (mapping: Mapping): void => {
    for (const variable of symbolsInMapping(mapping)) into.add(variable);
  };
  switch (node.node) {
    case "leaf":
      into.add(node.var);
      return;
    case "record":
      for (const op of node.where) {
        if (op.op === "holds") fromMapping(op.fused.in);
        else if (op.op === "custom") op.in.forEach((variable) => into.add(variable));
        else {
          fromMapping(op.in);
          if ("out" in op && typeof op.out === "object") fromMapping(op.out);
        }
      }
      for (const [, child] of node.entries) symbolsUsed(child, into);
      // A splice's anchors are uses of the host's variables.
      for (const use of node.splices) fromMapping(use.fused.in);
      return;
    case "former":
      fromMapping(node.use.fused.in);
      return;
    default: {
      fromMapping(node.from.in);
      fromMapping(node.from.not ?? {});
      for (const variable of symbolsInMapping(node.from.out)) into.add(variable);
      for (const op of node.where) {
        if (op.op === "holds") fromMapping(op.fused.in);
        else if (op.op === "custom") op.in.forEach((variable) => into.add(variable));
        else {
          fromMapping(op.in);
          if ("out" in op && typeof op.out === "object") fromMapping(op.out);
        }
      }
      if (node.node === "each") symbolsUsed(node.as, into);
      if (node.node === "first" || node.node === "distinct") into.add(node.value);
      if (
        (node.node === "each" || node.node === "first") &&
        node.arranged !== undefined &&
        "by" in node.arranged
      ) {
        into.add(node.arranged.by);
      }
      return;
    }
  }
}
