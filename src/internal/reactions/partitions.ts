import { structurallyEqual } from "../reads/frames.ts";
import { isQueryRef } from "./refs.ts";
import { setReactionLintExtraUses } from "../reads/lower.ts";
import { walkValueTree } from "../reads/value-tree.ts";
import { isWhereOp } from "../reads/where-ops.ts";
import type { AnyWhereOp, FindOp, NoOp, WhereOp } from "../reads/where-ops.ts";
import type {
  Mapping,
  ReactionCase,
  NestedReactionCase,
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  StepNode,
  ThenNode,
  TriggerPattern,
} from "./types.ts";
import { ReactionCaseBrand, ReactionPartitionBrand, hasBrand } from "../reads/brands.ts";
import { assertReactionNodes } from "./nodes.ts";

export function isReactionCase(value: unknown): value is ReactionCase {
  return (
    (typeof value === "object" &&
      value !== null &&
      (value as { kind?: unknown }).kind === "branch") ||
    hasBrand(value, ReactionCaseBrand)
  );
}

export function isReactionPartition(value: unknown): value is ReactionPartition {
  return hasBrand(value, ReactionPartitionBrand);
}

export function declarationsOf(result: ReactionResult): readonly ReactionDeclaration[] {
  return isReactionPartition(result) ? result.declarations : [result];
}

function sameSource(left: FindOp | NoOp, right: FindOp | NoOp): boolean {
  return (
    left.query === right.query && left.view === right.view && structurallyEqual(left.in, right.in)
  );
}

function patternsOverlap(left: Mapping, right: Mapping): boolean {
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (key in left && key in right && !structurallyEqual(left[key], right[key])) return false;
  }
  return true;
}

function linePromise(op: FindOp): "one" | "optional" | "many" | undefined {
  if (op.query !== undefined) return op.query.queryPromise;
  return "promise" in (op.view ?? {})
    ? (op.view as { promise?: "one" | "optional" | "many" }).promise
    : undefined;
}

