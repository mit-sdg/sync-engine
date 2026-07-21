/**
 * Define views as named relations over concept queries and other views.
 *
 * A view declares the same three facts as a concept query: inputs, outputs
 * bound or tested through `.is`, and a row-count promise. Its builder receives
 * separate input, output, and free-binding bags. The sentence is only its
 * human name.
 *
 * ```ts
 * export const authorFaceOf = view(
 *   "the author face of a post",
 *   ({ post }, { username, avatar }, { author }) =>
 *     where(
 *       Posting._getPost({ post }).is({ author }),
 *       Profiling._getProfile({ user: author }).is({ username, avatar }),
 *     ),
 * ).optional();
 *
 * authorFaceOf({ post }).is({ username })   // at a use-site: the same line form
 * ```
 *
 * Where there are outputs, the promise defaults to `many`; `.one()`,
 * `.optional()`, and `.many()` state it explicitly. A view without outputs
 * ends in `.holds()`. Several returned `where(...)` blocks are the
 * alternatives: the view holds (or answers rows) if any block does.
 * Multiple blocks are alternatives, so callers can reuse one named policy.
 *
 * Registration infers a cardinality bound from the body and checks it against
 * the view's declared promise. Runtime evaluation enforces a promise that is
 * tighter than static inference can establish. Views may read other views;
 * registration rejects cycles.
 *
 * Views are where a reaction reaches an aggregate: `count(query, in, out)` binds
 * the number of matching rows at the moment of asking, never stored.
 *
 */

import type { BranchChain, InstrumentedQuery, Mapping, StepNode } from "../reactions/types.ts";
import type { Condition, WhereOp } from "./where-ops.ts";
import { conditionOp } from "./where-ops.ts";
import { brand, CountOpBrand, hasBrand, ViewBlockBrand } from "./brands.ts";
import { branchChain } from "../reactions/nodes.ts";
import type { ViewOpIR } from "./ir.ts";
import { lowerRelationBlocks } from "./lower.ts";
import { assertConceptQuery } from "./queries.ts";
import {
  assertSeparateBags,
  bindingBag,
  type FreeBindings,
  type InputBindings,
  type OutputBindings,
} from "./sentence.ts";
import { brandRelationView, lineOf } from "./lines.ts";
import type { RelationView } from "./lines.ts";
import type { QueryPromise } from "./query-contracts.ts";
import { symbolsInMapping } from "./former-analysis.ts";
import { opNamesIR, scheduleBlock } from "./schedule.ts";
import { formFrom } from "./former-builders.ts";
import type { FormNode } from "./former-builders.ts";
import type { FormerEntry } from "./former-nodes.ts";
import { isPlainMapping } from "./matchers.ts";

/**
 * An aggregation: bind the number of rows a query answers with right now.
 * Legal only inside a view's alternatives — a count is taken at the moment
 * of asking and never stored, and policy over aggregates is a view's job.
 */
export interface CountOp {
  readonly op: "count";
  readonly query: InstrumentedQuery;
  readonly in: Mapping;
  readonly out: symbol;
}

/** An op a view's alternative may carry: the where algebra plus `count`. */
export type ViewOp = WhereOp | CountOp;

/** One conjunction in a view; several returned blocks are alternatives. */
declare const ViewBlockType: unique symbol;
export type ViewBlock = ViewOp[] & {
  readonly [ViewBlockType]: true;
  form(entries: Record<string, FormerEntry>): FormNode;
  then(...nodes: StepNode[]): BranchChain;
};

/** State one view alternative as a variadic conjunction. */
export function where(...conditions: Array<Condition | CountOp>): ViewBlock {
  const ops = conditions.map((condition) =>
    isCountOp(condition) ? condition : (conditionOp(condition, "where") as ViewOp),
  );
  const block = brand(ops, ViewBlockBrand) as ViewBlock;
  Object.defineProperty(block, "form", {
    value: (entries: Record<string, FormerEntry>) => formFrom(block, entries),
  });
  Object.defineProperty(block, "then", {
    value: (first: StepNode, ...rest: StepNode[]) => {
      const branch = branchChain(block as WhereOp[], first);
      return rest.length === 0 ? branch : branch.then(...rest);
    },
  });
  return block;
}

export function isCountOp(value: unknown): value is CountOp {
  return hasBrand(value, CountOpBrand);
}

/**
 * Bind the number of rows a query matches with `count(query, in, out)`.
 * Counting is available inside views, not in a reaction's `.where(...)`.
 */
