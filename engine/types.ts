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
export type ActionFunction<TInput = Mapping, TOutput = Mapping> = (
  input: TInput,
) => TOutput;

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

/** The raw object a sync function returns before it is registered by name. */
interface SyncDeclaration {
  when: ActionPattern[];
  where?: (frames: Frames) => Frames | Promise<Frames>;
  then: ActionPattern[];
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
