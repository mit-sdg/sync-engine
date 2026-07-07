/**
 * The synchronization engine.
 *
 * Concepts are independent state machines; **synchronizations** compose them
 * declaratively. A sync is a `when` / `where` / `then` rule:
 *
 *  - **when**  — patterns matched against the action journal. Matching binds
 *               logic variables and yields a set of {@link Frames}.
 *  - **where** — an optional pure transform over those frames (filter, query,
 *               aggregate, …) producing the final frames.
 *  - **then**  — actions to invoke, one per surviving frame, with their inputs
 *               resolved from the frame's bindings.
 *
 * Concepts are *instrumented* so that every (non-query) action invocation:
 *   1. appends a record to the journal under a **flow** token,
 *   2. runs the underlying action and records its output, then
 *   3. drives {@link SyncConcept.synchronize}, which fires any matching syncs.
 *
 * A **flow** groups actions in one causal chain: actions produced by a sync's
 * `then` inherit the triggering action's flow, and matching is restricted to a
 * single flow so independent invocations never cross-match.
 */

import { FrameworkErrorCode } from "../sdk/error-codes.ts";
import { cached } from "../utils/cache.ts";
import { logger } from "../utils/logger.ts";
import { redact as redactValue, serializeError } from "../utils/redaction.ts";
import { ActionConcept, type ActionRecord, normalizeOutcome } from "./actions.ts";
import { Frames } from "./frames.ts";
import { actionNameOf, conceptNameOf } from "./introspect.ts";
import type { EngineObserver, JournalEvent } from "./observer.ts";
import type {
  ActionList,
  ActionOutcome,
  ActionPattern,
  AnyAction,
  BranchNode,
  DoChain,
  Frame,
  InstrumentedAction,
  Mapping,
  NestedThenOptions,
  OutcomeKind,
  ParallelNode,
  SequenceNode,
  StepNode,
  SyncFunction,
  SyncFunctionMap,
  Synchronization,
  ThenNode,
} from "./types.ts";
import { inspect, inspectCustom, uuid } from "./util.ts";
import { $vars } from "./vars.ts";

export function sanitize(obj: unknown): unknown {
  return redactValue(obj);
}

function errorOutputFromThrown(err: unknown): Record<string, unknown> {
  if (err !== null && typeof err === "object") {
    const thrown = err as Record<string, unknown>;
    const error =
      typeof thrown.error === "string"
        ? thrown.error
        : typeof thrown.code === "string"
          ? thrown.code
          : FrameworkErrorCode.UNKNOWN_ERROR;
    const detail =
      typeof thrown.detail === "string"
        ? thrown.detail
        : typeof thrown.message === "string"
          ? thrown.message
          : undefined;

    return detail === undefined ? { error } : { error, detail };
  }

  return { error: FrameworkErrorCode.UNKNOWN_ERROR, detail: String(err) };
}

/**
 * Reserved frame keys carried alongside the user's logic variables:
 *  - `flow`     — the flow token threaded through a causal chain;
 *  - `synced`   — the per-action map recording which syncs already consumed it;
 *  - `actionId` — the journal id a matched/produced action is identified by.
 */
const flow = Symbol("flow");
const synced = Symbol("synced");
const actionId = Symbol("actionId");

/**
 * Normalize sync clauses into {@link ActionPattern}s.
 *
 * Used in both `when` and `then`. Each tuple is `[action, input, output?]`.
 * The action must be instrumented (carry a `.concept`); otherwise it could
 * never appear in — or be appended to — the journal.
 */
export function actions(...actions: ActionList[]): ActionPattern[] {
  return actions.map(([action, input, output]) => {
    const concept = action.concept;
    if (concept === undefined) {
      throw new Error(`Action ${action.name} is not instrumented.`);
    }
    return {
      concept,
      action,
      input,
      flow,
      ...(output ? { output } : {}),
    };
  });
}

export function step(action: ActionList, options: NestedThenOptions = {}): StepNode {
  const [pattern] = actions(action);
  return { kind: "step", action: pattern, ...options };
}

export function branch(pattern: Mapping, options: NestedThenOptions = {}): BranchNode {
  return { kind: "branch", outcome: "any", pattern, ...options };
}

