/** Evaluate a fused former into its shaped tree, at the moment of asking. */

import { Frames, readPatternValue } from "./frames.ts";
import { applyWhereOps } from "./where-ops.ts";
import { varNamesInPattern } from "./former-analysis.ts";
import { FormerFault } from "./former-nodes.ts";
import type { FormerRef, FusedFormer } from "./former-nodes.ts";
import { liveOf } from "./ir.ts";
import type { ArrangedIR, FormerNodeIR, PatternIR, SpliceIR } from "./ir.ts";
import type { ReadEnv } from "./env.ts";
import type { Frame, Mapping } from "../reactions/types.ts";

/** One selection's shared shape: source line and refinements. */
type SelectionIR = Extract<FormerNodeIR, { from: object }>;

/** Whether an input pattern reads through an unbound variable — absence propagates. */
function inputUnbound(input: PatternIR, frame: Frame): boolean {
  return varNamesInPattern(input).some((name) => !(name in frame));
}

/** The selection's surviving row-frames, in order: rows unified, conditions applied. */
async function selectFrames(
  formerName: string,
  selection: SelectionIR,
  frame: Frame,
  env: ReadEnv,
): Promise<Frames> {
  if (inputUnbound(selection.from.in, frame)) return new Frames();
  const expanded = await applyWhereOps(new Frames(frame), [selection.from], env);
  const where = selection.where ?? [];
  if (where.length === 0) return expanded;
  return applyWhereOps(expanded, where, env);
}

function compareValues(left: unknown, right: unknown): number {
  if ((left as number) < (right as number)) return -1;
  if ((left as number) > (right as number)) return 1;
  return 0;
}

function arrange(frames: Frames, ordering: ArrangedIR | undefined): Frame[] {
  const list = [...frames];
  if (ordering === undefined) return list;
  if (!("by" in ordering)) return ordering.order === "newest" ? list.reverse() : list;
  const direction = ordering.order === "descending" ? -1 : 1;
  const by = ordering.by;
  return list
    .map((frame, index) => ({ frame, index }))
    .sort((a, b) => direction * compareValues(a.frame[by], b.frame[by]) || a.index - b.index)
    .map((entry) => entry.frame);
}

/** A plain absent read drops its host row. */
const DROP_ROW: unique symbol = Symbol("DROP_ROW");
const ABSENT: unique symbol = Symbol("ABSENT");

/** The fragment a splice names: its definition-site ref, or the registered one. */
function fragmentOf(use: SpliceIR, hostName: string, env: ReadEnv): FormerRef {
  return (liveOf(use) as FormerRef | undefined) ?? env.formerByName(use.fragment, hostName);
}

/**
 * Evaluate one flat former contribution against the host's scope. Anchors
 * resolve from the host's bindings; a plain use drops the host when absent,
 * while `whether` contributes blank leaves. The keys come back flat.
 */
async function evalSplice(
  use: SpliceIR,
  hostName: string,
  hostScope: Frame,
  env: ReadEnv,
): Promise<Record<string, unknown> | typeof DROP_ROW> {
  const fragment = fragmentOf(use, hostName, env);
  const input = resolveInput(use.in, hostScope);
  if (input === ABSENT) {
    return use.whether ? (blankNode(fragment.body) as Record<string, unknown>) : DROP_ROW;
  }
  const result = await evaluateFormer(fragment, input, env);
  if (result === ABSENT) {
    return use.whether ? (blankNode(fragment.body) as Record<string, unknown>) : DROP_ROW;
  }
  return result !== null && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
}

function resolveInput(input: PatternIR, frame: Frame): Mapping | typeof ABSENT {
  const resolved: Mapping = {};
  for (const [key, pattern] of Object.entries(input)) {
    const read = readPatternValue(pattern, frame);
    if (read.isVariable && !read.bound) return ABSENT;
    resolved[key] = read.value;
  }
  return resolved;
}

function formerOf(node: Extract<FormerNodeIR, { node: "former" }>, host: string, env: ReadEnv) {
  return (liveOf(node) as FormerRef | undefined) ?? env.formerByName(node.former, host);
}

