import { brandWhereOp } from "@engine/reads/where-ops";
import type { AnyWhereOp, Condition, EarlierOp, WhereOp } from "@engine/reads/where-ops";
import { isCountOp, where as viewWhere, type CountOp, type ViewBlock } from "@engine/reads/views";
import { normalizeWhere } from "./conditions.ts";
import { assertReactionNodes } from "./nodes.ts";
import { siblingTree } from "./partitions.ts";
import { isChannelPattern } from "./channels.ts";
import { actionPattern, branchChain } from "./nodes.ts";
import type {
  ActionTriggerPattern,
  BranchChain,
  UnnamedStepNode,
  ChannelPattern,
  DeferredWhenBuilder,
  InstrumentedAction,
  Mapping,
  StageOptions,
  StepNode,
  ThenNode,
  TriggerPattern,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhenBuilderWithFunctionWhere,
} from "../types.ts";

export { actionPattern } from "./nodes.ts";

/** Read matching occurrences strictly before a trigger in its causal flow. */
export function earlier(action: InstrumentedAction, input: Mapping, output?: Mapping): EarlierOp {
  return brandWhereOp({
    op: "earlier",
    pattern: { ...actionPattern(action, input, output ?? {}), output: output ?? {} },
  }) as EarlierOp;
}

export function when(channel: ChannelPattern): WhenBuilder;
export function when(line: StepNode): WhenBuilder;
export function when(line: StepNode | ChannelPattern): WhenBuilder {
  if (isChannelPattern(line)) return createWhenBuilderFromPatterns([line]);
  if (typeof line !== "object" || line === null || line.kind !== "step") {
    throw new Error("when(...) takes one callable action line or posture channel.");
  }
  const pattern: ActionTriggerPattern = {
    ...line.action,
    posture: line.linePosture ?? "requested",
    output: line.action.output ?? {},
  };
  return createWhenBuilderFromPatterns([pattern]);
}

function createWhenBuilderFromPatterns(
  patterns: TriggerPattern[],
  stage: StageOptions = {},
): WhenBuilder {
  const builder = {
    where(...args: unknown[]) {
      const normalized = normalizeWhere(args, "when(...).where");
      if (normalized.fn !== undefined) {
        const functional: WhenBuilderWithFunctionWhere = {
          then(...nodes: ThenNode[]) {
            assertReactionNodes(nodes);
            return siblingTree(patterns, { where: normalized.fn }, nodes, stage);
          },
        } as WhenBuilderWithFunctionWhere;
        return functional;
      }
      return declarativeWhenBuilder(patterns, normalized.ops ?? [], stage);
    },
    then(...nodes: ThenNode[]) {
      assertReactionNodes(nodes);
      return siblingTree(patterns, {}, nodes, stage);
    },
  } as WhenBuilder;
  if (stage.deferred !== true) {
    builder.afterFlowSettles = () =>
      createWhenBuilderFromPatterns(patterns, { deferred: true }) as DeferredWhenBuilder;
  }
  return builder;
}

function declarativeWhenBuilder(
  patterns: TriggerPattern[],
  whereOps: readonly AnyWhereOp[],
  stage: StageOptions,
): WhenBuilderWithWhere {
  return {
    then(...nodes: ThenNode[]) {
      assertReactionNodes(nodes);
      return siblingTree(patterns, { whereOps }, nodes, stage);
    },
  } as WhenBuilderWithWhere;
}

interface AuthoredWhereBlock extends ViewBlock {
  then(node: UnnamedStepNode): BranchChain;
}

/** State a read conjunction, optionally qualifying one reaction branch with it. */
export function where(...conditions: Array<Condition | CountOp>): AuthoredWhereBlock {
  const block = viewWhere(...conditions) as AuthoredWhereBlock;
  Object.defineProperty(block, "then", {
    value: (...nodes: UnnamedStepNode[]) => {
      if (nodes.length !== 1) {
        throw new Error("a branch-local then(...) takes one callable action line.");
      }
      if (block.some(isCountOp)) {
        throw new Error(
          "count(...) cannot be used in a reaction condition. " +
            "To return a row count, use each(line).count() in a former. " +
            "To test a count as policy, define a view and read that view.",
        );
      }
      return branchChain(block as WhereOp[], nodes[0]);
    },
  });
  return block;
}
