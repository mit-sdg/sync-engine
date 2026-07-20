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
 *   1. appends a record to the log under a **flow** token,
 *   2. runs the underlying action and records its output, then
 *   3. drives {@link Reacting.react}, which fires any matching reactions.
 *
 * A **flow** groups actions in one causal chain: actions produced by a reaction's
 * `then` inherit the triggering action's flow, and matching is restricted to a
 * single flow so independent invocations never cross-match.
 */

import { logger } from "../utils/logger.ts";
import { serializeError } from "../utils/redaction.ts";
import { ActionConcept, type ActionRecord, normalizeOutcome } from "./actions.ts";
import { DESCEND, mapValueTree, mapValueTreeAsync, walkValueTree } from "../reads/value-tree.ts";
import { applyWhereOps } from "../reads/where-ops.ts";
import type { AnyWhereOp } from "../reads/where-ops.ts";
import type { ComputationRef } from "../reads/computations.ts";
import type { RelationView } from "../reads/lines.ts";
import type { AppIR, ConceptInventoryIR, FormerIR, ReactionIR, ViewIR } from "../reads/ir.ts";
import { renderApp as renderAppSpec } from "../reads/render.ts";
import {
  assertThenInputsAreData,
  copyReactionLintExtraUses,
  lintReactionOpens,
  type LoweredReaction,
  lowerReaction,
  serializeApp,
  serializeReaction,
  serializeView,
} from "../reads/lower.ts";
import {
  type FormerRef,
  fuseFormer,
  type FusedFormer,
  isFusedFormer,
} from "../reads/former-nodes.ts";
import { formTree } from "../reads/former-evaluation.ts";
import { readBackApp, readBackReaction } from "../reads/read-back.ts";
import type { ReadEnv } from "../reads/env.ts";
import { Registry } from "../reads/registering.ts";
import type { BoundReaction, BoundWhereOp } from "../reads/registering.ts";
import { varKeyOf } from "../reads/frames.ts";
import { hasMarkerKey, liveOf } from "../reads/ir.ts";
import type { FiringRecord } from "./log-store.ts";
import { Frames } from "../reads/frames.ts";
import { actionNameOf, inventoryOf } from "./introspect.ts";
import type { EngineObserver } from "./observer.ts";
import { FiringBook, type FiringBranch, type FiringFill } from "./firing.ts";
import {
  actionId,
  byReaction as byAskingReaction,
  flow,
  landing,
  matchArguments as matchActionArguments,
  matchChannel as matchChannelPattern,
  postureOfOutcome,
  unifyOutputPattern as unifyActionOutput,
} from "./matching.ts";
import { Logging, ReactionLogger } from "./logging.ts";
import {
  errorOutputFromThrown,
  instrument as instrumentAll,
  instrumentConcept as instrumentOne,
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
  ThenNode,
  WhereFn,
} from "./types.ts";
import { uuid } from "../utils/runtime.ts";
import { $vars } from "./vars.ts";
import { declarationsOf } from "./partitions.ts";