function blankNode(node: FormerNodeIR): unknown {
  switch (node.node) {
    case "leaf":
    case "first":
    case "former":
      return null;
    case "each":
    case "distinct":
      return [];
    case "count":
      return 0;
    case "record":
      return Object.fromEntries(
        Object.entries(node.entries).map(([key, child]) => [key, blankNode(child)]),
      );
  }
}

async function evaluateFormer(
  ref: FormerRef,
  input: Mapping,
  env: ReadEnv,
): Promise<unknown | typeof ABSENT> {
  const frame: Frame = {};
  for (const slot of ref.slots) frame[slot] = input[slot];
  const result = await evalNode(ref.formerName, ref.body, frame, env);
  if (result !== DROP_ROW) return result;
  if (ref.promise === "optional") return ABSENT;
  throw new FormerFault(
    "FORMER_NONE",
    `Former "${ref.formerName}" promises one result and its body answered none.`,
  );
}

async function evalNode(
  formerName: string,
  node: FormerNodeIR,
  frame: Frame,
  env: ReadEnv,
): Promise<unknown> {
  switch (node.node) {
    case "leaf": {
      const value = node.var in frame ? frame[node.var] : null;
      return value === undefined ? null : value;
    }
    case "record": {
      const matches = await applyWhereOps(new Frames(frame), node.where ?? [], env);
      if (matches.length === 0) return DROP_ROW;
      if (matches.length > 1) {
        throw new FormerFault(
          "FORMER_MANY",
          `Former "${formerName}" promises one record and its body answered ${matches.length}.`,
        );
      }
      const scope = matches[0];
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node.entries)) {
        const value = await evalNode(formerName, child, scope, env);
        if (value === DROP_ROW) return DROP_ROW;
        result[key] = value;
      }
      for (const use of node.splices ?? []) {
        const sub = await evalSplice(use, formerName, scope, env);
        if (sub === DROP_ROW) return DROP_ROW;
        Object.assign(result, sub);
      }
      return result;
    }
    case "former": {
      const ref = formerOf(node, formerName, env);
      const input = resolveInput(node.in, frame);
      if (input === ABSENT) return node.whether ? blankNode(ref.body) : DROP_ROW;
      const result = await evaluateFormer(ref, input, env);
      if (result === ABSENT) return node.whether ? blankNode(ref.body) : DROP_ROW;
      return result;
    }
    case "each": {
      const selected = arrange(await selectFrames(formerName, node, frame, env), node.arranged);
      const items: unknown[] = [];
      for (const rowFrame of selected) {
        const item = await evalNode(formerName, node.as, rowFrame, env);
        if (item === DROP_ROW) continue;
        items.push(item);
      }
      return items;
    }
    case "count":
      return (await selectFrames(formerName, node, frame, env)).length;
    case "first": {
      const selected = arrange(await selectFrames(formerName, node, frame, env), node.arranged);
      if (selected.length === 0) return null;
      const value = selected[0][node.value];
      return value === undefined ? null : value;
    }
    case "distinct": {
      const selected = await selectFrames(formerName, node, frame, env);
      const seen = new Set<unknown>();
      const values: unknown[] = [];
      for (const rowFrame of selected) {
        const value = rowFrame[node.value];
        if (value === undefined || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
      return values;
    }
  }
}

/**
 * Evaluate a fused former into its tree, at the moment of asking, resolving
 * its names through the engine's read environment. Slot values must be
 * concrete (a then input's symbols are resolved per firing before the
 * engine evaluates). A violated former promise throws {@link FormerFault}.
 * When forming a consequence input, the engine records that fault on the ask.
 */
export async function formTree(fused: FusedFormer, env: ReadEnv): Promise<unknown> {
  for (const slot of fused.former.slots) {
    if (typeof fused.in[slot] === "symbol") {
      throw new Error(
        `Former "${fused.former.formerName}": slot "${slot}" is an unresolved variable — ` +
          "formTree evaluates concrete slot values.",
      );
    }
  }
  const tree = await evaluateFormer(fused.former, fused.in, env);
  return tree === ABSENT ? null : tree;
}
