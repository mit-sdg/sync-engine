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

import { bindInputMapping, distinctFrames, expandOutputRows, Frames } from "./frames.ts";
import { readPatternValue, structurallyEqual } from "./frames.ts";
import { QueryAnswerFault, queryRows } from "./queries.ts";
import type { ComputationRef, FusedComputation } from "./computations.ts";
import { isFusedComputation } from "./computations.ts";
import type { ViewOp } from "./views.ts";
import type { ActionPattern, Frame, InstrumentedQuery, Mapping } from "../reactions/types.ts";
import { brand, hasBrand, WhereOpBrand } from "./brands.ts";
import { liveOf } from "./ir.ts";
import { walkValueTree } from "./value-tree.ts";
import type { QueryRefIR, ViewOpIR } from "./ir.ts";
import type { ReadEnv } from "./env.ts";
import { isQueryRef } from "../reactions/refs.ts";
import { isReadLine, lineOf } from "./lines.ts";
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
      "no(...), whether(...)) or an advanced op (compute/custom/earlier).",
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

// ── Evaluation ─────────────────────────────────────────────────────────────

/** An op as evaluation accepts it: authored (live refs, symbols) or IR (names). */
export type EvaluableOp = ViewOp | ViewOpIR;

/** The shape any view answers as: named ins, promised outs, alternative blocks. */
interface ViewShape {
  name: string;
  ins: readonly string[];
  outs: readonly string[];
  bindings: readonly string[];
  promise?: "one" | "optional" | "many";
  holdsPredicate: boolean;
  alternatives: readonly (readonly ViewOpIR[])[];
}

function viewShapeOf(view: RelationView): ViewShape {
  return {
    name: view.viewName,
    ins: view.ins,
    outs: view.outs,
    bindings: view.bindings,
    promise: view.promise,
    holdsPredicate: view.holdsPredicate,
    alternatives: view.alternatives as readonly (readonly ViewOpIR[])[],
  };
}

/** The query an op ranges over: a live reference is itself; names and unresolved vocabulary refs bind through the environment. */
function queryOf(
  query: InstrumentedQuery | QueryRefIR,
  env: ReadEnv | undefined,
  site: string,
): InstrumentedQuery {
  if (typeof query === "function") {
    if (isQueryRef(query)) {
      return requireEnv(env, `query "${query.queryName}"`).query(
        { concept: query.refConcept, query: query.refQuery },
        site,
      );
    }
    return query;
  }
  if (env === undefined) {
    throw new Error(
      `${site}: "${query.concept}.${query.query}" is a name — evaluate through an assembled engine.`,
    );
  }
  return env.query(query, site);
}

function requireEnv(env: ReadEnv | undefined, what: string): ReadEnv {
  if (env === undefined) {
    throw new Error(`${what} resolves by name — evaluate through an assembled engine.`);
  }
  return env;
}

/** The view a line op names: its definition-site ref, or the registered one. */
function viewOf(op: { view?: RelationView | string }, env: ReadEnv | undefined): RelationView {
  if (typeof op.view !== "string" && op.view !== undefined) return op.view;
  const live = liveOf(op as object) as RelationView | undefined;
  if (live !== undefined) return live;
  const name = op.view as string;
  return requireEnv(env, `view "${name}"`).viewByName(name, name);
}

/**
 * The rows a view answers with, for one frame: seed each alternative with
 * the handed ins, run its block, and project the declared outs from the
 * survivors. A predicate view (no outs) answers one empty row when any block
 * survives. Every read checks the declared promise, and any fault names the
 * view and its promise.
 */
async function viewRows(
  view: RelationView,
  input: Mapping,
  frame: Frame,
  env: ReadEnv | undefined,
): Promise<unknown[]> {
  const shape = viewShapeOf(view);
  const filled = bindInputMapping(frame, input);
  const seed: Frame = {};
  for (const name of shape.ins) {
    if (name in filled) seed[name] = filled[name];
  }
  const survivors: Frame[] = [];
  for (const block of shape.alternatives) {
    survivors.push(...(await applyViewOps(new Frames(seed), block, env)));
    if (shape.outs.length === 0 && survivors.length > 0) break;
  }
  if (shape.outs.length === 0) return survivors.length > 0 ? [{}] : [];
  const rows: Record<string, unknown>[] = [];
  for (const survivor of survivors) {
    const row: Record<string, unknown> = {};
    for (const out of shape.outs) row[out] = survivor[out];
    if (!rows.some((prior) => structurallyEqual(prior, row))) rows.push(row);
  }
  if (shape.promise === "one" && rows.length !== 1) {
    throw new QueryAnswerFault(
      `View "${shape.name}" promises one row but produced ${rows.length}.`,
    );
  }
  if (shape.promise === "optional" && rows.length > 1) {
    throw new QueryAnswerFault(
      `View "${shape.name}" promises at most one row but produced ${rows.length}.`,
    );
  }
  return rows;
}

/** Read rows from the query or view named by one operation. */
async function lineRows(
  op: {
    query?: InstrumentedQuery | QueryRefIR;
    view?: RelationView | string;
    in: Mapping;
  },
  frame: Frame,
  env: ReadEnv | undefined,
  site: string,
): Promise<unknown[]> {
  if (op.query !== undefined) return queryRows(queryOf(op.query, env, site), op.in, frame);
  return viewRows(viewOf(op, env), op.in, frame, env);
}

/** Whether a row survives a line's negated slot tests: every stated slot differs. */
function passesNot(not: Mapping | undefined, frame: Frame, row: unknown): boolean {
  if (not === undefined) return true;
  for (const [key, pattern] of Object.entries(not)) {
    const stated = readPatternValue(pattern, frame);
    const value =
      row !== null && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined;
    if (structurallyEqual(stated.value, value)) return false;
  }
  return true;
}

