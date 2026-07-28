/** Evaluate declared where operations against working frames and registered reads. */

import { isQueryRef } from "@engine/reactions/authoring/references";
import type { Frame, InstrumentedQuery, Mapping } from "@engine/reactions/types";
import type { ComputationRef } from "./computations.ts";
import type { ReadEnv } from "./env.ts";
import {
  bindInputMapping,
  distinctFrames,
  expandOutputRows,
  Frames,
  readPatternValue,
  structurallyEqual,
} from "./frames.ts";
import { liveOf } from "./ir.ts";
import type { QueryRefIR, ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import { QueryAnswerFault, queryRows } from "./queries.ts";
import { walkValueTree } from "./value-tree.ts";
import type { ViewOp } from "./views.ts";
import { conditionOp } from "./where-ops.ts";
import type { Condition, CustomOp, WhereOp } from "./where-ops.ts";
import { setOwn } from "@engine/utils/own-property";

/** An op as evaluation accepts it: authored (live refs, symbols) or IR (names). */
export type EvaluableOp = ViewOp | ViewOpIR;

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
): Promise<unknown[]> {
  const shape = viewShapeOf(view);
  const filled = bindInputMapping(frame, input);
  const seed: Frame = {};
  for (const name of shape.ins) {
    if (Object.hasOwn(filled, name)) setOwn(seed, name, filled[name]);
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
    for (const out of shape.outs) setOwn(row, out, survivor[out]);
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
          if (Object.hasOwn(frame, variable) && frame[variable] !== values[index]) unifies = false;
          else setOwn(next, variable, values[index]);
        });
        if (unifies) result.push(next);
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
): Promise<Frames> {
  let current = frames;
  for (const op of ops) {
    current = await applyOp(current, op, env);
    if (current.length === 0) break;
  }
  return current;
}

/** Evaluate a where-op list over the working set, one op at a time. */
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