function outcomeBranch(
  outcome: OutcomeKind,
  patternOrOptions: Mapping | NestedThenOptions = {},
  maybeOptions?: NestedThenOptions,
): BranchNode {
  const firstArgIsOptions =
    maybeOptions === undefined &&
    patternOrOptions !== null &&
    typeof patternOrOptions === "object" &&
    ("then" in patternOrOptions || "nested" in patternOrOptions || "where" in patternOrOptions);
  const pattern = firstArgIsOptions ? {} : (patternOrOptions as Mapping);
  const options =
    maybeOptions ?? (firstArgIsOptions ? (patternOrOptions as NestedThenOptions) : {});
  return { kind: "branch", outcome, pattern, ...options };
}

export const outcome = {
  result: (patternOrOptions?: Mapping | NestedThenOptions, options?: NestedThenOptions) =>
    outcomeBranch("result", patternOrOptions ?? {}, options),
  error: (patternOrOptions?: Mapping | NestedThenOptions, options?: NestedThenOptions) =>
    outcomeBranch("error", patternOrOptions ?? {}, options),
  complete: (options: NestedThenOptions = {}) => outcomeBranch("complete", {}, options),
} as const;

export function workflow(fn: SyncFunction): SyncFunction {
  return fn;
}

// ── Uppercase workflow DSL sugar (#2) ────────────────────────────────────

/** Opaque brand carried by a {@link DoChain} so TypeScript infers the chain type. */
const DoChainBrand = Symbol("DoChainBrand");

function createDoChain(actionPattern: ActionPattern): DoChain {
  const node: StepNode = { kind: "step", action: actionPattern };
  const chain = node as unknown as DoChain;
  (chain as unknown as Record<symbol, boolean>)[DoChainBrand] = true;
  chain.as = function asDo(outputMapping: Mapping): DoChain {
    node.action = {
      ...node.action,
      output: { ...node.action.output, ...outputMapping },
    };
    return chain;
  };
  chain.then = function thenDo(...nodes: ThenNode[]): DoChain {
    if (!node.nested) node.nested = [];
    node.nested.push(...nodes);
    return chain;
  };
  return chain;
}

export const Workflow = workflow;

export function When(action: InstrumentedAction, input: Mapping, output?: Mapping): ActionPattern[];
export function When(...clauses: ActionList[]): ActionPattern[];
export function When(...args: any[]): ActionPattern[] {
  if (typeof args[0] === "function") {
    return actions([args[0] as InstrumentedAction, args[1] as Mapping, args[2] ?? {}]);
  }
  return actions(...(args as ActionList[]));
}

export const Then = When;

export function Do(action: InstrumentedAction, input: Mapping, output?: Mapping): DoChain {
  return createDoChain(actions([action, input, output])[0]);
}

export function Sequence(...nodes: ThenNode[]): SequenceNode {
  return { kind: "sequence", nodes };
}

export function Parallel(...nodes: ThenNode[]): ParallelNode {
  return { kind: "parallel", nodes };
}

export function On(pattern: Mapping, ...nodes: ThenNode[]): BranchNode {
  return { kind: "branch", outcome: "any", pattern, nested: nodes };
}

export function Err(pattern: Mapping = {}, ...nodes: ThenNode[]): BranchNode {
  return { kind: "branch", outcome: "error", pattern, nested: nodes };
}

export function Done(...nodes: ThenNode[]): BranchNode {
  return { kind: "branch", outcome: "complete", pattern: {}, nested: nodes };
}

/** The internal shape of an instrumented action's argument object. */
type ActionArguments = Record<string | symbol, unknown>;

/** Verbosity levels for engine logging. */
export enum Logging {
  /** Print nothing. */
  OFF,
  /** Print a one-line `Concept.action input => output` per action. */
  TRACE,
  /** Print TRACE plus matched frames and `then` dispatches. */
  VERBOSE,
}

export class SyncConcept {
  /** Registered synchronizations, by name. */
  public syncs: Record<string, Synchronization> = {};
  /** Inverted index: which syncs care about each `when` action. */
  public syncsByAction: Map<InstrumentedAction, Set<Synchronization>> = new Map();
  /** The action journal backing all matching. */
  public Action: ActionConcept;
  /** Current verbosity. */
  public logging = Logging.OFF;
  /** Memoizes bound/instrumented wrappers per concept instance. */
  private boundActionsByConcept: WeakMap<object, Map<AnyAction, InstrumentedAction>> =
    new WeakMap();
  /** Tracks query cache invalidators per concept instance. */
  private queryCaches: WeakMap<object, Array<{ invalidate: () => void }>> = new WeakMap();
  /** All raw concept instances known to this engine (for bulk invalidation). */
  private concepts = new Set<object>();
  /** Engine-level observers (passive sinks). */
  private observers = new Set<EngineObserver>();

