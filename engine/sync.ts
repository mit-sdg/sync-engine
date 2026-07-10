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
  ActChain,
  ActionList,
  ActionOutcome,
  ActionPattern,
  AnyAction,
  CaseNode,
  Frame,
  Guard,
  GuardFn,
  GuardReader,
  InstrumentedAction,
  Matcher,
  Mapping,
  OutcomeKind,
  ParallelChild,
  ParallelNode,
  SequenceNode,
  StepNode,
  SyncDeclaration,
  SyncFunction,
  SyncFunctionMap,
  Synchronization,
  ThenNode,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhenClause,
  WhereFn,
} from "./types.ts";
import { inspect, inspectCustom, uuid } from "./util.ts";
import { $vars, type Var } from "./vars.ts";

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

// ── Fluent authoring DSL ──────────────────────────────────────────────────
//
// A sync reads as one sentence:
//
//   sync(({ requestId, route }) =>
//     when(Request.submitted, { requestId }).then(
//       act(Review.classify, { requestId }).match(
//         on({ route }, act(Request.approve, { requestId })),
//         onError({ detail: reason }, act(Audit.record, { event: "FAILED" })),
//       ),
//     ),
//   );
//
// The public constructors produce steps and parallel nodes. Pipelines are
// normalized internally so every execution path shares the same semantics.

/**
 * Brand marking a value as a DSL-constructed node. Lets {@link onError} tell a
 * user pattern (a plain {@link Mapping}, which may itself contain a `kind`
 * key) apart from a node, without a fragile `"kind" in x` duck-test. Defined
 * non-enumerable so it never leaks into spreads, serialization, or inspection.
 */
const NodeBrand: unique symbol = Symbol("NodeBrand");
const CaseBrand: unique symbol = Symbol("CaseBrand");
const MatcherBrand: unique symbol = Symbol("MatcherBrand");
const GuardBrand: unique symbol = Symbol("GuardBrand");

function brand<T extends object>(node: T): T {
  Object.defineProperty(node, NodeBrand, { value: true, enumerable: false });
  return node;
}

function isNode(value: unknown): value is ThenNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[NodeBrand] === true
  );
}

function isCase(value: unknown): value is CaseNode {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[CaseBrand] === true
  );
}

function isGuard(value: unknown): value is Guard {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[GuardBrand] === true
  );
}

function isMatcher(value: unknown): value is Matcher {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[MatcherBrand] === true
  );
}

/**
 * Declares a sync function. An identity wrapper that gives TypeScript a place to
 * infer the {@link Vars} parameter and makes every rule greppable by a single name.
 */
export function sync(fn: SyncFunction): SyncFunction {
  return fn;
}

/**
 * Start a sync rule by matching one or more action clauses against the journal.
 * Pass a single action as `when(action, input, output?)`, or join multiple
 * clauses with `when([[action, input, output?], ...])`. Chain an optional
 * `.where(...)` to transform frames, then `.then(...)` to dispatch.
 */
export function when(clauses: WhenClause[]): WhenBuilder;
export function when(action: InstrumentedAction, input: Mapping, output?: Mapping): WhenBuilder;
export function when(
  actionOrClauses: InstrumentedAction | WhenClause[],
  input?: Mapping,
  output?: Mapping,
): WhenBuilder {
  if (Array.isArray(actionOrClauses)) {
    if (actionOrClauses.length === 0) throw new Error("when([...]) requires at least one clause.");
    return createWhenBuilder(...actionOrClauses);
  }
  if (input === undefined) throw new Error("when(action, input) requires an input pattern.");
  return createWhenBuilder([actionOrClauses, input, output]);
}

function createWhenBuilder(...clauses: WhenClause[]): WhenBuilder {
  // A `when` pattern always carries an output pattern (an empty one rejects
  // error outputs); default it here so callers may omit the third tuple entry.
  const patterns: ActionPattern[] = actions(
    ...clauses.map(([action, input, output]) => [action, input, output ?? {}] as ActionList),
  );
  let where: WhereFn | undefined;
  const builder: WhenBuilder = {
    where(fn) {
      if (where !== undefined) {
        throw new Error(
          "when(...).where() called twice — combine the transforms into one function.",
        );
      }
      where = fn;
      // The narrowed type hides `.where`, enforcing `when → where → then`.
      return builder as unknown as WhenBuilderWithWhere;
    },
    then(...nodes) {
      assertTopLevelThen(nodes);
      const decl: SyncDeclaration = { when: patterns, then: nodes };
      if (where !== undefined) decl.where = where;
      return decl;
    },
  };
  return builder;
}