function casesAreDisjoint(left: readonly AnyWhereOp[], right: readonly AnyWhereOp[]): boolean {
  for (const a of left) {
    for (const b of right) {
      if (
        ((a.op === "find" && b.op === "no") || (a.op === "no" && b.op === "find")) &&
        sameSource(a, b) &&
        patternsOverlap(a.out, b.out)
      ) {
        return true;
      }
      if (a.op !== "find" || b.op !== "find" || !sameSource(a, b)) continue;
      const promise = linePromise(a);
      if (promise !== "one" && promise !== "optional") continue;
      for (const key of new Set([...Object.keys(a.out), ...Object.keys(b.out)])) {
        const leftValue = a.out[key];
        const rightValue = b.out[key];
        if (
          leftValue !== undefined &&
          rightValue !== undefined &&
          typeof leftValue !== "symbol" &&
          typeof rightValue !== "symbol" &&
          !structurallyEqual(leftValue, rightValue)
        ) {
          return true;
        }
        if (
          (b.not !== undefined && structurallyEqual(leftValue, b.not[key])) ||
          (a.not !== undefined && structurallyEqual(a.not[key], rightValue))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function lineName(op: FindOp): string {
  if (op.query !== undefined) {
    if (isQueryRef(op.query)) return `${op.query.refConcept}.${op.query.refQuery}`;
    return op.query.queryLabel ?? op.query.queryName ?? "the read";
  }
  return op.view?.viewName ?? "the view";
}

function coverageAssumptions(
  own: readonly AnyWhereOp[],
  siblings: readonly (readonly AnyWhereOp[])[] = [],
): string[] {
  const assumptions: string[] = [];
  for (const op of own) {
    if (op.op !== "find" || linePromise(op) === "one") continue;
    const covered = siblings.some((conditions) =>
      conditions.some(
        (candidate) =>
          candidate.op === "no" &&
          sameSource(op, candidate) &&
          patternsOverlap(op.out, candidate.out),
      ),
    );
    if (!covered) assumptions.push(lineName(op));
  }
  return assumptions;
}

function cloneTrigger(pattern: TriggerPattern): TriggerPattern {
  if ("channel" in pattern) return { ...pattern, pattern: { ...pattern.pattern } };
  return {
    ...pattern,
    input: { ...pattern.input },
    ...(pattern.output !== undefined ? { output: { ...pattern.output } } : {}),
  };
}

function declaration(
  patterns: readonly TriggerPattern[],
  conditions: readonly AnyWhereOp[],
  nodes: readonly StepNode[],
  coverage: readonly string[] = [],
): ReactionDeclaration {
  assertReactionNodes(nodes);
  return {
    when: patterns.map(cloneTrigger),
    ...(conditions.length > 0 ? { whereOps: [...conditions] } : {}),
    then: [...nodes],
    ...(coverage.length > 0 ? { coverage: [...new Set(coverage)] } : {}),
  };
}

function conditionsOf(reactionCase: ReactionCase): readonly AnyWhereOp[] {
  const conditions =
    "kind" in reactionCase && reactionCase.kind === "branch"
      ? reactionCase.whereOps
      : (reactionCase as NestedReactionCase).where;
  if (!conditions.every(isWhereOp)) {
    throw new Error(
      "either(...): count(...) cannot be used in a reaction condition. " +
        "To test a count as policy, define a view and read that view.",
    );
  }
  return conditions;
}

function flattenCases(
  patterns: readonly TriggerPattern[],
  prefix: readonly AnyWhereOp[],
  cases: readonly ReactionCase[],
  inheritedCoverage: readonly string[],
  inheritedLintUses: readonly symbol[] = [],
): ReactionDeclaration[] {
  if (cases.length < 2 || !cases.every(isReactionCase)) {
    throw new Error("either(...) states at least two where(...).then(...) cases.");
  }
  const caseConditions = cases.map(conditionsOf);
  for (let left = 0; left < cases.length; left += 1) {
    for (let right = left + 1; right < cases.length; right += 1) {
      if (!casesAreDisjoint(caseConditions[left], caseConditions[right])) {
        throw new Error(
          `either(...): cases ${left + 1} and ${right + 1} can both match. ` +
            "Distinguish them with a literal, existence, or value split.",
        );
      }
    }
  }

  const caseUses = new Set<symbol>();
  walkValueTree(cases, (value) => {
    if (typeof value === "symbol") caseUses.add(value);
  });
  const lintUses = new Set(inheritedLintUses);
  for (const op of prefix) {
    if (op.op !== "find" && op.op !== "whether") continue;
    walkValueTree(op.out, (value) => {
      if (typeof value === "symbol" && caseUses.has(value)) lintUses.add(value);
    });
  }

  const leaves: ReactionDeclaration[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const entry = cases[index];
    const own = caseConditions[index];
    const conditions = [...prefix, ...own];
    const coverage = [
      ...inheritedCoverage,
      ...coverageAssumptions(
        own,
        caseConditions.filter((_, sibling) => sibling !== index),
      ),
    ];
    if ("kind" in entry && entry.kind === "branch") {
      leaves.push(
        setReactionLintExtraUses(declaration(patterns, conditions, entry.steps, coverage), [
          ...lintUses,
        ]),
      );
    } else if ((entry as NestedReactionCase).cases !== undefined) {
      leaves.push(
        ...flattenCases(patterns, conditions, (entry as NestedReactionCase).cases ?? [], coverage, [
          ...lintUses,
        ]),
      );
    } else {
      throw new Error("either(...): each case ends in then(...) or a nested either(...).");
    }
  }
  return leaves;
}

export function partition(
  patterns: readonly TriggerPattern[],
  prefix: readonly AnyWhereOp[],
  cases: readonly ReactionCase[],
): ReactionPartition {
  const result = {
    declarations: flattenCases(patterns, prefix, cases, coverageAssumptions(prefix)),
    then() {
      throw new Error("either(...) cannot be extended; migrate it to sibling then(...) branches.");
    },
  };
  Object.defineProperty(result, ReactionPartitionBrand, { value: true });
  return result;
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
