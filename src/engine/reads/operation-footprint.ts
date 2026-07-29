/** Binding facts shared by authored operations and their string-backed IR. */

import type { Mapping } from "@engine/reactions/types";
import { isVarIR } from "./ir.ts";
import type { PatternIR, ViewOpIR, WhereOpIR } from "./ir.ts";
import { walkValueTree } from "./value-tree.ts";
import type { AnyWhereOp } from "./where-ops.ts";

type AuthoredCountOp = { readonly op: "count"; readonly in: Mapping; readonly out: symbol };
export type AuthoredOperation = AnyWhereOp | AuthoredCountOp;
export type IROperation = WhereOpIR | ViewOpIR;

export interface OperationFootprint<Name extends string | symbol> {
  /** Names read from the operation's primary input. */
  inputs: Name[];
  /** Names that must be bound before the operation can run. */
  requires: Name[];
  /** Names the operation may bind. */
  produces: Name[];
  /** Every occurrence, in diagnostic counting order and without deduplication. */
  mentions: Name[];
  /** Names tested under `no` or `.is.not`. */
  negative: Name[];
}

type Operation = AuthoredOperation | IROperation;
type Backing = "authored" | "ir";

function variablesIn(value: unknown, backing: Backing): Array<string | symbol> {
  const found: Array<string | symbol> = [];
  walkValueTree(value, (node) => {
    if (backing === "authored") {
      if (typeof node === "symbol") found.push(node);
    } else if (isVarIR(node)) {
      found.push(node.$var);
      return false;
    }
  });
  return found;
}

/** Every `{ $var }` name an IR pattern reads through, deep. */
export function varNamesInPattern(pattern: unknown): string[] {
  return variablesIn(pattern, "ir") as string[];
}

/** Every variable an authored pattern reads through, deep. */
export function symbolsInMapping(mapping: unknown): symbol[] {
  return variablesIn(mapping, "authored") as symbol[];
}

export function operationFootprint(
  op: AuthoredOperation,
  backing: "authored",
): OperationFootprint<symbol>;
export function operationFootprint(op: IROperation, backing: "ir"): OperationFootprint<string>;
export function operationFootprint(
  op: Operation,
  backing: Backing,
): OperationFootprint<string | symbol> {
  const names = (value: Mapping | PatternIR | readonly (string | symbol)[] | undefined) =>
    variablesIn(value, backing);
  const footprint = (
    inputs: Array<string | symbol>,
    produces: Array<string | symbol> = [],
    negative: Array<string | symbol> = [],
  ): OperationFootprint<string | symbol> => ({
    inputs,
    requires: [...inputs, ...negative],
    produces,
    mentions: [...inputs, ...produces, ...negative],
    negative,
  });
  switch (op.op) {
    case "find":
    case "whether":
      return footprint(
        names(op.in),
        names(op.out),
        "not" in op && op.not !== undefined ? names(op.not) : [],
      );
    case "no":
      return footprint(names(op.in), [], names(op.out));
    case "holds": {
      const input =
        backing === "authored"
          ? (op as Extract<AuthoredOperation, { op: "holds" }>).fused.in
          : (op as Extract<IROperation, { op: "holds" }>).in;
      return footprint(names(input));
    }
    case "compute":
    case "count":
      return footprint(names(op.in), [op.out]);
    case "custom":
      return footprint([...op.in], [...op.out]);
    case "earlier": {
      const pattern =
        backing === "authored"
          ? (op as Extract<AuthoredOperation, { op: "earlier" }>).pattern
          : (op as Extract<IROperation, { op: "earlier" }>).when;
      return footprint([], [...names(pattern.input), ...names(pattern.output)]);
    }
  }
}
