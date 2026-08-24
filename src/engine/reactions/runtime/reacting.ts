/** Stable internal facade for reaction registration, instrumentation, and execution. */

import { setOwn } from "@engine/utils/own-property";
import type { ComputationRef } from "@engine/reads/computations";
import type { AuthoredDeclarationIdentity } from "@engine/reads/declaration-identity";
import type { ReadEnv } from "@engine/reads/definition-registry";
import { Frames, varKeyOf } from "@engine/reads/frames";
import { isFusedFormer } from "@engine/reads/former-nodes";
import type { FormerRef, FusedFormer } from "@engine/reads/former-nodes";
import { formTree } from "@engine/reads/former-evaluation";
import type { AppIR, FormerIR, ReactionIR, ViewIR } from "@engine/reads/ir";
import {
  type LoweredReaction,
  lowerReaction,
  serializeReactionFamily,
  serializeUnloweredReaction,
} from "@engine/reads/reaction-lowering";
import { readBackReaction } from "@engine/reads/read-back";
import { assertThenInputsAreData, lintReactionOpens } from "@engine/reads/reaction-validation";
import { Registry } from "@engine/reads/definition-registry";
import type { BoundReaction, BoundWhereOp } from "@engine/reads/definition-registry";
import { applyWhereOps } from "@engine/reads/where-evaluation";
import type { AnyWhereOp } from "@engine/reads/where-ops";
import type { RelationView } from "@engine/reads/lines";
import { canonicalJson } from "@engine/utils/canonical-json";
import { logger } from "@engine/utils/logger";
import { uuid } from "@engine/utils/runtime";
import { $vars } from "../authoring/vars.ts";
import { declarationsOf } from "../authoring/partitions.ts";
import { actionNameOf, conceptNameOf } from "../concepts/introspect.ts";
import { flow, landing } from "../context.ts";
import type {
  ActionTriggerPattern,
  ExecutableReaction,
  Frame,
  InstrumentedAction,
  ReactionDeclaration,
  ReactionMap,
  WhereFn,
} from "../types.ts";
import { ActionScheduler } from "./action-scheduler.ts";
import { ActionConcept, breachLimit, type ActionRecord } from "./actions.ts";
import { FiringBook } from "./firing.ts";
import { FiringPipeline } from "./firing-pipeline.ts";
import { ConceptInstrumentation, type QueryCacheMode } from "./instrumenting.ts";
import { Logging, ReactionLogger } from "./logging.ts";
import type { EngineObserver } from "./logging.ts";
import type { ExecutionControl } from "./operational.ts";
import { ReactionCatalog } from "./reaction-catalog.ts";
import { exportConcepts, exportReactions, readBack, renderApp } from "./reacting-export.ts";
import { matchArguments as matchActionArguments } from "./matching.ts";
import { TriggerMatcher } from "./matching.ts";

export class Reacting {
  public Action: ActionConcept;
  private readonly registry = new Registry();
  private readonly catalog = new ReactionCatalog();
  private readonly reactionLogger: ReactionLogger;
  private readonly firingBook: FiringBook;
  private readonly actionScheduler = new ActionScheduler();
  private readonly instrumentation: ConceptInstrumentation;
  private readonly triggerMatcher: TriggerMatcher;
  private readonly firingPipeline: FiringPipeline;
  private readonly execution?: ExecutionControl;

  constructor(
    actionConcept: ActionConcept = new ActionConcept(),
    execution?: ExecutionControl,
    requireDeclaredRefusals = false,
    queryCache: QueryCacheMode = "memoize",
  ) {
    this.Action = actionConcept;
    this.execution = execution;
    this.reactionLogger = new ReactionLogger(actionConcept, actionConcept.redactor);
    this.firingBook = new FiringBook(
      actionConcept.store,
      (flowToken) => {
        if (this.execution?.firing(flowToken) === false) {
          throw breachLimit(this.Action, flowToken, "firings");
        }
      },
      actionConcept.redactor,
    );
    this.instrumentation = new ConceptInstrumentation({
      actions: actionConcept,
      scheduler: this.actionScheduler,
      execution,
      requireDeclaredRefusals,
      queryCache,
      react: (record, durationMs) => this.react(record, durationMs),
      settle: (flowToken) => this.firingPipeline.settle(flowToken),
      emit: (record, durationMs) => this.reactionLogger.emit(record, durationMs),
      registerConcept: (name, instrumented) => this.registry.registerConcept(name, instrumented),
    });
    this.triggerMatcher = new TriggerMatcher(
      actionConcept,
      this.firingBook,
      (instrumented) => this.instrumentation.rawConceptOf(instrumented),
      (flowToken, count) => this.assertRows(flowToken, count),
    );
    this.firingPipeline = new FiringPipeline(
      this.triggerMatcher,
      actionConcept,
      this.firingBook,
      this.registry,
      this.reactionLogger,
      (record, durationMs) => this.react(record, durationMs),
      (flowToken, count) => this.assertRows(flowToken, count),
      (flowToken) => this.consumeAction(flowToken),
    );
  }

