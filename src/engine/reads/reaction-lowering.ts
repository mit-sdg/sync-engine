/** Lower fluent reaction declarations into one-consequence reaction IR entries. */

import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import type {
  ActionPattern,
  ReactionDeclaration,
  StepNode,
  ThenNode,
  TriggerPattern,
  WhereFn,
} from "@engine/reactions/types";
import { withLive } from "./ir.ts";
import type { ConsequenceIR, ReactionIR, UnloweredIR, WhereOpIR } from "./ir.ts";
import {
  encodePattern,
  encodeTrigger,
  encodeWhereOp,
  PatternVariables,
  patternVariables,
} from "./pattern-encoding.ts";
import type { AnyWhereOp } from "./where-ops.ts";

export type LoweredWhereOp = AnyWhereOp;

/** One lowered reaction with live references, ready to compile. */
export interface LoweredReaction {
  name: string;
  when: TriggerPattern[];
  whereOps?: LoweredWhereOp[];
  whereFn?: WhereFn;
  step: StepNode;
}

export interface LowerOutcome {
  reactions?: LoweredReaction[];
  reason?: string;
}

function opOutVars(op: AnyWhereOp): symbol[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [...patternVariables(op.out)];
    case "no":
      return [];
    case "compute":
      return [op.out];
    case "custom":
      return [...op.out];
    case "holds":
      return [];
    case "earlier":
      return [...patternVariables(op.pattern.input, op.pattern.output)];
  }
}

function opInVars(op: AnyWhereOp): symbol[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [...patternVariables(op.in, "not" in op ? op.not : undefined)];
    case "no":
      return [...patternVariables(op.in, op.out)];
    case "compute":
      return [...patternVariables(op.in)];
    case "holds":
      return [...patternVariables(op.fused.in)];
    case "custom":
      return [...op.in];
    case "earlier":
      return [];
  }
}

function intersects(a: Set<symbol>, b: Iterable<symbol>): boolean {
  for (const item of b) if (a.has(item)) return true;
  return false;
}

function isPlainStep(node: ThenNode): node is StepNode {
  return node.kind === "step" && node.transform === undefined;
}

function returnedTrigger(step: StepNode, by: string): ActionPattern {
  return {
    ...step.action,
    output: step.action.output ?? {},
    posture: step.linePosture === "refused" ? "refused" : "returned",
    by,
  };
}

function triggerVars(pattern: TriggerPattern): Set<symbol> {
  if ("channel" in pattern) return patternVariables(pattern.pattern);
  return patternVariables(pattern.input, pattern.output);
}

function lowerChainStep(
  decl: ReactionDeclaration,
  chain: StepNode[],
  i: number,
  names: string[],
): { reaction?: LoweredReaction; reason?: string } {
  const step = chain[i];
  const trigger = returnedTrigger(chain[i - 1], names[i - 1]);
  const available = patternVariables(trigger.input, trigger.output);
  const needed = patternVariables(step.action.input);
  const ops: LoweredWhereOp[] = [...(step.whereOps ?? [])];
  const pendingStepOps = [...ops];
  const initialWhereOps = [...(decl.whereOps ?? []), ...(chain[0].whereOps ?? [])];

  const stillMissing = (): Set<symbol> =>
    new Set([...needed].filter((variable) => !available.has(variable)));
  const settleStepOps = (): void => {
    let settled = true;
    while (settled) {
      settled = false;
      for (let j = 0; j < pendingStepOps.length; j++) {
        const op = pendingStepOps[j];
        if (!opInVars(op).every((variable) => available.has(variable))) continue;
        for (const variable of opOutVars(op)) available.add(variable);
        pendingStepOps.splice(j, 1);
        j--;
        settled = true;
      }
    }
  };
  const bindingsNeededNow = (): Set<symbol> => {
    const missing = stillMissing();
    for (const op of pendingStepOps) {
      for (const variable of opInVars(op)) {
        if (!available.has(variable)) missing.add(variable);
      }
    }
    return missing;
  };

  settleStepOps();

  const sources: Array<TriggerPattern | ActionPattern> = [
    ...chain.slice(0, i - 1).map((prior, j) => returnedTrigger(prior, names[j])),
    ...decl.when,
  ];
  for (const source of sources) {
    const sourceVars =
      "channel" in source ? triggerVars(source) : patternVariables(source.input, source.output);
    if (!intersects(sourceVars, bindingsNeededNow())) continue;
    if ("channel" in source) {
      return { reason: `step ${i + 1} needs a binding from a channel trigger` };
    }
    ops.push({ op: "earlier", pattern: { ...source, output: source.output ?? {} } });
    for (const variable of sourceVars) available.add(variable);
    settleStepOps();
  }

  if (stillMissing().size > 0) {
    if (initialWhereOps.length === 0) {
      if (decl.where !== undefined) {
        return { reason: `step ${i + 1} needs a value bound by a closure where` };
      }
      const missing = [...stillMissing()]
        .map((variable) => `"${String(variable.description ?? variable.toString())}"`)
        .sort()
        .join(", ");
      return { reason: `stage ${i + 1} uses ${missing} before it is bound` };
    }
    for (const op of initialWhereOps) {
      const outs = opOutVars(op);
      if (!intersects(stillMissing(), outs)) continue;
      if (op.op === "find" || op.op === "whether" || op.op === "earlier") {
        return {
          reason: `step ${i + 1} needs rows from a state read, which would re-run at a later position`,
        };
      }
      if (!opInVars(op).every((variable) => available.has(variable))) {
        return {
          reason: `step ${i + 1} needs a computation whose inputs do not travel on a record`,
        };
      }
      ops.push(op);
      for (const variable of outs) available.add(variable);
    }
    if (stillMissing().size > 0) {
      const missing = [...stillMissing()]
        .map((variable) => `"${String(variable.description ?? variable.toString())}"`)
        .sort()
        .join(", ");
      return { reason: `stage ${i + 1} uses ${missing} before it is bound` };
    }
  }

  return {
    reaction: {
      name: names[i],
      when: [trigger],
      ...(ops.length > 0 ? { whereOps: ops } : {}),
      step,
    },
  };
}

