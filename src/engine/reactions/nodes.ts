import { actionPattern } from "./words.ts";
import type {
  BranchChain,
  InstrumentedAction,
  Mapping,
  NamedBranchChain,
  StepNode,
  ThenNode,
  UnnamedStepNode,
} from "./types.ts";
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
    action: actionPattern(action, input, output),
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
export function branchChain(whereOps: readonly WhereOp[], first: UnnamedStepNode): BranchChain {
  if (first.branchLabel !== undefined) {
    throw new Error(
      "name the qualified branch after its local action chain, not an action inside it.",
    );
  }
  const steps: StepNode[] = [first];
  const branch = {
    kind: "branch" as const,
    whereOps,
    steps,
    then(...nodes: StepNode[]) {
      if (nodes.length !== 1) {
        throw new Error("a branch-local then(...) takes one callable action line.");
      }
      const [node] = nodes;
      if (!isReactionNode(node) || node.kind !== "step") {
        throw new Error("a branch-local then(...) takes one callable action line.");
      }
      if (node.branchLabel !== undefined) {
        throw new Error(
          "name the qualified branch after its local action chain, not an action inside it.",
        );
      }
      steps.push(node);
      return branch;
    },
    named(name: string) {
      const terminal = {
        kind: "branch" as const,
        whereOps,
        steps,
        branchLabel: name,
        named(next: string) {
          return branch.named(next);
        },
      } as unknown as NamedBranchChain;
      return brandReactionNode(terminal);
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
