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
  BranchNode,
  BranchPredicate,
  Frame,
  InstrumentedAction,
  Mapping,
  OutcomeKind,
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

// ── Fluent authoring DSL ──────────────────────────────────────────────────
//
// A sync reads as one sentence:
//
//   sync(({ requestId, route }) =>
//     when(Request.submitted, { requestId })
//       .then(
//         act(Review.classify, { requestId }).as({ route }).branch(
//           on({ route: [route] }, act(Request.approve, { requestId })),
//           onError({ detail: [reason] }, act(Audit.record, { event: "FAILED" })),
//           on(act(Audit.record, { event: "EMPTY" })),
//         ),
//       ),
//   );
//
// Every constructor produces the same internal node vocabulary the engine
// already executes (StepNode / BranchNode / SequenceNode / ParallelNode). The
// DSL only adds a legible surface plus construction-time checks for shapes
// that would otherwise fail silently at runtime.

/**
 * Brand marking a value as a DSL-constructed node. Lets {@link onError} tell a
 * user pattern (a plain {@link Mapping}, which may itself contain a `kind`
 * key) apart from a node, without a fragile `"kind" in x` duck-test. Defined
 * non-enumerable so it never leaks into spreads, serialization, or inspection.
 */
const NodeBrand: unique symbol = Symbol("NodeBrand");

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
 * A dispatch step. `act(action, input)` invokes `action` once per surviving
 * frame; refine it with `.as(...)`, `.where(...)`, and `.branch(...)`. See
 * {@link ActChain}.
 */
export function act(action: InstrumentedAction, input: Mapping): ActChain {
  const node: StepNode = { kind: "step", action: actions([action, input])[0] };
  const chain = brand(node) as unknown as ActChain;
  chain.as = (outputMapping) => {
    node.action = { ...node.action, output: { ...node.action.output, ...outputMapping } };
    return chain;
  };
  chain.where = (fn) => {
    node.transform = fn;
    return chain;
  };
  chain.branch = (...nodes) => {
    if (nodes.length === 0) {
      throw new Error("act(...).branch() requires at least one node (on/onError/act/…).");
    }
    node.nested = [...(node.nested ?? []), ...nodes];
    return chain;
  };
  return chain;
}

function buildBranch(outcome: "result" | "error", args: unknown[]): BranchNode {
  const [first, second, ...rest] = args;
  if (first !== undefined && isNode(first)) {
    return brand({
      kind: "branch",
      outcome,
      pattern: {},
      nested: args as ThenNode[],
    });
  }
  if (typeof first === "function") {
    const nodes = [second, ...rest].filter((n): n is ThenNode => n !== undefined);
    if (nodes.length === 0) throw new Error("on(...)/onError(...) requires at least one node.");
    return brand({
      kind: "branch",
      outcome,
      pattern: {},
      predicate: first as BranchPredicate,
      nested: nodes,
    });
  }
  const pattern = first as Mapping;
  let predicate: BranchPredicate | undefined;
  let nodes: ThenNode[];
  if (typeof second === "function") {
    predicate = second as BranchPredicate;
    nodes = rest.length > 0 ? (rest as ThenNode[]) : [];
  } else {
    nodes = [second, ...rest] as ThenNode[];
  }
  if (nodes.length === 0) throw new Error("on(...)/onError(...) requires at least one node.");
  const branch: BranchNode = {
    kind: "branch",
    outcome,
    pattern,
    nested: nodes,
  };
  if (predicate !== undefined) branch.predicate = predicate;
  return brand(branch);
}

/**
 * Success branch: fires when the preceding step produced a value or completed
 * (any non-error outcome). Pattern is optional — omit it when `.as()` already
 * bound what you need. Pass one to filter or extract further bindings. Use
 * {@link onError} to catch failures.
 *
 * Pattern values use `[var]` bracket syntax to extract values into variables
 * (e.g. `{ route: [route] }`). String/number/boolean values perform literal
 * matching. An optional predicate function `(frame) => boolean` enables
 * complex per-frame filtering — pass it as the first argument (no pattern)
 * or as the second argument after a pattern.
 *
 *   on(act(Receipt.send, { paymentId }))                    // .as() already had paymentId
 *   on({ route: [route] }, act(Request.approve))            // extract value into route
 *   on({ status: "active" }, act(Process.active))           // literal string match
 *   on((f) => f[someVar] > 10, act(HandleLarge))            // predicate-only filter
 *   on({ kind: [kind] }, (f) => f[kind] === "VALID", act(Process.valid))
 */
export function on(...args: ThenNode[]): BranchNode;
export function on(pattern: Mapping, ...nodes: ThenNode[]): BranchNode;
export function on(predicate: BranchPredicate, ...nodes: ThenNode[]): BranchNode;
export function on(pattern: Mapping, predicate: BranchPredicate, ...nodes: ThenNode[]): BranchNode;
export function on(...args: unknown[]): BranchNode {
  return buildBranch("result", args);
}

/**
 * Error branch: fires when the preceding step failed — whether it threw or
 * returned an error record (both normalise to a `{ kind: "error" }` outcome).
 *
 * The optional first argument is a pattern unified against the error record,
 * using `[var]` bracket syntax for extraction. The optional predicate
 * function `(frame) => boolean` enables complex per-frame filtering — pass it
 * as the first argument (no pattern) or as the second argument after a pattern.
 */