/**
 * A dispatch step. Its optional output mapping extends a successful result's
 * frame for following pipeline nodes; `.match(...)` handles its outcome.
 */
export function act(action: InstrumentedAction, input: Mapping, output?: Mapping): ActChain {
  const node: StepNode = { kind: "step", action: actions([action, input, output])[0] };
  const chain = brand(node) as unknown as ActChain;
  chain.where = (fn) => {
    node.transform = fn;
    return chain;
  };
  chain.match = (...cases) => {
    assertCases(cases);
    node.cases = cases;
    return chain;
  };
  return chain;
}

function buildCase(outcome: "result" | "error", args: unknown[]): CaseNode {
  const [first, ...rest] = args;
  const pattern = isNode(first) ? {} : (first as Mapping);
  const values = isNode(first) ? args : rest;
  const candidateGuard = values[0];
  const guard = isGuard(candidateGuard) ? candidateGuard : undefined;
  const nodes = (guard === undefined ? values : values.slice(1)) as ThenNode[];
  if (nodes.length === 0 || !nodes.every(isNode)) {
    throw new Error("on()/onError() requires at least one act()/par() node.");
  }
  const node = { kind: "case", outcome, pattern, nodes, ...(guard ? { guard } : {}) } as CaseNode;
  Object.defineProperty(node, CaseBrand, { value: true, enumerable: false });
  return node;
}

export function on(...nodes: ThenNode[]): CaseNode;
export function on(pattern: Mapping, ...nodes: ThenNode[]): CaseNode;
export function on(pattern: Mapping, guard: Guard, ...nodes: ThenNode[]): CaseNode;
export function on(...args: unknown[]): CaseNode {
  return buildCase("result", args);
}

export function onError(...nodes: ThenNode[]): CaseNode;
export function onError(pattern: Mapping, ...nodes: ThenNode[]): CaseNode;
export function onError(pattern: Mapping, guard: Guard, ...nodes: ThenNode[]): CaseNode;
export function onError(...args: unknown[]): CaseNode {
  return buildCase("error", args);
}

export function otherwise(...nodes: ThenNode[]): CaseNode {
  if (nodes.length === 0 || !nodes.every(isNode)) {
    throw new Error("otherwise() requires at least one act()/par() node.");
  }
  const node: CaseNode = { kind: "case", outcome: "any", pattern: {}, nodes };
  Object.defineProperty(node, CaseBrand, { value: true, enumerable: false });
  return node;
}

/** Create an inspectable equality matcher. */
export function oneOf(...candidates: unknown[]): Matcher {
  if (candidates.length === 0) throw new Error("oneOf(...) requires at least one candidate.");
  const node = {
    kind: "oneOf",
    candidates,
    label: `oneOf(${candidates.map(String).join(", ")})`,
  } as unknown as Matcher;
  Object.defineProperty(node, MatcherBrand, { value: true, enumerable: false });
  return node;
}

/** Create a branded value matcher. */
export function is(predicate: (value: unknown) => boolean, label = "is"): Matcher {
  const node = { kind: "is", predicate, label } as unknown as Matcher;
  Object.defineProperty(node, MatcherBrand, { value: true, enumerable: false });
  return node;
}

/** Create a branded synchronous, cross-binding case guard. */
export function guard(fn: GuardFn, label?: string): Guard {
  const node = { fn, ...(label === undefined ? {} : { label }) } as Guard;
  Object.defineProperty(node, GuardBrand, { value: true, enumerable: false });
  return node;
}

/**
 * Run children concurrently from the same input frame. An array child is an
 * explicit local pipeline whose bindings remain private to that child.
 */
export function par(...children: ParallelChild[]): ParallelNode {
  if (children.length === 0) throw new Error("par(...) requires at least one child.");
  const nodes = children.map((child) => {
    if (Array.isArray(child)) {
      if (child.length === 0 || !child.every(isNode)) {
        throw new Error("par([...]) requires at least one act()/par() node.");
      }
      return brand({ kind: "sequence", nodes: [...child] }) as SequenceNode;
    }
    if (!isNode(child)) throw new Error("par(...) accepts only act(), par(), or a pipeline array.");
    return child;
  });
  return brand({ kind: "parallel", nodes });
}

