import { applyWhereOps, brandWhereOp, conditionOp, isCondition } from "../reads/where-ops.ts";
import type { AnyWhereOp, EarlierOp, WhereOp } from "../reads/where-ops.ts";
import { isCountOp } from "../reads/views.ts";
import { assertReactionNodes, brandReactionNode } from "./nodes.ts";
import { partition } from "./partitions.ts";
import { isChannelPattern } from "./channels.ts";
import { isActionRef } from "./refs.ts";
import { flow } from "./matching.ts";
import type {
  ActionList,
  ActionPattern,
  ChannelPattern,
  ChannelPosture,
  InstrumentedAction,
  Mapping,
  ReactionCase,
  RequestChain,
  StepNode,
  TriggerPattern,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhenBuilderWithFunctionWhere,
  WhenClause,
  WhereFn,
} from "./types.ts";

/** Normalize clauses shared by when, request, and earlier into action patterns. */
export function actions(...clauses: ActionList[]): ActionPattern[] {
  return clauses.map(([action, input, output]) => {
    const concept = action.concept;
    if (concept === undefined) {
      if (isActionRef(action)) {
        return { concept: action, action, input, flow, ...(output ? { output } : {}) };
      }
      throw new Error(`Action ${action.name} is not instrumented.`);
    }
    return { concept, action, input, flow, ...(output ? { output } : {}) };
  });
}

/** Read matching occurrences strictly before a trigger in its causal flow. */
export function earlier(action: InstrumentedAction, input: Mapping, output?: Mapping): EarlierOp {
  return brandWhereOp({
    op: "earlier" as const,
    pattern: actions([action, input, output ?? {}])[0],
  });
}

export interface WhenOptions {
  by?: string;
  posture?: ChannelPosture;
}

export function when(clauses: Array<WhenClause | ChannelPattern>): WhenBuilder;
export function when(channel: ChannelPattern): WhenBuilder;
export function when(
  action: InstrumentedAction,
  input: Mapping,
  output?: Mapping,
  options?: WhenOptions,
): WhenBuilder;
export function when(
  actionOrClauses: InstrumentedAction | ChannelPattern | Array<WhenClause | ChannelPattern>,
  input?: Mapping,
  output?: Mapping,
  options?: WhenOptions,
): WhenBuilder {
  if (Array.isArray(actionOrClauses)) {
    if (actionOrClauses.length === 0) throw new Error("when([...]) requires at least one clause.");
    return createWhenBuilder(...actionOrClauses);
  }
  if (isChannelPattern(actionOrClauses)) return createWhenBuilder(actionOrClauses);
  if (input === undefined) throw new Error("when(action, input) requires an input pattern.");
  const pattern = actions([actionOrClauses, input, output ?? {}])[0];
  if (options?.by !== undefined) pattern.by = options.by;
  if (options?.posture !== undefined) pattern.posture = options.posture;
  return createWhenBuilderFromPatterns([pattern]);
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

function createWhenBuilder(...clauses: Array<WhenClause | ChannelPattern>): WhenBuilder {
  const patterns: TriggerPattern[] = clauses.map((clause) => {
    if (isChannelPattern(clause)) return clause;
    const [action, input, output] = clause;
    return actions([action, input, output ?? {}])[0];
  });
  return createWhenBuilderFromPatterns(patterns);
}

function createWhenBuilderFromPatterns(patterns: TriggerPattern[]): WhenBuilder {
  const builder = {
    where(...args: unknown[]) {
      const normalized = normalizeWhere(args, "when(...).where");
      if (normalized.fn !== undefined) {
        const functional: WhenBuilderWithFunctionWhere = {
          then(...nodes) {
            assertReactionNodes(nodes);
            return { when: patterns, where: normalized.fn, then: nodes };
          },
        };
        return functional;
      }
      return declarativeWhenBuilder(patterns, normalized.ops ?? []);
    },
    then(...nodes) {
      assertReactionNodes(nodes);
      return { when: patterns, then: nodes };
    },
    either: (...cases: ReactionCase[]) => partition(patterns, [], cases),
  } as WhenBuilder;
  return builder;
}

function declarativeWhenBuilder(
  patterns: TriggerPattern[],
  whereOps: readonly AnyWhereOp[],
): WhenBuilderWithWhere {
  return {
    then(...nodes) {
      assertReactionNodes(nodes);
      return { when: patterns, whereOps, then: nodes };
    },
    either: (...cases) => partition(patterns, whereOps, cases),
  };
}

/** Construct one action request in a reaction consequence chain. */
export function request(
  action: InstrumentedAction,
  input: Mapping,
  output?: Mapping,
): RequestChain {
  const node: StepNode = { kind: "step", action: actions([action, input, output])[0] };
  const chain = brandReactionNode(node) as unknown as RequestChain;
  chain.where = (...args: unknown[]) => {
    const normalized = normalizeWhere(args, "request(...).where");
    if (normalized.ops !== undefined) {
      if (normalized.ops.some((op) => op.op === "earlier")) {
        throw new Error(
          "request(...).where takes state/computation ops only — an earlier read belongs to the reaction's own where.",
        );
      }
      const ops = normalized.ops as readonly WhereOp[];
      node.transformOps = ops;
      node.transform = (frames) => applyWhereOps(frames, ops);
    } else {
      node.transform = normalized.fn;
    }
    return chain;
  };
  chain.named = (name) => {
    node.stepName = name;
    return chain;
  };
  return chain;
}