export function onError(...args: ThenNode[]): BranchNode;
export function onError(pattern: Mapping, ...nodes: ThenNode[]): BranchNode;
export function onError(predicate: BranchPredicate, ...nodes: ThenNode[]): BranchNode;
export function onError(
  pattern: Mapping,
  predicate: BranchPredicate,
  ...nodes: ThenNode[]
): BranchNode;
export function onError(...args: unknown[]): BranchNode {
  return buildBranch("error", args);
}

/**
 * Run steps in order, forwarding each step's `.as(...)` bindings into the next
 * step's frame. Stops at the first error outcome. A branch may follow a step
 * (it dispatches on that step's outcome) but may not lead — a leading branch
 * has no outcome to match and would be dead.
 */
export function seq(...nodes: ThenNode[]): SequenceNode {
  if (nodes.length === 0) throw new Error("seq(...) requires at least one node.");
  let sawStep = false;
  for (const node of nodes) {
    if (node.kind === "branch" && !sawStep) {
      throw new Error("seq(...): a branch (on/onError) must follow an act(), not lead.");
    }
    if (node.kind !== "branch") sawStep = true;
  }
  return brand({ kind: "sequence", nodes });
}

/**
 * Run steps concurrently, each from the same input frame. Branches are
 * rejected: a parallel child never receives a preceding outcome, so an
 * outcome branch here would be silently dead — attach it via
 * `act(...).branch(...)` instead.
 */
export function par(...nodes: ThenNode[]): ParallelNode {
  if (nodes.length === 0) throw new Error("par(...) requires at least one node.");
  for (const node of nodes) {
    if (node.kind === "branch") {
      throw new Error(
        "par(...): outcome branches are not allowed — parallel children receive no outcome; " +
          "attach the branch to a specific step via act(...).branch(...).",
      );
    }
  }
  return brand({ kind: "parallel", nodes });
}

/**
 * Validate the top-level nodes of `.then(...)`. Two silent failures become loud
 * construction-time errors:
 *  - `await when(...)` treats the builder as a promise, calling `.then` with
 *    resolve/reject functions — caught here as non-nodes;
 *  - a top-level outcome branch never receives an outcome (top-level siblings
 *    are not threaded), so it would be dead — it must be nested under an act.
 */
function assertTopLevelThen(nodes: ThenNode[]): void {
  if (nodes.length === 0) {
    throw new Error(".then(...) requires at least one node (act/seq/par).");
  }
  for (const node of nodes) {
    if (!isNode(node)) {
      throw new Error(
        "a sync rule is not a promise — pass act()/seq()/par() nodes to .then() (did you `await` a when(...) chain?).",
      );
    }
    if (node.kind === "branch") {
      throw new Error(
        "on()/onError() cannot be a top-level `.then(...)` node — nest it via act(...).branch(...).",
      );
    }
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
        } catch (err) {
          logger.warn(
            `Sync "${sync.sync}": matchThen failed for ${String(then.action)} — ${serializeError(err)}`,
          );
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
    } catch (err) {
      logger.warn(
        `Sync "${sync.sync}": matchThen failed for step ${String(node.action.action)} — ${serializeError(err)}`,
      );
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
    if (node.transform !== undefined) {
      try {
        const maybeFrames = node.transform(childFrames);
        childFrames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
      } catch (err) {
        logger.error(
          `Sync "${sync.sync}": act(...).where() threw for ${String(node.action.action)} — ${serializeError(err)}`,
        );
        return outcome;
      }
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
    if (node.transform !== undefined) {
      try {
        const maybeFrames = node.transform(frames);
        frames = maybeFrames instanceof Promise ? await maybeFrames : maybeFrames;
      } catch (err) {
        logger.error(
          `Sync "${sync.sync}": branch.where() threw for outcome "${node.outcome}" — ${serializeError(err)}`,
        );
        return;
      }
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
      // Each parallel branch gets its own synced map copy so sibling
      // failures cannot erase another branch's consumption mark.
      const ownWhenActions = whenActions.map((wa) => ({
        ...wa,
        synced: new Map(wa.synced),
      }));
      if (subNode.kind === "step") {
        await this.runStepNode(frame, subNode, sync, ownWhenActions);
      } else if (subNode.kind === "branch") {
        await this.runBranchNode(frame, subNode, sync, ownWhenActions, undefined);
      } else if (subNode.kind === "sequence") {
        await this.runSequenceNode(frame, subNode, sync, ownWhenActions);
      } else if (subNode.kind === "parallel") {
        await this.runParallelNode(frame, subNode, sync, ownWhenActions);
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
    if (!this.matchesOutcome(outcome, branch.outcome)) return undefined;
    const extendedFrame = this.unifyOutputPattern(outcome, branch.pattern, frame);
    if (extendedFrame === undefined) return undefined;
    if (branch.predicate !== undefined && !branch.predicate(extendedFrame)) return undefined;
    return extendedFrame;
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
        if (
          allowMissingKeys &&
          (typeof value === "symbol" ||
            (Array.isArray(value) && value.length === 1 && typeof value[0] === "symbol"))
        )
          continue;
        return undefined;
      }
      const recordValue = recordValues[key];
      if (Array.isArray(value) && value.length === 1 && typeof value[0] === "symbol") {
        const sym = value[0];
        if (!(sym in next)) {
          next = { ...next, [sym]: recordValue };
        } else if (next[sym] !== recordValue) {
          return undefined;
        }
      } else if (typeof value === "symbol") {
        if (!(value in next)) {
          next = { ...next, [value]: recordValue };
        } else if (next[value] !== recordValue) {
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
