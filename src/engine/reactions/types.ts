/** Core type vocabulary for declarative reactions. */
import type { Frames } from "../reads/frames.ts";
import type { AnyWhereOp, Condition, WhereOp } from "../reads/where-ops.ts";
import type { QueryPromise } from "../reads/query-contracts.ts";

/** A plain, string-keyed record — the shape an action's input/output takes. */
export type Mapping = Record<string, unknown>;

/**
 * A single row of variable bindings. Authored variables and reserved engine
 * keys are symbols; registered IR variables use string names, which cannot
 * collide with the reserved symbol keys.
 */
export type Frame = Record<string | symbol, unknown>;

/** A concept method reference stored as identity, not called through this type. */
export type AnyAction = (...args: never[]) => unknown;

/** A normalized action declaration. */
export interface ActionPattern {
  action: InstrumentedAction;
  concept: object;
  input: Mapping;
  output?: Mapping;
  flow: symbol;
  /**
   * Pin the trigger to one posture. Absent = as authored (an empty output
   * pattern admits successes only; a keyed one matches whichever posture's
   * payload unifies). Lowered reaction chains pin "returned".
   */
  posture?: ActionPosture;
  /**
   * Pin the trigger to occurrences asked for by one reaction — the ask's
   * provenance. Lowered reaction chains pin the previous step, so a
   * chain continues only from its own ask, never a look-alike record.
   */
  by?: string;
}

/** The posture a channel trigger watches for. */
export type ChannelPosture = "returned" | "refused" | "faulted";
export type ActionPosture = "requested" | ChannelPosture;

/**
 * A normalized channel clause: matches occurrences of *any* action by
 * posture rather than by identity. The pattern is unified against a
 * synthesized mapping — `concept` and `action` (names), `input` (the whole
 * input mapping), and the posture's payload (`result`, `refusal`, or
 * `fault`) — so a reaction can bind or test any of them. Concepts in `except`
 * are skipped. Reaction names in `exceptBy` skip occurrences asked for by those
 * reactions. Framework reactions use these options to avoid reacting to their
 * own delivery attempts.
 */
export interface ChannelPattern {
  channel: ChannelPosture;
  pattern: Mapping;
  except: readonly object[];
  exceptBy?: readonly string[];
  /** Pin to occurrences asked for by one reaction — the ask's provenance. */
  by?: string;
}

/** A `when` clause: one concrete action, or a posture channel. */
export type TriggerPattern = ActionPattern | ChannelPattern;

/**
 * The normalized result of invoking an action: one success kind and one
 * refusal kind. An action that returns nothing
 * (or an empty mapping) succeeds with an empty value. A fault is neither:
 * it leaves the ask without an outcome (see `ActionRecord.fault`).
 */
export type ActionOutcome = { kind: "result"; value: Mapping } | { kind: "error"; error: Mapping };

/** A pure transform over frames — the `where` clause. */
export type WhereFn = (frames: Frames) => Frames | Promise<Frames>;

declare const MatcherBrand: unique symbol;
declare const NamedLineBrand: unique symbol;
declare const CompleteInputBrand: unique symbol;

/** A branded value matcher used inside a pattern mapping. */
export interface Matcher {
  readonly [MatcherBrand]: true;
  readonly kind: "oneOf";
  readonly label: string;
  readonly candidates?: readonly unknown[];
}

/** A dispatch step. */
export interface StepNode {
  kind: "step";
  action: ActionPattern;
  linePosture?: "requested" | "returned" | "refused";
  /** Conditions read immediately before this step at its incoming frontier. */
  whereOps?: readonly WhereOp[];
  transform?: WhereFn;
  /** The declarative form of the step's transform, when authored as ops. */
  transformOps?: readonly WhereOp[];
  /** Author-chosen name for the reaction this step lowers to (see `.named()`). */
  stepName?: string;
  branchLabel?: string;
  /** Stable sibling labels introduced at this temporal stage. */
  pathLabels?: readonly string[];
  responds(output?: Mapping): StepNode;
  refuses(output?: Mapping): StepNode;
  named(name: string): StepNode;
}

/** A requested callable action line. */
export interface ActionCall<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
> extends StepNode {
  readonly [CompleteInputBrand]: true;
  action: ActionPattern & { action: TAction; input: TInput };
  linePosture: "requested";
  responds<TOutput extends Mapping = Empty>(
    output?: TOutput,
  ): ReturnedActionLine<TAction, TInput, TOutput>;
  refuses<TRefusal extends Mapping = Empty>(
    output?: TRefusal,
  ): RefusedActionLine<TAction, TInput, TRefusal>;
  named(name: string): NamedActionCall<TAction, TInput>;
}

/** A requested callable action line whose required input slots remain open. */
export interface TriggerActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
> {
  kind: "step";
  action: ActionPattern & { action: TAction; input: TInput };
  linePosture: "requested";
  responds<TOutput extends Mapping = Empty>(
    output?: TOutput,
  ): ReturnedTriggerActionLine<TAction, TInput, TOutput>;
  refuses<TRefusal extends Mapping = Empty>(
    output?: TRefusal,
  ): RefusedTriggerActionLine<TAction, TInput, TRefusal>;
  named(name: string): TriggerActionLine<TAction, TInput>;
}

export interface NamedActionCall<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
> extends ActionCall<TAction, TInput> {
  readonly [NamedLineBrand]: true;
  named(name: string): NamedActionCall<TAction, TInput>;
}

/** A callable action line pinned to a successful return. */
export interface ReturnedActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TOutput extends Mapping = Mapping,
> extends StepNode {
  readonly [CompleteInputBrand]: true;
  action: ActionPattern & { action: TAction; input: TInput; output: TOutput };
  linePosture: "returned";
  named(name: string): NamedReturnedActionLine<TAction, TInput, TOutput>;
}

