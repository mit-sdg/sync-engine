import { actionNameOf, conceptNameOf } from "../reactions/introspect.ts";
import type { ReactionDeclaration, StepNode } from "../reactions/types.ts";
import { isFusedFormer } from "./former-nodes.ts";
import { isMatcher, isPlainMapping } from "./matchers.ts";
import { walkValueTree } from "./value-tree.ts";
import type { AnyWhereOp } from "./where-ops.ts";

const extraUses = new WeakMap<ReactionDeclaration, readonly symbol[]>();

export function setReactionLintExtraUses(
  declaration: ReactionDeclaration,
  uses: readonly symbol[],
): ReactionDeclaration {
  extraUses.set(declaration, uses);
  return declaration;
}

export function copyReactionLintExtraUses(
  source: ReactionDeclaration,
  target: ReactionDeclaration,
): void {
  const uses = extraUses.get(source);
  if (uses !== undefined) extraUses.set(target, uses);
}

function countSymbols(value: unknown, counts: Map<symbol, number>): void {
  walkValueTree(value, (node) => {
    if (typeof node === "symbol") counts.set(node, (counts.get(node) ?? 0) + 1);
  });
}

function countOpSymbols(op: AnyWhereOp, counts: Map<symbol, number>): void {
  switch (op.op) {
    case "find":
    case "whether":
      countSymbols(op.in, counts);
      countSymbols(op.out, counts);
      if ("not" in op) countSymbols(op.not, counts);
      return;
    case "no":
      countSymbols(op.in, counts);
      countSymbols(op.out, counts);
      return;
    case "holds":
      countSymbols(op.fused.in, counts);
      return;
    case "compute":
      countSymbols(op.in, counts);
      countSymbols([op.out], counts);
      return;
    case "custom":
      countSymbols([...op.in, ...op.out], counts);
      return;
    case "earlier":
      countSymbols(op.pattern.input, counts);
      countSymbols(op.pattern.output, counts);
      return;
  }
}

function outputVars(op: AnyWhereOp): symbol[] {
  if (op.op !== "find" && op.op !== "whether") return [];
  const vars = new Set<symbol>();
  walkValueTree(op.out, (value) => {
    if (typeof value === "symbol") vars.add(value);
  });
  return [...vars];
}

export function lintReactionOpens(name: string, decl: ReactionDeclaration): void {
  const ops = [...(decl.whereOps ?? []), ...decl.then.flatMap((node) => node.whereOps ?? [])];
  if (ops.length === 0) return;
  const counts = new Map<symbol, number>();
  for (const clause of decl.when) {
    if ("channel" in clause) countSymbols(clause.pattern, counts);
    else {
      countSymbols(clause.input, counts);
      countSymbols(clause.output, counts);
    }
  }
  for (const op of ops) countOpSymbols(op, counts);
  for (const node of decl.then) {
    countSymbols(node.action.input, counts);
    countSymbols(node.action.output, counts);
    for (const op of node.transformOps ?? []) countOpSymbols(op, counts);
  }
  for (const variable of extraUses.get(decl) ?? []) {
    counts.set(variable, (counts.get(variable) ?? 0) + 1);
  }
  for (const op of ops) {
    for (const variable of outputVars(op)) {
      if ((counts.get(variable) ?? 0) <= 1) {
        throw new Error(
          `Reaction "${name}": "${String(variable.description ?? variable.toString())}" is opened and never used — omit the key instead.`,
        );
      }
    }
  }
}

function describeValue(value: unknown): string {
  if (typeof value === "function") return "a function";
  if (value instanceof RegExp) return "a RegExp";
  if (isMatcher(value)) return `a matcher (${value.label})`;
  if (value instanceof Date) return "a Date";
  if (value !== null && typeof value === "object")
    return `a ${value.constructor?.name ?? "non-plain"} instance`;
  return typeof value;
}

function assertDataValue(reactionName: string, action: string, key: string, value: unknown): void {
  if (value === null || typeof value === "symbol") return;
  if (["boolean", "number", "string", "bigint", "undefined"].includes(typeof value)) return;
  if (isFusedFormer(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertDataValue(reactionName, action, key, item);
    return;
  }
  if (isPlainMapping(value)) {
    for (const [childKey, child] of Object.entries(value)) {
      assertDataValue(reactionName, action, `${key}.${childKey}`, child);
    }
    return;
  }
  throw new Error(
    `Reaction "${reactionName}": then input "${key}" for ${action} is ${describeValue(value)} — a ` +
      "registration-time value that would be frozen into every future firing. Then inputs are " +
      "literals or variables; compute a per-firing value with a vocabulary computation or custom op.",
  );
}

export function assertThenInputsAreData(reactionName: string, then: StepNode[]): void {
  for (const step of then) {
    const action = `${conceptNameOf(step.action.concept)}.${actionNameOf(step.action.action)}`;
    for (const [key, value] of Object.entries(step.action.input)) {
      assertDataValue(reactionName, action, key, value);
    }
  }
}
