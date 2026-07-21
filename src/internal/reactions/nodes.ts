import { actions } from "./words.ts";
import type { BranchChain, InstrumentedAction, Mapping, StepNode, ThenNode } from "./types.ts";
import type { WhereOp } from "../reads/where-ops.ts";

const NodeBrand: unique symbol = Symbol("NodeBrand");

export function brandReactionNode<T extends object>(node: T): T {
  Object.defineProperty(node, NodeBrand, { value: true, enumerable: false });
  return node;
}

function isReactionNode(value: unknown): value is ThenNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[NodeBrand] === true
  );
}

function stepWith(
  action: InstrumentedAction,
  input: Mapping,
  linePosture: "requested" | "returned" | "refused" = "requested",
  output?: Mapping,
): StepNode {
  const node = {
    kind: "step" as const,
    action: actions([action, input, output])[0],
    linePosture,
  } as unknown as StepNode;
  node.responds = (pattern: Mapping = {}) => stepWith(action, input, "returned", pattern);
  node.refuses = (pattern: Mapping = {}) => stepWith(action, input, "refused", pattern);
  node.named = (name: string) => {
    node.branchLabel = name;
    return node;
  };
  return brandReactionNode(node);
}

/** Build the callable data line represented by one vocabulary action ref. */
export function actionLine(action: InstrumentedAction, input: Mapping): StepNode {
  return stepWith(action, input);
}

/** Qualify and privately chain one sibling branch. */
export function branchChain(whereOps: readonly WhereOp[], first: StepNode): BranchChain {
  const steps: StepNode[] = [first];
  const branch = {
    kind: "branch" as const,
    whereOps,
    steps,
    then(...nodes: StepNode[]) {
      if (
        nodes.length === 0 ||
        nodes.some((node) => !isReactionNode(node) || node.kind !== "step")
      ) {
        throw new Error("a branch-local then(...) takes callable action lines.");
      }
      steps.push(...nodes);
      return branch;
    },
    named(name: string) {
      Object.defineProperty(branch, "branchLabel", { value: name, configurable: true });
      return branch;
    },
  } as unknown as BranchChain;
  return brandReactionNode(branch);
}

export function assertReactionNodes(nodes: readonly ThenNode[]): void {
  if (nodes.length === 0) throw new Error(".then(...) requires at least one callable action line.");
  for (const node of nodes) {
    if (!isReactionNode(node)) {
      throw new Error(
        "a reaction is not a promise — pass callable action lines to .then() (did you `await` a when(...) chain?).",
      );
    }
  }
}
