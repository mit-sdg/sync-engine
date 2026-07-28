/**
 * The reaction interpreter.
 *
 * Concepts are independent state machines; **reactions** compose them
 * declaratively. Each reaction has a `when` / `where` / `then` frame:
 *
 *  - **when**  — patterns matched against the action log. Matching binds
 *               logic variables and yields a set of {@link Frames}.
 *  - **where** — an optional pure transform over those frames (filter, query,
 *               aggregate, …) producing the final frames.
 *  - **then**  — actions to invoke, one per surviving frame, with their inputs
 *               resolved from the frame's bindings.
 *
 * Concepts are *instrumented* so that every (non-query) action invocation:
 *   1. appends a requested record under a **flow** token, reserves the action
 *      body's per-concept arrival position, and reacts to the request,
 *   2. runs the underlying action and records its return, refusal, or fault
 *      (a same-concept requested consequence can release the reserved body
 *      early so the causal chain does not deadlock),
 *   3. reacts again to that completed posture.
 *
 * A **flow** groups actions in one causal chain: actions produced by a reaction's
 * `then` inherit the triggering action's flow, and matching is restricted to a
 * single flow so independent invocations never cross-match.
 */

import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { ActionConcept, type ActionRecord, normalizeOutcome } from "./actions.ts";
import { DESCEND, mapValueTree, mapValueTreeAsync, walkValueTree } from "@engine/reads/value-tree";
import { setOwn } from "@engine/reads/brands";
import { applyWhereOps } from "@engine/reads/where-ops";
import type { AnyWhereOp } from "@engine/reads/where-ops";
import type { ComputationRef } from "@engine/reads/computations";
import type { RelationView } from "@engine/reads/lines";
import type { AppIR, FormerIR, ReactionIR, ViewIR } from "@engine/reads/ir";
import { type LoweredReaction, lowerReaction, serializeReaction } from "@engine/reads/lower";
import {
  assertThenInputsAreData,
  copyReactionLintExtraUses,
  lintReactionOpens,
} from "@engine/reads/reaction-validation";
import {
  type FormerRef,
  fuseFormer,
  type FusedFormer,
  isFusedFormer,
} from "@engine/reads/former-nodes";
import { readBackReaction } from "@engine/reads/read-back";
import { formTree } from "@engine/reads/former-evaluation";
import type { ReadEnv } from "@engine/reads/env";
import { Registry } from "@engine/reads/registering";
import type { BoundReaction, BoundWhereOp } from "@engine/reads/registering";
import { varKeyOf } from "@engine/reads/frames";
import { hasMarkerKey, liveOf } from "@engine/reads/ir";
import type { FiringRecord, ReactionFailureRecord } from "./log-store.ts";
import { Frames } from "@engine/reads/frames";
import { actionNameOf, conceptNameOf } from "../concepts/introspect.ts";
import type { EngineObserver } from "./observer.ts";
import { FiringBook, type FiringBranch, type FiringFill } from "./firing.ts";
import {
  actionId,
  actionSettlement,
  byReaction as byAskingReaction,
  flow,
  landing,
} from "../context.ts";
import type { ActionSettlement } from "../context.ts";
import {
  matchArguments as matchActionArguments,
  matchChannel as matchChannelPattern,
  postureOfOutcome,
  unifyOutputPattern as unifyActionOutput,
} from "./matching.ts";
import { Logging, ReactionLogger } from "./logging.ts";
import {
  errorOutputFromThrown,
  instrument as instrumentMany,
  instrumentConcept as instrumentSingle,
  type ActionLine,
  type InstrumentationState,
} from "./instrumenting.ts";
import type {
  ActionOutcome,
  ActionPattern,
  AnyAction,
  ChannelPattern,
  ChannelPosture,
  Frame,
  InstrumentedAction,
  Mapping,
  StepNode,
  ReactionDeclaration,
  ReactionMap,
  ExecutableReaction,
  WhereFn,
} from "../types.ts";
import { uuid } from "@engine/utils/runtime";
import { $vars } from "../authoring/vars.ts";
import { declarationsOf } from "../authoring/partitions.ts";
import { exportConcepts, exportReactions, form, readBack, renderApp } from "./reacting-export.ts";

type ActionArguments = Record<string | symbol, unknown>;

interface FrameProvenance {
  flow: string;
  triggerIds: string[];
  frameTriggerIds: string[][];
  triggerSignatures?: Set<string>;
}

