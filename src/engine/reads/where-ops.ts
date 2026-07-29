/**
 * Conditions accepted by `where(...)`.
 *
 * A query or view call supplies an input pattern. Its optional `.is(...)`
 * pattern tests output fields with literals or bound variables and binds new
 * variables. A call without `.is(...)` checks only whether a matching row
 * exists. `.is.not(...)` tests that the stated output fields differ.
 *
 * `no(line)` requires zero matching rows. `whether(line)` keeps the current
 * match when the query or view returns no row and assigns `null` to variables
 * that line would have bound. Built-in comparisons and named computations add
 * closed conditions. Advanced code may use `custom(...)`.
 */

import type { ComputationRef, FusedComputation } from "./computations.ts";
import { isFusedComputation } from "./computations.ts";
import type { ActionPattern, InstrumentedQuery, Mapping } from "@engine/reactions/types";
import { brand, hasBrand, WhereOpBrand } from "./brands.ts";
import { isReadLine } from "./lines.ts";
import type { ReadLine, RelationView, ViewReadLine } from "./lines.ts";
import { isFusedFormer, useFormer } from "./former-nodes.ts";
import type { FormerUse, FusedFormer } from "./former-nodes.ts";

/** The query or view used by one read operation. */
export interface LineRef {
  readonly query?: InstrumentedQuery;
  readonly view?: RelationView;
}

/** A read whose output pattern binds or tests fields and whose `not` pattern tests differences. */
export interface FindOp extends LineRef {
  readonly op: "find";
  readonly in: Mapping;
  readonly out: Mapping;
  readonly not?: Mapping;
}

/** A read that succeeds only when no row matches. */
export interface NoOp extends LineRef {
  readonly op: "no";
  readonly in: Mapping;
  readonly out: Mapping;
}

/** A read that assigns matched outputs or assigns `null` when no row matches. */
export interface WhetherOp extends LineRef {
  readonly op: "whether";
  readonly in: Mapping;
  readonly out: Mapping;
}

/** A closed line over a named computation; failing rows are dropped. */
export interface HoldsOp {
  readonly op: "holds";
  readonly fused: FusedComputation;
}

/** A vocabulary-owned calculation; exactly one result, bound to one variable. */
export interface ComputeOp {
  readonly op: "compute";
  readonly computation: ComputationRef;
  readonly in: Mapping;
  readonly out: symbol;
}

/** An opaque escape with a declared positional footprint. */
export interface CustomOp {
  readonly op: "custom";
  readonly name: string;
  readonly fn: (...args: unknown[]) => unknown | Promise<unknown>;
  readonly in: readonly symbol[];
  readonly out: readonly symbol[];
}

export type WhereOp = FindOp | NoOp | WhetherOp | HoldsOp | ComputeOp | CustomOp;

/**
 * A non-consuming read of the flow's record: the pattern stood earlier in
 * this causal tree — one row per matching occurrence, nothing consumed (the
 * double-fire guard belongs to the trigger alone). Built by
 * `earlier(action, in, out?)` (in `words.ts`, which owns action patterns);
 * evaluated by the engine, since it reads the flow index.
 */
export interface EarlierOp {
  readonly op: "earlier";
  readonly pattern: ActionPattern;
}

/** A where op as a reaction's `.where(...)` accepts it, including `earlier`. */
export type AnyWhereOp = WhereOp | EarlierOp;

/** A condition accepted by `where(...)`: an operation, read line, or named computation. */
export type Condition = AnyWhereOp | ReadLine | FusedComputation;

function brandOp<T extends object>(op: T): T {
  return brand(op, WhereOpBrand);
}

/** Whether a value is a where op built by this module (or `earlier`). */
export function isWhereOp(value: unknown): value is AnyWhereOp {
  return hasBrand(value, WhereOpBrand);
}

/** Brand an op constructed elsewhere (`earlier`, which needs action patterns). */
export function brandWhereOp<T extends object>(op: T): T {
  return brandOp(op);
}