  /** Register an engine observer. Returns a function to unregister it. */
  addObserver(o: EngineObserver): () => void {
    this.observers.add(o);
    return () => {
      this.observers.delete(o);
    };
  }

  constructor(actionConcept: ActionConcept = new ActionConcept()) {
    this.Action = actionConcept;
  }

  /** Invalidate all query caches for a concept — useful after external DB mutations. */
  invalidateCaches(concept: object): void {
    this.queryCaches.get(concept)?.forEach((c) => {
      c.invalidate();
    });
  }

  /** Invalidate query caches for every instrumented concept. */
  invalidateAllCaches(): void {
    for (const concept of this.concepts) {
      this.invalidateCaches(concept);
    }
  }

  /**
   * Register named sync functions. Each is invoked with the {@link $vars} proxy
   * to produce its declaration, then indexed by every action in its `when`.
   */
  register(syncs: SyncFunctionMap): void {
    for (const [name, syncFunction] of Object.entries(syncs)) {
      const raw = syncFunction($vars);
      const sync: Synchronization = {
        sync: name,
        ...raw,
        then: Array.isArray(raw.then) ? raw.then : [raw.then],
      };
      this.syncs[name] = sync;
      for (const { action } of sync.when) {
        let mapped = this.syncsByAction.get(action);
        if (mapped === undefined) {
          mapped = new Set();
          this.syncsByAction.set(action, mapped);
        }
        mapped.add(sync);
      }
    }
  }

  /**
   * React to a just-completed action: log it, then fire every sync indexed on
   * that action whose `when` matches within the action's flow.
   */
  async synchronize(record: ActionRecord, durationMs?: number): Promise<void> {
    this.logAction(record);

    const syncs = this.syncsByAction.get(record.action as InstrumentedAction);
    if (syncs === undefined) {
      // Fan out to observers even when no syncs match.
      this.emitObserverEvents(record, durationMs);
      return;
    }

    for (const sync of syncs) {
      const [matched, actionSymbols] = this.matchWhen(record, sync);
      if (matched.length === 0) continue;

      this.logFrames(`Matched \`sync\`: ${sync.sync} with \`when\`:`, matched);

      let frames = matched;
      if (sync.where !== undefined) {
        const maybeFrames = sync.where(frames);
        frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
        this.logFrames(`After processing \`where\`:`, frames);
      }
      await this.addThen(frames, sync, actionSymbols);
    }

    this.emitObserverEvents(record, durationMs);
  }

  /**
   * Match a sync's `when` against the firing action's flow.
   *
   * Starts from a single seed frame carrying the flow token, then for each
   * `when` clause joins in every journal record (within the flow) that matches,
   * binding logic variables along the way. Returns the resulting frames and the
   * per-clause symbols under which each matched record's id was stored.
   */
  matchWhen(record: ActionRecord, sync: Synchronization): [Frames<Frame>, symbol[]] {
    const flowActions = this.Action._getByFlow(record.flow);
    if (flowActions === undefined) return [new Frames(), []];

    let frames: Frames = new Frames({ [flow]: record.flow } as Frame);
    const actionSymbols: symbol[] = [];

    sync.when.forEach((when, i) => {
      const actionSymbol = Symbol(`action_${i}`);
      actionSymbols.push(actionSymbol);

      const joined = new Frames();
      for (const frame of frames) {
        for (const candidate of flowActions) {
          // Skip records this sync has already consumed (double-fire guard).
          if (candidate.synced?.has(sync.sync)) continue;
          const matched = this.matchArguments(candidate, when, frame, actionSymbol);
          if (matched !== undefined) joined.push(matched);
        }
      }
      frames = joined;
    });

    return [frames, actionSymbols];
  }