export class Reacting {
  /** Registered reactions, by name. */
  public reactions: Record<string, ExecutableReaction> = {};
  /** Inverted index: which reactions care about each `when` action. */
  public reactionsByAction: Map<InstrumentedAction, Set<ExecutableReaction>> = new Map();
  /** Inverted index: which reactions watch each posture channel. */
  public reactionsByChannel: Map<ChannelPosture, Set<ExecutableReaction>> = new Map();
  /** The action log backing all matching. */
  public Action: ActionConcept;
  private readonly reactionLogger: ReactionLogger;
  private readonly firingBook: FiringBook;
  private readonly registry = new Registry();
  /** Memoizes bound/instrumented wrappers per concept instance. */
  private boundActionsByConcept: WeakMap<object, Map<AnyAction, InstrumentedAction>> =
    new WeakMap();
  /** Tracks query cache invalidators per concept instance. */
  private queryCaches: WeakMap<object, Array<{ invalidate: () => void }>> = new WeakMap();
  /** Per-concept serial lines: the tail of each concept's action queue. */
  private actionLines: WeakMap<object, ActionLine> = new WeakMap();
  /** Reserved bodies still waiting for their requested reactions to finish. */
  private waitingActionBodies = new WeakMap<object, Set<{ flow: string; release: () => void }>>();
  /** Resolves public instrumented proxies back to their cache-owning instances. */
  private rawConceptsByInstrumented = new WeakMap<object, object>();
  /** All raw concept instances known to this engine, via WeakRef so they can be GC'd. */
  private concepts = new Set<WeakRef<object>>();
  /** Registered `ReactionIR` entries per base reaction name — the exported form. */
  private loweredReactions: Map<string, ReactionIR[]> = new Map();
  /** Reactions that stayed pipelines, with the reason — visible, never silent. */
  private unloweredReactions: Map<string, string> = new Map();
  /** Every executable reaction name each base registration produced. */
  private namesByBase: Map<string, string[]> = new Map();
  private readonly execution?: {
    action(flow: string): boolean;
    firing(flow: string): boolean;
    rows(count: number): boolean;
  };

  constructor(
    actionConcept: ActionConcept = new ActionConcept(),
    execution?: {
      action(flow: string): boolean;
      firing(flow: string): boolean;
      rows(count: number): boolean;
    },
  ) {
    this.Action = actionConcept;
    this.execution = execution;
    this.reactionLogger = new ReactionLogger(actionConcept, actionConcept.redactor);
    this.firingBook = new FiringBook(
      actionConcept.store,
      (flow) => {
        if (this.execution?.firing(flow) !== false) return;
        this.recordExecutionLimit(flow, "firings");
        throw new Error("The flow exceeded its firing limit.");
      },
      actionConcept.redactor,
    );
  }

  /** Register an engine observer. Returns a function to unregister it. */
  addObserver(o: EngineObserver): () => void {
    return this.reactionLogger.addObserver(o);
  }

  /** Remove all registered observers. */
  clearObservers(): void {
    this.reactionLogger.clearObservers();
  }

  get logging(): Logging {
    return this.reactionLogger.level;
  }

  set logging(level: Logging) {
    this.reactionLogger.level = level;
  }

  /** Install one assembly's vocabulary-owned calculations. */
  registerComputations(computations: Record<string, ComputationRef>): void {
    this.registry.registerComputations(computations);
  }

  /** Invalidate all query caches for a concept — useful after external DB mutations. */
  invalidateCaches(concept: object): void {
    const rawConcept = this.rawConceptsByInstrumented.get(concept) ?? concept;
    this.queryCaches.get(rawConcept)?.forEach((c) => {
      c.invalidate();
    });
  }

  /** Invalidate query caches for every instrumented concept. */
  invalidateAllCaches(): void {
    for (const ref of this.concepts) {
      const concept = ref.deref();
      if (concept !== undefined) {
        this.invalidateCaches(concept);
      } else {
        this.concepts.delete(ref);
      }
    }
  }