export function count(
  query: InstrumentedQuery | ((...args: never[]) => unknown),
  input: Mapping,
  out: symbol,
): CountOp {
  const validated = assertConceptQuery(
    query,
    "count",
    "; an arbitrary function is a computation — use compute(fn, in, out).",
  );
  if (typeof out !== "symbol") {
    throw new Error("count(query, in, out) binds the row count to a single variable.");
  }
  const op = { op: "count" as const, query: validated, in: input, out };
  return brand(op, CountOpBrand);
}

const VIEW_OPS = new Set(["find", "whether", "no", "holds", "compute", "custom", "count"]);

function assertViewOps(name: string, alternatives: readonly (readonly ViewOp[])[]): void {
  if (alternatives.length === 0) {
    throw new Error(`View "${name}": at least one where block is required.`);
  }
  for (const block of alternatives) {
    if (block.length === 0) {
      throw new Error(`View "${name}": a where block cannot be empty.`);
    }
    for (const op of block) {
      const kind = (op as { op?: unknown })?.op;
      if (kind === "earlier") {
        throw new Error(
          `View "${name}": a view answers from standing state, not from the ` +
            "flow's record — earlier(...) belongs to a reaction's own where.",
        );
      }
      if (typeof kind !== "string" || !VIEW_OPS.has(kind)) {
        throw new Error(
          `View "${name}": each condition is a line (a called query or view, ` +
            "is.lt(...), no(...), whether(...)), count(...), or an advanced computation.",
        );
      }
    }
  }
}

/** Validate a view call against its declared input names. */
function assertViewInputs(name: string, inputs: readonly string[], input: Mapping): Mapping {
  if (!isPlainMapping(input)) {
    throw new Error(`View "${name}" takes one object-shaped input mapping.`);
  }
  for (const key of Object.keys(input)) {
    if (!inputs.includes(key)) {
      throw new Error(`View "${name}": "${key}" is not an input; expected (${inputs.join(", ")}).`);
    }
  }
  for (const inputName of inputs) {
    if (!(inputName in input)) {
      throw new Error(`View "${name}": required input "${inputName}" is missing.`);
    }
  }
  return input;
}

function symbolsInViewOps(alternatives: readonly (readonly ViewOp[])[]): Set<symbol> {
  const used = new Set<symbol>();
  const add = (mapping: Mapping): void => {
    for (const variable of symbolsInMapping(mapping)) used.add(variable);
  };
  for (const block of alternatives) {
    for (const op of block) {
      if (op.op === "count") {
        add(op.in);
        used.add(op.out);
      } else if (op.op === "holds") {
        add(op.fused.in);
      } else if (op.op === "compute") {
        add(op.in);
        used.add(op.out);
      } else if (op.op === "custom") {
        op.in.forEach((variable) => used.add(variable));
        op.out.forEach((variable) => used.add(variable));
      } else {
        add(op.in);
        add(op.out);
        if (op.op === "find") add(op.not ?? {});
      }
    }
  }
  return used;
}

function assertBagUsed(
  name: string,
  label: string,
  minted: ReadonlyMap<string, symbol>,
  used: ReadonlySet<symbol>,
): void {
  for (const [binding, variable] of minted) {
    if (!used.has(variable)) {
      throw new Error(`View "${name}": ${label} binding "${binding}" is declared but never used.`);
    }
  }
}

/**
 * Construct a {@link RelationView} from validated parts. Both `view(...)` and
 * `registerViews(...)` use this function.
 * @internal
 */
