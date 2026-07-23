/**
 * Historical low-level authoring helpers retained only for engine regression
 * tests. Public package declarations and examples use callable action lines.
 */

import { applyWhereOps, conditionOp, isCondition } from "../../../src/engine/reads/where-ops.ts";
import type { AnyWhereOp, WhereOp } from "../../../src/engine/reads/where-ops.ts";
import { isCountOp } from "../../../src/engine/reads/views.ts";
import { actionLine, assertReactionNodes } from "../../../src/engine/reactions/nodes.ts";
import { siblingTree } from "../../../src/engine/reactions/partitions.ts";
import { isChannelPattern } from "../../../src/engine/reactions/channels.ts";
import { actionPattern } from "../../../src/engine/reactions/words.ts";
import type {
  ChannelPattern,
  InstrumentedAction,
  Mapping,
  StepNode,
  TriggerPattern,
  WhereFn,
} from "../../../src/engine/reactions/types.ts";

function normalizedWhere(args: unknown[], site: string): { fn?: WhereFn; ops?: AnyWhereOp[] } {
  if (args.length === 1 && typeof args[0] === "function" && !isCondition(args[0])) {
    return { fn: args[0] as WhereFn };
  }
  if (args.some(isCountOp)) throw new Error(`${site}(...): count(...) cannot be used here.`);
  return { ops: args.map((arg) => conditionOp(arg as never, site)) };
}

function builder(patterns: TriggerPattern[]): any {
  return {
    where(...args: unknown[]) {
      const normalized = normalizedWhere(args, "when(...).where");
      return {
        then(...nodes: StepNode[]) {
          assertReactionNodes(nodes);
          return siblingTree(
            patterns,
            normalized.fn === undefined
              ? { whereOps: normalized.ops ?? [] }
              : { where: normalized.fn },
            nodes,
          );
        },
      };
    },
    then(...nodes: StepNode[]) {
      assertReactionNodes(nodes);
      return siblingTree(patterns, {}, nodes);
    },
  };
}

export function when(
  value: unknown,
  input?: Mapping,
  output?: Mapping,
  options?: { by?: string; posture?: "returned" | "refused" | "faulted" },
): any {
  if (Array.isArray(value)) {
    return builder(
      value.map((clause) =>
        isChannelPattern(clause) ? clause : actionPattern(clause[0], clause[1], clause[2] ?? {}),
      ),
    );
  }
  if (isChannelPattern(value)) return builder([value as ChannelPattern]);
  if (typeof value === "object" && value !== null && (value as StepNode).kind === "step") {
    const line = value as StepNode;
    const pattern = { ...line.action };
    pattern.posture = line.linePosture ?? "requested";
    pattern.output ??= {};
    return builder([pattern]);
  }
  const pattern = actionPattern(value as InstrumentedAction, input ?? {}, output ?? {});
  if (options?.by !== undefined) pattern.by = options.by;
  if (options?.posture !== undefined) pattern.posture = options.posture;
  return builder([pattern]);
}

export function request(action: InstrumentedAction, input: Mapping, output?: Mapping): any {
  const chain =
    output === undefined ? actionLine(action, input) : actionLine(action, input).responds(output);
  chain.named = (name: string) => {
    chain.stepName = name;
    return chain;
  };
  (chain as any).where = (...args: unknown[]) => {
    const normalized = normalizedWhere(args, "request(...).where");
    if (normalized.ops !== undefined) {
      const ops = normalized.ops as WhereOp[];
      chain.transformOps = ops;
      chain.transform = (frames) => applyWhereOps(frames, ops);
    } else {
      chain.transform = normalized.fn;
    }
    return chain;
  };
  return chain;
}
