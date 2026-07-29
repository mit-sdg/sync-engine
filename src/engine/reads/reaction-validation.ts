import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import type { ReactionDeclaration, StepNode } from "@engine/reactions/types";
import { isFusedFormer } from "./former-nodes.ts";
import { isMatcher, isPlainMapping } from "./matchers.ts";
import { walkValueTree } from "./value-tree.ts";
import { operationFootprint } from "./operation-footprint.ts";

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
  for (const op of ops) {
    countSymbols(operationFootprint(op, "authored").mentions, counts);
  }
  for (const node of decl.then) {
    countSymbols(node.action.input, counts);
    countSymbols(node.action.output, counts);
    for (const op of node.transformOps ?? []) {
      countSymbols(operationFootprint(op, "authored").mentions, counts);
    }
  }
  for (const variable of extraUses.get(decl) ?? []) {
    counts.set(variable, (counts.get(variable) ?? 0) + 1);
  }
  for (const op of ops) {
    if (op.op !== "find" && op.op !== "whether") continue;
    for (const variable of new Set(operationFootprint(op, "authored").produces)) {
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
  if (value === undefined) {
    throw new Error(
      `Reaction "${reactionName}": then input "${key}" for ${action} is literal undefined — ` +
        "portable patterns cannot represent undefined; omit the key instead.",
    );
  }
  if (["boolean", "number", "string", "bigint"].includes(typeof value)) return;
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