  /**
   * For every surviving frame, invoke each `then` action with inputs resolved
   * from the frame, threading the flow token and a fresh action id. As a side
   * effect, mark each consumed `when` record `synced` for this sync so it can't
   * be matched again. All produced actions are awaited in order afterward.
   */
  async addThen(frames: Frames, sync: Synchronization, actionSymbols: symbol[]): Promise<void> {
    if (this.isNestedThen(sync.then)) {
      for (const frame of frames) {
        let whenActions: ActionRecord[];
        try {
          whenActions = this.resolveWhenActions(frame, actionSymbols);
        } catch (err) {
          logger.warn(
            `Sync "${sync.sync}": skipping frame — ${err instanceof Error ? err.message : String(err)}`,
          );
          continue;
        }
        await this.runThenNodes(new Frames(frame), sync.then, sync, whenActions);
      }
      return;
    }

    const thens: [InstrumentedAction, ActionArguments, ActionRecord[]][] = [];

    for (const frame of frames) {
      let whenActions: ActionRecord[];
      try {
        whenActions = this.resolveWhenActions(frame, actionSymbols);
      } catch (err) {
        logger.warn(
          `Sync "${sync.sync}": skipping frame — ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      const flat = sync.then as ActionPattern[];
      for (const then of flat) {
        let matched: ActionArguments;
        try {
          matched = this.matchThen(then, frame);
        } catch {
          continue;
        }
        const id = matched[actionId];
        if (typeof id !== "string") {
          throw new Error("Action produced from `then` is missing an id.");
        }
        // Mark synced before executing to prevent recursive re-fire.
        for (const whenAction of whenActions) {
          whenAction.synced?.set(sync.sync, id);
        }
        thens.push([then.action, matched, whenActions]);
      }
    }

    for (const [thenAction, thenRecord, whenActions] of thens) {
      if (this.logging === Logging.VERBOSE) {
        logger.debug(`${sync.sync}: THEN ${thenAction}`, {
          record: thenRecord,
        });
      }
      const runThen = thenAction as unknown as (args: ActionArguments) => Promise<unknown>;
      try {
        await runThen(thenRecord);
      } catch (err) {
        logger.error(`Error in then action ${String(thenAction)}:`, {
          error: serializeError(err),
        });
        // On failure, unmark so the sync can retry on the next action cycle.
        for (const whenAction of whenActions) {
          whenAction.synced?.delete(sync.sync);
        }
      }
    }
  }

  private isNestedThen(then: Synchronization["then"]): then is ThenNode[] {
    return Array.isArray(then) && then.length > 0 && "kind" in then[0];
  }

  private async runThenNodes(
    frames: Frames,
    nodes: ThenNode[],
    sync: Synchronization,
    whenActions: ActionRecord[],
    previousOutcome?: ActionOutcome,
    blockDirectStepsOnError = false,
  ): Promise<void> {
    for (const frame of frames) {
      for (const node of nodes) {
        if (node.kind === "sequence") {
          await this.runSequenceNode(frame, node, sync, whenActions);
          continue;
        }
        if (node.kind === "parallel") {
          await this.runParallelNode(frame, node, sync, whenActions);
          continue;
        }
        if (node.kind === "branch") {
          await this.runBranchNode(frame, node, sync, whenActions, previousOutcome);
          continue;
        }
        if (blockDirectStepsOnError && previousOutcome?.kind === "error") {
          continue;
        }
        await this.runStepNode(frame, node, sync, whenActions);
      }
    }
  }

  private async runStepNode(
    frame: Frame,
    node: StepNode,
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<ActionOutcome | undefined> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame);
    } catch {
      return undefined;
    }

    const id = matched[actionId];
    if (typeof id !== "string") {
      throw new Error("Action produced from `then` is missing an id.");
    }

    for (const whenAction of whenActions) {
      whenAction.synced?.set(sync.sync, id);
    }

    let output: Record<string, unknown>;
    const runThen = node.action.action as unknown as (args: ActionArguments) => Promise<unknown>;
    try {
      output = (await runThen(matched)) as Record<string, unknown>;
    } catch (err) {
      logger.error(`Error in then action ${String(node.action.action)}:`, {
        error: serializeError(err),
      });
      for (const whenAction of whenActions) {
        whenAction.synced?.delete(sync.sync);
      }
      return undefined;
    }

    const outcome = normalizeOutcome(output);

    if (node.nested === undefined || node.nested.length === 0) return outcome;

    const childFrame = this.frameWithStepOutput(frame, node.action, outcome);
    if (childFrame === undefined) return outcome;

    let childFrames = new Frames(childFrame);
    if (node.where !== undefined) {
      const maybeFrames = node.where(childFrames);
      childFrames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
    }

    await this.runThenNodes(childFrames, node.nested, sync, whenActions, outcome, true);
    return outcome;
  }

  private async runBranchNode(
    frame: Frame,
    node: BranchNode,
    sync: Synchronization,
    whenActions: ActionRecord[],
    previousOutcome?: ActionOutcome,
  ): Promise<void> {
    if (previousOutcome === undefined || node.nested === undefined || node.nested.length === 0)
      return;
    const branchedFrame = this.frameWithBranchOutput(frame, previousOutcome, node);
    if (branchedFrame === undefined) return;

    let frames = new Frames(branchedFrame);
    if (node.where !== undefined) {
      const maybeFrames = node.where(frames);
      frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
    }

    await this.runThenNodes(frames, node.nested, sync, whenActions);
  }

  private async runSequenceNode(
    frame: Frame,
    node: SequenceNode,
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<void> {
    let currentFrame = frame;
    let currentOutcome: ActionOutcome | undefined;

    for (const subNode of node.nodes) {
      if (subNode.kind === "step") {
        currentOutcome = await this.runStepNode(currentFrame, subNode, sync, whenActions);
        if (currentOutcome === undefined || currentOutcome.kind === "error") break;
        if (subNode.action.output) {
          const nextFrame = this.frameWithStepOutput(currentFrame, subNode.action, currentOutcome);
          if (nextFrame) currentFrame = nextFrame;
        }
      } else if (subNode.kind === "branch") {
        await this.runBranchNode(currentFrame, subNode, sync, whenActions, currentOutcome);
      } else if (subNode.kind === "sequence") {
        await this.runSequenceNode(currentFrame, subNode, sync, whenActions);
      } else if (subNode.kind === "parallel") {
        await this.runParallelNode(currentFrame, subNode, sync, whenActions);
      }
    }
  }

  private async runParallelNode(
    frame: Frame,
    node: ParallelNode,
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<void> {
    const tasks = node.nodes.map(async (subNode) => {
      if (subNode.kind === "step") {
        await this.runStepNode(frame, subNode, sync, whenActions);
      } else if (subNode.kind === "branch") {
        await this.runBranchNode(frame, subNode, sync, whenActions, undefined);
      } else if (subNode.kind === "sequence") {
        await this.runSequenceNode(frame, subNode, sync, whenActions);
      } else if (subNode.kind === "parallel") {
        await this.runParallelNode(frame, subNode, sync, whenActions);
      }
    });
    await Promise.all(tasks);
  }

  private frameWithStepOutput(
    frame: Frame,
    pattern: ActionPattern,
    outcome: ActionOutcome,
  ): Frame | undefined {
    if (pattern.output === undefined) {
      return { ...frame };
    }
    return this.unifyOutputPattern(outcome, pattern.output, frame);
  }

  private frameWithBranchOutput(
    frame: Frame,
    outcome: ActionOutcome,
    branch: BranchNode,
  ): Frame | undefined {
    if (!this.matchesOutcome(outcome, branch.outcome, branch.pattern)) return undefined;
    return this.unifyOutputPattern(outcome, branch.pattern, frame);
  }

  private matchesOutcome(
    outcome: ActionOutcome,
    outcomeKind: OutcomeKind,
    _pattern: Mapping,
  ): boolean {
    switch (outcomeKind) {
      case "error":
        return outcome.kind === "error";
      case "complete":
        return outcome.kind === "complete";
      case "result":
        return outcome.kind !== "error";
      case "any":
        return true;
    }
  }

  private unifyOutputPattern(
    outcome: ActionOutcome,
    pattern: Mapping,
    frame: Frame,
  ): Frame | undefined {
    switch (outcome.kind) {
      case "error":
        return this.unifyPattern(outcome.error, pattern, frame);
      case "result":
        return this.unifyPattern(outcome.value, pattern, frame);
      case "complete":
        if (Object.keys(pattern).length === 0) return { ...frame };
        return undefined;
    }
  }

  /** Recover the `when` records a frame matched, ready to be marked synced. */
  private resolveWhenActions(frame: Frame, actionSymbols: symbol[]): ActionRecord[] {
    return actionSymbols.map((actionSymbol) => {
      const id = frame[actionSymbol];
      if (typeof id !== "string") {
        throw new Error("Missing actionId in `then` clause.");
      }
      const action = this.Action._getById(id);
      if (action?.synced === undefined) {
        throw new Error(`Action ${String(action)} missing or missing synced Map.`);
      }
      return action;
    });
  }

  /**
   * Resolve a `then` clause into an action argument object: replace symbol
   * inputs with their frame bindings (a missing binding is an error), then
   * attach the flow token and a fresh action id.
   */
  matchThen(then: ActionPattern, frame: Frame): ActionArguments {
    const resolve = (value: unknown): unknown => {
      if (typeof value === "symbol") {
        return frame[value];
      }
      if (Array.isArray(value)) {
        return value.map(resolve);
      }
      if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          const resolved = resolve(v);
          if (resolved !== undefined) {
            result[k] = resolved;
          }
        }
        return result;
      }
      return value;
    };

    const input: ActionArguments = {};
    for (const [key, value] of Object.entries(then.input)) {
      const resolved = resolve(value);
      if (resolved !== undefined) {
        input[key] = resolved;
      }
    }
    input[flow] = frame[flow];
    input[actionId] = uuid();
    return input;
  }

  /**
   * Try to match a single journal record against one `when` clause, extending
   * `frame` with any newly bound variables.
   *
   * The concept+action identity must match. For each input pattern key the
   * record's input must carry that key; symbols bind if unbound and otherwise
   * must unify (strict `!==`), while literals must strictly equal. The same
   * rules apply to the `output` pattern — which is required: an absent output
   * pattern is a declaration error, and a pattern key the record's output lacks
   * rejects the match (this is what makes e.g. `error` vs `question` outputs
   * mutually exclusive). On success the record's id is stored under
   * `actionSymbol`.
   */
  matchArguments(
    record: ActionRecord,
    when: ActionPattern,
    frame: Frame,
    actionSymbol: symbol,
  ): Frame | undefined {
    if (record.concept !== when.concept || record.action !== when.action) {
      return undefined;
    }

    let newFrame: Frame = { ...frame };

    const unified = this.unifyPattern(record.input, when.input, newFrame, true);
    if (unified === undefined) return undefined;
    newFrame = unified;

    if (when.output === undefined) {
      throw new Error(`When pattern: ${String(when)} is missing output pattern.`);
    }
    if (record.outcome === undefined) return undefined;

    if (Object.keys(when.output).length === 0 && record.outcome.kind === "error") {
      return undefined;
    }
    const unifiedOut = this.unifyOutputPattern(record.outcome, when.output, newFrame);
    if (unifiedOut === undefined) return undefined;
    newFrame = unifiedOut;

    return { ...newFrame, [actionSymbol]: record.id };
  }

  /**
   * Unify one pattern mapping against a record mapping, returning an extended
   * frame or `undefined` on conflict / missing key. Pure: never mutates inputs.
   */
  private unifyPattern(
    recordValues: Record<string, unknown>,
    pattern: Record<string, unknown>,
    frame: Frame,
    allowMissingKeys = false,
  ): Frame | undefined {
    let next: Frame = frame;
    for (const [key, value] of Object.entries(pattern)) {
      const recordValue = recordValues[key];
      if (recordValue === undefined) {
        if (allowMissingKeys && typeof value === "symbol") continue;
        return undefined;
      }
      if (typeof value === "symbol") {
        const bound = next[value];
        if (bound === undefined) {
          next = { ...next, [value]: recordValue };
        } else if (bound !== recordValue) {
          return undefined;
        }
      } else if (recordValue !== value) {
        return undefined;
      }
    }
    return next;
  }

  /** VERBOSE-only dump of a labeled set of frames. */
  logFrames(message: string, frames: Frames): void {
    if (this.logging === Logging.VERBOSE && frames.length > 0) {
      logger.debug(message, { frames });
    }
  }

  /** Build a JournalEvent from an action record and measured duration. */
  private toJournalEvent(record: ActionRecord, durationMs: number): JournalEvent {
    const conceptName = conceptNameOf(record.concept);
    const boundName = actionNameOf(record.action);
    return {
      concept: conceptName,
      action: boundName,
      input: record.input,
      output: record.output ?? {},
      flow: record.flow,
      durationMs,
      ts: Date.now(),
    };
  }

  /**
   * Fan out a journal event to every registered observer.
   * Each observer invocation is guarded so a throwing observer cannot
   * break the engine.
   */
  private emitObserverEvents(record: ActionRecord, durationMs?: number): void {
    if (this.observers.size === 0 || durationMs === undefined) return;
    const ev = this.toJournalEvent(record, durationMs);
    for (const o of this.observers) {
      try {
        o.onAction(ev);
      } catch (err) {
        logger.warn("observer threw", { error: serializeError(err) });
      }
    }
  }

  /** Per-action logging honouring the current {@link Logging} level. */
  private logAction(record: ActionRecord): void {
    if (this.logging === Logging.VERBOSE) {
      const { concept, input, output, ...rest } = record;
      logger.debug("Synchronizing action:", {
        concept: concept.constructor.name,
        input: sanitize(input),
        output: sanitize(output),
        ...rest,
      });
      return;
    }
    if (this.logging === Logging.TRACE) {
      const { concept, action, input, output } = this.toJournalEvent(record, 0);
      logger.debug(
        `\n${concept}.${action} ${inspect(sanitize(input))} => ${inspect(sanitize(output))}\n`,
      );
    }
  }

  /**
   * Wrap a concept in a `Proxy` that instruments its actions.
   *
   * Queries (methods whose name starts with `_`) are bound but left
   * uninstrumented — they have no journal side effects. Every other method is
   * wrapped exactly once per concept instance so the instrumented identity is
   * stable across accesses without aliasing sibling instances of the same class.
   * The wrapper records the action in the journal, runs it, records its output,
   * and then drives {@link synchronize}.
   */
  instrumentConcept<T extends object>(concept: T): T {
    this.concepts.add(concept);
    const Action = this.Action;
    const synchronize = this.synchronize.bind(this);
    const queryCaches = this.queryCaches;
    let boundActions = this.boundActionsByConcept.get(concept);
    if (boundActions === undefined) {
      boundActions = new Map();
      this.boundActionsByConcept.set(concept, boundActions);
    }

    return new Proxy(concept, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        const actionKey = value as AnyAction;

        // Queries: wrap with automatic caching.
        if (value.name.startsWith("_")) {
          const memoized = boundActions.get(actionKey);
          if (memoized !== undefined) return memoized;

          const queryFn = value.bind(concept);
          const withCache = cached(queryFn);
          boundActions.set(actionKey, withCache as unknown as InstrumentedAction);

          let caches = queryCaches.get(concept);
          if (!caches) {
            caches = [];
            queryCaches.set(concept, caches);
          }
          caches.push(withCache);

          return withCache as unknown as InstrumentedAction;
        }

        // Actions: instrument once, then memoize.
        let instrumented = boundActions.get(actionKey);
        if (instrumented !== undefined) return instrumented;

        const action = value.bind(concept);
        instrumented = async function instrumented(args: ActionArguments) {
          // Invalidate every cached query result for this concept
          // so subsequent reads see fresh data after this mutation.
          queryCaches.get(concept)?.forEach((c) => {
            c.invalidate();
          });

          let { [flow]: flowToken, [synced]: syncedMap, [actionId]: id, ...input } = args;

          if (flowToken === undefined) flowToken = uuid();
          if (typeof flowToken !== "string") {
            throw new Error("Flow token not string.");
          }
          if (syncedMap === undefined) syncedMap = new Map();
          if (!(syncedMap instanceof Map)) {
            throw new Error("synced must be a Map.");
          }
          if (id === undefined) id = uuid();
          if (typeof id !== "string") {
            throw new Error("actionId not string.");
          }

          const actionRecord: ActionRecord = {
            id,
            action: instrumented as InstrumentedAction,
            concept,
            input,
            synced: syncedMap,
            flow: flowToken,
          };

          Action.invoke(actionRecord);
          const started = performance.now();
          let output: Record<string, unknown>;
          try {
            output = (await action(input)) as Record<string, unknown>;
          } catch (err) {
            output = errorOutputFromThrown(err);
          }
          const durationMs = performance.now() - started;
          Action.invoked({ id, output });
          await synchronize({ ...actionRecord, output }, durationMs);
          return output;
        } as InstrumentedAction;

        instrumented.concept = concept;
        instrumented.action = action;
        const repr = () => inspect(action);
        instrumented.toString = repr;
        Object.defineProperty(instrumented, inspectCustom, {
          value: repr,
          writable: false,
          configurable: true,
        });

        boundActions.set(actionKey, instrumented);
        return instrumented;
      },
    });
  }

  /** Instrument every concept in a record, preserving keys. */
  instrument<T extends Record<string, object>>(concepts: T): T {
    return Object.fromEntries(
      Object.entries(concepts).map(([key, concept]) => [key, this.instrumentConcept(concept)]),
    ) as T;
  }
}
