/** Resolve definition-site vocabulary references to one assembly's live members. */

import { isActionRef, isQueryRef } from "@engine/reactions/authoring/references";
import type { NameResolver } from "@engine/reactions/resolving";
import type {
  ActionPattern,
  InstrumentedAction,
  InstrumentedQuery,
  ReactionDeclaration,
  StepNode,
} from "@engine/reactions/types";
import type { ComputationRef } from "./computations.ts";
import type { ReadEnv } from "./definition-registry.ts";
import { applyWhereOps } from "./where-evaluation.ts";
import { brandWhereOp } from "./where-ops.ts";
import type { AnyWhereOp, WhereOp } from "./where-ops.ts";

/** Mutates only the fresh declaration passed to {@link resolveDeclaration}. */
export class AuthoredReferenceResolver {
  constructor(
    private readonly resolver: NameResolver,
    private readonly definitions: {
      computationNamed(name: string): ComputationRef | undefined;
      readEnv(): ReadEnv;
    },
  ) {}

  resolveDeclaration(name: string, declaration: ReactionDeclaration): void {
    const site = `Reaction "${name}"`;
    for (const clause of declaration.when) {
      if (!("channel" in clause)) this.resolveActionPattern(clause, site);
    }
    if (declaration.whereOps !== undefined) {
      declaration.whereOps = declaration.whereOps.map(
        (op) => this.resolveWhereOp(op, site) as AnyWhereOp,
      );
    }
    this.resolveThenNodes(declaration.then, site);
  }

  /** Vocabulary references must be the definitions installed in this assembly. */
  resolveComputation(ref: ComputationRef, site: string): ComputationRef {
    const existing = this.definitions.computationNamed(ref.computationName);
    if (existing === ref) return ref;
    if (existing === undefined) {
      throw new Error(
        `${site}: computation "${ref.computationName}" is not in the assembled vocabulary.`,
      );
    }
    throw new Error(
      `${site}: computation "${ref.computationName}" is not the definition installed by this assembly.`,
    );
  }

  private resolveActionPattern(pattern: ActionPattern, site: string): void {
    if (!isActionRef(pattern.action)) return;
    const { refConcept, refAction } = pattern.action;
    const concept = this.resolver.concept(refConcept, site);
    const live = Reflect.get(concept, refAction) as InstrumentedAction;
    if (typeof live !== "function" || live.concept === undefined) {
      throw new Error(
        `${site}: "${refConcept}.${refAction}" is not an action of the instrumented concept.`,
      );
    }
    pattern.action = live;
    pattern.concept = live.concept;
  }

  private liveQuery(query: InstrumentedQuery, site: string): InstrumentedQuery {
    if (!isQueryRef(query)) return query;
    const { refConcept, refQuery } = query;
    const concept = this.resolver.concept(refConcept, site);
    const live = Reflect.get(concept, refQuery) as InstrumentedQuery;
    if (typeof live !== "function" || live.queryName === undefined) {
      throw new Error(
        `${site}: "${refConcept}.${refQuery}" is not a query of the instrumented concept.`,
      );
    }
    return live;
  }

  private resolveWhereOp(op: AnyWhereOp, site: string): AnyWhereOp {
    switch (op.op) {
      case "find":
      case "whether":
      case "no": {
        if (op.query === undefined) return op;
        const query = this.liveQuery(op.query, site);
        return query === op.query ? op : brandWhereOp({ ...op, query });
      }
      case "compute":
        this.resolveComputation(op.computation, site);
        return op;
      case "holds":
        this.resolveComputation(op.fused.computation, site);
        return op;
      case "earlier":
        this.resolveActionPattern(op.pattern, site);
        return op;
      case "custom":
        return op;
    }
  }

  private resolveThenNodes(nodes: readonly StepNode[], site: string): void {
    for (const node of nodes) {
      this.resolveActionPattern(node.action, site);
      if (node.transformOps === undefined) continue;
      const ops = node.transformOps.map((op) => this.resolveWhereOp(op, site) as WhereOp);
      node.transformOps = ops;
      node.transform = (frames) => applyWhereOps(frames, ops, this.definitions.readEnv());
    }
  }
}
