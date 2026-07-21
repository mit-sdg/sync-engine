/**
 * Define views as named relations over concept queries and other views.
 *
 * A view declares the same three facts as a concept query: inputs, outputs
 * bound or tested through `.is`, and a row-count promise. A caller uses a view
 * like a concept query. The sentence carries the declaration: its ordinary `(slot)`
 * groups are the inputs, and a sentence-final tail — `with one (…)` /
 * `with optional (…)` / `with many (…)` — states the promise and the
 * outputs. No tail means a pure predicate view: no outs, no promise.
 *
 * ```ts
 * export const authorFaceOf = view(
 *   "the author face of (post) with optional (username, avatar)",
 *   ({ post, author, username, avatar }) =>
 *     where(
 *       Posting._getPost({ post }).is({ author }),
 *       Profiling._getProfile({ user: author }).is({ username, avatar }),
 *     ),
 * );
 *
 * authorFaceOf({ post }).is({ username })   // at a use-site: the same line form
 * ```
 *
 * Only a sentence-final `with <promise-word> (…)` parses as the tail, so
 * ordinary uses of "with" stay unambiguous. Where there are outs, the
 * promise is required — no default. Several returned `where(...)` blocks are
 * the alternatives: the view holds (or answers rows) if any block does.
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

import type {
  BranchChain,
  InstrumentedQuery,
  Mapping,
  StepNode,
  Vars,
} from "../reactions/types.ts";
import type { Condition, WhereOp } from "./where-ops.ts";
import { conditionOp } from "./where-ops.ts";
import { brand, CountOpBrand, hasBrand, ViewBlockBrand } from "./brands.ts";
import { branchChain } from "../reactions/nodes.ts";
import type { ViewOpIR } from "./ir.ts";
import { lowerRelationBlocks } from "./lower.ts";
import { assertConceptQuery } from "./queries.ts";
import { sentenceVars, slotVariables, slotsOf } from "./sentence.ts";
import { brandRelationView, lineOf } from "./lines.ts";
import type { RelationView } from "./lines.ts";
import type { QueryPromise } from "./query-contracts.ts";
import { formFrom } from "./former-builders.ts";
import type { FormNode } from "./former-builders.ts";
import type { FormerEntry } from "./former-nodes.ts";

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

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
export { slotsOf } from "./sentence.ts";

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

/** Validate a view call against the input names declared by its sentence. */
function assertViewInputs(name: string, slots: readonly string[], input: Mapping): Mapping {
  for (const key of Object.keys(input)) {
    if (!slots.includes(key)) {
      throw new Error(`View "${name}": "${key}" is not an input; expected (${slots.join(", ")}).`);
    }
  }
  for (const slot of slots) {
    if (!(slot in input)) {
      throw new Error(`View "${name}": required input "${slot}" is missing.`);
    }
  }
  return input;
}

// ── The relation declaration: the sentence carries the tail ────────────────

/** The one parse of the tail: sentence-final `with <promise-word> (…)`. */
const TAIL = /\bwith\s+(one|optional|many)\s*\(([^()]*)\)\s*$/;

/** A sentence that states a tail — the declaration form of a promised view. */
export type TailSentence = `${string}with ${QueryPromise} (${string})`;

/**
 * Split a declaration's tail off its sentence: the promise word and the
 * output names it declares. A sentence without a final tail is a pure
 * predicate declaration and answers `undefined`.
 */
function tailOf(
  name: string,
): { sentence: string; promise: QueryPromise; outs: string[] } | undefined {
  const match = TAIL.exec(name);
  if (match === null) return undefined;
  const sentence = name.slice(0, match.index).trim();
  if (sentence === "") {
    throw new Error(`View "${name}": the tail follows a sentence — nothing precedes "with".`);
  }
  const outs = match[2].split(",").map((part) => part.trim());
  for (const out of outs) {
    if (!IDENTIFIER.test(out)) {
      throw new Error(
        `View "${name}": declare output names as "with ${match[1]} (a, b)"; ` +
          `"${match[2]}" does not parse as one name per comma.`,
      );
    }
  }
  const repeated = outs.find((out, index) => outs.indexOf(out) !== index);
  if (repeated !== undefined) {
    throw new Error(`View "${name}": output "${repeated}" is named more than once.`);
  }
  return { sentence, promise: match[1] as QueryPromise, outs };
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
  promise: QueryPromise | undefined,
  alternatives: readonly (readonly ViewOpIR[])[],
): RelationView {
  const ref = ((pattern: Mapping) =>
    lineOf({ view: ref }, assertViewInputs(name, ins, pattern))) as RelationView;
  Object.defineProperties(ref, {
    viewName: { value: name, enumerable: true },
    ins: { value: [...ins], enumerable: true },
    outs: { value: [...outs], enumerable: true },
    ...(promise !== undefined ? { promise: { value: promise, enumerable: true } } : {}),
    alternatives: { value: alternatives, enumerable: false },
  });
  return brandRelationView(ref);
}

/**
 * Define a view: a sentence whose `(slot)` groups are the inputs, an
 * optional sentence-final tail — `with one|optional|many (…)` — stating the
 * promise and the outputs, and a builder from its logic variables to
 * `where(...)` blocks (several blocks are the alternatives). A tailless
 * sentence declares a pure predicate.
 */
export function view(
  name: TailSentence,
  build: (vars: Vars) => ViewBlock | ViewBlock[],
): RelationView;
export function view(name: string, build: (vars: Vars) => ViewBlock | ViewBlock[]): RelationView;
export function view(name: string, build: (vars: Vars) => ViewBlock | ViewBlock[]): RelationView {
  const { vars, minted } = sentenceVars();
  const built = build(vars);

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

  const tail = tailOf(name);
  if (tail !== undefined) {
    const { sentence, promise, outs } = tail;
    const slots = slotsOf(sentence);
    for (const out of outs) {
      if (slots.includes(out)) {
        throw new Error(
          `View "${name}": "${out}" is already an input; outputs must be bound by the body.`,
        );
      }
    }
    const slotVars = slotVariables("View", name, slots, minted, "constrains");
    const named = new Map<symbol, string>();
    slots.forEach((slot, index) => named.set(slotVars[index], slot));
    for (const out of outs) {
      const variable = minted.get(out);
      if (variable === undefined) {
        throw new Error(`View "${name}": declared output "${out}" is not bound by the body.`);
      }
      named.set(variable, out);
    }
    return relationViewWith(
      sentence,
      slots,
      outs,
      promise,
      lowerRelationBlocks(named, alternatives),
    );
  }

  const slots = slotsOf(name);
  const slotVars = slotVariables("View", name, slots, minted, "constrains");
  const named = new Map<symbol, string>();
  slots.forEach((slot, index) => named.set(slotVars[index], slot));
  return relationViewWith(name, slots, [], undefined, lowerRelationBlocks(named, alternatives));
}