  addObserver(observer: EngineObserver): () => void {
    return this.reactionLogger.addObserver(observer);
  }

  clearObservers(): void {
    this.reactionLogger.clearObservers();
  }

  get logging(): Logging {
    return this.reactionLogger.level;
  }

  set logging(level: Logging) {
    this.reactionLogger.level = level;
  }

  registerComputations(computations: Record<string, ComputationRef>): void {
    this.registry.registerComputations(computations);
  }

  invalidateAllCaches(): void {
    this.instrumentation.invalidateAll();
  }

  register(
    reactions: ReactionMap,
    authoredByBase: Readonly<Record<string, AuthoredDeclarationIdentity>> = {},
  ): void {
    const prepared = Object.entries(reactions).map(([base, reaction]) => {
      const authored = authoredByBase[base];
      const lowered: Array<{
        executable: ExecutableReaction;
        reaction: ReactionIR;
      }> = [];
      const unlowered: Array<{
        definition: ReturnType<typeof serializeUnloweredReaction>;
        executable: ExecutableReaction;
      }> = [];
      const storedByName = new Map<string, string>();
      declarationsOf(reaction($vars)).forEach((raw, index) => {
        const name = index === 0 ? base : `${base}:${index + 1}`;
        const declaration: ReactionDeclaration = {
          ...raw,
          then: Array.isArray(raw.then) ? raw.then : [raw.then],
        };
        this.registry.resolveDeclaration(name, declaration);
        assertThenInputsAreData(name, declaration.then);
        lintReactionOpens(name, declaration);
        const outcome = lowerReaction(declaration.path === undefined ? name : base, declaration);
        if (outcome.reason?.includes("before it is bound") === true) {
          const path = declaration.path?.join(" → ") ?? "main";
          throw new Error(`Reaction "${base}", path "${path}": ${outcome.reason}.`);
        }
        this.registry.indexDeclarationReads(declaration);
        if (outcome.reactions !== undefined) {
          const encodedFamily = serializeReactionFamily(outcome.reactions, authored);
          for (const [stage, live] of outcome.reactions.entries()) {
            const encoded = encodedFamily[stage];
            const serialized = canonicalJson(encoded);
            const previous = storedByName.get(encoded.name);
            if (previous !== undefined) {
              if (previous !== serialized) {
                throw new Error(
                  `register: reaction "${base}" produces different entries named "${encoded.name}".`,
                );
              }
              continue;
            }
            storedByName.set(encoded.name, serialized);
            lowered.push({
              reaction: encoded,
              executable: this.compileReaction(
                live.whereFn !== undefined ? live : this.registry.bindReaction(encoded),
              ),
            });
          }
          return;
        }

        const deferredStage = declaration.then.findIndex(
          (step, stage) => stage > 0 && step.deferred === true,
        );
        if (deferredStage > 0) {
          const path = declaration.path?.join(" → ") ?? "main";
          throw new Error(
            `Reaction "${base}", path "${path}": stage ${deferredStage + 1} states ` +
              "afterFlowSettles(), which needs its stage to lower into its own reaction — " +
              `${outcome.reason ?? "not lowerable"}.`,
          );
        }

        const ops = [...(declaration.whereOps ?? []), ...(declaration.then[0]?.whereOps ?? [])];
        const where = this.compileWhere(declaration.where, ops);
        unlowered.push({
          definition: serializeUnloweredReaction(
            name,
            outcome.reason ?? "not lowerable",
            declaration,
            authored,
          ),
          executable: {
            name,
            when: declaration.when,
            ...(where !== undefined ? { where } : {}),
            then: declaration.then,
          },
        });
      });
      const names = [
        ...lowered.map(({ reaction }) => reaction.name),
        ...unlowered.map(({ definition }) => definition.name),
      ];
      return { base, lowered, names, unlowered };
    });

    const claims = new Map<string, string>();
    for (const family of prepared) {
      for (const name of family.names) {
        const claimedBy = claims.get(name);
        if (claimedBy !== undefined && claimedBy !== family.base) {
          throw new Error(
            `register: reactions "${claimedBy}" and "${family.base}" both produce "${name}".`,
          );
        }
        const currentOwner = this.catalog.ownerOf(name);
        if (currentOwner !== undefined && currentOwner !== family.base) {
          throw new Error(
            `register: reaction "${family.base}" produces "${name}", already owned by "${currentOwner}".`,
          );
        }
        claims.set(name, family.base);
      }
    }

    for (const family of prepared) this.catalog.unregisterBase(family.base);
    for (const family of prepared) {
      for (const entry of family.lowered) {
        this.catalog.index(entry.executable);
        if (this.logging !== Logging.OFF) {
          logger.info(readBackReaction(entry.reaction, this.registry.readBackEnv()));
        }
      }
      for (const entry of family.unlowered) {
        this.catalog.markUnlowered(entry.definition);
        this.catalog.index(entry.executable);
      }
      this.catalog.finishBase(
        family.base,
        family.names,
        family.lowered.map(({ reaction }) => reaction),
      );
    }
  }