  /**
   * Register named reaction functions. Each is invoked with the {@link $vars}
   * proxy to produce its declaration, checked (then inputs must be literals
   * or variables), lowered to `ReactionIR` where the shape allows (see
   * {@link lowerReaction}), and indexed by every action in each reaction's `when`.
   * A reaction that stays a pipeline executes as one and is reported as
   * unlowered by {@link exportReactions}.
   */
  register(reactions: ReactionMap): void {
    const prepared = Object.entries(reactions).map(([base, reaction]) => {
      const leaves = declarationsOf(reaction($vars)).map((raw, index) => {
        const name = index === 0 ? base : `${base}:${index + 1}`;
        const decl: ReactionDeclaration = {
          ...raw,
          then: Array.isArray(raw.then) ? raw.then : [raw.then],
        };
        copyReactionLintExtraUses(raw, decl);
        this.registry.resolveDeclaration(name, decl);
        assertThenInputsAreData(name, decl.then);
        lintReactionOpens(name, decl);
        const outcome = lowerReaction(decl.path === undefined ? name : base, decl);
        if (outcome.reason?.includes("before it is bound") === true) {
          const path = decl.path?.join(" → ") ?? "main";
          throw new Error(`Reaction "${base}", path "${path}": ${outcome.reason}.`);
        }
        this.registry.indexDeclarationReads(decl);
        return { name, decl, outcome };
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
          const currentOwner = this.ownerOf(name);
          if (currentOwner !== undefined && currentOwner !== family.base) {
            throw new Error(
              `register: reaction "${family.base}" produces "${name}", already owned by "${currentOwner}".`,
            );
          }
          claims.set(name, family.base);
        }
      }
    }

    for (const family of prepared) this.unregisterBase(family.base);

    for (const family of prepared) {
      const stored: ReactionIR[] = [];
      const executableNames: string[] = [];
      const storedByName = new Map<string, string>();
      for (const leaf of family.leaves) {
        if (leaf.outcome.reactions !== undefined) {
          // The definition boundary: lowered reactions serialize to the IR here,
          // and the IR is what is stored, compiled, and exported. The one
          // exception is a reaction carrying a closure-based `where`: the
          // closure indexes frames by the symbols it closed over, so that
          // reaction executes from its authored form while still exporting as IR.
          const reactions = leaf.outcome.reactions.map((reaction) => serializeReaction(reaction));
          leaf.outcome.reactions.forEach((live, index) => {
            const reaction = reactions[index];
            const serialized = JSON.stringify(reaction);
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
            this.indexReaction(
              this.compileReaction(
                live.whereFn !== undefined ? live : this.registry.bindReaction(reaction),
              ),
            );
            if (this.logging !== Logging.OFF)
              logger.info(readBackReaction(reaction, this.registry.readBackEnv()));
          });
          continue;
        }

        this.unloweredReactions.set(leaf.name, leaf.outcome.reason ?? "not lowerable");
        executableNames.push(leaf.name);
        const ops = [...(leaf.decl.whereOps ?? []), ...(leaf.decl.then[0]?.whereOps ?? [])];
        const where =
          ops.length > 0
            ? (frames: Frames) => this.applyLoweredWhere(frames, ops)
            : leaf.decl.where;
        this.indexReaction({
          name: leaf.name,
          when: leaf.decl.when,
          ...(where !== undefined ? { where } : {}),
          then: leaf.decl.then,
        });
      }
      if (stored.length > 0) this.loweredReactions.set(family.base, stored);
      this.namesByBase.set(family.base, executableNames);
    }
  }

  private ownerOf(name: string): string | undefined {
    for (const [base, names] of this.namesByBase) {
      if (names.includes(name)) return base;
    }
    return undefined;
  }

  /** Remove every executable reaction a previous registration of `base` produced. */
  private unregisterBase(base: string): void {
    for (const reactionName of this.namesByBase.get(base) ?? []) {
      const old = this.reactions[reactionName];
      if (old === undefined) continue;
      for (const clause of old.when) {
        if ("channel" in clause) {
          this.reactionsByChannel.get(clause.channel)?.delete(old);
        } else {
          this.reactionsByAction.get(clause.action)?.delete(old);
        }
      }
      delete this.reactions[reactionName];
      this.unloweredReactions.delete(reactionName);
    }
    this.namesByBase.delete(base);
    this.loweredReactions.delete(base);
  }

  /** Add one executable reaction to the name and trigger indexes. */
  private indexReaction(reaction: ExecutableReaction): void {
    this.reactions[reaction.name] = reaction;
    for (const clause of reaction.when) {
      if ("channel" in clause) {
        let mapped = this.reactionsByChannel.get(clause.channel);
        if (mapped === undefined) {
          mapped = new Set();
          this.reactionsByChannel.set(clause.channel, mapped);
        }
        mapped.add(reaction);
      } else {
        let mapped = this.reactionsByAction.get(clause.action);
        if (mapped === undefined) {
          mapped = new Set();
          this.reactionsByAction.set(clause.action, mapped);
        }
        mapped.add(reaction);
      }
    }
  }

  /** Compile one bound `ReactionIR` entry into an executable reaction. */
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

  /** The environment used to resolve registered names during reads. */
  readEnv(): ReadEnv {
    return this.registry.readEnv();
  }

  /** Evaluate reaction ops: `earlier` reads the flow's record; the rest are where ops. */
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
          : await applyWhereOps(current, [op], this.registry.readEnv());
      if (current.length === 0) break;
    }
    if (optionalBindings.size === 0) return current;
    return current.map((frame) => {
      const filled = { ...frame };
      for (const key of optionalBindings) {
        if (!Object.hasOwn(filled, key)) {
          setOwn(filled, key, null);
        }
      }
      return filled;
    });
  }

  /**
   * A non-consuming read of the flow's record: extend each row once per
   * record the pattern matches, exactly like `some` over concept state.
   * Nothing is consumed — the double-fire guard belongs to the trigger.
   */
  private applyEarlier(frames: Frames, pattern: ActionPattern): Frames {
    const result: Frame[] = [];
    for (const frame of frames) {
      const flowToken = frame[flow];
      const records =
        typeof flowToken === "string" ? (this.Action._getByFlow(flowToken) ?? []) : [];
      // Read as of the trigger's landing: only records that stood strictly
      // before it. What was construed at one position stays construed; a
      // record landing later never widens an earlier read.
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
          result.push(rest);
        }
      }
    }
    return new Frames(...result);
  }

  /**
   * Evaluate a fused former against this engine's concepts — the read-side
   * entry point for assembled apps. The former's names bind against this
   * engine's registry (validated once per former), and the tree is read at
   * the moment of asking.
   */
  async form(fused: FusedFormer): Promise<unknown> {
    return form({ registry: this.registry }, fused);
  }

  /** The engine states the quantities the author no longer writes: per reaction, */
  readBack(): string {
    return readBack({
      registry: this.registry,
      exportReactions: () => this.exportReactions(),
    });
  }

  /** Everything this engine knows about its registered reactions, as data. */
  exportReactions(): AppIR {
    return exportReactions({
      loweredReactions: this.loweredReactions,
      unloweredReactions: this.unloweredReactions,
      registry: this.registry,
    });
  }

  /** Inventories of every instrumented concept, in instrumentation order. */
  exportConcepts() {
    return exportConcepts({
      registry: this.registry,
      rawConceptsByInstrumented: this.rawConceptsByInstrumented,
    });
  }

  /** Render the registered concepts, views, formers, and reactions. */
  renderApp(title = "Application"): string {
    return renderApp(
      {
        registry: this.registry,
        rawConceptsByInstrumented: this.rawConceptsByInstrumented,
        exportReactions: () => this.exportReactions(),
      },
      title,
    );
  }

  /**
   * Register reactions from exported `ReactionIR` — the registered form
   * itself. Concept, query, and computation references bind by name against
   * this engine's instrumented concepts and the computation registry.
   * Exporting and re-registering the same reaction IR is behavior-preserving.
   */
  registerReactions(reactions: ReactionIR[]): void {
    for (const reaction of reactions) {
      const bound = this.registry.bindReaction(reaction);
      this.unregisterBase(this.ownerOf(reaction.name) ?? reaction.name);
      this.loweredReactions.set(reaction.name, [reaction]);
      this.namesByBase.set(reaction.name, [reaction.name]);
      this.indexReaction(this.compileReaction(bound));
    }
  }

  /**
   * Register views from their exported IR, dependencies first. Concept and
   * computation references resolve by name, a nested view by its sentence
   * against the views already registered here — which is also what keeps a
   * crafted cycle out: a view can only rest on views that already exist.
   */
  registerViews(views: ViewIR[]): void {
    this.registry.registerViews(views);
  }

  /**
   * Declare formers no reaction references — reads served at an edge or a
   * CLI — so they export and render with the rest of the application.
   */
  declareFormers(...refs: FormerRef[]): void {
    this.registry.declareFormers(...refs);
  }

  /**
   * Declare views no registered reaction consults so `exportReactions()`,
   * `readBack()`, and `renderApp()` include them. Views referenced by a reaction
   * register with that reaction.
   */
  declareViews(...refs: RelationView[]): void {
    this.registry.declareViews(...refs);
  }

  /**
   * Register formers from their exported IR. Concept and query references
   * resolve by name. Every view named by a former, including each view's
   * dependencies, must already be registered. Each `{ $var }` reference
   * creates a new binding for that former.
   */
  registerFormers(formers: FormerIR[]): void {
    this.registry.registerFormers(formers);
  }

  /**
   * React to a just-completed action: log it, then fire every reaction indexed on
   * that action whose `when` matches within the action's flow.
   */
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

    const actionReactions = this.reactionsByAction.get(record.action as InstrumentedAction);
    const channelReactions = this.channelReactionsFor(record);
    if (actionReactions === undefined && channelReactions === undefined) {
      // Notify observers even when no reactions match.
      this.reactionLogger.emit(record, durationMs);
      return;
    }
    // A reaction indexed both ways (e.g. the funnel: a request clause plus a
    // channel clause) is evaluated once — the union is a Set.
    const reactions = new Set<ExecutableReaction>([
      ...(actionReactions ?? []),
      ...(channelReactions ?? []),
    ]);

    for (const reaction of reactions) {
      let matched: Frames;
      let actionSymbols: symbol[];
      try {
        [matched, actionSymbols] = this.matchWhen(record, reaction);
        this.assertRows(record.flow, matched.length);
      } catch (err) {
        logger.error(`Reaction "${reaction.name}": trigger matching failed`, {
          error: serializeError(err),
        });
        this.appendReactionFailure(
          reaction.name,
          record.flow,
          record.id === undefined ? [] : [record.id],
          "trigger",
          err,
        );
        continue;
      }
      if (matched.length === 0) continue;

      this.reactionLogger.frames(`Matched \`reaction\`: ${reaction.name} with \`when\`:`, matched);

      const provenance = this.captureFrameProvenance(matched, record.flow, actionSymbols);
      let frameTriggerIds = provenance.frameTriggerIds;
      let frames = matched;
      if (reaction.where !== undefined) {
        try {
          const maybeFrames = reaction.where(frames);
          frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
          if (!(frames instanceof Frames)) {
            throw new TypeError("A reaction where function must return Frames.");
          }
          this.assertRows(provenance.flow, frames.length);
          frameTriggerIds = this.assertFrameProvenance(frames, provenance, actionSymbols);
        } catch (err) {
          logger.error(`Reaction "${reaction.name}": where condition evaluation failed`, {
            error: serializeError(err),
          });
          this.appendReactionFailure(
            reaction.name,
            provenance.flow,
            provenance.triggerIds,
            "where",
            err,
          );
          continue;
        }
        this.reactionLogger.frames(`After processing \`where\`:`, frames);
      }
      try {
        await this.addThen(frames, reaction, actionSymbols, provenance, frameTriggerIds);
      } catch (err) {
        logger.error(`Reaction "${reaction.name}": consequence processing failed`, {
          error: serializeError(err),
        });
        this.appendReactionFailure(
          reaction.name,
          provenance.flow,
          provenance.triggerIds,
          "consequence-dispatch",
          err,
        );
      }
    }

    this.reactionLogger.emit(record, durationMs);
  }

  /**
   * Match a reaction's `when` against the firing action's flow.
   *
   * Starts from a single seed frame carrying the flow token, then for each
   * `when` clause joins in every log record (within the flow) that matches,
   * binding logic variables along the way. Returns the resulting frames and the
   * per-clause symbols under which each matched record's id was stored.
   */
  matchWhen(record: ActionRecord, reaction: ExecutableReaction): [Frames<Frame>, symbol[]] {
    // Read the current trigger record from the store so its outcome or fault is attached.
    // The seed carries the flow token and action id used by `earlier`.
    const landed = this.Action._matchingRecord(
      (record.id !== undefined ? this.Action._getById(record.id) : undefined) ?? record,
    );
    const seed = { [flow]: record.flow, [landing]: record.id } as Frame;

    if (reaction.when.length === 1) {
      // For one trigger, evaluate only the current trigger record.
      const clause = reaction.when[0];
      const actionSymbol = Symbol("action_0");
      if (this.firingBook.hasConsumed(landed.id, reaction.name))
        return [new Frames(), [actionSymbol]];
      const matched =
        "channel" in clause
          ? this.matchChannel(landed, clause, seed, actionSymbol)
          : matchActionArguments(landed, clause, seed, actionSymbol);
      return [matched === undefined ? new Frames() : new Frames(matched), [actionSymbol]];
    }

    // A multi-clause trigger joins matching records across the flow and consumes them together.
    const flowActions = this.Action._getByFlow(record.flow);
    if (flowActions === undefined) return [new Frames(), []];

    let framesWithConsumed: [Frame, Set<string>][] = [[seed, new Set()]];
    const actionSymbols: symbol[] = [];

    reaction.when.forEach((when, i) => {
      const actionSymbol = Symbol(`action_${i}`);
      actionSymbols.push(actionSymbol);

      const next: [Frame, Set<string>][] = [];
      for (const [frame, parentConsumed] of framesWithConsumed) {
        for (const candidate of flowActions) {
          // Skip records this reaction has already consumed (double-fire guard).
          if (this.firingBook.hasConsumed(candidate.id, reaction.name)) continue;
          if (candidate.id !== undefined && parentConsumed.has(candidate.id)) continue;
          const matchingCandidate = this.Action._matchingRecord(candidate);
          const matched =
            "channel" in when
              ? this.matchChannel(matchingCandidate, when, frame, actionSymbol)
              : matchActionArguments(matchingCandidate, when, frame, actionSymbol);
          if (matched !== undefined) {
            const childConsumed = new Set(parentConsumed);
            if (candidate.id !== undefined) childConsumed.add(candidate.id);
            next.push([matched, childConsumed]);
          }
        }
      }
      framesWithConsumed = next;
    });

    const frames = new Frames(...framesWithConsumed.map(([f]) => f));
    return [frames, actionSymbols];
  }

  /**
   * Match one log record against a channel clause: the posture must be
   * the channel's, the concept must not be excepted, and the clause's
   * pattern is unified against the synthesized mapping (concept and action
   * names, the whole input, and the posture's payload). On success the
   * record's id is stored under `actionSymbol`, so consumption and firing
   * records work exactly as for identity-matched clauses.
   */
  matchChannel(
    record: ActionRecord,
    clause: ChannelPattern,
    frame: Frame,
    actionSymbol: symbol,
  ): Frame | undefined {
    return matchChannelPattern(
      this.Action._matchingRecord(record),
      clause,
      frame,
      actionSymbol,
      this.rawConceptsByInstrumented,
    );
  }

  /** The channel-indexed reactions this record's posture makes eligible. */
  private channelReactionsFor(record: ActionRecord): Set<ExecutableReaction> | undefined {
    if (this.reactionsByChannel.size === 0) return undefined;
    const stored = record.id !== undefined ? this.Action._getById(record.id) : undefined;
    const fault = stored?.fault ?? record.fault;
    const outcome = stored?.outcome ?? record.outcome;
    const posture: ChannelPosture | undefined =
      fault !== undefined
        ? "faulted"
        : outcome !== undefined
          ? postureOfOutcome(outcome)
          : undefined;
    if (posture === undefined) return undefined;
    const set = this.reactionsByChannel.get(posture);
    return set === undefined || set.size === 0 ? undefined : set;
  }

  /** Run the declared pipeline once for every frame matched by `when`. */
  async addThen(
    frames: Frames,
    reaction: ExecutableReaction,
    actionSymbols: symbol[],
    captured?: FrameProvenance,
    validatedTriggerIds?: string[][],
  ): Promise<void> {
    const provenance =
      captured ??
      this.captureFrameProvenance(
        frames,
        typeof frames[0]?.[flow] === "string" ? frames[0][flow] : "",
        actionSymbols,
      );
    const triggerIdsByFrame = validatedTriggerIds ?? provenance.frameTriggerIds;
    for (const [index, frame] of frames.entries()) {
      const whenIds = triggerIdsByFrame[index];
      if (whenIds === undefined) {
        const err = new Error(`Matched frame has no captured trigger occurrences.`);
        logger.warn(
          `Reaction "${reaction.name}": matched bindings could not resolve every trigger occurrence`,
          {
            error: serializeError(err),
          },
        );
        this.appendReactionFailure(
          reaction.name,
          provenance.flow,
          provenance.triggerIds,
          "trigger",
          err,
        );
        continue;
      }
      const fill: FiringFill = {
        reaction: reaction.name,
        flow: provenance.flow,
        whenIds,
        bindings: this.bindingsOf(frame, actionSymbols),
        produced: [],
        branches: [],
      };
      await this.runPipelineForFrame(
        frame,
        reaction.then,
        reaction,
        this.firingBook.newBranch(fill),
      );
      this.firingBook.record(fill);
    }
  }

  /** All recorded firings of a reaction — which reaction fired, why, and what came of it. */
  _getFirings(reaction: string): FiringRecord[] {
    return this.firingBook.firings(reaction);
  }

  /** Extract a frame's user-variable bindings, keyed by variable name. */
  private bindingsOf(frame: Frame, actionSymbols: symbol[]): Record<string, unknown> {
    const reserved = new Set<symbol>([flow, landing, ...actionSymbols]);
    const bindings: Record<string, unknown> = {};
    for (const key of Object.keys(frame)) {
      setOwn(bindings, key, frame[key]);
    }
    for (const key of Object.getOwnPropertySymbols(frame)) {
      if (reserved.has(key)) continue;
      bindings[key.description ?? String(key)] = frame[key];
    }
    return bindings;
  }

  /** Snapshot engine-owned provenance before authored frame code can mutate it. */
  private captureFrameProvenance(
    frames: Frames,
    flowToken: string,
    actionSymbols: symbol[],
  ): FrameProvenance {
    const frameTriggerIds = frames.map((frame) => this.triggerIdsOf(frame, actionSymbols));
    const triggerIds = [...new Set(frameTriggerIds.flat())];
    return {
      flow: flowToken,
      triggerIds,
      frameTriggerIds,
      ...(actionSymbols.length > 0
        ? {
            triggerSignatures: new Set(frameTriggerIds.map((ids) => JSON.stringify(ids))),
          }
        : {}),
    };
  }

  private triggerIdsOf(frame: Frame, actionSymbols: symbol[]): string[] {
    return actionSymbols.map((actionSymbol, index) => {
      const id = frame[actionSymbol];
      if (typeof id !== "string") {
        throw new Error(`Matched frame has no action id for trigger ${index + 1}.`);
      }
      return id;
    });
  }

  /** Keep snapshotted causal provenance intact across authored frame transforms. */
  private assertFrameProvenance(
    frames: Frames,
    provenance: FrameProvenance,
    actionSymbols: symbol[] = [],
  ): string[][] {
    const frameTriggerIds: string[][] = [];
    for (const frame of frames) {
      if (frame[flow] !== provenance.flow) {
        throw new TypeError("A frame transform must preserve the causal flow.");
      }
      const triggerIds = this.triggerIdsOf(frame, actionSymbols);
      if (
        provenance.triggerSignatures !== undefined &&
        !provenance.triggerSignatures.has(JSON.stringify(triggerIds))
      ) {
        throw new TypeError("A reaction where function must preserve its trigger occurrences.");
      }
      frameTriggerIds.push(triggerIds);
    }
    return frameTriggerIds;
  }

  private async runPipelineForFrame(
    frame: Frame,
    nodes: StepNode[],
    reaction: ExecutableReaction,
    branch: FiringBranch,
  ): Promise<Frames> {
    let current = new Frames(frame);
    for (const node of nodes) {
      const next: Frame[] = [];
      for (const currentFrame of current) {
        const result = await this.runStepNode(currentFrame, node, reaction, branch);
        if (!result.stop) next.push(...result.frames);
      }
      current = new Frames(...next);
      this.assertRows(branch.fill.flow, current.length);
      if (current.length === 0) break;
    }
    return current;
  }

  private stopped(): { frames: Frames; stop: true } {
    return { frames: new Frames(), stop: true };
  }

  private failStep(
    reaction: ExecutableReaction,
    node: StepNode,
    branch: FiringBranch,
    stage: ReactionFailureRecord["stage"],
    message: string,
    err: unknown,
    actionId?: string,
  ): { frames: Frames; stop: true } {
    logger.error(`Reaction "${reaction.name}": ${message}`, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionId !== undefined ? { actionId } : {}),
      error: serializeError(err),
    });
    this.recordStepFailure(reaction, node, branch, stage, err, actionId);
    return this.stopped();
  }

  private recordStepFailure(
    reaction: ExecutableReaction,
    node: StepNode,
    branch: FiringBranch,
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    actionId?: string,
  ): void {
    this.appendReactionFailure(reaction.name, branch.fill.flow, branch.fill.whenIds, stage, error, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(actionId !== undefined ? { actionId } : {}),
    });
  }

  private async runStepNode(
    frame: Frame,
    node: StepNode,
    reaction: ExecutableReaction,
    branch: FiringBranch,
  ): Promise<{ frames: Frames; stop: boolean }> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame, reaction.name, branch.fill.flow);
    } catch (err) {
      return this.failStep(
        reaction,
        node,
        branch,
        "consequence-input",
        "consequence input could not be formed from the matched bindings",
        err,
      );
    }

    // Evaluate former inputs at the moment of asking. If a former violates its
    // promise, record the new ask with that fault and no outcome so a fault
    // reaction can answer the root request.
    try {
      matched = await this.resolveFormerInputs(matched);
    } catch (err) {
      return await this.landFormingFault(matched, node, reaction, branch, err);
    }

    const id = matched[actionId];
    if (typeof id !== "string") {
      throw new Error("Action produced from `then` is missing an id.");
    }

    this.firingBook.mark(branch);

    let output: Record<string, unknown>;
    let settlement: ActionSettlement | undefined;
    matched[actionSettlement] = (next: ActionSettlement) => {
      settlement = next;
    };
    const runThen = node.action.action as unknown as (args: ActionArguments) => Promise<unknown>;
    try {
      output = (await runThen(matched)) as Record<string, unknown>;
    } catch (err) {
      if (settlement !== undefined) {
        // Once the ask is recorded, retain its provenance even if recording
        // the eventual fault or outcome itself fails.
        branch.fill.produced.push(id);
        logger.error(
          settlement === "fault-recorded"
            ? "Consequence action faulted"
            : "Consequence action failed after its ask was recorded",
          {
            action: actionNameOf(node.action.action as InstrumentedAction),
            actionId: id,
            error: serializeError(err),
          },
        );
        if (settlement !== "fault-recorded") {
          this.recordStepFailure(reaction, node, branch, "consequence-dispatch", err, id);
        }
        return this.stopped();
      }
      // An infrastructure-level throw before the ask landed: roll back this
      // branch's consumption so the when-records stay re-matchable.
      logger.error("Consequence action failed before its ask was recorded", {
        action: actionNameOf(node.action.action as InstrumentedAction),
        actionId: id,
        error: serializeError(err),
      });
      this.recordStepFailure(reaction, node, branch, "consequence-dispatch", err, id);
      this.firingBook.unmark(branch);
      return this.stopped();
    }
    branch.fill.produced.push(id);

    // Use the recorded result or refusal; the returned mapping alone cannot
    // identify a refusal.
    const stored = this.Action._getById(id);
    const outcome =
      (stored === undefined ? undefined : this.Action._matchingRecord(stored).outcome) ??
      normalizeOutcome(output);
    let childFrames: Frames;
    try {
      // A failed action never tries to satisfy a successful output mapping.
      childFrames =
        outcome.kind === "error"
          ? new Frames({ ...frame })
          : this.framesWithStepOutput(frame, node.action, outcome);
    } catch (err) {
      return this.failStep(
        reaction,
        node,
        branch,
        "consequence-output",
        "consequence output matching failed",
        err,
        id,
      );
    }
    if (childFrames.length === 0) return { frames: childFrames, stop: true };

    if (node.transform !== undefined) {
      try {
        const maybeFrames = node.transform(childFrames);
        childFrames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
        if (!(childFrames instanceof Frames)) {
          throw new TypeError("An ask result transform must return Frames.");
        }
        this.assertFrameProvenance(childFrames, {
          flow: branch.fill.flow,
          triggerIds: branch.fill.whenIds,
          frameTriggerIds: [],
        });
      } catch (err) {
        return this.failStep(
          reaction,
          node,
          branch,
          "result-transform",
          "ask result condition failed",
          err,
          id,
        );
      }
    }

    // An action error is terminal: the pipeline stops, and whoever needs to
    // react to the refusal is a reaction triggered on the outcome (or the funnel).
    return { frames: childFrames, stop: outcome.kind === "error" };
  }

  private framesWithStepOutput(
    frame: Frame,
    pattern: ActionPattern,
    outcome: ActionOutcome,
  ): Frames {
    if (pattern.output === undefined) {
      return new Frames({ ...frame });
    }
    const extended = unifyActionOutput(outcome, pattern.output, frame);
    return extended === undefined ? new Frames() : new Frames(extended);
  }

  private appendReactionFailure(
    reaction: string,
    flowToken: string,
    triggerIds: string[],
    stage: ReactionFailureRecord["stage"],
    error: unknown,
    consequence: Pick<ReactionFailureRecord, "action" | "actionId"> = {},
  ): void {
    const at = Date.now();
    const serialized = serializeError(error);
    this.Action._recordReactionFailure({
      reaction,
      flow: flowToken,
      triggerIds,
      stage,
      ...consequence,
      errorClass: typeof serialized.name === "string" ? serialized.name : "Error",
      at,
    });
  }

  /**
   * Resolve a `then` clause into an action argument object: replace symbol
   * inputs with their frame bindings (a missing binding is an error), then
   * attach the flow token and a fresh action id.
   */
  matchThen(
    then: ActionPattern,
    frame: Frame,
    by?: string,
    authoritativeFlow?: string,
  ): ActionArguments {
    const resolve = (value: unknown): unknown =>
      mapValueTree(value, (node) => {
        const key = varKeyOf(node);
        if (key !== undefined) {
          if (!Object.hasOwn(frame, key)) {
            throw new Error(
              `Then clause references variable ${String(key)} which is not bound in the current frame.`,
            );
          }
          return frame[key];
        }
        if (isFusedFormer(node)) {
          // Fill the former's slots from the frame; the tree itself is
          // evaluated just before the ask is recorded (see runStepNode).
          return fuseFormer(node.former, resolve(node.in) as Mapping);
        }
        if (typeof node === "object" && node !== null) {
          if (hasMarkerKey(node, "$former")) {
            const payload = (node as { $former: { name: string; in: Mapping } }).$former;
            const ref =
              (liveOf(node) as FormerRef | undefined) ?? this.registry.formerNamed(payload.name);
            if (ref === undefined) {
              throw new Error(
                `Then clause references former "${payload.name}", which is not registered.`,
              );
            }
            return fuseFormer(ref, resolve(payload.in) as Mapping);
          }
          if (hasMarkerKey(node, "$lit")) return (node as { $lit: unknown }).$lit;
        }
        return DESCEND;
      });

    const input: ActionArguments = {};
    for (const [key, value] of Object.entries(then.input)) {
      setOwn(input, key, resolve(value));
    }
    input[flow] = authoritativeFlow ?? frame[flow];
    input[actionId] = uuid();
    if (by !== undefined) input[byAskingReaction] = by;
    return input;
  }

  /**
   * When a former faults while forming consequence input, append the
   * consequence ask with its former marker, record the fault, retain the
   * firing's consumption and produced id, then evaluate fault-channel reactions.
   */
  private async landFormingFault(
    matched: ActionArguments,
    node: StepNode,
    reaction: ExecutableReaction,
    branch: FiringBranch,
    err: unknown,
  ): Promise<{ frames: Frames; stop: boolean }> {
    const { [flow]: flowToken, [actionId]: id, [byAskingReaction]: askedBy, ...rest } = matched;
    logger.error(`Reaction "${reaction.name}": consequence input former failed`, {
      action: actionNameOf(node.action.action as InstrumentedAction),
      ...(typeof id === "string" ? { actionId: id } : {}),
      error: serializeError(err),
    });
    const concept = (node.action.action as InstrumentedAction).concept;
    if (typeof id !== "string" || typeof flowToken !== "string" || concept === undefined) {
      // Without an action id, flow token, or concept, no faulted ask can be recorded.
      return this.stopped();
    }
    const describe = (value: unknown): unknown =>
      mapValueTree(value, (node) =>
        isFusedFormer(node) ? { $former: { name: node.former.formerName, in: node.in } } : DESCEND,
      );
    const record: ActionRecord = {
      id,
      action: node.action.action as InstrumentedAction,
      concept,
      input: describe(rest) as Record<string, unknown>,
      flow: flowToken,
      ...(typeof askedBy === "string" ? { by: askedBy } : {}),
    };
    this.firingBook.mark(branch);
    this.Action._beginMatchingInput({ id, flow: flowToken, input: record.input });
    try {
      this.Action.invoke(record);
      this.Action.faulted({ id, fault: errorOutputFromThrown(err) });
      branch.fill.produced.push(id);
      try {
        await this.react({ ...record }, 0);
      } catch (immediateErr) {
        logger.error("Reaction body failed after a consequence-input fault was recorded", {
          actionId: id,
          error: serializeError(immediateErr),
        });
      }
    } finally {
      this.Action._endMatchingInput(flowToken);
    }
    return this.stopped();
  }

  /** Replace every fused former in a resolved input with its evaluated tree. */
  private async resolveFormerInputs(input: ActionArguments): Promise<ActionArguments> {
    let hasFormer = false;
    for (const value of Object.values(input)) {
      walkValueTree(value, (node) => {
        if (!isFusedFormer(node)) return;
        hasFormer = true;
        return false;
      });
      if (hasFormer) break;
    }
    if (!hasFormer) return input;

    const result: ActionArguments = {};
    for (const key of Object.getOwnPropertySymbols(input)) result[key] = input[key];
    for (const [key, value] of Object.entries(input)) {
      result[key] = await mapValueTreeAsync(value, (node) =>
        isFusedFormer(node) ? formTree(node, this.registry.readEnv()) : DESCEND,
      );
    }
    return result;
  }

  /**
   * Wrap a concept in a `Proxy` that instruments its actions.
   *
   * Queries (methods whose name starts with `_`) are bound but left
   * uninstrumented — they have no log side effects. Every other method is
   * wrapped exactly once per concept instance so the instrumented identity is
   * stable across accesses without aliasing sibling instances of the same class.
   * The wrapper records the action in the log, runs it, records its output,
   * and then drives {@link react}.
   *
   * An explicit `name` determines the concept name recorded in the log. A
   * substituted implementation uses that name, and two instances of one class
   * may use different names.
   */
  instrumentConcept<T extends object>(concept: T, name?: string): T {
    return instrumentSingle(this.instrumentationState(), concept, name);
  }

  /**
   * Instrument every concept in a record, preserving keys. Keys are local
   * handles, not concept names — an assembly that means its keys as names
   * instruments each instance with {@link instrumentConcept}'s explicit name.
   */
  instrument<T extends Record<string, object>>(concepts: T): T;
  /** Instrument a single concept instance. */
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object> | object): Record<string, object> | object {
    return instrumentMany(this.instrumentationState(), concepts);
  }

  private instrumentationState(): InstrumentationState {
    return {
      actions: this.Action,
      boundActionsByConcept: this.boundActionsByConcept,
      queryCaches: this.queryCaches,
      actionLines: this.actionLines,
      waitingActionBodies: this.waitingActionBodies,
      rawConceptsByInstrumented: this.rawConceptsByInstrumented,
      concepts: this.concepts,
      conceptsByName: this.registry.concepts,
      execution: this.execution,
      react: this.react.bind(this),
      emit: this.reactionLogger.emit.bind(this.reactionLogger),
    };
  }

  private assertRows(flow: string, count: number): void {
    if (this.execution?.rows(count) !== false) return;
    this.recordExecutionLimit(flow, "rows");
    throw new Error("The evaluation exceeded its row limit.");
  }

  private recordExecutionLimit(flow: string, limit: "firings" | "rows"): void {
    this.Action._recordIntegrityFailure({
      kind: "execution-limit",
      flow,
      limit,
      errorClass: "ExecutionLimitExceeded",
      at: Date.now(),
    });
  }
}
