/** Evaluate declared where operations against working frames and registered reads. */

import { isQueryRef } from "@engine/reactions/authoring/references";
import type { Frame, InstrumentedQuery, Mapping } from "@engine/reactions/types";
import type { ComputationRef } from "./computations.ts";
import type { ReadEnv } from "./definition-registry.ts";
import { bindInputMapping, expandOutputRows, Frames, readPatternValue } from "./frames.ts";
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
 * Reads run ahead of the evaluation that consumes them. The rows of one line,
 * and the rows of one selection, do not depend on each other, so their reads
 * may overlap. Answers are still consumed in row order, so results, their
 * order, and the reported fault are those of evaluating the rows one after
 * another. Two bounds keep this cheap: a window of rows read ahead of the one
 * being consumed, and a cap on reads in flight per engine.
 */

/** Check a running row count; an engine-owned check can also be asked without recording. */
export type AssertRows = ((count: number) => void) & {
  /** Whether `count` rows would breach the limit, without recording a breach. */
  readonly exceeds?: (count: number) => boolean;
};

export const DEFAULT_READ_AHEAD = 16;
export const DEFAULT_CONCURRENT_READS = 64;

/** Bounds on overlapping reads, shared by every evaluation one engine runs. */
export interface ReadConcurrency {
  /** Rows read ahead of the row being consumed, per line or selection. 1 reads in sequence. */
  readonly readAhead: number;
  /** Query calls in flight at once. */
  readonly slots: ReadSlots;
}

/** A counting semaphore held only around leaf query calls, so nested evaluation cannot deadlock. */
export class ReadSlots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(readonly capacity: number) {}

  async run<T>(read: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.capacity) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await read();
    } finally {
      const next = this.waiting.shift();
      if (next === undefined) this.active -= 1;
      else next();
    }
  }
}

export function readConcurrency(
  readAhead = DEFAULT_READ_AHEAD,
  concurrentReads = DEFAULT_CONCURRENT_READS,
): ReadConcurrency {
  return { readAhead, slots: new ReadSlots(concurrentReads) };
}

/** A row limit reached by a row read ahead, recorded only if evaluation reaches that row. */
class DeferredRowLimit extends Error {
  constructor(readonly count: number) {
    super(`row limit reached at ${count} rows`);
  }
}

function deferredGuard(assertRows: AssertRows | undefined): AssertRows | undefined {
  if (assertRows === undefined) return undefined;
  const exceeds = assertRows.exceeds as (count: number) => boolean;
  return Object.assign(
    (count: number) => {
      if (exceeds(count)) throw new DeferredRowLimit(count);
    },
    { exceeds },
  );
}

/**
 * Evaluate `count` independent rows: `launch` starts row `index`'s work, and
 * `consume` takes its answer in row order, returning `false` to stop. Rows
 * launched ahead check limits without recording; a limit one of them reached
 * is recorded through the caller's guard when its row is consumed. Before
 * returning or rethrowing, the rows already launched settle, so an evaluation
 * never finishes with its reads still running.
 */