  readEnv(): ReadEnv {
    return this.registry.readEnv();
  }

  async form(fused: FusedFormer): Promise<unknown> {
    if (!isFusedFormer(fused)) {
      throw new Error(
        "form(...) takes a named former with its input mapping filled, " +
          "for example form(roomDashboard(room)).",
      );
    }
    const flowToken = uuid();
    const route = `form:${fused.former.formerName}`;
    if (this.execution?.admitFlow?.(flowToken, route, flowToken) !== undefined) {
      throw new Error(`Read "${route}" is unavailable.`);
    }
    if (this.execution !== undefined) this.instrumentation.invalidateAll();
    try {
      this.registry.assertFormable(fused.former);
      return await formTree(fused, this.registry.readEnv(), (count) =>
        this.assertRows(flowToken, count),
      );
    } finally {
      this.Action.store.flowSettled(flowToken);
      this.execution?.flowSettled?.(flowToken);
    }
  }

  readBack(): string {
    return readBack({ registry: this.registry, exportReactions: () => this.exportReactions() });
  }

  exportReactions(): AppIR {
    return exportReactions({
      loweredReactions: this.catalog.loweredGroups(),
      unloweredReactions: this.catalog.unloweredEntries(),
      registry: this.registry,
    });
  }

  exportConcepts() {
    return exportConcepts({
      registry: this.registry,
      rawConceptOf: (instrumented) => this.instrumentation.rawConceptOf(instrumented),
    });
  }

  renderApp(title = "Application"): string {
    return renderApp(
      {
        registry: this.registry,
        rawConceptOf: (instrumented) => this.instrumentation.rawConceptOf(instrumented),
        exportReactions: () => this.exportReactions(),
      },
      title,
    );
  }

  registerReactions(reactions: ReactionIR[]): void {
    for (const reaction of reactions) {
      const bound = this.registry.bindReaction(reaction);
      this.catalog.unregisterBase(this.catalog.ownerOf(reaction.name) ?? reaction.name);
      this.catalog.index(this.compileReaction(bound));
      if (this.logging !== Logging.OFF) {
        logger.info(readBackReaction(reaction, this.registry.readBackEnv()));
      }
      this.catalog.finishBase(reaction.name, [reaction.name], [reaction]);
    }
  }

  registerViews(views: ViewIR[]): void {
    this.registry.registerViews(views);
  }

  declareFormers(...refs: FormerRef[]): void {
    this.registry.declareFormers(...refs);
  }

  declareAuthoredFormers(
    ...declarations: ReadonlyArray<readonly [FormerRef, AuthoredDeclarationIdentity]>
  ): void {
    this.registry.declareAuthoredFormers(...declarations);
  }

  declareViews(...refs: RelationView[]): void {
    this.registry.declareViews(...refs);
  }

  declareAuthoredViews(
    ...declarations: ReadonlyArray<readonly [RelationView, AuthoredDeclarationIdentity]>
  ): void {
    this.registry.declareAuthoredViews(...declarations);
  }

  registerFormers(formers: FormerIR[]): void {
    this.registry.registerFormers(formers);
  }

  async react(record: ActionRecord, durationMs?: number): Promise<void> {
    if (durationMs !== undefined) {
      const stored = this.Action._getById(record.id);
      const result =
        stored?.fault !== undefined
          ? "fault"
          : stored?.outcome?.kind === "error"
            ? "refusal"
            : "success";
      this.Action.operational?.emit(
        this.Action.operational.withContext(record.flow, {
          type: "action-settled",
          at: Date.now(),
          flow: record.flow,
          actionId: record.id,
          concept: conceptNameOf(record.concept),
          action: actionNameOf(record.action),
          ...(record.by === undefined ? {} : { reaction: record.by }),
          result,
          durationMs,
        }),
      );
    }
    this.reactionLogger.action(record, durationMs);
    const candidates = this.catalog.candidates(
      record.action as InstrumentedAction,
      this.triggerMatcher.posture(record),
    );
    if (candidates === undefined) {
      this.reactionLogger.emit(record, durationMs);
      return;
    }
    await this.firingPipeline.fire(record, candidates);
    this.reactionLogger.emit(record, durationMs);
  }

