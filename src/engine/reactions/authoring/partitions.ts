import type { WhereOp } from "@engine/reads/where-ops";
import type {
  DeferredStage,
  DeferredStageWithWhere,
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  StageOptions,
  StepNode,
  ThenNode,
  TriggerPattern,
} from "../types.ts";
import { ReactionPartitionBrand, brand, hasBrand } from "@engine/reads/brands";
import { normalizeWhere } from "./conditions.ts";
import { assertReactionNodes } from "./nodes.ts";

function isReactionPartition(value: unknown): value is ReactionPartition {
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
    output: { ...pattern.output },
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

/**
 * Attach one stage's incoming conditions, sibling label, and deferral to the
 * step that opens it. A deferred stage holds its consequence until a
 * settlement frontier; the conditions above travel with it and are re-read
 * there, so the stage answers from the state the frontier observes.
 */
function withIncomingWhere(
  steps: readonly StepNode[],
  whereOps: readonly WhereOp[],
  label?: string,
  deferred?: boolean,
): StepNode[] {
  return steps.map((step, index) =>
    index === 0
      ? {
          ...step,
          ...(whereOps.length > 0 ? { whereOps: [...whereOps, ...(step.whereOps ?? [])] } : {}),
          ...(deferred === true ? { deferred: true as const } : {}),
          ...(label !== undefined ? { pathLabels: [...(step.pathLabels ?? []), label] } : {}),
        }
      : { ...step },
  );
}

/** The conditions one stage carries in: the stage's own, then its branch's. */
function stageWhere(stage: StageOptions, branchOps: readonly WhereOp[]): readonly WhereOp[] {
  return stage.whereOps === undefined ? branchOps : [...stage.whereOps, ...branchOps];
}

/** Build the `.afterFlowSettles()` stage builder over one partition's extension. */
function deferredStage(
  extend: (nodes: readonly ThenNode[], stage: StageOptions) => ReactionPartition,
): DeferredStage {
  return {
    where(...conditions: unknown[]) {
      const normalized = normalizeWhere(conditions, "afterFlowSettles(...).where");
      if (normalized.fn !== undefined) {
        throw new Error(
          "afterFlowSettles(...).where(...) states condition lines; " +
            "a frame function belongs on when(...).where(...).",
        );
      }
      return {
        then(...nodes: ThenNode[]) {
          return extend(nodes, { deferred: true, whereOps: normalized.ops as WhereOp[] });
        },
      } as DeferredStageWithWhere;
    },
    then(...nodes: ThenNode[]) {
      return extend(nodes, { deferred: true });
    },
  } as DeferredStage;
}

/** Build and extend the authored sibling tree as independent flat paths. */
export function siblingTree(
  patterns: readonly TriggerPattern[],
  root: Pick<ReactionDeclaration, "where" | "whereOps">,
  nodes: readonly ThenNode[],
  stage: StageOptions = {},
): ReactionPartition {
  const branches = labeledBranches(nodes, 1);
  const declarations: ReactionDeclaration[] = branches.map((branch) => ({
    when: patterns.map(cloneTrigger),
    ...root,
    then: withIncomingWhere(
      branch.steps,
      stageWhere(stage, branch.whereOps),
      branches.length > 1 ? branch.label : undefined,
      stage.deferred,
    ),
    ...(branches.length > 1 ? { path: [branch.label as string] } : {}),
  }));

  const extend = (next: readonly ThenNode[], nextStage: StageOptions): ReactionPartition => {
    const position = Math.max(...declarations.map((decl) => decl.then.length)) + 1;
    const nextBranches = labeledBranches(next, position);
    const expanded: ReactionDeclaration[] = [];
    for (const declaration of declarations) {
      for (const branch of nextBranches) {
        expanded.push({
          ...declaration,
          when: declaration.when.map(cloneTrigger),
          then: [
            ...declaration.then.map((step) => ({ ...step })),
            ...withIncomingWhere(
              branch.steps,
              stageWhere(nextStage, branch.whereOps),
              nextBranches.length > 1 ? branch.label : undefined,
              nextStage.deferred,
            ),
          ],
          ...(nextBranches.length > 1
            ? { path: [...(declaration.path ?? []), branch.label as string] }
            : declaration.path !== undefined
              ? { path: [...declaration.path] }
              : {}),
        });
      }
    }
    declarations.splice(0, declarations.length, ...expanded);
    return result;
  };

  const result = {
    declarations,
    afterFlowSettles: () => deferredStage(extend),
    then(...next: ThenNode[]) {
      return extend(next, {});
    },
  } as ReactionPartition;
  return brand(result, ReactionPartitionBrand);
}
