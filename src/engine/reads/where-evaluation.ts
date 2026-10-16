/** Evaluate declared where operations against working frames and registered reads. */

import { isQueryRef } from "@engine/reactions/authoring/references";
import type { Frame, InstrumentedQuery, Mapping } from "@engine/reactions/types";
import type { ComputationRef } from "./computations.ts";
import type { ReadEnv } from "./definition-registry.ts";
import { bindInputMapping, Frames, outputRow, readPatternValue } from "./frames.ts";
import { structurallyEqual } from "./value-equality.ts";
import { liveOf } from "./ir.ts";
import type { QueryRefIR, ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { QueryAnswerFault, queryRows } from "./queries.ts";
import { walkValueTree } from "./value-tree.ts";
import type { ViewOp } from "./views.ts";
import { conditionOp } from "./where-ops.ts";
import type { Condition, CustomOp, WhereOp } from "./where-ops.ts";
import { setOwn } from "@engine/utils/own-property";

/*
 * Rows read together. The rows of one line, and the rows of one selection, do
 * not depend on each other, so an engine assembled with `concurrentReads` may
 * evaluate several at once. Answers are still consumed in row order, so the
 * results, their order, the reported fault, and the recorded row-limit breach
 * are those of reading the rows one after another, provided queries,
 * computations, conditions, and custom ops are free of side effects and no
 * action changes the state being read meanwhile. Without `concurrentReads`,
 * every line reads its rows one after another, through the same code.
 */

/** Check a running row count, recording a breach when it is over the limit; `exceeds` only asks. */
export type AssertRows = ((count: number) => void) & {
  /** Whether `count` rows would breach the limit, asked without recording a breach. */
  readonly exceeds: (count: number) => boolean;
};

/** How one engine reads rows together; set by the `concurrentReads` assembly option. */
export interface ReadAhead {
  /** Rows of one line or selection evaluated at once, the row being consumed included. */
  readonly rowsAtOnce: number;
  /** Rows started ahead of the row being consumed, counted across the whole engine. */
  readonly ahead: RowsAhead;
}

/**
 * A count of rows started ahead and not yet settled, shared by every
 * evaluation one engine runs. An evaluation that finds it spent does not wait:
 * it reads its next row when it reaches it, as it would without read-ahead, so
 * nesting cannot deadlock.
 */
export class RowsAhead {
  private started = 0;

  constructor(readonly capacity: number) {}

  /** Rows started ahead that have not settled yet. */
  get inUse(): number {
    return this.started;
  }

  take(): boolean {
    if (this.started >= this.capacity) return false;
    this.started += 1;
    return true;
  }

  give(): void {
    if (this.started === 0)
      throw new Error("RowsAhead: a row was given back that was never taken.");
    this.started -= 1;
  }
}

/** The `concurrentReads` assembly option. */
export interface ConcurrentReads {
  /** Rows of one line or selection evaluated at once, the row being consumed included; 1 reads them one after another. */
  readonly rowsAtOnce: number;
  /** Rows started ahead at once across the whole engine; 64 when unset. */
  readonly maxRowsAhead?: number;
}

export const DEFAULT_MAX_ROWS_AHEAD = 64;

/** The engine's read-ahead for an assembly option; undefined reads rows one after another. */
export function readAheadFor(options: ConcurrentReads | undefined): ReadAhead | undefined {
  if (options === undefined) return undefined;
  return {
    rowsAtOnce: options.rowsAtOnce,
    ahead: new RowsAhead(options.maxRowsAhead ?? DEFAULT_MAX_ROWS_AHEAD),
  };
}

/** A row limit reached inside a row read together, recorded only when that row is consumed. */
class DeferredRowLimit extends Error {
  constructor(readonly count: number) {
    super(`row limit reached at ${count} rows`);
  }
}

/** Stops a row started ahead whose evaluation has already answered or failed. */
class AbandonedRow extends Error {
  constructor() {
    super("the evaluation this row was read for has finished");
  }
}

/**
 * The check a row read together runs under. It asks the evaluation's own
 * check without recording, so a breach is recorded only when its row is
 * consumed, and it stops the row once the evaluation has finished. Rows nested
 * in that row ask through it, so they stop too.
 */
function rowTogetherGuard(
  assertRows: AssertRows | undefined,
  evaluation: { finished: boolean },
): AssertRows {
  const exceeds = (count: number): boolean => {
    if (evaluation.finished) throw new AbandonedRow();
    return assertRows?.exceeds(count) ?? false;
  };
  return Object.assign(
    (count: number) => {
      if (exceeds(count)) throw new DeferredRowLimit(count);
    },
    { exceeds },
  );
}

/**
 * Evaluate `count` independent rows: `launch` starts row `index`'s work, and
 * `consume` takes its answer in row order. With read-ahead, up to `rowsAtOnce`
 * rows run at once, while the engine's count of rows ahead lasts. A row-limit
 * breach is recorded when the row that reached it is consumed. A fault is
 * rethrown as soon as its row is consumed; rows started ahead are then
 * abandoned: their reads already sent run to completion, and they stop at
 * their next row check.
 */
export async function inRowOrder<T>(
  count: number,
  readAhead: ReadAhead | undefined,
  assertRows: AssertRows | undefined,
  launch: (index: number, assertRows: AssertRows | undefined) => Promise<T>,
  consume: (index: number, value: T) => void,
): Promise<void> {
  if (readAhead === undefined || readAhead.rowsAtOnce <= 1 || count <= 1) {
    for (let index = 0; index < count; index += 1) consume(index, await launch(index, assertRows));
    return;
  }
  const evaluation = { finished: false };
  const guard = rowTogetherGuard(assertRows, evaluation);
  const start = (index: number): Promise<T> => {
    try {
      return launch(index, guard);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const startedAhead: (Promise<T> | undefined)[] = [];
  let next = 0;
  try {
    for (let index = 0; index < count; index += 1) {
      const current = startedAhead[index] ?? start(index);
      startedAhead[index] = undefined;
      next = Math.max(next, index + 1);
      while (next < count && next < index + readAhead.rowsAtOnce && readAhead.ahead.take()) {
        const pending = start(next).finally(() => readAhead.ahead.give());
        pending.catch(() => {});
        startedAhead[next] = pending;
        next += 1;
      }
      let value: T;
      try {
        value = await current;
      } catch (error) {
        if (error instanceof DeferredRowLimit) assertRows?.(error.count);
        throw error;
      }
      consume(index, value);
    }
  } finally {
    evaluation.finished = true;
  }
}

/** An op as evaluation accepts it: authored (live refs, symbols) or IR (names). */
type EvaluableOp = ViewOp | ViewOpIR;

function pushFrame(into: Frames, frame: Frame, assertRows?: AssertRows): void {
  assertRows?.(into.length + 1);
  into.push(frame);
}

function appendFrames(into: Frames, frames: Iterable<Frame>, assertRows?: AssertRows): void {
  for (const frame of frames) pushFrame(into, frame, assertRows);
}

function expandDistinctRows(
  frame: Frame,
  rows: readonly unknown[],
  output: Mapping,
  assertRows?: AssertRows,
): Frames {
  const matches = new Frames();
  const entries = Object.entries(output);
  for (const row of rows) {
    const matched = outputRow(frame, row, entries);
    if (matched === undefined || matches.some((prior) => structurallyEqual(prior, matched)))
      continue;
    pushFrame(matches, matched, assertRows);
  }
  return matches;
}

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

/** A computation op's definition-site ref, or the registered computation of the same name. */
function computationOf(
  op: { computation: string | ComputationRef },
  env: ReadEnv | undefined,
): ComputationRef {
  if (typeof op.computation === "function") return op.computation;
  return (
    (liveOf(op) as ComputationRef | undefined) ??
    requireEnv(env, `computation "${op.computation}"`).computation(op.computation, op.computation)
  );
}

function viewOf(op: { view?: RelationView | string }, env: ReadEnv | undefined): RelationView {
  if (typeof op.view !== "string" && op.view !== undefined) return op.view;
  const live = liveOf(op as object) as RelationView | undefined;
  if (live !== undefined) return live;
  const name = op.view as string;
  return requireEnv(env, `view "${name}"`).viewByName(name, name);
}

async function viewRows(
  view: RelationView,
  input: Mapping,
  frame: Frame,
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<unknown[]> {
  const filled = bindInputMapping(frame, input);
  const seed: Frame = {};
  for (const name of view.ins) {
    if (Object.hasOwn(filled, name)) setOwn(seed, name, filled[name]);
  }
  const survivors: Frame[] = [];
  for (const block of view.alternatives as readonly (readonly ViewOpIR[])[]) {
    for (const survivor of await applyViewOps(new Frames(seed), block, env, assertRows)) {
      assertRows?.(survivors.length + 1);
      survivors.push(survivor);
    }
    if (view.outs.length === 0 && survivors.length > 0) break;
  }
  if (view.outs.length === 0) return survivors.length > 0 ? [{}] : [];
  const rows: Record<string, unknown>[] = [];
  for (const survivor of survivors) {
    const row: Record<string, unknown> = {};
    for (const out of view.outs) {
      if (Object.hasOwn(survivor, out)) setOwn(row, out, survivor[out]);
    }
    if (!rows.some((prior) => structurallyEqual(prior, row))) {
      assertRows?.(rows.length + 1);
      rows.push(row);
    }
  }
  if (view.promise === "one" && rows.length !== 1) {
    throw new QueryAnswerFault(
      `View "${view.viewName}" promises one row but produced ${rows.length}.`,
    );
  }
  if (view.promise === "optional" && rows.length > 1) {
    throw new QueryAnswerFault(
      `View "${view.viewName}" promises at most one row but produced ${rows.length}.`,
    );
  }
  return rows;
}

async function lineRows(
  op: {
    query?: InstrumentedQuery | QueryRefIR;
    view?: RelationView | string;
    in: Mapping;
  },
  frame: Frame,
  env: ReadEnv | undefined,
  site: string,
  assertRows?: AssertRows,
): Promise<unknown[]> {
  if (op.query !== undefined) {
    const rows = await queryRows(queryOf(op.query, env, site), op.in, frame, env?.since);
    assertRows?.(rows.length);
    return rows;
  }
  return viewRows(viewOf(op, env), op.in, frame, env, assertRows);
}

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

function hasUnboundInput(frame: Frame, input: Mapping): boolean {
  let unbound = false;
  walkValueTree(input, (value) => {
    const read = readPatternValue(value, frame);
    if (read.isVariable && !read.bound) unbound = true;
    return !read.isVariable && read.value === value;
  });
  return unbound;
}

type ReadOp = Extract<EvaluableOp, { op: "find" | "whether" | "no" | "count" }>;
/** What a line reads for a frame whose input is unbound: nothing. */
const UNBOUND = Symbol("unbound input");

function isReadOp(op: EvaluableOp): op is ReadOp {
  return op.op === "find" || op.op === "whether" || op.op === "no" || op.op === "count";
}

/** Read one frame's rows for a reading line. */
async function readLine(
  op: ReadOp,
  frame: Frame,
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<unknown[] | typeof UNBOUND> {
  if (op.op === "count") {
    const rows = await queryRows(queryOf(op.query, env, "count"), op.in, frame, env?.since);
    assertRows?.(rows.length);
    return rows;
  }
  if (hasUnboundInput(frame, op.in)) return UNBOUND;
  return lineRows(op, frame, env, op.op, assertRows);
}

/** Add what one frame's rows make of a reading line to the result. */
function consumeLine(
  op: ReadOp,
  frame: Frame,
  rows: unknown[] | typeof UNBOUND,
  result: Frames,
  assertRows?: AssertRows,
): void {
  switch (op.op) {
    case "find": {
      if (rows === UNBOUND) return;
      if (Object.keys(op.out).length === 0) {
        if (rows.some((row) => passesNot("not" in op ? op.not : undefined, frame, row))) {
          pushFrame(result, frame, assertRows);
        }
        return;
      }
      const passing = rows.filter((row) => passesNot("not" in op ? op.not : undefined, frame, row));
      appendFrames(result, expandDistinctRows(frame, passing, op.out, assertRows), assertRows);
      return;
    }
    case "whether": {
      if (rows === UNBOUND) {
        pushFrame(result, { ...frame }, assertRows);
        return;
      }
      const matches = expandDistinctRows(frame, rows, op.out, assertRows);
      if (matches.length === 0) pushFrame(result, { ...frame }, assertRows);
      else appendFrames(result, matches, assertRows);
      return;
    }
    case "no": {
      if (rows === UNBOUND) return;
      const matches = expandDistinctRows(frame, rows, op.out, assertRows);
      if (matches.length === 0) pushFrame(result, frame, assertRows);
      return;
    }
    case "count": {
      if (rows === UNBOUND) return;
      if (op.out in frame && frame[op.out] !== rows.length) return;
      pushFrame(result, { ...frame, [op.out]: rows.length }, assertRows);
      return;
    }
  }
}

async function applyOp(
  frames: Frames,
  op: EvaluableOp,
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<Frames> {
  assertRows?.(frames.length);
  const result = new Frames();
  if (isReadOp(op)) {
    await inRowOrder(
      frames.length,
      env?.readAhead,
      assertRows,
      (index, guard) => readLine(op, frames[index], env, guard),
      (index, rows) => consumeLine(op, frames[index], rows, result, assertRows),
    );
    return result;
  }
  for (const frame of frames) {
    switch (op.op) {
      case "holds": {
        if ("fused" in op) {
          if ((await op.fused.computation.fn(bindInputMapping(frame, op.fused.in))) === true) {
            pushFrame(result, frame, assertRows);
          }
          break;
        }
        const ref = computationOf(op, env);
        if ((await ref.fn(bindInputMapping(frame, op.in))) === true) {
          pushFrame(result, frame, assertRows);
        }
        break;
      }
      case "compute": {
        const ref = typeof op.computation === "function" ? op.computation : computationOf(op, env);
        const value = await ref.fn(bindInputMapping(frame, op.in));
        if (typeof op.out === "string" || typeof op.out === "symbol") {
          if (op.out in frame && !structurallyEqual(frame[op.out], value)) break;
          pushFrame(result, { ...frame, [op.out]: value }, assertRows);
          break;
        }
        appendFrames(result, expandDistinctRows(frame, [value], op.out, assertRows), assertRows);
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
          pushFrame(result, frame, assertRows);
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
          if (Object.hasOwn(frame, variable) && frame[variable] !== values[index]) unifies = false;
          else setOwn(next, variable, values[index]);
        });
        if (unifies) pushFrame(result, next, assertRows);
        break;
      }
      default: {
        const _exhausted: never = op;
        throw new Error(`Unknown where op kind: ${(_exhausted as { op?: unknown }).op}`);
      }
    }
  }
  return result;
}

function opaqueCustom(fnRef: string): never {
  throw new Error(`a custom op (${fnRef}) is opaque code and cannot be re-registered from data.`);
}

async function applyViewOps(
  frames: Frames,
  ops: readonly EvaluableOp[],
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<Frames> {
  let current = frames;
  assertRows?.(current.length);
  for (const op of ops) {
    current = await applyOp(current, op, env, assertRows);
    if (current.length === 0) break;
  }
  return current;
}

/** Evaluate a where-op list over the working set, one op at a time. */
export async function applyWhereOps(
  frames: Frames,
  ops: readonly (WhereOp | ViewOpIR | Condition)[],
  env?: ReadEnv,
  assertRows?: AssertRows,
): Promise<Frames> {
  const normalized = ops.map((op) =>
    typeof (op as { op?: unknown }).op === "string"
      ? (op as EvaluableOp)
      : (conditionOp(op as Condition, "where") as EvaluableOp),
  );
  return applyViewOps(frames, normalized, env, assertRows);
}