/** Copy a read line's query or view reference into its operation. */
function refOf(line: ReadLine): LineRef {
  return line.query !== undefined ? { query: line.query } : { view: line.view };
}

/** Lower one line to its plain op. */
function findOf(line: ReadLine): FindOp {
  return brandOp({
    op: "find" as const,
    ...refOf(line),
    in: line.in,
    out: line.out,
    ...(Object.keys(line.not).length > 0 ? { not: line.not } : {}),
  });
}

/**
 * Accept one condition in `where(...)`, whatever its spelling: an op
 * passes through, a plain line lowers to `find`, a fused computation to
 * `holds`, a sentence view to its existence line.
 */
export function conditionOp(value: Condition, site: string): AnyWhereOp {
  if (isWhereOp(value)) return value;
  if (isReadLine(value)) return findOf(value);
  if (isFusedComputation(value)) return brandOp({ op: "holds" as const, fused: value });
  throw new Error(
    `${site}: each condition is a line (a called query or view, is.lt(...), ` +
      "no(...), whether(...)) or a condition operation (compute/custom/earlier).",
  );
}

/** Whether a value is accepted by `where(...)`. */
export function isCondition(value: unknown): value is Condition {
  return isWhereOp(value) || isReadLine(value) || isFusedComputation(value);
}

// ── no and whether ─────────────────────────────────────────────────────────

function assertPlainLine(call: string, line: ReadLine): void {
  if (Object.keys(line.not).length > 0) {
    throw new Error(
      `${call}(...): no(...) and whether(...) cannot wrap a line that uses .is.not(...).`,
    );
  }
}

/** Require that the query or view return no matching row. The line cannot bind new variables. */
export function no(line: ReadLine): NoOp {
  assertPlainLine("no", line);
  return brandOp({
    op: "no" as const,
    ...refOf(line),
    in: line.in,
    out: line.out,
  });
}

/** Keep the current match when no row exists and assign `null` to the line's new variables. */
export function whether(line: ViewReadLine): WhetherOp;
export function whether(line: ReadLine): WhetherOp;
export function whether(fused: FusedFormer): FormerUse;
export function whether(line: ReadLine | FusedFormer): WhetherOp | FormerUse {
  if (isFusedFormer(line)) return useFormer(line, true);
  if (!isReadLine(line)) {
    throw new Error(
      "whether(...) takes a plain line or a named former with its input mapping filled.",
    );
  }
  assertPlainLine("whether", line);
  return brandOp({ op: "whether" as const, ...refOf(line), in: line.in, out: line.out });
}

/** Bind one variable to one calculation declared by the assembled vocabulary. */
export function compute(computation: ComputationRef, input: Mapping, out: symbol): ComputeOp {
  if (typeof computation !== "function" || computation.source !== "vocabulary") {
    throw new Error("compute(...) requires a computation from vocabulary(...).computations.");
  }
  if (typeof out !== "symbol") {
    throw new Error("compute(computation, in, out) binds its one result to a single variable.");
  }
  return brandOp({ op: "compute" as const, computation, in: input, out });
}

/**
 * An opaque function with a declared footprint:
 * which variables it reads (positional args) and which it writes (one value
 * per out variable; a single out binds the return value directly).
 */
export function custom(
  fn: (...args: never[]) => unknown | Promise<unknown>,
  input: readonly symbol[],
  output: readonly symbol[],
): CustomOp {
  if (typeof fn !== "function") throw new Error("custom(fn, in, out) requires a function.");
  if (!input.every((s) => typeof s === "symbol") || !output.every((s) => typeof s === "symbol")) {
    throw new Error("custom(fn, in, out) declares its footprint as variables.");
  }
  return brandOp({
    op: "custom" as const,
    name: fn.name === "" ? "<anonymous>" : fn.name,
    fn: fn as (...args: unknown[]) => unknown | Promise<unknown>,
    in: [...input],
    out: [...output],
  });
}
