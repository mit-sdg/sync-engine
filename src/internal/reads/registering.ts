/**
 * Bind reaction, view, and former IR to one engine's concepts and computations.
 * Registration validates names, bindings, promises, and attached opaque
 * functions before evaluation. Authored computations must use the installed
 * reference; imported computations resolve by name. Imported opaque functions
 * are rejected because JSON does not carry their implementation.
 */

import { isActionRef, isQueryRef } from "../reactions/refs.ts";
import { NameResolver } from "../reactions/resolving.ts";
import type {
  ActionPattern,
  InstrumentedAction,
  InstrumentedQuery,
  ReactionDeclaration,
  StepNode,
  ThenNode,
  TriggerPattern,
  WhereFn,
} from "../reactions/types.ts";
import { standardComputations } from "./computations.ts";
import type { ComputationRef } from "./computations.ts";
import { formerRefWith } from "./former-nodes.ts";
import type { FormerRef } from "./former-nodes.ts";
import { hasMarkerKey, liveOf } from "./ir.ts";
import type {
  ActionTriggerIR,
  FormerIR,
  FormerNodeIR,
  PatternIR,
  ReactionIR,
  TriggerIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";
import type { ReadEnv } from "./env.ts";
import type { ReadBackEnv } from "./read-back.ts";
import {
  fragmentChannelsOfFormer,
  fusedFormersOf,
  serializeFormer,
  serializeView,
  viewChannelsOfFormer,
  viewChannelsOfView,
  viewLineIR,
} from "./lower.ts";
import type { RelationView } from "./lines.ts";
import { foldFormerNode } from "./schema.ts";
import { varNamesInPattern } from "./former-analysis.ts";
import { opNamesIR, scheduleBlock } from "./schedule.ts";
import { walkValueTree } from "./value-tree.ts";
import { relationViewWith, slotsOf } from "./views.ts";
import { applyWhereOps, brandWhereOp } from "./where-ops.ts";
import type { AnyWhereOp, EarlierOp, WhereOp } from "./where-ops.ts";
import type { QueryPromise } from "./query-contracts.ts";

/** A where op as a bound reaction executes it: the IR, plus bound `earlier` reads. */
export type BoundWhereOp = Exclude<WhereOpIR, { op: "earlier" }> | EarlierOp;

/**
 * One reaction bound against a registry: the IR's names resolved to live
 * trigger and consequence actions, its where ops validated and ready for
 * leaf-agnostic evaluation, and a closure-based `where` recovered from the
 * reaction's {@link LIVE} channel.
 */
export interface BoundReaction {
  name: string;
  when: TriggerPattern[];
  whereOps?: BoundWhereOp[];
  whereFn?: WhereFn;
  step: StepNode;
}

// ── The registry ───────────────────────────────────────────────────────────

export class Registry {
  /** Instrumented concepts by canonical name — instrumentation writes, resolution reads. */
  readonly concepts: Map<string, object> = new Map();
  /** Calculations available to this assembly, by vocabulary name. */
  private readonly computations: Map<string, ComputationRef> = new Map();
  /**
   * Views by name, indexed as reactions referencing them register. Views live
   * in the application alongside the reactions — engine-scoped, not a module
   * registry — because a view reads state through this engine's concepts.
   */
  private readonly views: Map<string, RelationView> = new Map();
  /**
   * Per registered view, the inferred body bound and declared promise. When
   * static inference is looser, runtime evaluation checks the declaration.
   */
  private readonly viewProofs: Map<string, { declared?: QueryPromise; proven: QueryPromise }> =
    new Map();
  /**
   * Formers by sentence, indexed as reactions referencing them register (or as
   * the app declares them for edge/CLI reads). Engine-scoped for the same
   * reason views are: a former reads state through this engine's concepts.
   */
  private readonly formers: Map<string, FormerRef> = new Map();
  private readonly formerProofs: Map<string, { declared: QueryPromise; proven: QueryPromise }> =
    new Map();
  /** Formers this engine has validated against its vocabulary — names bind, escapes carried. */
  private readonly formable = new WeakSet<FormerRef>();
  /** Views this engine has validated against its vocabulary. */
  private readonly usableViews = new WeakSet<object>();
  private env: ReadEnv | undefined;
  private readonly resolver: NameResolver = new NameResolver(this.concepts, this.computations);

  constructor() {
    for (const ref of standardComputations) {
      this.computations.set(ref.computationName, ref);
    }
  }

  /** Install one assembly's vocabulary-owned calculations. */
  registerComputations(computations: Record<string, ComputationRef>): void {
    for (const [name, ref] of Object.entries(computations)) {
      if (name !== ref.computationName || ref.source !== "vocabulary") {
        throw new Error(`Computation "${name}" was not declared by this vocabulary.`);
      }
      const existing = this.computations.get(name);
      if (existing !== undefined && existing !== ref) {
        throw new Error(`Computation "${name}" is already installed in this assembly.`);
      }
      this.computations.set(name, ref);
    }
  }

  /** Every former this registry holds, for export beside the reactions. */
  formerRefs(): Iterable<FormerRef> {
    return this.formers.values();
  }

  // ── The authored declaration ─────────────────────────────────────────────
  //
  // A reaction may be authored against a vocabulary's static refs (`refs.ts`) —
  // names as data, exactly what the IR carries. Its declaration is
  // per-registration (its function just ran), so refs resolve to live
  // instrumented members in place before the declaration lowers to the IR.
  // Views and formers need no such pass: their refs already carry IR.

  /** Resolve every static ref in a freshly authored declaration, in place. */
  resolveDeclaration(name: string, decl: ReactionDeclaration): void {
    const site = `Reaction "${name}"`;
    for (const clause of decl.when) {
      if (!("channel" in clause)) this.resolveActionPatternRefs(clause, site);
    }
    if (decl.whereOps !== undefined) {
      decl.whereOps = decl.whereOps.map((op) => this.resolveAuthoredOp(op, site) as AnyWhereOp);
    }
    this.resolveThenNodes(decl.then, site);
  }

  /** Index every view and former a resolved declaration references. */
  indexDeclarationReads(decl: ReactionDeclaration): void {
    this.indexDeclaredViews(decl);
    this.indexDeclaredFormers(decl);
  }

  /** Declare views no registered reaction consults. Their blocks are already IR. */
  declareViews(...refs: RelationView[]): void {
    for (const ref of refs) this.indexView(ref);
  }

  /** Declare formers no reaction references. Their bodies are already IR. */
  declareFormers(...refs: FormerRef[]): void {
    for (const ref of refs) this.indexFormer(ref);
  }

  /** A registered view, by name — how exports resolve name-only channels. */
  viewNamed(name: string): RelationView | undefined {
    return this.views.get(name);
  }

  /** Every view this registry holds, in registration order. */
  viewRefs(): Iterable<RelationView> {
    return this.views.values();
  }

  /** What registration proved about a view's promise — the read-back's source. */
  viewProof(name: string): { declared?: QueryPromise; proven: QueryPromise } | undefined {
    return this.viewProofs.get(name);
  }

  /** The promise lookups the read-back printer states quantities from. */
  readBackEnv(): ReadBackEnv {
    return {
      queryPromise: (ref) => {
        try {
          return this.resolver.query(ref.concept, ref.query, "read-back").queryPromise;
        } catch {
          return undefined;
        }
      },
      viewPromise: (name) => {
        const view = this.views.get(name);
        return view?.promise;
      },
      viewProof: (name) => this.viewProofs.get(name),
      formerProof: (name) => this.formerProofs.get(name),
    };
  }

  /** The environment used to resolve registered names during evaluation. */
  readEnv(): ReadEnv {
    this.env ??= {
      query: (ref, site) => this.resolver.query(ref.concept, ref.query, site),
      computation: (name, site) => this.resolver.computation(name, site),
      viewByName: (name, site) => {
        const view = this.views.get(name);
        if (view === undefined) {
          throw new Error(
            `Reaction "${site}": view "${name}" is not registered — ` +
              "registerViews(...) before the reactions that ask it.",
          );
        }
        return view;
      },
      formerByName: (name, site) => {
        const ref = this.formers.get(name);
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

  /**
   * Validate one former against this engine's vocabulary, once: every query
   * and computation name binds, every opaque escape carries its
   * definition-site live value, every name-only view or fragment is already
   * registered. Registration and direct evaluation both pass through here,
   * so an evaluation-time miss is impossible rather than merely unlikely.
   */
  assertFormable(ref: FormerRef): void {
    if (this.formable.has(ref)) return;
    const site = ref.formerName;
    this.assertFormerBindings(ref.body, new Set(ref.slots), site);
    foldFormerNode(ref.body, {
      query: (query) => this.resolver.query(query.concept, query.query, `Former "${site}"`),
      pattern: (pattern) => this.assertPatternUsable(pattern, site, "Former"),
      node: (node) => {
        if (node.node !== "former") return;
        const nested = (liveOf(node) as FormerRef | undefined) ?? this.formers.get(node.former);
        if (nested === undefined) {
          throw new Error(`Former "${site}": named former "${node.former}" is not registered.`);
        }
      },
      op: (op) => {
        if (op.op === "earlier") {
          throw new Error(
            `Former "${site}": a former answers from standing state — earlier(...) cannot appear in its selections.`,
          );
        }
        this.assertOpUsable(op, site, "Former");
      },
      splice: (use) => {
        const fragment = liveOf(use) as FormerRef | undefined;
        if (fragment !== undefined) this.assertFormable(fragment);
        else if (!this.formers.has(use.fragment)) {
          throw new Error(
            `Former "${site}": spliced fragment "${use.fragment}" resolves against ` +
              "the engine's registered formers — register dependencies first.",
          );
        }
      },
    });
    this.formerProofs.set(site, { declared: ref.promise, proven: this.proveFormerBound(ref) });
    this.formable.add(ref);
  }

  /** Validate a former's sequential scopes from its registered IR. */
  private assertFormerBindings(
    node: FormerNodeIR,
    inherited: ReadonlySet<string>,
    site: string,
  ): void {
    const requireBound = (pattern: PatternIR, phrase: string, scope: ReadonlySet<string>): void => {
      for (const name of varNamesInPattern(pattern)) {
        if (!scope.has(name)) {
          throw new Error(`Former "${site}": ${phrase} uses "${name}" before it is bound.`);
        }
      }
    };
    if (node.node === "leaf") {
      if (!inherited.has(node.var)) {
        throw new Error(`Former "${site}": leaf "${node.var}" is bound by nothing.`);
      }
      return;
    }
    if (node.node === "record") {
      const scheduled = scheduleBlock(node.where ?? [], inherited, `Former "${site}"`);
      if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
      for (const op of scheduled.ordered) {
        if (op.op !== "find" && op.op !== "whether") continue;
        const opens = scheduled.opens.get(op) ?? [];
        if (opens.length > 0 && this.lineRefPromise(op, `Former "${site}"`) === "many") {
          throw new Error(
            `Former "${site}": this record's where may match many rows; ` +
              "wrap the source in each(...) when the result should contain rows.",
          );
        }
      }
      for (const child of Object.values(node.entries)) {
        this.assertFormerBindings(child, scheduled.bound, site);
      }
      for (const splice of node.splices ?? []) {
        requireBound(splice.in, `splice "${splice.fragment}" anchor`, scheduled.bound);
      }
      return;
    }

    if (node.node === "former") {
      requireBound(node.in, `former "${node.former}" anchor`, inherited);
      return;
    }

    if (node.from.op !== "find") {
      throw new Error(
        `Former "${site}": each(...) starts production from one plain query or view line.`,
      );
    }
    requireBound(node.from.in, "each(...) input", inherited);
    requireBound(node.from.not ?? {}, "each(...).is.not(...) test", inherited);
    const scope = new Set(inherited);
    for (const name of varNamesInPattern(node.from.out)) scope.add(name);
    const scheduled = scheduleBlock(node.where ?? [], scope, `Former "${site}"`);
    if (node.where !== undefined) node.where.splice(0, node.where.length, ...scheduled.ordered);
    const afterWhere = scheduled.bound;
    if (node.node === "each") this.assertFormerBindings(node.as, afterWhere, site);
    if (
      (node.node === "count" || node.node === "first" || node.node === "distinct") &&
      this.lineRefPromise(node.from, `Former "${site}"`) !== "many"
    ) {
      throw new Error(
        `Former "${site}": the source already promises at most one row; ` +
          "use a plain line or whether(...), not a fold.",
      );
    }
    if ((node.node === "first" || node.node === "distinct") && !afterWhere.has(node.value)) {
      throw new Error(
        `Former "${site}": ${node.node}(...) value "${node.value}" is bound by nothing.`,
      );
    }
    if (
      (node.node === "each" || node.node === "first") &&
      node.arranged !== undefined &&
      "by" in node.arranged &&
      !afterWhere.has(node.arranged.by)
    ) {
      throw new Error(
        `Former "${site}": arranged(...) value "${node.arranged.by}" is bound by nothing.`,
      );
    }
  }

  private proveFormerBound(ref: FormerRef): QueryPromise {
    if (ref.body.node !== "record") return "one";
    const scheduled = scheduleBlock(
      ref.body.where ?? [],
      new Set(ref.slots),
      `Former "${ref.formerName}"`,
    );
    let bound: QueryPromise = "one";
    for (const op of scheduled.ordered) {
      if (op.op === "find") {
        const opens = scheduled.opens.get(op) ?? [];
        if (
          this.lineRefPromise(op, `Former "${ref.formerName}"`) !== "one" ||
          this.lineTests(op, opens)
        ) {
          bound = "optional";
        }
      } else if (op.op === "no" || op.op === "holds" || op.op === "custom") {
        bound = "optional";
      }
    }
    return bound;
  }

  /**
   * Validate one view against this engine's vocabulary, once — the same
   * contract {@link assertFormable} keeps for formers: names bind, opaque
   * escapes carry their definition-site live values, and the views it rests
   * on are themselves usable (carried at definition, or already registered).
   * Each block is scheduled (conjunction is orderless), a relation's outs
   * must be bound by every alternative, and the body's cardinality bound is
   * proved against the declared promise.
   */
  assertViewUsable(ref: RelationView): void {
    if (this.usableViews.has(ref)) return;
    const site = ref.viewName;
    const ins = ref.ins;
    const outs = ref.outs;
    for (const block of ref.alternatives as readonly (readonly ViewOpIR[])[]) {
      const scheduled = scheduleBlock(block, new Set(ins), `View "${site}"`);
      for (const out of outs) {
        if (!scheduled.bound.has(out)) {
          throw new Error(
            `View "${site}": an alternative never binds the declared output "${out}".`,
          );
        }
      }
      this.lintOpenedNames(scheduled.ordered, scheduled.opens, [...ins, ...outs], `View "${site}"`);
      for (const op of block) {
        if ((op as { op: string }).op === "earlier") {
          throw new Error(
            `View "${site}": a view answers from standing state, not from the ` +
              "flow's record — earlier(...) belongs to a reaction's own where.",
          );
        }
        this.assertOpUsable(op, site, "View");
        if (viewLineIR(op)) {
          const nested = (liveOf(op) as RelationView | undefined) ?? this.views.get(op.view);
          if (nested !== undefined) this.assertViewUsable(nested);
        }
      }
    }
    if (outs.length > 0 && ref.promise === undefined) {
      throw new Error(
        `View "${site}": a view with outputs declares its promise — one, optional, or many; there is no default.`,
      );
    }
    this.viewProofs.set(site, {
      ...(ref.promise !== undefined ? { declared: ref.promise } : {}),
      proven: this.proveViewBound(ref),
    });
    this.usableViews.add(ref);
  }

  /**
   * The compositional cardinality bound a view's body proves: chains of
   * always-fill lines prove `one`, anything that can drop caps at
   * `optional`, an opening line over a many-relation — or stacked
   * alternatives — makes the body `many`. Where the author declares tighter
   * than static inference establishes, runtime evaluation enforces the
   * declaration and the read-back says so.
   */
  private proveViewBound(ref: RelationView): QueryPromise {
    const ins = ref.ins;
    const blocks = ref.alternatives as readonly (readonly ViewOpIR[])[];
    if (blocks.length > 1) return "many";
    const bounds = blocks.map((block) => {
      let bound: QueryPromise = "one";
      const cap = (next: QueryPromise): void => {
        if (next === "many" || bound === "many") bound = "many";
        else if (next === "optional" || bound === "optional") bound = "optional";
      };
      const scheduled = scheduleBlock(block, new Set(ins), `View "${ref.viewName}"`);
      for (const op of scheduled.ordered) {
        const opens = scheduled.opens.get(op) ?? [];
        switch (op.op) {
          case "find":
          case "whether": {
            const promise = this.lineRefPromise(op, `View "${ref.viewName}"`);
            if (promise === "many" && opens.length > 0) cap("many");
            else if (op.op === "find" && (promise !== "one" || this.lineTests(op, opens))) {
              cap("optional");
            }
            break;
          }
          case "no":
          case "holds":
            cap("optional");
            break;
          case "custom":
            cap("optional");
            break;
          default:
            break;
        }
      }
      return bound;
    });
    return bounds[0] ?? "one";
  }

  /** The declared promise of a query or view line. */
  private lineRefPromise(
    op: Extract<ViewOpIR, { op: "find" | "whether" | "no" }>,
    diagnosticSite: string,
  ): QueryPromise {
    if (viewLineIR(op)) {
      const nested = (liveOf(op) as RelationView | undefined) ?? this.views.get(op.view);
      if (nested !== undefined) return nested.promise ?? "optional";
      return "optional";
    }
    if (op.query === undefined) return "many";
    const query = this.resolver.query(op.query.concept, op.query.query, diagnosticSite);
    return query.queryPromise ?? "many";
  }

  /** Whether a line can drop its case: any tested out slot, or any `.is.not` slot. */
  private lineTests(
    op: Extract<ViewOpIR, { op: "find" | "whether" }>,
    opens: readonly string[],
  ): boolean {
    if ("not" in op && op.not !== undefined && Object.keys(op.not).length > 0) return true;
    const tested = Object.entries(op.out).some(([, value]) => {
      const names = varNamesInPattern({ value } as PatternIR);
      return names.length === 0 || names.some((name) => !opens.includes(name));
    });
    return tested;
  }

  /**
   * The unused-opened-name lint: a name a line opens and nothing reads —
   * no later line, no consequence, no declared output — is an error; omit
   * the key instead. `extra` lists the names the surrounding shape consumes
   * (a reaction's consequence inputs, a view's declared outs).
   */
  private lintOpenedNames(
    ordered: readonly (WhereOpIR | ViewOpIR)[],
    opens: ReadonlyMap<WhereOpIR | ViewOpIR, string[]>,
    extra: readonly string[],
    site: string,
  ): void {
    const counts = new Map<string, number>();
    const add = (name: string): void => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    for (const op of ordered) for (const name of opNamesIR(op)) add(name);
    for (const name of extra) add(name);
    for (const op of ordered) {
      if (op.op === "earlier") continue;
      for (const name of opens.get(op) ?? []) {
        if ((counts.get(name) ?? 0) <= 1) {
          throw new Error(`${site}: "${name}" is opened and never used — omit the key instead.`);
        }
      }
    }
  }

  /** One IR op's names bind here, and its opaque escapes carry their live values. */
  private assertOpUsable(op: ViewOpIR, site: string, kind: "Former" | "View" | "Reaction"): void {
    switch (op.op) {
      case "find":
      case "whether":
      case "no":
        if (viewLineIR(op)) {
          if (liveOf(op) === undefined && !this.views.has(op.view)) {
            throw new Error(
              `${kind} "${site}": view "${op.view}" is not registered — ` +
                "registerViews(...) before the reactions that ask it.",
            );
          }
        } else if (op.query !== undefined) {
          this.resolver.query(op.query.concept, op.query.query, `${kind} "${site}"`);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      case "count":
        this.resolver.query(op.query.concept, op.query.query, `${kind} "${site}"`);
        this.assertPatternUsable(op.in, site, kind);
        break;
      case "holds": {
        const installed = liveOf(op) as ComputationRef | undefined;
        if (installed !== undefined) {
          this.resolveAuthoredComputation(installed, `${kind} "${site}"`);
        } else if (!this.computations.has(op.computation)) {
          throw new Error(`${kind} "${site}": computation "${op.computation}" is not registered.`);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      }
      case "compute": {
        const installed = liveOf(op) as ComputationRef | undefined;
        if (installed !== undefined) {
          this.resolveAuthoredComputation(installed, `${kind} "${site}"`);
        } else {
          this.resolver.computation(op.computation, `${kind} "${site}"`, true);
        }
        this.assertPatternUsable(op.in, site, kind);
        break;
      }
      case "custom":
        if (liveOf(op) === undefined) {
          throw new Error(
            `${kind} "${site}": a custom op (${op.fnRef}) is opaque code and cannot be ` +
              "re-registered from data.",
          );
        }
        break;
    }
  }

  /** Every opaque `$is` marker in a pattern must carry its definition-site matcher. */
  private assertPatternUsable(
    pattern: unknown,
    site: string,
    kind: "Former" | "View" | "Reaction",
  ): void {
    walkValueTree(pattern, (node) => {
      if (
        typeof node === "object" &&
        node !== null &&
        hasMarkerKey(node, "$is") &&
        liveOf(node) === undefined
      ) {
        throw new Error(
          `${kind} "${site}": an "$is" matcher (${String((node as { $is: unknown }).$is)}) is ` +
            "opaque code and cannot be re-registered from data.",
        );
      }
    });
  }

  /** Swap a pattern's static action ref for the live instrumented action. */
  private resolveActionPatternRefs(pattern: ActionPattern, site: string): void {
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

  /** The live instrumented query a static query ref names (identity for live queries). */
  private liveQueryOf(query: InstrumentedQuery, site: string): InstrumentedQuery {
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

  /**
   * Resolve one authored where op: a static query ref becomes the live
   * instrumented query (the op rebuilt in place, brand kept), an authored
   * computation must be the installed reference, an `earlier` read's action
   * ref resolves in place. A view line is already data and passes through
   * whole.
   */
  private resolveAuthoredOp(op: AnyWhereOp, site: string): AnyWhereOp {
    switch (op.op) {
      case "find":
      case "whether":
      case "no": {
        if (op.query === undefined) return op;
        const query = this.liveQueryOf(op.query, site);
        if (query === op.query) return op;
        return brandWhereOp({ ...op, query });
      }
      case "compute":
        this.resolveAuthoredComputation(op.computation, site);
        return op;
      case "holds":
        this.resolveAuthoredComputation(op.fused.computation, site);
        return op;
      case "earlier":
        this.resolveActionPatternRefs(op.pattern, site);
        return op;
      case "custom":
        return op;
    }
  }

  /** Vocabulary refs must belong to this assembly. */
  private resolveAuthoredComputation(ref: ComputationRef, site: string): ComputationRef {
    const existing = this.computations.get(ref.computationName);
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

  /** Resolve refs through a then pipeline: step actions and transforms. */
  private resolveThenNodes(nodes: readonly ThenNode[], site: string): void {
    for (const node of nodes) {
      this.resolveActionPatternRefs(node.action, site);
      const authored = node.transformOps;
      if (authored !== undefined) {
        const ops = authored.map((op) => this.resolveAuthoredOp(op, site) as WhereOp);
        node.transformOps = ops;
        node.transform = (frames) => applyWhereOps(frames, ops, this.readEnv());
      }
    }
  }

  // ── Indexing: a sentence names at most one definition ────────────────────

  /**
   * The one idempotency guard behind view and former registration: a sentence
   * names at most one definition. Returns `true` when the name is free and the
   * caller should install `candidate`. Registering the same reference, or one
   * that serializes identically, returns `false` — the existing registration
   * remains registered and the caller does nothing. A different definition under
   * a name already taken is the error two `${kind}`s may not license: they
   * would disagree about what one sentence means (`elaborate` appends that
   * clause, as the index sites spell it out and the IR sites do not).
   */
  private registerUnique<Ref extends object>(
    map: Map<string, Ref>,
    name: string,
    candidate: object,
    candidateIR: () => unknown,
    serializeExisting: (ref: Ref) => unknown,
    kind: string,
    elaborate: boolean,
  ): boolean {
    const existing = map.get(name);
    if (existing === undefined) return true;
    if (existing === candidate) return false;
    if (JSON.stringify(serializeExisting(existing)) === JSON.stringify(candidateIR())) return false;
    const detail = elaborate
      ? ` — two ${kind.toLowerCase()}s may not disagree about what one sentence means.`
      : ".";
    throw new Error(`${kind} "${name}" is already registered with a different definition${detail}`);
  }

  /**
   * Index every view a declaration references (through `keep`, in the reaction's
   * own where or a step's), plus the views those rest on. Two views may share
   * a sentence only when they mean the same thing — same serialized
   * definition — so concept instances can be rebuilt without collisions while
   * two genuinely different definitions of one sentence stay an error.
   */
  private indexDeclaredViews(decl: ReactionDeclaration): void {
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
    fromOps(decl.whereOps);
    for (const node of decl.then) fromOps(node.transformOps);
  }

  /** Index every former a declaration's then inputs reference. */
  private indexDeclaredFormers(decl: ReactionDeclaration): void {
    for (const node of decl.then) {
      for (const fused of fusedFormersOf(node.action.input)) this.indexFormer(fused.former);
    }
  }

  private indexView(ref: RelationView): void {
    if (
      !this.registerUnique(
        this.views,
        ref.viewName,
        ref,
        () => serializeView(ref),
        serializeView,
        "View",
        true,
      )
    ) {
      return;
    }
    for (const channel of viewChannelsOfView(
      ref as { alternatives: readonly (readonly ViewOpIR[])[] },
    )) {
      if (channel.live !== undefined) this.indexView(channel.live);
    }
    this.assertViewUsable(ref);
    this.views.set(ref.viewName, ref);
  }

  private indexFormer(ref: FormerRef): void {
    if (
      !this.registerUnique(
        this.formers,
        ref.formerName,
        ref,
        () => serializeFormer(ref),
        serializeFormer,
        "Former",
        true,
      )
    ) {
      return;
    }
    for (const channel of viewChannelsOfFormer(ref)) {
      if (channel.live !== undefined) this.indexView(channel.live);
    }
    // Spliced fragments are dependencies: registered first, like nested views.
    for (const channel of fragmentChannelsOfFormer(ref)) {
      if (channel.live !== undefined) this.indexFormer(channel.live);
    }
    this.assertFormable(ref);
    this.formers.set(ref.formerName, ref);
  }

  // ── Binding: the IR's names resolve to live actions ──────────────────────

  private bindActionTrigger(clause: ActionTriggerIR, reactionName: string): ActionPattern {
    this.assertPatternUsable(clause.input, reactionName, "Reaction");
    this.assertPatternUsable(clause.output, reactionName, "Reaction");
    return this.resolver.action(
      clause.concept,
      clause.action,
      clause.input,
      clause.output,
      reactionName,
      clause.posture,
      clause.by,
    );
  }

  private bindTrigger(clause: TriggerIR, reactionName: string): TriggerPattern {
    if (clause.kind === "channel") {
      this.assertPatternUsable(clause.pattern, reactionName, "Reaction");
      return {
        channel: clause.channel,
        pattern: clause.pattern,
        except: clause.except.map((name) => this.resolver.concept(name, reactionName)),
        ...(clause.exceptBy !== undefined ? { exceptBy: [...clause.exceptBy] } : {}),
        ...(clause.by !== undefined ? { by: clause.by } : {}),
      };
    }
    return this.bindActionTrigger(clause, reactionName);
  }

  /** A consequence input's `$former` references must be carried or registered. */
  private assertConsequenceUsable(input: PatternIR, site: string): void {
    walkValueTree(input, (node) => {
      if (typeof node !== "object" || node === null) return;
      if (hasMarkerKey(node, "$former") && liveOf(node) === undefined) {
        const name = (node as { $former: { name: string } }).$former.name;
        if (!this.formers.has(name)) {
          throw new Error(
            `Reaction "${site}": former "${name}" is not registered — ` +
              "registerFormers(...) before the reactions that respond with it.",
          );
        }
      }
    });
    this.assertPatternUsable(input, site, "Reaction");
  }

  /**
   * Bind one reaction's IR against this registry: trigger and consequence
   * actions resolve to their live instrumented members, where ops are
   * validated (names bind; opaque escapes must carry their definition-site
   * live values), and `earlier` reads bind their action patterns. The IR
   * itself is what executes — binding adds liveness, never a second form.
   */
  bindReaction(reaction: ReactionIR): BoundReaction {
    if (reaction.then.length !== 1) {
      throw new Error(`Reaction "${reaction.name}": expected exactly one consequence.`);
    }
    const consequence = reaction.then[0];
    const initial = new Set<string>();
    for (const clause of reaction.when) {
      const patterns = clause.kind === "channel" ? [clause.pattern] : [clause.input, clause.output];
      for (const pattern of patterns) {
        for (const name of varNamesInPattern(pattern)) initial.add(name);
      }
    }
    // Conjunction is orderless; the schedule derives the evaluable order,
    // and the registered order is the derived one — what exports is what runs.
    const scheduled = scheduleBlock(reaction.where, initial, `Reaction "${reaction.name}"`);
    reaction.where.splice(0, reaction.where.length, ...scheduled.ordered);
    for (const name of varNamesInPattern(consequence.input)) {
      if (!scheduled.bound.has(name)) {
        throw new Error(
          `Reaction "${reaction.name}": consequence input uses "${name}" before it is bound.`,
        );
      }
    }
    this.assertConsequenceUsable(consequence.input, reaction.name);
    const bound: BoundReaction = {
      name: reaction.name,
      when: reaction.when.map((clause) => this.bindTrigger(clause, reaction.name)),
      step: {
        kind: "step",
        action: this.resolver.action(
          consequence.concept,
          consequence.action,
          consequence.input,
          undefined,
          reaction.name,
        ),
      },
    };
    const whereFn = liveOf(reaction) as WhereFn | undefined;
    if (whereFn !== undefined) {
      bound.whereFn = whereFn;
    } else if (reaction.where.length > 0) {
      bound.whereOps = reaction.where.map((op) => {
        if (op.op === "earlier") {
          return {
            op: "earlier" as const,
            pattern: this.bindActionTrigger(op.when, reaction.name),
          };
        }
        this.assertOpUsable(op, reaction.name, "Reaction");
        return op;
      });
    }
    return bound;
  }

  /** A registered former, by sentence — how consequence `$former` markers fuse. */
  formerNamed(name: string): FormerRef | undefined {
    return this.formers.get(name);
  }

  /**
   * Register views from their exported IR — which is the registered form
   * itself, dependencies first. Concept and computation references are
   * validated by name, a nested view by its sentence against the views
   * already registered here — which is also what keeps a crafted cycle out:
   * a view can only rest on views that already exist.
   */
  registerViews(views: ViewIR[]): void {
    this.assertViewDag(views);
    for (const ir of views) {
      if (!this.registerUnique(this.views, ir.name, ir, () => ir, serializeView, "View", false)) {
        continue;
      }
      const ref = relationViewWith(
        ir.name,
        ir.ins ?? slotsOf(ir.name),
        ir.outs ?? [],
        ir.promise,
        ir.alternatives,
      );
      this.assertViewUsable(ref);
      this.views.set(ir.name, ref);
    }
  }

  /**
   * Views form a DAG. The authored API prevents a direct cycle because a view
   * can only use existing references; batch registration checks the named
   * graph outright and prints any cycle it finds.
   */
  private assertViewDag(views: ViewIR[]): void {
    const batch = new Map(views.map((ir) => [ir.name, ir]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, path: string[]): void => {
      if (done.has(name)) return;
      if (visiting.has(name)) {
        const cycle = [...path.slice(path.indexOf(name)), name].join(" → ");
        throw new Error(`Views form a DAG — this registration has a cycle: ${cycle}.`);
      }
      const ir = batch.get(name);
      if (ir === undefined) return;
      visiting.add(name);
      for (const block of ir.alternatives) {
        for (const op of block) {
          if (viewLineIR(op)) visit(op.view, [...path, name]);
        }
      }
      visiting.delete(name);
      done.add(name);
    };
    for (const ir of views) visit(ir.name, []);
  }

  /**
   * Register formers from their exported IR — which is the registered form
   * itself. Concept and query references are validated by name. Every view
   * named inside a selection, including its dependencies, must already be
   * registered; spliced fragments resolve against registered formers.
   */
  registerFormers(formers: FormerIR[]): void {
    for (const ir of formers) {
      if (
        !this.registerUnique(this.formers, ir.name, ir, () => ir, serializeFormer, "Former", false)
      ) {
        continue;
      }
      const slots = slotsOf(ir.name);
      const ref = formerRefWith(
        ir.name,
        slots,
        slots.map((slot) => Symbol(slot)),
        ir.promise,
        ir.body,
      );
      this.assertFormable(ref);
      this.formers.set(ir.name, ref);
    }
  }
}
