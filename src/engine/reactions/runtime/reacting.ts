/** Stable internal facade for reaction registration, instrumentation, and execution. */

import { setOwn } from "@engine/utils/own-property";
import type { ComputationRef } from "@engine/reads/computations";
import type { ReadEnv } from "@engine/reads/env";
import { Frames, varKeyOf } from "@engine/reads/frames";
import { isFusedFormer } from "@engine/reads/former-nodes";
import type { FormerRef, FusedFormer } from "@engine/reads/former-nodes";
import { formTree } from "@engine/reads/former-evaluation";
import type { AppIR, FormerIR, ReactionIR, ViewIR } from "@engine/reads/ir";
import {
  type LoweredReaction,
  lowerReaction,
  serializeReaction,
  serializeUnloweredReaction,
} from "@engine/reads/reaction-lowering";
import { readBackReaction } from "@engine/reads/read-back";
import {
  assertThenInputsAreData,
  copyReactionLintExtraUses,
  lintReactionOpens,
} from "@engine/reads/reaction-validation";
import { Registry } from "@engine/reads/registering";
import type { BoundReaction, BoundWhereOp } from "@engine/reads/registering";
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
  ActionPattern,
  ChannelPattern,
  ChannelPosture,
  ExecutableReaction,
  Frame,
  InstrumentedAction,
  ReactionDeclaration,
  ReactionMap,
  WhereFn,
} from "../types.ts";
import { ActionScheduler } from "./action-scheduler.ts";
import { ActionConcept, type ActionRecord } from "./actions.ts";
import { ConsequencePipeline } from "./consequence-pipeline.ts";
import { FiringBook } from "./firing.ts";
import { FiringPipeline } from "./firing-pipeline.ts";
import { ConceptInstrumentation } from "./instrumenting.ts";
import { InterpreterFailures } from "./interpreter-failures.ts";
import { Logging, ReactionLogger } from "./logging.ts";
import type { FiringRecord } from "./log-store.ts";
import type { EngineObserver } from "./observer.ts";
import { ReactionCatalog } from "./reaction-catalog.ts";
import { exportConcepts, exportReactions, readBack, renderApp } from "./reacting-export.ts";
import { matchArguments as matchActionArguments } from "./matching.ts";
import { TriggerMatcher } from "./trigger-matching.ts";

type ActionArguments = Record<string | symbol, unknown>;

interface FrameProvenance {
  flow: string;
  triggerIds: string[];
  frameTriggerIds: string[][];
  triggerSignatures?: Set<string>;
}

export class Reacting {
  public Action: ActionConcept;
  public reactions: Record<string, ExecutableReaction>;
  public reactionsByAction: Map<InstrumentedAction, Set<ExecutableReaction>>;
  public reactionsByChannel: Map<ChannelPosture, Set<ExecutableReaction>>;
  private readonly registry = new Registry();
  private readonly catalog = new ReactionCatalog();
  private readonly reactionLogger: ReactionLogger;
  private readonly firingBook: FiringBook;
  private readonly actionScheduler = new ActionScheduler();
  private readonly instrumentation: ConceptInstrumentation;
  private readonly triggerMatcher: TriggerMatcher;
  private readonly consequencePipeline: ConsequencePipeline;
  private readonly firingPipeline: FiringPipeline;
  private readonly execution?: {
    action(flow: string): boolean;
    firing(flow: string): boolean;
    rows(count: number): boolean;
    admitFlow?(flow: string, route: string, correlationId: string): unknown;
    abandon?(flow: string): void;
    flowSettled?(flow: string): void;
  };

