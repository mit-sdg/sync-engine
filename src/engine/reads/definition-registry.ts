/** Own the definitions and read environments installed in one engine. */

import { logger } from "@engine/utils/logger";
import { canonicallyEqual } from "@engine/utils/canonical-json";
import { NameResolver } from "@engine/reactions/resolving";
import type { InstrumentedQuery, ReactionDeclaration } from "@engine/reactions/types";
import { standardComputations } from "./computations.ts";
import type { ComputationRef } from "./computations.ts";
import {
  fragmentChannelsOfFormer,
  fusedFormersOf,
  viewChannelsOfFormer,
  viewChannelsOfView,
} from "./collection.ts";
import { serializeFormer } from "./former-lowering.ts";
import type { FormerRef } from "./former-nodes.ts";
import type { FormerIR, QueryRefIR, ReactionIR, ViewIR, ViewOpIR } from "./ir.ts";
import type { RelationView } from "./lines.ts";
import type { ReadBackEnv } from "./read-back.ts";
import { serializeView } from "./view-lowering.ts";
import type { AnyWhereOp, WhereOp } from "./where-ops.ts";
import { AuthoredReferenceResolver } from "./authored-reference-resolution.ts";
import { ImportedIrBinder, type BoundReaction } from "./imported-ir-binding.ts";
import { ViewFormerValidator } from "./view-former-validation.ts";

export type { BoundReaction, BoundWhereOp } from "./imported-ir-binding.ts";

export interface ReadEnv {
  /** The instrumented query a `{ concept, query }` reference names. */
  query(ref: QueryRefIR, site: string): InstrumentedQuery;
  /** The installed computation a vocabulary name resolves to. */
  computation(name: string, site: string): ComputationRef;
  /** A registered view, by name. */
  viewByName(name: string, site: string): RelationView;
  /** A registered former, by sentence. */
  formerByName(name: string, site: string): FormerRef;
}

export class Registry {
  private readonly conceptsByName = new Map<string, object>();
  private readonly computationsByName = new Map<string, ComputationRef>();
  private readonly viewsByName = new Map<string, RelationView>();
  private readonly formersByName = new Map<string, FormerRef>();
  private readonly resolver: NameResolver;
  private readonly authored: AuthoredReferenceResolver;
  private readonly validator: ViewFormerValidator;
  private readonly binder: ImportedIrBinder;
  private env: ReadEnv | undefined;

  constructor() {
    for (const ref of standardComputations) {
      this.computationsByName.set(ref.computationName, ref);
    }
    this.resolver = new NameResolver({
      conceptNamed: (name) => this.conceptNamed(name),
      computationNamed: (name) => this.computationNamed(name),
    });
    this.authored = new AuthoredReferenceResolver(this.resolver, {
      computationNamed: (name) => this.computationNamed(name),
      readEnv: () => this.readEnv(),
    });
    this.validator = new ViewFormerValidator({
      resolver: this.resolver,
      viewNamed: (name) => this.viewNamed(name),
      formerNamed: (name) => this.formerNamed(name),
      resolveAuthoredComputation: (ref, site) => this.authored.resolveComputation(ref, site),
    });
    this.binder = new ImportedIrBinder({
      resolver: this.resolver,
      formerNamed: (name) => this.formerNamed(name),
      assertPatternUsable: (pattern, site, kind) =>
        this.validator.assertPatternUsable(pattern, site, kind),
      assertOpUsable: (op, site, kind) => this.validator.assertOpUsable(op, site, kind),
    });
  }

  get concepts(): Map<string, object> {
    return this.conceptsByName;
  }

  registerConcept(name: string, instrumented: object): void {
    const existing = this.conceptsByName.get(name);
    if (existing !== undefined && existing !== instrumented) {
      logger.warn(
        `Two concepts share the name "${name}" — exported reactions naming it will resolve to the most recently instrumented one.`,
      );
    }
    this.conceptsByName.set(name, instrumented);
  }

  registerComputations(computations: Record<string, ComputationRef>): void {
    for (const [name, ref] of Object.entries(computations)) {
      if (name !== ref.computationName || ref.source !== "vocabulary") {
        throw new Error(`Computation "${name}" was not declared by this vocabulary.`);
      }
      const existing = this.computationsByName.get(name);
      if (existing !== undefined && existing !== ref) {
        throw new Error(`Computation "${name}" is already installed in this assembly.`);
      }
      this.computationsByName.set(name, ref);
    }
  }

  resolveDeclaration(name: string, declaration: ReactionDeclaration): void {
    this.authored.resolveDeclaration(name, declaration);
  }

  indexDeclarationReads(declaration: ReactionDeclaration): void {
    const fromOps = (ops: readonly (AnyWhereOp | WhereOp)[] | undefined): void => {
      for (const op of ops ?? []) {
        if (
          (op.op === "find" || op.op === "whether" || op.op === "no") &&
          op.view !== undefined &&
          typeof op.view !== "string"
        ) {
          this.indexView(op.view);
        }
      }
    };
    fromOps(declaration.whereOps);
    for (const node of declaration.then) {
      fromOps(node.whereOps);
      fromOps(node.transformOps);
      for (const fused of fusedFormersOf(node.action.input)) this.indexFormer(fused.former);
    }
  }