/**
 * Validate the top-level nodes of `.then(...)`. Two silent failures become loud
 * construction-time errors:
 *  - `await when(...)` treats the builder as a promise, calling `.then` with
 *    resolve/reject functions — caught here as non-nodes;
 */
function assertTopLevelThen(nodes: ThenNode[]): void {
  if (nodes.length === 0) {
    throw new Error(".then(...) requires at least one node (act/par).");
  }
  for (const node of nodes) {
    if (isCase(node)) {
      throw new Error("on()/onError()/otherwise() cases may only appear inside act(...).match().");
    }
    if (!isNode(node)) {
      throw new Error(
        "a sync rule is not a promise — pass act()/par() nodes to .then() (did you `await` a when(...) chain?).",
      );
    }
  }
}

function assertCases(cases: CaseNode[]): void {
  if (cases.length === 0) throw new Error("act(...).match() requires at least one case.");
  let otherwiseSeen = false;
  for (const node of cases) {
    if (!isCase(node))
      throw new Error("act(...).match() accepts only on(), onError(), or otherwise() cases.");
    if (otherwiseSeen) throw new Error("otherwise() must be the final match case.");
    otherwiseSeen = node.outcome === "any";
  }
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
  /** Resolves public instrumented proxies back to their cache-owning instances. */
  private rawConceptsByInstrumented = new WeakMap<object, object>();
  /** All raw concept instances known to this engine, via WeakRef so they can be GC'd. */
  private concepts = new Set<WeakRef<object>>();
  /** Engine-level observers (passive sinks). */
  private observers = new Set<EngineObserver>();

  /** Register an engine observer. Returns a function to unregister it. */
  addObserver(o: EngineObserver): () => void {
    this.observers.add(o);
    return () => {
      this.observers.delete(o);
    };
  }

  /** Remove all registered observers. */
  clearObservers(): void {
    this.observers.clear();
  }

  constructor(actionConcept: ActionConcept = new ActionConcept()) {
    this.Action = actionConcept;
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
      const old = this.syncs[name];
      if (old) {
        for (const { action } of old.when) {
          this.syncsByAction.get(action)?.delete(old);
        }
      }
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
    this.logAction(record, durationMs);

    const syncs = this.syncsByAction.get(record.action as InstrumentedAction);
    if (syncs === undefined) {
      // Fan out to observers even when no syncs match.
      this.emitObserverEvents(record, durationMs);
      return;
    }

    for (const sync of syncs) {
      try {
        const [matched, actionSymbols] = this.matchWhen(record, sync);
        if (matched.length === 0) continue;

        this.logFrames(`Matched \`sync\`: ${sync.sync} with \`when\`:`, matched);

        let frames = matched;
        if (sync.where !== undefined) {
          try {
            const maybeFrames = sync.where(frames);
            frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
          } catch (err) {
            logger.error(`Sync "${sync.sync}": where() threw — ${serializeError(err)}`);
            continue;
          }
          this.logFrames(`After processing \`where\`:`, frames);
        }
        await this.addThen(frames, sync, actionSymbols);
      } catch (err) {
        logger.error(`Sync "${sync.sync}": processing threw — ${serializeError(err)}`);
      }
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

    let framesWithConsumed: [Frame, Set<string>][] = [
      [{ [flow]: record.flow } as Frame, new Set()],
    ];
    const actionSymbols: symbol[] = [];

    sync.when.forEach((when, i) => {
      const actionSymbol = Symbol(`action_${i}`);
      actionSymbols.push(actionSymbol);

      const next: [Frame, Set<string>][] = [];
      for (const [frame, parentConsumed] of framesWithConsumed) {
        for (const candidate of flowActions) {
          // Skip records this sync has already consumed (double-fire guard).
          if (candidate.synced?.has(sync.sync)) continue;
          if (candidate.id !== undefined && parentConsumed.has(candidate.id)) continue;
          const matched = this.matchArguments(candidate, when, frame, actionSymbol);
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

  /** Run the declared pipeline once for every frame matched by `when`. */
  async addThen(frames: Frames, sync: Synchronization, actionSymbols: symbol[]): Promise<void> {
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
      await this.runPipeline(new Frames(frame), sync.then, sync, whenActions);
    }
  }

  /** Execute a pipeline independently for every input frame. */
  private async runPipeline(
    frames: Frames,
    nodes: ThenNode[],
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<Frames> {
    const results: Frame[] = [];
    for (const frame of frames) {
      results.push(...(await this.runPipelineForFrame(frame, nodes, sync, whenActions)));
    }
    return new Frames(...results);
  }

  private async runPipelineForFrame(
    frame: Frame,
    nodes: ThenNode[],
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<Frames> {
    let current = new Frames(frame);
    for (const node of nodes) {
      const next: Frame[] = [];
      for (const currentFrame of current) {
        if (node.kind === "parallel") {
          await this.runParallelNode(currentFrame, node, sync, whenActions);
          next.push(currentFrame);
          continue;
        }
        const result = await this.runStepNode(currentFrame, node, sync, whenActions);
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
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<{ frames: Frames; stop: boolean }> {
    let matched: ActionArguments;
    try {
      matched = this.matchThen(node.action, frame);
    } catch (err) {
      logger.warn(
        `Sync "${sync.sync}": matchThen failed for step ${String(node.action.action)} — ${serializeError(err)}`,
      );
      return { frames: new Frames(), stop: true };
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
      return { frames: new Frames(), stop: true };
    }

    const outcome = normalizeOutcome(output);
    let childFrames: Frames;
    try {
      // A failed action never tries to satisfy a successful output mapping.
      childFrames =
        outcome.kind === "error"
          ? new Frames({ ...frame })
          : this.framesWithStepOutput(frame, node.action, outcome);
    } catch (err) {
      logger.error(`Sync "${sync.sync}": output matching failed — ${serializeError(err)}`);
      return { frames: new Frames(), stop: true };
    }
    if (childFrames.length === 0) return { frames: childFrames, stop: true };

    if (node.transform !== undefined) {
      try {
        const maybeFrames = node.transform(childFrames);
        childFrames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
      } catch (err) {
        logger.error(
          `Sync "${sync.sync}": act(...).where() threw for ${String(node.action.action)} — ${serializeError(err)}`,
        );
        return { frames: new Frames(), stop: true };
      }
    }

    const caseFrames = await this.runCases(childFrames, node.cases, outcome, sync, whenActions);
    // An action error is terminal even if its recovery case successfully runs.
    return { frames: caseFrames, stop: outcome.kind === "error" };
  }

  private async runParallelNode(
    frame: Frame,
    node: ParallelNode,
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<void> {
    const tasks = node.nodes.map(async (subNode) => {
      // Each parallel branch gets its own synced map copy so sibling
      // failures cannot erase another branch's consumption mark.
      const ownWhenActions = whenActions.map((wa) => ({
        ...wa,
        synced: new Map(wa.synced),
      }));
      if (subNode.kind === "sequence") {
        await this.runPipeline(new Frames(frame), subNode.nodes, sync, ownWhenActions);
      } else if (subNode.kind === "parallel") {
        await this.runParallelNode(frame, subNode, sync, ownWhenActions);
      } else {
        await this.runPipeline(new Frames(frame), [subNode], sync, ownWhenActions);
      }
      // Reconcile successful synced entries back to originals so the
      // caller can see which actions were consumed.
      for (let i = 0; i < whenActions.length; i++) {
        const target = whenActions[i].synced;
        if (target) {
          for (const [k, v] of ownWhenActions[i].synced) {
            target.set(k, v);
          }
        }
      }
    });
    await Promise.all(tasks);
  }

  private framesWithStepOutput(
    frame: Frame,
    pattern: ActionPattern,
    outcome: ActionOutcome,
  ): Frames {
    if (pattern.output === undefined) {
      return new Frames({ ...frame });
    }
    const extended = this.unifyOutputPattern(outcome, pattern.output, frame);
    return extended === undefined ? new Frames() : new Frames(extended);
  }

  private async runCases(
    frames: Frames,
    cases: CaseNode[] | undefined,
    outcome: ActionOutcome,
    sync: Synchronization,
    whenActions: ActionRecord[],
  ): Promise<Frames> {
    if (cases === undefined) return frames;
    const results: Frame[] = [];
    for (const frame of frames) {
      let selected: CaseNode | undefined;
      let selectedFrame: Frame | undefined;
      try {
        for (const candidate of cases) {
          if (!this.matchesOutcome(outcome, candidate.outcome)) continue;
          const matched = this.unifyOutputPattern(outcome, candidate.pattern, frame);
          if (matched === undefined) continue;
          if (candidate.guard !== undefined && !candidate.guard.fn(this.guardReader(matched)))
            continue;
          selected = candidate;
          selectedFrame = matched;
          break;
        }
      } catch (err) {
        logger.error(`Sync "${sync.sync}": match evaluation threw — ${serializeError(err)}`);
        continue;
      }
      if (selected === undefined || selectedFrame === undefined) {
        if (this.logging === Logging.VERBOSE) {
          logger.debug(`${sync.sync}: no match case for ${String(outcome.kind)}`);
        }
        results.push(frame);
        continue;
      }
      results.push(
        ...(await this.runPipeline(new Frames(selectedFrame), selected.nodes, sync, whenActions)),
      );
    }
    return new Frames(...results);
  }

  private guardReader(frame: Frame): GuardReader {
    return <T>(variable: Var<T>): T => {
      if (!(variable in frame)) {
        throw new Error(`Guard read unbound variable ${variable.description ?? String(variable)}.`);
      }
      return frame[variable] as T;
    };
  }

  private matchesOutcome(outcome: ActionOutcome, outcomeKind: OutcomeKind): boolean {
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
        if (!(value in frame)) {
          throw new Error(
            `Then clause references variable ${String(value)} which is not bound in the current frame.`,
          );
        }
        return frame[value];
      }
      if (Array.isArray(value)) {
        return value.map(resolve);
      }
      if (value !== null && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          result[k] = resolve(v);
        }
        return result;
      }
      return value;
    };

    const input: ActionArguments = {};
    for (const [key, value] of Object.entries(then.input)) {
      const resolved = resolve(value);
      input[key] = resolved;
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
      if (!(key in recordValues)) {
        if (allowMissingKeys && typeof value === "symbol") continue;
        return undefined;
      }
      const recordValue = recordValues[key];
      if (typeof value === "symbol") {
        if (!(value in next)) {
          next = { ...next, [value]: recordValue };
        } else if (next[value] !== recordValue) {
          return undefined;
        }
      } else if (value instanceof RegExp) {
        if (typeof recordValue !== "string") return undefined;
        value.lastIndex = 0;
        const matched = value.test(recordValue);
        value.lastIndex = 0;
        if (!matched) return undefined;
      } else if (isMatcher(value)) {
        if (value.kind === "oneOf") {
          if (!value.candidates?.some((candidate) => candidate === recordValue)) return undefined;
        } else if (!value.predicate?.(recordValue)) {
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
  private logAction(record: ActionRecord, durationMs?: number): void {
    if (this.logging === Logging.VERBOSE) {
      const { concept, input, output, flow: recordFlow, id: actionRecordId, outcome } = record;
      logger.debug("Synchronizing action:", {
        concept: concept.constructor.name,
        input: sanitize(input),
        output: sanitize(output),
        outcome: sanitize(outcome),
        flow: recordFlow,
        actionId: actionRecordId,
      });
      return;
    }
    if (this.logging === Logging.TRACE) {
      const { concept, action, input, output } = this.toJournalEvent(record, durationMs ?? 0);
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
    this.concepts.add(new WeakRef(concept));
    const Action = this.Action;
    const synchronize = this.synchronize.bind(this);
    const emitObserverEvents = this.emitObserverEvents.bind(this);
    const queryCaches = this.queryCaches;
    let boundActions = this.boundActionsByConcept.get(concept);
    if (boundActions === undefined) {
      boundActions = new Map();
      this.boundActionsByConcept.set(concept, boundActions);
    }

    const instrumentedConcept = new Proxy(concept, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        const actionKey = value as AnyAction;

        // Queries: wrap with automatic caching.
        if (String(prop).startsWith("_")) {
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
          try {
            await synchronize({ ...actionRecord, output }, durationMs);
          } catch (err) {
            logger.error("synchronize threw after action was recorded", {
              actionId: id,
              concept: concept.constructor.name,
              action: action.name,
              error: serializeError(err),
            });
            emitObserverEvents({ ...actionRecord, output }, durationMs);
          }
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
    this.rawConceptsByInstrumented.set(instrumentedConcept, concept);
    return instrumentedConcept;
  }

  /** Instrument every concept in a record, preserving keys. */
  instrument<T extends Record<string, object>>(concepts: T): T;
  /** Instrument a single concept instance. */
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object> | object): any {
    if (concepts !== null && typeof concepts === "object" && concepts.constructor === Object) {
      const entries = Object.entries(concepts);
      if (entries.length > 0 && entries.every(([, v]) => typeof v === "object" && v !== null)) {
        return Object.fromEntries(
          entries.map(([key, concept]) => [key, this.instrumentConcept(concept as object)]),
        );
      }
    }
    return this.instrumentConcept(concepts as object);
  }
}