  constructor(
    actionConcept: ActionConcept = new ActionConcept(),
    execution?: {
      action(flow: string): boolean;
      firing(flow: string): boolean;
      rows(count: number): boolean;
      admitFlow?(flow: string, route: string, correlationId: string): unknown;
      abandon?(flow: string): void;
      flowSettled?(flow: string): void;
    },
  ) {
    this.Action = actionConcept;
    this.reactions = this.catalog.reactions;
    this.reactionsByAction = this.catalog.reactionsByAction;
    this.reactionsByChannel = this.catalog.reactionsByChannel;
    this.execution = execution;
    this.reactionLogger = new ReactionLogger(actionConcept, actionConcept.redactor);
    this.firingBook = new FiringBook(
      actionConcept.store,
      (flowToken) => {
        if (this.execution?.firing(flowToken) !== false) return;
        this.recordExecutionLimit(flowToken, "firings");
        throw new Error("The flow exceeded its firing limit.");
      },
      actionConcept.redactor,
    );
    const failures = new InterpreterFailures(actionConcept);
    this.instrumentation = new ConceptInstrumentation({
      actions: actionConcept,
      scheduler: this.actionScheduler,
      execution,
      react: (record, durationMs) => this.react(record, durationMs),
      emit: (record, durationMs) => this.reactionLogger.emit(record, durationMs),
      registerConcept: (name, instrumented) => this.registry.registerConcept(name, instrumented),
    });
    this.triggerMatcher = new TriggerMatcher(
      actionConcept,
      this.firingBook,
      (instrumented) => this.instrumentation.rawConceptOf(instrumented),
      (flowToken, count) => this.assertRows(flowToken, count),
    );
    this.consequencePipeline = new ConsequencePipeline(
      actionConcept,
      this.firingBook,
      this.registry,
      failures,
      (record, durationMs) => this.react(record, durationMs),
      (flowToken, count) => this.assertRows(flowToken, count),
      (flowToken) => this.consumeAction(flowToken),
    );
    this.firingPipeline = new FiringPipeline(
      this.triggerMatcher,
      this.consequencePipeline,
      failures,
      this.reactionLogger,
      (flowToken, count) => this.assertRows(flowToken, count),
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

  invalidateCaches(concept: object): void {
    this.instrumentation.invalidate(concept);
  }

  invalidateAllCaches(): void {
    this.instrumentation.invalidateAll();
  }

  register(reactions: ReactionMap): void {
    const prepared = Object.entries(reactions).map(([base, reaction]) => {
      const leaves = declarationsOf(reaction($vars)).map((raw, index) => {
        const name = index === 0 ? base : `${base}:${index + 1}`;
        const declaration: ReactionDeclaration = {
          ...raw,
          then: Array.isArray(raw.then) ? raw.then : [raw.then],
        };
        copyReactionLintExtraUses(raw, declaration);
        this.registry.resolveDeclaration(name, declaration);
        assertThenInputsAreData(name, declaration.then);
        lintReactionOpens(name, declaration);
        const outcome = lowerReaction(declaration.path === undefined ? name : base, declaration);
        if (outcome.reason?.includes("before it is bound") === true) {
          const path = declaration.path?.join(" → ") ?? "main";
          throw new Error(`Reaction "${base}", path "${path}": ${outcome.reason}.`);
        }
        this.registry.indexDeclarationReads(declaration);
        return { name, declaration, outcome };
      });
      return { base, leaves };
    });

    const claims = new Map<string, string>();
    for (const family of prepared) {
      for (const leaf of family.leaves) {
        const names = leaf.outcome.reactions?.map((reaction) => reaction.name) ?? [leaf.name];
        for (const name of names) {
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
    }

    for (const family of prepared) this.catalog.unregisterBase(family.base);
    for (const family of prepared) {
      const stored: ReactionIR[] = [];
      const executableNames: string[] = [];
      const storedByName = new Map<string, string>();
      for (const leaf of family.leaves) {
        if (leaf.outcome.reactions !== undefined) {
          const serializedReactions = leaf.outcome.reactions.map((reaction) =>
            serializeReaction(reaction),
          );
          leaf.outcome.reactions.forEach((live, index) => {
            const reaction = serializedReactions[index];
            const serialized = canonicalJson(reaction);
            const previous = storedByName.get(reaction.name);
            if (previous !== undefined) {
              if (previous !== serialized) {
                throw new Error(
                  `register: reaction "${family.base}" produces different entries named "${reaction.name}".`,
                );
              }
              return;
            }
            storedByName.set(reaction.name, serialized);
            stored.push(reaction);
            executableNames.push(reaction.name);
            this.catalog.index(
              this.compileReaction(
                live.whereFn !== undefined ? live : this.registry.bindReaction(reaction),
              ),
            );
            if (this.logging !== Logging.OFF) {
              logger.info(readBackReaction(reaction, this.registry.readBackEnv()));
            }
          });
          continue;
        }

        this.catalog.markUnlowered(
          serializeUnloweredReaction(
            leaf.name,
            leaf.outcome.reason ?? "not lowerable",
            leaf.declaration,
          ),
        );
        executableNames.push(leaf.name);
        const ops = [
          ...(leaf.declaration.whereOps ?? []),
          ...(leaf.declaration.then[0]?.whereOps ?? []),
        ];
        const where =
          ops.length > 0
            ? (frames: Frames) => this.applyLoweredWhere(frames, ops)
            : leaf.declaration.where;
        this.catalog.index({
          name: leaf.name,
          when: leaf.declaration.when,
          ...(where !== undefined ? { where } : {}),
          then: leaf.declaration.then,
        });
      }
      this.catalog.finishBase(family.base, executableNames, stored);
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
      this.catalog.finishBase(reaction.name, [reaction.name], [reaction]);
    }
  }

  registerViews(views: ViewIR[]): void {
    this.registry.registerViews(views);
  }

  declareFormers(...refs: FormerRef[]): void {
    this.registry.declareFormers(...refs);
  }

  declareViews(...refs: RelationView[]): void {
    this.registry.declareViews(...refs);
  }

  registerFormers(formers: FormerIR[]): void {
    this.registry.registerFormers(formers);
  }

  async react(record: ActionRecord, durationMs?: number): Promise<void> {
    if (durationMs !== undefined && record.id !== undefined) {
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
    for (const reaction of candidates) await this.firingPipeline.fire(record, reaction);
    this.reactionLogger.emit(record, durationMs);
  }

  matchWhen(record: ActionRecord, reaction: ExecutableReaction): [Frames<Frame>, symbol[]] {
    return this.triggerMatcher.match(record, reaction);
  }

  matchChannel(
    record: ActionRecord,
    clause: ChannelPattern,
    frame: Frame,
    actionSymbol: symbol,
  ): Frame | undefined {
    return this.triggerMatcher.matchChannel(record, clause, frame, actionSymbol);
  }

  addThen(
    frames: Frames,
    reaction: ExecutableReaction,
    actionSymbols: symbol[],
    captured?: FrameProvenance,
    validatedTriggerIds?: string[][],
  ): Promise<void> {
    return this.firingPipeline.addThen(
      frames,
      reaction,
      actionSymbols,
      captured,
      validatedTriggerIds,
    );
  }

  matchThen(
    then: ActionPattern,
    frame: Frame,
    by?: string,
    authoritativeFlow?: string,
  ): ActionArguments {
    return this.consequencePipeline.matchThen(then, frame, by, authoritativeFlow);
  }

  _getFirings(reaction: string): FiringRecord[] {
    return this.firingBook.firings(reaction);
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
    const where: WhereFn | undefined =
      reaction.whereFn ??
      (reaction.whereOps !== undefined
        ? (frames) => this.applyLoweredWhere(frames, reaction.whereOps ?? [])
        : undefined);
    return {
      name: reaction.name,
      when: reaction.when,
      ...(where !== undefined ? { where } : {}),
      then: [reaction.step],
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

  private applyEarlier(frames: Frames, pattern: ActionPattern): Frames {
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
    if (this.execution?.rows(count) !== false) return;
    this.recordExecutionLimit(flowToken, "rows");
    throw new Error("The evaluation exceeded its row limit.");
  }

  private consumeAction(flowToken: string): boolean {
    if (this.execution?.action(flowToken) !== false) return true;
    this.recordExecutionLimit(flowToken, "actions");
    return false;
  }

  private recordExecutionLimit(flowToken: string, limit: "actions" | "firings" | "rows"): void {
    this.Action._recordIntegrityFailure({
      kind: "execution-limit",
      flow: flowToken,
      limit,
      errorClass: "ExecutionLimitExceeded",
      at: Date.now(),
    });
  }
}