/** A returned trigger line whose required input slots remain open. */
export interface ReturnedTriggerActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TOutput extends Mapping = Mapping,
> {
  kind: "step";
  action: ActionPattern & { action: TAction; input: TInput; output: TOutput };
  linePosture: "returned";
  named(name: string): ReturnedTriggerActionLine<TAction, TInput, TOutput>;
}

export interface NamedReturnedActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TOutput extends Mapping = Mapping,
> extends ReturnedActionLine<TAction, TInput, TOutput> {
  readonly [NamedLineBrand]: true;
  named(name: string): NamedReturnedActionLine<TAction, TInput, TOutput>;
}

/** A callable action line pinned to a declared refusal. */
export interface RefusedActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TRefusal extends Mapping = Mapping,
> extends StepNode {
  readonly [CompleteInputBrand]: true;
  action: ActionPattern & { action: TAction; input: TInput; output: TRefusal };
  linePosture: "refused";
  named(name: string): NamedRefusedActionLine<TAction, TInput, TRefusal>;
}

/** A refused trigger line whose required input slots remain open. */
export interface RefusedTriggerActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TRefusal extends Mapping = Mapping,
> {
  kind: "step";
  action: ActionPattern & { action: TAction; input: TInput; output: TRefusal };
  linePosture: "refused";
  named(name: string): RefusedTriggerActionLine<TAction, TInput, TRefusal>;
}

export interface NamedRefusedActionLine<
  TAction extends InstrumentedAction = InstrumentedAction,
  TInput extends Mapping = Mapping,
  TRefusal extends Mapping = Mapping,
> extends RefusedActionLine<TAction, TInput, TRefusal> {
  readonly [NamedLineBrand]: true;
  named(name: string): NamedRefusedActionLine<TAction, TInput, TRefusal>;
}

/** A callable consequence before it receives a sibling-path label. */
export type UnnamedStepNode = StepNode & { readonly [NamedLineBrand]?: never };

/** A qualified branch with temporal stages private to that branch. */
export interface BranchChain {
  readonly kind: "branch";
  readonly whereOps: readonly WhereOp[];
  readonly steps: readonly StepNode[];
  readonly branchLabel?: string;
  then(node: UnnamedStepNode): BranchChain;
  named(name: string): NamedBranchChain;
}

export interface NamedBranchChain {
  readonly kind: "branch";
  readonly whereOps: readonly WhereOp[];
  readonly steps: readonly StepNode[];
  readonly branchLabel: string;
  readonly [NamedLineBrand]: true;
  named(name: string): NamedBranchChain;
}

/** Public executable node accepted by `then`. */
export type ThenNode = StepNode | BranchChain | NamedBranchChain;
export type ConsequenceNode =
  | ActionCall
  | ReturnedActionLine
  | RefusedActionLine
  | BranchChain
  | NamedBranchChain;
export type NamedThenNode =
  | NamedActionCall
  | NamedReturnedActionLine
  | NamedRefusedActionLine
  | NamedBranchChain;

/** The raw object a reaction function returns before it is registered by name. */
export interface ReactionDeclaration {
  when: TriggerPattern[];
  where?: WhereFn;
  /** The declarative form of `where`, when authored as ops — the data the IR keeps. */
  whereOps?: readonly AnyWhereOp[];
  then: StepNode[];
  path?: string[];
}

export interface ReactionPartition {
  readonly declarations: readonly ReactionDeclaration[];
  then(node: ConsequenceNode): ReactionPartition;
  then(first: NamedThenNode, second: NamedThenNode, ...rest: NamedThenNode[]): ReactionPartition;
}

export type ReactionResult = ReactionDeclaration | ReactionPartition;

/** A registered reaction plus its name. */
export interface ExecutableReaction extends ReactionDeclaration {
  name: string;
}

/** An instrumented action callable with identity back-references. */
export interface InstrumentedAction extends AnyAction {
  concept?: object;
  action?: AnyAction;
}

/**
 * An instrumented concept query (a `_`-prefixed method, wrapped with caching)
 * carrying identity back-references, so a where op that reads state stays
 * data: the op serializes as (concept name, query name) rather than a closure.
 */
export interface InstrumentedQuery {
  (input: Mapping): unknown | Promise<unknown>;
  concept?: object;
  queryName?: string;
  /** `Concept.query`, for contract faults that name their source. */
  queryLabel?: string;
  /** The concept's cardinality promise, checked against the determiner at registration. */
  queryPromise?: QueryPromise;
}

/** The untyped logic-variable proxy supplied to reaction functions. */
export type Vars = Record<string, symbol>;
export type Reaction = (vars: Vars) => ReactionResult;
export type ReactionMap = Record<string, Reaction>;

/** The canonical no-fields mapping. */
export type Empty = Record<PropertyKey, never>;

/** The builder returned by `when(...)`. */
export interface WhenBuilder {
  where(...conditions: Condition[]): WhenBuilderWithWhere;
  where(fn: WhereFn): WhenBuilderWithFunctionWhere;
  then(node: ConsequenceNode): ReactionPartition;
  then(first: NamedThenNode, second: NamedThenNode, ...rest: NamedThenNode[]): ReactionPartition;
}

/** A `when` builder after `.where(...)`. */
export interface WhenBuilderWithWhere {
  then(node: ConsequenceNode): ReactionPartition;
  then(first: NamedThenNode, second: NamedThenNode, ...rest: NamedThenNode[]): ReactionPartition;
}

export interface WhenBuilderWithFunctionWhere {
  then(node: ConsequenceNode): ReactionPartition;
  then(first: NamedThenNode, second: NamedThenNode, ...rest: NamedThenNode[]): ReactionPartition;
}