  instrumentConcept<T extends object>(concept: T, name?: string): T {
    return this.instrumentation.instrumentConcept(concept, name);
  }

  instrument<T extends Record<string, object>>(concepts: T): T;
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object> | object): Record<string, object> | object {
    return this.instrumentation.instrument(concepts);
  }

  private compileReaction(reaction: BoundReaction | LoweredReaction): ExecutableReaction {
    const where = this.compileWhere(reaction.whereFn, reaction.whereOps);
    return {
      name: reaction.name,
      when: reaction.when,
      ...(where !== undefined ? { where } : {}),
      then: [reaction.step],
    };
  }

  private compileWhere(
    whereFn: WhereFn | undefined,
    whereOps: readonly (BoundWhereOp | AnyWhereOp)[] | undefined,
  ): WhereFn | undefined {
    if (whereFn === undefined) {
      return whereOps === undefined
        ? undefined
        : (frames) => this.applyLoweredWhere(frames, whereOps);
    }
    if (whereOps === undefined || whereOps.length === 0) return whereFn;
    return async (frames) => {
      const filtered = await whereFn(frames);
      if (!(filtered instanceof Frames)) {
        throw new TypeError("A reaction where function must return Frames.");
      }
      return this.applyLoweredWhere(filtered, whereOps);
    };
  }

  private async applyLoweredWhere(
    frames: Frames,
    ops: readonly (BoundWhereOp | AnyWhereOp)[],
  ): Promise<Frames> {
    let current = frames;
    const optionalBindings = new Set<string | symbol>();
    for (const op of ops) {
      if (op.op === "whether") {
        for (const pattern of Object.values(op.out)) {
          const key = varKeyOf(pattern);
          if (key !== undefined) optionalBindings.add(key);
        }
      }
      current =
        op.op === "earlier"
          ? this.applyEarlier(current, op.pattern)
          : op.op === "now"
            ? this.applyNow(current, op.out)
            : await applyWhereOps(current, [op], this.registry.readEnv(), (count) =>
                this.assertRows(
                  typeof current[0]?.[flow] === "string" ? current[0][flow] : "",
                  count,
                ),
              );
      if (current.length === 0) break;
    }
    if (optionalBindings.size === 0) return current;
    return current.map((frame) => {
      const filled = { ...frame };
      for (const key of optionalBindings) {
        if (!Object.hasOwn(filled, key)) setOwn(filled, key, null);
      }
      return filled;
    });
  }

  private applyNow(frames: Frames, variable: string | symbol): Frames {
    return frames.map((frame) => {
      const flowToken = frame[flow];
      const instant =
        typeof flowToken === "string" ? this.Action._flowInstant(flowToken) : undefined;
      if (instant === undefined) {
        throw new Error("now(...) can only evaluate inside an active causal flow.");
      }
      return { ...frame, [variable]: instant };
    });
  }

  private applyEarlier(frames: Frames, pattern: ActionTriggerPattern): Frames {
    const result: Frame[] = [];
    for (const frame of frames) {
      const flowToken = frame[flow];
      const records =
        typeof flowToken === "string" ? (this.Action._getByFlow(flowToken) ?? []) : [];
      const landingId = frame[landing];
      const position =
        typeof landingId === "string"
          ? records.findIndex((candidate) => candidate.id === landingId)
          : -1;
      const scope = position >= 0 ? records.slice(0, position) : records;
      for (const record of scope) {
        const probe = Symbol("earlier");
        const matched = matchActionArguments(
          this.Action._matchingRecord(record),
          pattern,
          frame,
          probe,
        );
        if (matched !== undefined) {
          const { [probe]: _recordId, ...rest } = matched;
          this.assertRows(typeof flowToken === "string" ? flowToken : "", result.length + 1);
          result.push(rest);
        }
      }
    }
    return new Frames(...result);
  }

  private assertRows(flowToken: string, count: number): void {
    if (this.execution?.rows(count) === false) throw breachLimit(this.Action, flowToken, "rows");
  }

  private consumeAction(flowToken: string): boolean {
    if (this.execution?.action(flowToken) === false) {
      breachLimit(this.Action, flowToken, "actions");
      return false;
    }
    return true;
  }
}