/** A line cannot answer a definite fact while one of its inputs is still absent. */
function hasUnboundInput(frame: Frame, input: Mapping): boolean {
  let unbound = false;
  walkValueTree(input, (value) => {
    if (typeof value !== "symbol") return;
    if (!readPatternValue(value, frame).bound) unbound = true;
  });
  return unbound;
}

async function applyOp(frames: Frames, op: EvaluableOp, env: ReadEnv | undefined): Promise<Frames> {
  const result = new Frames();
  for (const frame of frames) {
    switch (op.op) {
      case "find": {
        if (hasUnboundInput(frame, op.in)) break;
        const rows = (await lineRows(op, frame, env, "find")).filter((row) =>
          passesNot("not" in op ? op.not : undefined, frame, row),
        );
        if (Object.keys(op.out).length === 0) {
          // The bare call: existence — fires once or drops, a limit-1 probe.
          if (rows.length > 0) result.push(frame);
          break;
        }
        const matches = new Frames();
        expandOutputRows(matches, frame, rows, op.out);
        result.push(...distinctFrames(matches));
        break;
      }
      case "whether": {
        if (hasUnboundInput(frame, op.in)) {
          result.push({ ...frame });
          break;
        }
        const rows = await lineRows(op, frame, env, "whether");
        const matches = new Frames();
        expandOutputRows(matches, frame, rows, op.out);
        if (matches.length === 0) result.push({ ...frame });
        else result.push(...distinctFrames(matches));
        break;
      }
      case "no": {
        if (hasUnboundInput(frame, op.in)) break;
        const rows = await lineRows(op, frame, env, "no");
        const matches = new Frames();
        expandOutputRows(matches, frame, rows, op.out);
        if (matches.length === 0) result.push(frame);
        break;
      }
      case "count": {
        const query = queryOf(op.query, env, "count");
        const rows = await queryRows(query, op.in, frame);
        if (op.out in frame && frame[op.out] !== rows.length) break;
        result.push({ ...frame, [op.out]: rows.length });
        break;
      }
      case "holds": {
        if ("fused" in op) {
          if ((await op.fused.computation.fn(bindInputMapping(frame, op.fused.in))) === true) {
            result.push(frame);
          }
          break;
        }
        const ref =
          (liveOf(op) as ComputationRef | undefined) ??
          requireEnv(env, `computation "${op.computation}"`).computation(
            op.computation,
            op.computation,
          );
        if ((await ref.fn(bindInputMapping(frame, op.in))) === true) result.push(frame);
        break;
      }
      case "compute": {
        const ref =
          typeof op.computation === "function"
            ? op.computation
            : ((liveOf(op) as ComputationRef | undefined) ??
              requireEnv(env, `computation "${op.computation}"`).computation(
                op.computation,
                op.computation,
              ));
        const value = await ref.fn(bindInputMapping(frame, op.in));
        if (op.out in frame && frame[op.out] !== value) break;
        result.push({ ...frame, [op.out]: value });
        break;
      }
      case "custom": {
        const fn =
          "fn" in op
            ? op.fn
            : ((liveOf(op) as CustomOp["fn"] | undefined) ?? opaqueCustom(op.fnRef));
        const name = "fn" in op ? op.name : op.fnRef;
        const args = op.in.map((variable) => frame[variable]);
        const value = await fn(...args);
        if (op.out.length === 0) {
          result.push(frame);
          break;
        }
        const values = op.out.length === 1 ? [value] : value;
        if (!Array.isArray(values) || values.length !== op.out.length) {
          throw new Error(
            `custom(${name}) declared ${op.out.length} outputs but returned ${
              Array.isArray(values) ? values.length : typeof values
            }.`,
          );
        }
        const next: Frame = { ...frame };
        let unifies = true;
        op.out.forEach((variable, index) => {
          if (variable in frame && frame[variable] !== values[index]) unifies = false;
          else next[variable] = values[index];
        });
        if (unifies) result.push(next);
        break;
      }
    }
  }
  return result;
}

function opaqueCustom(fnRef: string): never {
  throw new Error(`a custom op (${fnRef}) is opaque code and cannot be re-registered from data.`);
}

/** Evaluate one of a view's where blocks — the algebra plus `count`. */
async function applyViewOps(
  frames: Frames,
  ops: readonly EvaluableOp[],
  env: ReadEnv | undefined,
): Promise<Frames> {
  let current = frames;
  for (const op of ops) {
    current = await applyOp(current, op, env);
    if (current.length === 0) break;
  }
  return current;
}

/** Evaluate a where-op list over the working set, one op at a time. A plain
 * line or fused condition normalizes to its operation before evaluation. */
export async function applyWhereOps(
  frames: Frames,
  ops: readonly (WhereOp | ViewOpIR | Condition)[],
  env?: ReadEnv,
): Promise<Frames> {
  const normalized = ops.map((op) =>
    typeof (op as { op?: unknown }).op === "string"
      ? (op as EvaluableOp)
      : (conditionOp(op as Condition, "where") as EvaluableOp),
  );
  return applyViewOps(frames, normalized, env);
}

/** Construct the line a called vocabulary query ref answers with. @internal */
export function queryLine(query: InstrumentedQuery, input: Mapping): ReadLine {
  return lineOf({ query }, input);
}

/** Construct the line a called relation view answers with. @internal */
export function viewLine(view: RelationView, input: Mapping): ReadLine {
  return lineOf({ view }, input);
}