/** Lower one registered reaction into reaction IR, or report why it remains a pipeline. */
export function lowerReaction(name: string, decl: ReactionDeclaration): LowerOutcome {
  if (!decl.then.every(isPlainStep)) return { reason: "a step transform in the pipeline" };
  const chain = decl.then as StepNode[];
  const labels: string[] = [];
  const names = chain.map((step, i) => {
    labels.push(...(step.pathLabels ?? []));
    const pathName = labels.length === 0 ? name : `${name}:${labels.join(":")}`;
    return step.stepName ?? (i === 0 ? pathName : `${pathName}#${i + 1}`);
  });

  const reactions: LoweredReaction[] = [
    {
      name: names[0],
      when: decl.when,
      ...(decl.whereOps !== undefined || chain[0].whereOps !== undefined
        ? { whereOps: [...(decl.whereOps ?? []), ...(chain[0].whereOps ?? [])] }
        : decl.where !== undefined
          ? { whereFn: decl.where }
          : {}),
      step: chain[0],
    },
  ];

  for (let i = 1; i < chain.length; i++) {
    const lowered = lowerChainStep(decl, chain, i, names);
    if (lowered.reaction === undefined) return { reason: lowered.reason };
    reactions.push(lowered.reaction);
  }
  return { reactions };
}

function encodeConsequence(step: StepNode, vars: PatternVariables): ConsequenceIR {
  return {
    kind: "request",
    concept: conceptNameOf(step.action.concept),
    action: actionNameOf(step.action.action),
    input: encodePattern(step.action.input, vars),
  };
}

/** Serialize one lowered reaction to JSON-safe IR. */
export function serializeReaction(reaction: LoweredReaction): ReactionIR {
  const vars = new PatternVariables();
  const when = reaction.when.map((clause) => encodeTrigger(clause, vars));
  const where: WhereOpIR[] =
    reaction.whereFn !== undefined
      ? [{ op: "custom", fnRef: "<where closure>", opaque: true, in: [], out: [] }]
      : (reaction.whereOps ?? []).map((op) => encodeWhereOp(op, vars));
  const ir: ReactionIR = {
    name: reaction.name,
    when,
    where,
    then: [encodeConsequence(reaction.step, vars)],
  };
  if (reaction.whereFn !== undefined) withLive(ir, reaction.whereFn);
  return ir;
}

/** Keep every inspectable dependency fact from a reaction whose whole pipeline stays local. */
export function serializeUnloweredReaction(
  name: string,
  reason: string,
  declaration: ReactionDeclaration,
): UnloweredIR {
  const vars = new PatternVariables();
  const when = declaration.when.map((clause) => encodeTrigger(clause, vars));
  const where: WhereOpIR[] = (declaration.whereOps ?? []).map((op) => encodeWhereOp(op, vars));
  const then: ConsequenceIR[] = [];
  const patterns = [];
  for (const step of declaration.then) {
    for (const op of step.whereOps ?? []) where.push(encodeWhereOp(op, vars));
    then.push(encodeConsequence(step, vars));
    if (step.action.output !== undefined) patterns.push(encodePattern(step.action.output, vars));
    for (const op of step.transformOps ?? []) where.push(encodeWhereOp(op, vars));
  }
  return { name, reason, known: { when, where, then, patterns } };
}
