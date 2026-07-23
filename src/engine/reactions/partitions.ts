import { setReactionLintExtraUses } from "../reads/lower.ts";
import type { WhereOp } from "../reads/where-ops.ts";
import type {
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  StepNode,
  ThenNode,
  TriggerPattern,
} from "./types.ts";
import { ReactionPartitionBrand, hasBrand } from "../reads/brands.ts";
import { assertReactionNodes } from "./nodes.ts";

export function isReactionPartition(value: unknown): value is ReactionPartition {
  return hasBrand(value, ReactionPartitionBrand);
}

export function declarationsOf(result: ReactionResult): readonly ReactionDeclaration[] {
  return isReactionPartition(result) ? result.declarations : [result];
}

function cloneTrigger(pattern: TriggerPattern): TriggerPattern {
  if ("channel" in pattern) return { ...pattern, pattern: { ...pattern.pattern } };
  return {
    ...pattern,
    input: { ...pattern.input },
    ...(pattern.output !== undefined ? { output: { ...pattern.output } } : {}),
  };
}

function branchOf(node: ThenNode): {
  steps: StepNode[];
  whereOps: readonly WhereOp[];
  label?: string;
} {
  if (node.kind === "branch") {
    return {
      steps: [...node.steps],
      whereOps: node.whereOps,
      ...(node.branchLabel !== undefined ? { label: node.branchLabel } : {}),
    };
  }
  return {
    steps: [node],
    whereOps: [],
    ...(node.branchLabel !== undefined ? { label: node.branchLabel } : {}),
  };
}

function labeledBranches(nodes: readonly ThenNode[], stage: number) {
  assertReactionNodes(nodes);
  const branches = nodes.map(branchOf);
  if (branches.length > 1) {
    const labels = new Set<string>();
    for (const branch of branches) {
      const label = branch.label;
      if (label === undefined) {
        throw new Error(`Reaction stage ${stage}: every sibling in then(...) needs .named(...).`);
      }
      if (!/^[A-Za-z0-9_-]+$/.test(label)) {
        throw new Error(
          `Reaction stage ${stage}: sibling label "${label}" uses a reserved character. ` +
            "Use letters, numbers, _, or -.",
        );
      }
      if (labels.has(label)) {
        throw new Error(`Reaction stage ${stage}: sibling label "${label}" is stated twice.`);
      }
      labels.add(label);
    }
  }
  return branches;
}

function withIncomingWhere(
  steps: readonly StepNode[],
  whereOps: readonly WhereOp[],
  label?: string,
): StepNode[] {
  return steps.map((step, index) =>
    index === 0
      ? {
          ...step,
          ...(whereOps.length > 0 ? { whereOps: [...whereOps, ...(step.whereOps ?? [])] } : {}),
          ...(label !== undefined ? { pathLabels: [...(step.pathLabels ?? []), label] } : {}),
        }
      : { ...step },
  );
}

/** Build and extend the authored sibling tree as independent flat paths. */
export function siblingTree(
  patterns: readonly TriggerPattern[],
  root: Pick<ReactionDeclaration, "where" | "whereOps">,
  nodes: readonly ThenNode[],
): ReactionPartition {
  const branches = labeledBranches(nodes, 1);
  const declarations: ReactionDeclaration[] = branches.map((branch) =>
    setReactionLintExtraUses(
      {
        when: patterns.map(cloneTrigger),
        ...root,
        then: withIncomingWhere(
          branch.steps,
          branch.whereOps,
          branches.length > 1 ? branch.label : undefined,
        ),
        ...(branches.length > 1 ? { path: [branch.label as string] } : {}),
      },
      [],
    ),
  );

  const result = {
    declarations,
    then(...next: ThenNode[]) {
      const stage = Math.max(...declarations.map((decl) => decl.then.length)) + 1;
      const nextBranches = labeledBranches(next, stage);
      const expanded: ReactionDeclaration[] = [];
      for (const declaration of declarations) {
        for (const branch of nextBranches) {
          expanded.push(
            setReactionLintExtraUses(
              {
                ...declaration,
                when: declaration.when.map(cloneTrigger),
                then: [
                  ...declaration.then.map((step) => ({ ...step })),
                  ...withIncomingWhere(
                    branch.steps,
                    branch.whereOps,
                    nextBranches.length > 1 ? branch.label : undefined,
                  ),
                ],
                ...(nextBranches.length > 1
                  ? { path: [...(declaration.path ?? []), branch.label as string] }
                  : declaration.path !== undefined
                    ? { path: [...declaration.path] }
                    : {}),
              },
              [],
            ),
          );
        }
      }
      declarations.splice(0, declarations.length, ...expanded);
      return result;
    },
  } as ReactionPartition;
  Object.defineProperty(result, ReactionPartitionBrand, { value: true });
  return result;
}
