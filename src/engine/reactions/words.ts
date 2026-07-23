import { brandWhereOp, conditionOp, isCondition } from "../reads/where-ops.ts";
import type { AnyWhereOp, EarlierOp } from "../reads/where-ops.ts";
import { isCountOp } from "../reads/views.ts";
import { assertReactionNodes } from "./nodes.ts";
import { siblingTree } from "./partitions.ts";
import { isChannelPattern } from "./channels.ts";
import { isActionRef } from "./refs.ts";
import { flow } from "./matching.ts";
import type {
  ActionPattern,
  ChannelPattern,
  InstrumentedAction,
  Mapping,
  StepNode,
  ThenNode,
  TriggerPattern,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhenBuilderWithFunctionWhere,
  WhereFn,
} from "./types.ts";

/** Normalize one action and its patterns into the occurrence data the engine matches. */
export function actionPattern(
  action: InstrumentedAction,
  input: Mapping,
  output?: Mapping,
): ActionPattern {
  const concept = action.concept;
  if (concept === undefined) {
    if (isActionRef(action)) {
      return { concept: action, action, input, flow, ...(output ? { output } : {}) };
    }
    throw new Error(`Action ${action.name} is not instrumented.`);
  }
  return { concept, action, input, flow, ...(output ? { output } : {}) };
}

/** Read matching occurrences strictly before a trigger in its causal flow. */
export function earlier(action: InstrumentedAction, input: Mapping, output?: Mapping): EarlierOp {
  return brandWhereOp({
    op: "earlier",
    pattern: actionPattern(action, input, output ?? {}),
  }) as EarlierOp;
}

function normalizeWhere(
  args: unknown[],
  site: string,
): { fn?: WhereFn; ops?: readonly AnyWhereOp[] } {
  if (args.length === 1 && typeof args[0] === "function" && !isCondition(args[0])) {
    return { fn: args[0] as WhereFn };
  }
  if (args.some(isCountOp)) {
    throw new Error(
      `${site}(...): count(...) cannot be used in a reaction condition. ` +
        "To return a row count, use each(line).count() in a former. " +
        "To test a count as policy, define a view and read that view.",
    );
  }
  if (args.length === 0) {
    throw new Error(`${site}(...) states at least one condition line.`);
  }
  return { ops: args.map((arg) => conditionOp(arg as Parameters<typeof conditionOp>[0], site)) };
}

export function when(channel: ChannelPattern): WhenBuilder;
export function when(line: StepNode): WhenBuilder;
export function when(line: StepNode | ChannelPattern): WhenBuilder {
  if (isChannelPattern(line)) return createWhenBuilderFromPatterns([line]);
  if (typeof line !== "object" || line === null || line.kind !== "step") {
    throw new Error("when(...) takes one callable action line or posture channel.");
  }
  const pattern = { ...line.action };
  pattern.posture = line.linePosture ?? "requested";
  pattern.output ??= {};
  return createWhenBuilderFromPatterns([pattern]);
}

function createWhenBuilderFromPatterns(patterns: TriggerPattern[]): WhenBuilder {
  return {
    where(...args: unknown[]) {
      const normalized = normalizeWhere(args, "when(...).where");
      if (normalized.fn !== undefined) {
        const functional: WhenBuilderWithFunctionWhere = {
          then(...nodes: ThenNode[]) {
            assertReactionNodes(nodes);
            return siblingTree(patterns, { where: normalized.fn }, nodes);
          },
        } as WhenBuilderWithFunctionWhere;
        return functional;
      }
      return declarativeWhenBuilder(patterns, normalized.ops ?? []);
    },
    then(...nodes: ThenNode[]) {
      assertReactionNodes(nodes);
      return siblingTree(patterns, {}, nodes);
    },
  } as WhenBuilder;
}

function declarativeWhenBuilder(
  patterns: TriggerPattern[],
  whereOps: readonly AnyWhereOp[],
): WhenBuilderWithWhere {
  return {
    then(...nodes: ThenNode[]) {
      assertReactionNodes(nodes);
      return siblingTree(patterns, { whereOps }, nodes);
    },
  } as WhenBuilderWithWhere;
}
