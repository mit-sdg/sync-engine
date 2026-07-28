/** Stable facade over engine-scoped definition registration and IR binding. */

import type { ReactionDeclaration } from "@engine/reactions/types";
import type { ComputationRef } from "./computations.ts";
import { DefinitionRegistry } from "./definition-registry.ts";
import type { ReadEnv } from "./env.ts";
import type { FormerRef } from "./former-nodes.ts";
import type { FormerIR, ReactionIR, ViewIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import type { ReadBackEnv } from "./read-back.ts";

export type { BoundReaction, BoundWhereOp } from "./imported-ir-binding.ts";
import type { BoundReaction } from "./imported-ir-binding.ts";

export class Registry {
  private readonly definitions = new DefinitionRegistry();
  readonly concepts: Map<string, object>;

  constructor() {
    this.concepts = this.definitions.concepts;
  }

  registerConcept(name: string, instrumented: object): void {
    this.definitions.registerConcept(name, instrumented);
  }

  registerComputations(computations: Record<string, ComputationRef>): void {
    this.definitions.registerComputations(computations);
  }

  resolveDeclaration(name: string, declaration: ReactionDeclaration): void {
    this.definitions.resolveDeclaration(name, declaration);
  }

  indexDeclarationReads(declaration: ReactionDeclaration): void {
    this.definitions.indexDeclarationReads(declaration);
  }

  declareViews(...refs: RelationView[]): void {
    this.definitions.declareViews(...refs);
  }

  declareFormers(...refs: FormerRef[]): void {
    this.definitions.declareFormers(...refs);
  }

  registerViews(views: ViewIR[]): void {
    this.definitions.registerViews(views);
  }

  registerFormers(formers: FormerIR[]): void {
    this.definitions.registerFormers(formers);
  }

  bindReaction(reaction: ReactionIR): BoundReaction {
    return this.definitions.bindReaction(reaction);
  }

  assertFormable(ref: FormerRef): void {
    this.definitions.assertFormable(ref);
  }

  assertViewUsable(ref: RelationView): void {
    this.definitions.assertViewUsable(ref);
  }

  formerRefs(): Iterable<FormerRef> {
    return this.definitions.formerRefs();
  }

  formerNamed(name: string): FormerRef | undefined {
    return this.definitions.formerNamed(name);
  }

  viewRefs(): Iterable<RelationView> {
    return this.definitions.viewRefs();
  }

  viewNamed(name: string): RelationView | undefined {
    return this.definitions.viewNamed(name);
  }

  readBackEnv(): ReadBackEnv {
    return this.definitions.readBackEnv();
  }

  readEnv(): ReadEnv {
    return this.definitions.readEnv();
  }
}