export function relationViewWith(
  name: string,
  ins: readonly string[],
  outs: readonly string[],
  bindings: readonly string[],
  promise: QueryPromise | undefined,
  alternatives: readonly (readonly ViewOpIR[])[],
  holdsPredicate = false,
): RelationView {
  const ref = ((pattern: Mapping) =>
    lineOf({ view: ref }, assertViewInputs(name, ins, pattern))) as RelationView;
  Object.defineProperties(ref, {
    viewName: { value: name, enumerable: true },
    ins: { value: [...ins], enumerable: true },
    outs: { value: [...outs], enumerable: true },
    bindings: { value: [...bindings], enumerable: true },
    ...(promise !== undefined ? { promise: { value: promise, enumerable: true } } : {}),
    holdsPredicate: { value: holdsPredicate, enumerable: true },
    alternatives: { value: alternatives, enumerable: false },
    holds: {
      value: (): RelationView => {
        if (outs.length !== 0) {
          throw new Error(`View "${name}": holds() requires an empty output binding bag.`);
        }
        return relationViewWith(name, ins, outs, bindings, undefined, alternatives, true);
      },
    },
    one: {
      value: (): RelationView => {
        if (outs.length === 0) {
          throw new Error(`View "${name}": one() requires at least one output binding.`);
        }
        return relationViewWith(name, ins, outs, bindings, "one", alternatives);
      },
    },
    optional: {
      value: (): RelationView => {
        if (outs.length === 0) {
          throw new Error(`View "${name}": optional() requires at least one output binding.`);
        }
        return relationViewWith(name, ins, outs, bindings, "optional", alternatives);
      },
    },
    many: {
      value: (): RelationView => {
        if (outs.length === 0) {
          throw new Error(`View "${name}": many() requires at least one output binding.`);
        }
        return relationViewWith(name, ins, outs, bindings, "many", alternatives);
      },
    },
  });
  return brandRelationView(ref);
}

/**
 * Define a view from explicit input, output, and free-binding bags. Several
 * returned `where(...)` blocks are alternatives. End a predicate in
 * `holds()`. Output views default to `many()` and may state a narrower promise.
 */
export function view(
  name: string,
  build: (
    inputs: InputBindings,
    outputs: OutputBindings,
    bindings: FreeBindings,
  ) => ViewBlock | ViewBlock[],
): RelationView {
  const inputs = bindingBag<InputBindings>();
  const outputs = bindingBag<OutputBindings>();
  const bindings = bindingBag<FreeBindings>();
  const built = build(inputs.vars, outputs.vars, bindings.vars);

  const alternatives: ViewOp[][] = hasBrand(built, ViewBlockBrand)
    ? [built as ViewBlock]
    : (built as ViewBlock[]);
  if (
    !Array.isArray(alternatives) ||
    !alternatives.every((block) => hasBrand(block, ViewBlockBrand))
  ) {
    throw new Error(
      `View "${name}": state each conjunction with where(...); return several where(...) blocks for alternatives.`,
    );
  }
  assertViewOps(name, alternatives);
  assertSeparateBags("View", name, [
    ["input", inputs.minted],
    ["output", outputs.minted],
    ["free", bindings.minted],
  ]);
  const used = symbolsInViewOps(alternatives);
  const declared = new Set([
    ...inputs.minted.values(),
    ...outputs.minted.values(),
    ...bindings.minted.values(),
  ]);
  for (const variable of used) {
    if (!declared.has(variable)) {
      throw new Error(
        `View "${name}": binding "${String(variable.description ?? variable.toString())}" is not declared in the input, output, or free binding bag.`,
      );
    }
  }
  assertBagUsed(name, "input", inputs.minted, used);
  assertBagUsed(name, "output", outputs.minted, used);
  assertBagUsed(name, "free", bindings.minted, used);
  const named = new Map<symbol, string>();
  for (const bag of [inputs.minted, outputs.minted, bindings.minted]) {
    for (const [binding, variable] of bag) named.set(variable, binding);
  }
  const ins = [...inputs.minted.keys()];
  const outs = [...outputs.minted.keys()];
  const free = [...bindings.minted.keys()];
  const lowered = lowerRelationBlocks(named, alternatives);
  for (const block of lowered) {
    const scheduled = scheduleBlock(block, new Set(ins), `View "${name}"`);
    for (const output of outs) {
      if (!scheduled.bound.has(output)) {
        throw new Error(`View "${name}": an alternative never binds output binding "${output}".`);
      }
    }
    const counts = new Map<string, number>();
    for (const op of scheduled.ordered) {
      for (const binding of opNamesIR(op)) counts.set(binding, (counts.get(binding) ?? 0) + 1);
    }
    for (const output of outs) counts.set(output, (counts.get(output) ?? 0) + 1);
    for (const op of scheduled.ordered) {
      for (const opened of scheduled.opens.get(op) ?? []) {
        if ((counts.get(opened) ?? 0) <= 1) {
          const partition = free.includes(opened) ? "free binding" : "binding";
          throw new Error(
            `View "${name}": ${partition} "${opened}" is opened and never used — omit it or use it in a later line.`,
          );
        }
      }
    }
  }
  return relationViewWith(name, ins, outs, free, outs.length > 0 ? "many" : undefined, lowered);
}