  declareViews(...refs: RelationView[]): void {
    for (const ref of refs) this.indexView(ref);
  }

  declareFormers(...refs: FormerRef[]): void {
    for (const ref of refs) this.indexFormer(ref);
  }

  registerViews(views: ViewIR[]): void {
    this.binder.assertViewDag(views);
    for (const ir of views) {
      const ref = this.binder.bindView(ir);
      if (!this.registerUniqueView(ref, ir, false)) continue;
      this.validator.assertViewUsable(ref);
      this.viewsByName.set(ir.name, ref);
    }
  }

  registerFormers(formers: FormerIR[]): void {
    for (const ir of formers) {
      const ref = this.binder.bindFormer(ir);
      if (!this.registerUniqueFormer(ref, ir, false)) continue;
      this.validator.assertFormable(ref);
      this.formersByName.set(ir.name, ref);
    }
  }

  bindReaction(reaction: ReactionIR): BoundReaction {
    return this.binder.bindReaction(reaction);
  }

  assertFormable(ref: FormerRef): void {
    this.validator.assertFormable(ref);
  }

  formerRefs(): Iterable<FormerRef> {
    return this.formersByName.values();
  }

  formerNamed(name: string): FormerRef | undefined {
    return this.formersByName.get(name);
  }

  viewRefs(): Iterable<RelationView> {
    return this.viewsByName.values();
  }

  private viewNamed(name: string): RelationView | undefined {
    return this.viewsByName.get(name);
  }

  readBackEnv(): ReadBackEnv {
    return {
      queryPromise: (ref) => {
        try {
          return this.resolver.query(ref.concept, ref.query, "read-back").queryPromise;
        } catch {
          return undefined;
        }
      },
      viewPromise: (name) => this.viewsByName.get(name)?.promise,
    };
  }

  readEnv(): ReadEnv {
    this.env ??= {
      query: (ref, site) => this.resolver.query(ref.concept, ref.query, site),
      computation: (name, site) => this.resolver.computation(name, site),
      viewByName: (name, site) => {
        const view = this.viewsByName.get(name);
        if (view === undefined) {
          throw new Error(
            `Reaction "${site}": view "${name}" is not registered — ` +
              "registerViews(...) before the reactions that ask it.",
          );
        }
        return view;
      },
      formerByName: (name, site) => {
        const ref = this.formersByName.get(name);
        if (ref === undefined) {
          throw new Error(
            `Former "${site}": spliced fragment "${name}" resolves against ` +
              "the engine's registered formers — register dependencies first.",
          );
        }
        return ref;
      },
    };
    return this.env;
  }

  private conceptNamed(name: string): object | undefined {
    return this.conceptsByName.get(name);
  }

  private computationNamed(name: string): ComputationRef | undefined {
    return this.computationsByName.get(name);
  }

  private indexView(ref: RelationView): void {
    if (!this.registerUniqueView(ref, serializeView(ref), true)) return;
    for (const channel of viewChannelsOfView(
      ref as { alternatives: readonly (readonly ViewOpIR[])[] },
    )) {
      if (channel.live !== undefined) this.indexView(channel.live);
    }
    this.validator.assertViewUsable(ref);
    this.viewsByName.set(ref.viewName, ref);
  }

  private indexFormer(ref: FormerRef): void {
    if (!this.registerUniqueFormer(ref, serializeFormer(ref), true)) return;
    for (const channel of viewChannelsOfFormer(ref)) {
      if (channel.live !== undefined) this.indexView(channel.live);
    }
    for (const channel of fragmentChannelsOfFormer(ref)) {
      if (channel.live !== undefined) this.indexFormer(channel.live);
    }
    this.validator.assertFormable(ref);
    this.formersByName.set(ref.formerName, ref);
  }

  private registerUniqueView(candidate: RelationView, ir: ViewIR, elaborate: boolean): boolean {
    return this.registerUnique(
      this.viewsByName,
      candidate.viewName,
      candidate,
      ir,
      serializeView,
      "View",
      elaborate,
    );
  }

  private registerUniqueFormer(candidate: FormerRef, ir: FormerIR, elaborate: boolean): boolean {
    return this.registerUnique(
      this.formersByName,
      candidate.formerName,
      candidate,
      ir,
      serializeFormer,
      "Former",
      elaborate,
    );
  }

  private registerUnique<Ref extends object>(
    map: Map<string, Ref>,
    name: string,
    candidate: object,
    candidateIR: unknown,
    serializeExisting: (ref: Ref) => unknown,
    kind: string,
    elaborate: boolean,
  ): boolean {
    const existing = map.get(name);
    if (existing === undefined) return true;
    if (existing === candidate) return false;
    if (canonicallyEqual(serializeExisting(existing), candidateIR)) return false;
    const detail = elaborate
      ? ` — two ${kind.toLowerCase()}s may not disagree about what one sentence means.`
      : ".";
    throw new Error(`${kind} "${name}" is already registered with a different definition${detail}`);
  }
}
