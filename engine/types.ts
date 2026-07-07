/**
 * Core type vocabulary for the engine.
 *
 * The engine speaks in terms of **frames** (a bag of variable bindings keyed by
 * `symbol`) and **mappings** (a plain record keyed by `string`, as seen by the
 * concept actions themselves). Synchronizations are written declaratively as
 * `when` / `where` / `then` clauses over these structures.
 */
import type { Frames } from "./frames.ts";

/** A plain, string-keyed record — the shape an action's input/output takes. */
export type Mapping = Record<string, unknown>;

/**
 * A single row of variable bindings used during matching. Keys are the unique
 * `symbol`s produced by destructuring {@link Vars}; values are whatever those
 * variables are currently bound to.
 */
export type Frame = Record<symbol, unknown>;

/** A concept action: a function from an input mapping to an output mapping. */
export type ActionFunction<TInput = Mapping, TOutput = Mapping> = (input: TInput) => TOutput;

/** A concept method reference stored as identity, not called through this type. */
export type AnyAction = (...args: never[]) => unknown;

/**
 * A tuple passed to {@link actions}: an instrumented action plus the input
 * pattern and (optionally) the output pattern to match/produce.
 */
export type ActionList = [InstrumentedAction, Mapping, Mapping?];

/**
 * A normalized clause produced by {@link actions}. In a `when` it describes a
 * pattern to match against the action log; in a `then` it describes an action
 * to invoke with bindings resolved from the matched frame.
 */
export interface ActionPattern {
  action: InstrumentedAction;
  concept: object;
  input: Mapping;
  output?: Mapping;
  flow: symbol;
}

/**
 * The canonical outcome of an action execution.
 *
 * Rather than inferring outcome semantics from raw output records
 * (e.g. `{ error: … }` → error, `{}` → complete), the engine normalises
 * every action result into a first-class discriminated union so branches,
 * observers and devtools can type-narrow on {@link ActionOutcome.kind}.
 */
export type ActionOutcome =
  | { kind: "result"; value: Mapping }
  | { kind: "error"; error: Mapping }
  | { kind: "complete" };

export type OutcomeKind = "any" | "result" | "error" | "complete";

export type ThenClause = ActionPattern[] | ThenNode[] | ThenNode;

export type ThenNode = StepNode | BranchNode | SequenceNode | ParallelNode;

export interface NestedThenOptions {
  /**
   * A transform applied to this node's frames before its `nested` children run
   * — the per-step analogue of a sync's `where`. Named `transform` at the node
   * level (not `where`) so the fluent `ActChain.where(...)` method that sets it
   * does not collide with a same-named data field.
   */
  transform?: WhereFn;
  nested?: ThenNode[];
}

export interface StepNode extends NestedThenOptions {
  kind: "step";
  action: ActionPattern;
}

export interface BranchNode extends NestedThenOptions {
  kind: "branch";
  outcome: OutcomeKind;
  pattern: Mapping;
}

export interface SequenceNode {
  kind: "sequence";
  nodes: ThenNode[];
}

export interface ParallelNode {
  kind: "parallel";
  nodes: ThenNode[];
}

/** A pure transform over matched frames — the `where` clause. */
export type WhereFn = (frames: Frames) => Frames | Promise<Frames>;

/** The raw object a sync function returns before it is registered by name. */
export interface SyncDeclaration {
  when: ActionPattern[];
  where?: WhereFn;
  then: ThenClause;
}

/** A registered synchronization: a {@link SyncDeclaration} plus its name. */
export interface Synchronization extends SyncDeclaration {
  sync: string;
}

/**
 * An instrumented action callable. Beyond invoking the underlying concept
 * method, it carries back-references to its `concept` and the original bound
 * `action`, which {@link actions} and the logger rely on.
 */
export interface InstrumentedAction extends AnyAction {
  concept?: object;
  action?: AnyAction;
}

/**
 * The proxy handed to every sync function. Property access returns a fresh
 * `symbol` named after the property, so `const { user } = vars` binds `user`
 * to a unique logic variable.
 */
export type Vars = Record<string, symbol>;

/** A sync function: given {@link Vars}, returns its declaration. */
export type SyncFunction = (vars: Vars) => SyncDeclaration;

/** A named collection of sync functions, as passed to `register`. */
export type SyncFunctionMap = Record<string, SyncFunction>;

/** The canonical "no fields" mapping, used for empty action inputs/outputs. */
export type Empty = Record<PropertyKey, never>;

/**
 * A chainable dispatch step, returned by `act(action, input)`.
 *
 * Carries the base {@link StepNode} fields plus fluent refinements:
 *  - `.as(output)`    binds the step's output into the frame for later steps;
 *  - `.where(fn)`     transforms the frames before the step's children run;
 *  - `.branch(...n)`  attaches outcome branches (`on`/`onError`/`onDone`) and
 *                     follow-up nodes, dispatched on this step's outcome.
 *
 * Every method returns the same chain, so refinements read left-to-right.
 */
export interface ActChain extends StepNode {
  as(outputMapping: Mapping): ActChain;
  where(fn: WhereFn): ActChain;
  branch(...nodes: ThenNode[]): ActChain;
}

/**
 * The builder returned by `when(action, input, output?)`. Accumulates the
 * match patterns (`.and(...)` adds join clauses), an optional `.where(...)`
 * transform, and terminates with `.then(...)`, which produces the finished
 * {@link SyncDeclaration}.
 *
 * The clause order `when → and* → where? → then` is enforced by the return
 * types: `.where(...)` narrows to {@link WhenBuilderWithWhere} (only `.then`
 * remains) so `.and`/`.where` cannot follow a `where`, and `.then(...)` ends
 * the chain entirely.
 */
export interface WhenBuilder {
  and(action: InstrumentedAction, input: Mapping, output?: Mapping): WhenBuilder;
  where(fn: WhereFn): WhenBuilderWithWhere;
  then(...nodes: ThenNode[]): SyncDeclaration;
}

/** A {@link WhenBuilder} after `.where(...)` — only `.then(...)` remains. */
export interface WhenBuilderWithWhere {
  then(...nodes: ThenNode[]): SyncDeclaration;
}