type ActionArguments = Record<string | symbol, unknown>;

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
  private actionLines: WeakMap<object, Promise<unknown>> = new WeakMap();
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

  constructor(actionConcept: ActionConcept = new ActionConcept()) {
    this.Action = actionConcept;
    this.reactionLogger = new ReactionLogger(actionConcept);
    this.firingBook = new FiringBook(actionConcept.store);
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
        this.registry.indexDeclarationReads(decl);
        return { name, decl, outcome: lowerReaction(name, decl) };
      });
      return { base, leaves };
    });

    const claims = new Map<string, string>();
    for (const family of prepared) {
      for (const leaf of family.leaves) {
        const names = leaf.outcome.reactions?.map((reaction) => reaction.name) ?? [leaf.name];
        for (const name of names) {
          const claimedBy = claims.get(name);
          if (claimedBy !== undefined) {
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
      for (const leaf of family.leaves) {
        if (leaf.outcome.reactions !== undefined) {
          // The definition boundary: lowered reactions serialize to the IR here,
          // and the IR is what is stored, compiled, and exported. The one
          // exception is a reaction carrying a closure-based `where`: the
          // closure indexes frames by the symbols it closed over, so that
          // reaction executes from its authored form while still exporting as IR.
          const reactions = leaf.outcome.reactions.map((reaction) => serializeReaction(reaction));
          stored.push(...reactions);
          executableNames.push(...reactions.map((reaction) => reaction.name));
          leaf.outcome.reactions.forEach((live, index) => {
            this.indexReaction(
              this.compileReaction(
                live.whereFn !== undefined ? live : this.registry.bindReaction(reactions[index]),
              ),
            );
          });
          if (this.logging !== Logging.OFF) {
            for (const reaction of reactions)
              logger.info(readBackReaction(reaction, this.registry.readBackEnv()));
          }
          continue;
        }

        this.unloweredReactions.set(leaf.name, leaf.outcome.reason ?? "not lowerable");
        executableNames.push(leaf.name);
        const ops = leaf.decl.whereOps;
        const where =
          ops !== undefined
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
    for (const op of ops) {
      current =
        op.op === "earlier"
          ? this.applyEarlier(current, op.pattern)
          : await applyWhereOps(current, [op], this.registry.readEnv());
      if (current.length === 0) break;
    }
    return current;
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
    if (!isFusedFormer(fused)) {
      throw new Error(
        "form(...) takes a named former with its sentence slots filled, " +
          "for example form(roomDashboard(room)).",
      );
    }
    this.registry.assertFormable(fused.former);
    return formTree(fused, this.registry.readEnv());
  }

  /**
   * The read-back: the engine states the quantities the author no longer
   * writes: per reaction, which names open, which values are tested, where multiple
   * cases may result,
   * or drop; per view, the declared promise beside what the body proves.
   */
  readBack(): string {
    const app = this.exportReactions();
    const views = [...this.registry.viewRefs()].map((ref) => serializeView(ref));
    return readBackApp(views, app.formers, app.reactions, this.registry.readBackEnv());
  }

  /** Everything this engine knows about its registered reactions, as data. */
  exportReactions(): AppIR {
    return serializeApp(
      this.loweredReactions.values(),
      this.unloweredReactions.entries(),
      this.registry.formerRefs(),
      (name) => this.registry.viewNamed(name),
    );
  }

  /**
   * Inventories of every instrumented concept, in instrumentation order:
   * actions with observed input roles and declared refusal codes, queries,
   * and authored purpose/principle prose where the class carries it.
   */
  exportConcepts(): ConceptInventoryIR[] {
    const inventories: ConceptInventoryIR[] = [];
    for (const instrumented of this.registry.concepts.values()) {
      const raw = this.rawConceptsByInstrumented.get(instrumented) ?? instrumented;
      inventories.push(inventoryOf(raw));
    }
    return inventories;
  }

  /**
   * Render the registered concepts, views, formers, and reactions as a
   * assembled read-back. Missing concept prose and reactions that remain
   * executable pipelines are labeled in the output.
   */
  renderApp(title = "Application"): string {
    return renderAppSpec({
      title,
      concepts: this.exportConcepts(),
      app: this.exportReactions(),
    });
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
      this.unregisterBase(reaction.name);
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
      try {
        const [matched, actionSymbols] = this.matchWhen(record, reaction);
        if (matched.length === 0) continue;

        this.reactionLogger.frames(
          `Matched \`reaction\`: ${reaction.name} with \`when\`:`,
          matched,
        );

        let frames = matched;
        if (reaction.where !== undefined) {
          try {
            const maybeFrames = reaction.where(frames);
            frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
          } catch (err) {
            logger.error(`Reaction "${reaction.name}": where condition evaluation failed`, {
              error: serializeError(err),
            });
            continue;
          }
          this.reactionLogger.frames(`After processing \`where\`:`, frames);
        }
        await this.addThen(frames, reaction, actionSymbols);
      } catch (err) {
        logger.error(`Reaction "${reaction.name}": occurrence processing failed`, {
          error: serializeError(err),
        });
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
  ): Promise<void> {
    for (const frame of frames) {
      let whenActions: ActionRecord[];
      try {
        whenActions = this.resolveWhenActions(frame, actionSymbols);
      } catch (err) {
        logger.warn(
          `Reaction "${reaction.name}": matched bindings could not resolve every trigger occurrence`,
          {
            error: serializeError(err),
          },
        );
        continue;
      }
      const flowToken = frame[flow];
      const fill: FiringFill = {
        reaction: reaction.name,
        flow: typeof flowToken === "string" ? flowToken : "",
        whenIds: whenActions.map((record) => record.id ?? ""),
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
    for (const key of Object.keys(frame)) bindings[key] = frame[key];
    for (const key of Object.getOwnPropertySymbols(frame)) {
      if (reserved.has(key)) continue;
      bindings[key.description ?? String(key)] = frame[key];
    }
    return bindings;
  }

  private async runPipelineForFrame(
    frame: Frame,
    nodes: ThenNode[],
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
      if (current.length === 0) break;
    }
    return current;
  }

  private async runStepNode(
    frame: Frame,
    node: StepNode,
    reaction: ExecutableReaction,
    branch: FiringBranch,
  ): Promise<{ frames: Frames; stop: boolean }> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame, reaction.name);
    } catch (err) {
      logger.warn(
        `Reaction "${reaction.name}": consequence input could not be formed from the matched bindings`,
        {
          action: actionNameOf(node.action.action as InstrumentedAction),
          error: serializeError(err),
        },
      );
      return { frames: new Frames(), stop: true };
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
    const runThen = node.action.action as unknown as (args: ActionArguments) => Promise<unknown>;
    try {
      output = (await runThen(matched)) as Record<string, unknown>;
    } catch (err) {
      if (this.Action._getById(id)?.fault !== undefined) {
        // The ask was recorded with a fault and no outcome. The firing keeps
        // its consumption and lists the faulted ask it produced; only the
        // pipeline stops.
        branch.fill.produced.push(id);
        logger.error("Consequence action faulted", {
          action: actionNameOf(node.action.action as InstrumentedAction),
          actionId: id,
          error: serializeError(err),
        });
        return { frames: new Frames(), stop: true };
      }
      // An infrastructure-level throw before the ask landed: roll back this
      // branch's consumption so the when-records stay re-matchable.
      logger.error("Consequence action failed before its ask was recorded", {
        action: actionNameOf(node.action.action as InstrumentedAction),
        actionId: id,
        error: serializeError(err),
      });
      this.firingBook.unmark(branch);
      return { frames: new Frames(), stop: true };
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
      logger.error(`Reaction "${reaction.name}": consequence output matching failed`, {
        action: actionNameOf(node.action.action as InstrumentedAction),
        actionId: id,
        error: serializeError(err),
      });
      return { frames: new Frames(), stop: true };
    }
    if (childFrames.length === 0) return { frames: childFrames, stop: true };

    if (node.transform !== undefined) {
      try {
        const maybeFrames = node.transform(childFrames);
        childFrames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
      } catch (err) {
        logger.error(`Reaction "${reaction.name}": request result condition failed`, {
          action: actionNameOf(node.action.action as InstrumentedAction),
          actionId: id,
          error: serializeError(err),
        });
        return { frames: new Frames(), stop: true };
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

  /** Recover the `when` records a frame matched, ready to be consumed by a fill. */
  private resolveWhenActions(frame: Frame, actionSymbols: symbol[]): ActionRecord[] {
    return actionSymbols.map((actionSymbol, index) => {
      const id = frame[actionSymbol];
      if (typeof id !== "string") {
        throw new Error(`Matched frame has no action id for trigger ${index + 1}.`);
      }
      const action = this.Action._getById(id);
      if (action === undefined) {
        throw new Error(`Action record ${id} missing from the log.`);
      }
      return action;
    });
  }

  /**
   * Resolve a `then` clause into an action argument object: replace symbol
   * inputs with their frame bindings (a missing binding is an error), then
   * attach the flow token and a fresh action id.
   */
  matchThen(then: ActionPattern, frame: Frame, by?: string): ActionArguments {
    const resolve = (value: unknown): unknown =>
      mapValueTree(value, (node) => {
        const key = varKeyOf(node);
        if (key !== undefined) {
          if (!(key in frame)) {
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
      input[key] = resolve(value);
    }
    input[flow] = frame[flow];
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
      return { frames: new Frames(), stop: true };
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
    return { frames: new Frames(), stop: true };
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
    return instrumentOne(this.instrumentationState(), concept, name);
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
    return instrumentAll(this.instrumentationState(), concepts);
  }

  private instrumentationState(): InstrumentationState {
    return {
      actions: this.Action,
      boundActionsByConcept: this.boundActionsByConcept,
      queryCaches: this.queryCaches,
      actionLines: this.actionLines,
      rawConceptsByInstrumented: this.rawConceptsByInstrumented,
      concepts: this.concepts,
      conceptsByName: this.registry.concepts,
      react: this.react.bind(this),
      emit: this.reactionLogger.emit.bind(this.reactionLogger),
    };
  }
}
