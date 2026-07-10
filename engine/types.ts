/** Core type vocabulary for declarative synchronizations. */
import type { Frames } from "./frames.ts";
import type { Var } from "./vars.ts";

/** A plain, string-keyed record — the shape an action's input/output takes. */
export type Mapping = Record<string, unknown>;

/** A single row of variable bindings keyed by logic-variable symbols. */
export type Frame = Record<symbol, unknown>;

/** A concept action: a function from an input mapping to an output mapping. */
export type ActionFunction<TInput = Mapping, TOutput = Mapping> = (input: TInput) => TOutput;

/** A concept method reference stored as identity, not called through this type. */
export type AnyAction = (...args: never[]) => unknown;

/** An action plus its input pattern and optional output pattern. */
export type ActionList = [InstrumentedAction, Mapping, Mapping?];
export type WhenClause = ActionList;

/** A normalized action declaration. */
export interface ActionPattern {
  action: InstrumentedAction;
  concept: object;
  input: Mapping;
  output?: Mapping;
  flow: symbol;
}

/** The normalized result of invoking an action. */
export type ActionOutcome =
  | { kind: "result"; value: Mapping }
  | { kind: "error"; error: Mapping }
  | { kind: "complete" };

export type OutcomeKind = "any" | "result" | "error" | "complete";

/** A pure transform over frames — the `where` clause. */
export type WhereFn = (frames: Frames) => Frames | Promise<Frames>;

/** Typed, checked access to a binding while evaluating a match guard. */
export type GuardReader = <T>(variable: Var<T>) => T;
export type GuardFn = (read: GuardReader) => boolean;

declare const MatcherBrand: unique symbol;
declare const GuardBrand: unique symbol;

/** A branded value matcher used inside a pattern mapping. */
export interface Matcher {
  readonly [MatcherBrand]: true;
  readonly kind: "oneOf" | "is";
  readonly label: string;
  readonly candidates?: readonly unknown[];
  readonly predicate?: (value: unknown) => boolean;
}

/** A branded, synchronous cross-variable match guard. */
export interface Guard {
  readonly [GuardBrand]: true;
  readonly fn: GuardFn;
  readonly label?: string;
}

/** A dispatch step and optional ordered outcome cases. */
export interface StepNode {
  kind: "step";
  action: ActionPattern;
  transform?: WhereFn;
  cases?: CaseNode[];
}

/** One ordered arm of a step's outcome match. */
export interface CaseNode {
  kind: "case";
  outcome: "result" | "error" | "any";
  pattern: Mapping;
  guard?: Guard;
  nodes: ThenNode[];
}

/** An internal normalized pipeline. No public constructor is exported. */
export interface SequenceNode {
  kind: "sequence";
  nodes: ThenNode[];
}

/** Concurrent children, each a step/parallel node or an internal pipeline. */
export interface ParallelNode {
  kind: "parallel";
  nodes: Array<ThenNode | SequenceNode>;
}

/** Public executable node accepted by `then`, cases, and `par`. */
export type ThenNode = StepNode | ParallelNode;

/** An input child for `par`; arrays are normalized to internal pipelines. */
export type ParallelChild = ThenNode | readonly ThenNode[];

export type ThenClause = ThenNode[];

/** The raw object a sync function returns before it is registered by name. */
export interface SyncDeclaration {
  when: ActionPattern[];
  where?: WhereFn;
  then: ThenClause;
}

/** A registered synchronization plus its name. */
export interface Synchronization extends SyncDeclaration {
  sync: string;
}

/** An instrumented action callable with identity back-references. */
export interface InstrumentedAction extends AnyAction {
  concept?: object;
  action?: AnyAction;
}

/** The untyped logic-variable proxy supplied to sync functions. */
export type Vars = Record<string, symbol>;
export type SyncFunction = (vars: Vars) => SyncDeclaration;
export type SyncFunctionMap = Record<string, SyncFunction>;

/** The canonical no-fields mapping. */
export type Empty = Record<PropertyKey, never>;

/** A chainable dispatch step returned by `act(action, input, output?)`. */
export interface ActChain extends StepNode {
  where(fn: WhereFn): ActChain;
  match(...cases: CaseNode[]): ActChain;
}

/** The builder returned by `when(...)`. */
export interface WhenBuilder {
  where(fn: WhereFn): WhenBuilderWithWhere;
  then(...nodes: ThenNode[]): SyncDeclaration;
}

/** A `when` builder after `.where(...)`. */
export interface WhenBuilderWithWhere {
  then(...nodes: ThenNode[]): SyncDeclaration;
}