export async function inRowOrder<T>(
  count: number,
  reads: ReadConcurrency | undefined,
  assertRows: AssertRows | undefined,
  launch: (index: number, assertRows: AssertRows | undefined) => Promise<T>,
  consume: (index: number, value: T) => boolean | void,
): Promise<void> {
  const canDefer = assertRows === undefined || assertRows.exceeds !== undefined;
  const window = canDefer ? Math.max(1, reads?.readAhead ?? 1) : 1;
  if (window === 1 || count <= 1) {
    for (let index = 0; index < count; index += 1) {
      if (consume(index, await launch(index, assertRows)) === false) return;
    }
    return;
  }
  const guard = deferredGuard(assertRows);
  const launched: (Promise<T> | undefined)[] = [];
  let next = 0;
  let index = 0;
  try {
    for (; index < count; index += 1) {
      while (next < count && next < index + window) {
        const pending = launch(next, guard);
        pending.catch(() => {});
        launched[next] = pending;
        next += 1;
      }
      let value: T;
      try {
        value = await (launched[index] as Promise<T>);
      } catch (error) {
        if (error instanceof DeferredRowLimit) assertRows?.(error.count);
        throw error;
      }
      launched[index] = undefined;
      if (consume(index, value) === false) return;
    }
  } finally {
    const unsettled = launched.filter((pending) => pending !== undefined);
    if (unsettled.length > 0) await Promise.allSettled(unsettled);
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
  for (const row of rows) {
    const candidate = new Frames();
    expandOutputRows(candidate, frame, [row], output);
    const matched = candidate[0];
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
    const rows = await leafRows(queryOf(op.query, env, site), op.in, frame, env);
    assertRows?.(rows.length);
    return rows;
  }
  return viewRows(viewOf(op, env), op.in, frame, env, assertRows);
}

/** One query call, holding one of the engine's read slots while it runs. */
function leafRows(
  query: InstrumentedQuery,
  input: Mapping,
  frame: Frame,
  env: ReadEnv | undefined,
): Promise<unknown[]> {
  const slots = env?.reads?.slots;
  return slots === undefined
    ? queryRows(query, input, frame)
    : slots.run(() => queryRows(query, input, frame));
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
const UNBOUND = Symbol("unbound input");

/**
 * Apply a reading line to every frame. The frames' reads are independent, so
 * they may run ahead of the frame being consumed; frames are consumed in order.
 */
async function applyReadOp(
  frames: Frames,
  op: ReadOp,
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<Frames> {
  const result = new Frames();
  await inRowOrder(
    frames.length,
    env?.reads,
    assertRows,
    async (index, guard): Promise<unknown[] | typeof UNBOUND> => {
      const frame = frames[index];
      if (op.op === "count") {
        const rows = await leafRows(queryOf(op.query, env, "count"), op.in, frame, env);
        guard?.(rows.length);
        return rows;
      }
      if (hasUnboundInput(frame, op.in)) return UNBOUND;
      return lineRows(op, frame, env, op.op, guard);
    },
    (index, rows) => {
      const frame = frames[index];
      switch (op.op) {
        case "find": {
          if (rows === UNBOUND) break;
          if (Object.keys(op.out).length === 0) {
            if (rows.some((row) => passesNot("not" in op ? op.not : undefined, frame, row))) {
              pushFrame(result, frame, assertRows);
            }
            break;
          }
          const passing = rows.filter((row) =>
            passesNot("not" in op ? op.not : undefined, frame, row),
          );
          appendFrames(result, expandDistinctRows(frame, passing, op.out, assertRows), assertRows);
          break;
        }
        case "whether": {
          if (rows === UNBOUND) {
            pushFrame(result, { ...frame }, assertRows);
            break;
          }
          const matches = expandDistinctRows(frame, rows, op.out, assertRows);
          if (matches.length === 0) pushFrame(result, { ...frame }, assertRows);
          else appendFrames(result, matches, assertRows);
          break;
        }
        case "no": {
          if (rows === UNBOUND) break;
          const matches = expandDistinctRows(frame, rows, op.out, assertRows);
          if (matches.length === 0) pushFrame(result, frame, assertRows);
          break;
        }
        case "count": {
          if (rows === UNBOUND) break;
          if (op.out in frame && frame[op.out] !== rows.length) break;
          pushFrame(result, { ...frame, [op.out]: rows.length }, assertRows);
          break;
        }
      }
    },
  );
  return result;
}

async function applyOp(
  frames: Frames,
  op: EvaluableOp,
  env: ReadEnv | undefined,
  assertRows?: AssertRows,
): Promise<Frames> {
  assertRows?.(frames.length);
  if (op.op === "find" || op.op === "whether" || op.op === "no" || op.op === "count") {
    return applyReadOp(frames, op, env, assertRows);
  }
  const result = new Frames();
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
        if (op.out in frame && frame[op.out] !== value) break;
        pushFrame(result, { ...frame, [op.out]: value }, assertRows);
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
        const _exhausted: never = op.op;
        throw new Error(`Unknown where op kind: ${String(_exhausted)}`);
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
