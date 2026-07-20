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
  /**
   * Pin the trigger to one posture. Absent = as authored (an empty output
   * pattern admits successes only; a keyed one matches whichever posture's
   * payload unifies). Lowered reaction chains pin "returned".
   */
  posture?: ChannelPosture;
  /**
   * Pin the trigger to occurrences asked for by one reaction — the ask's
   * provenance. Lowered reaction chains pin the previous step, so a
   * chain continues only from its own ask, never a look-alike record.
   */
  by?: string;
}

/** The posture a channel trigger watches for. */
export type ChannelPosture = "returned" | "refused" | "faulted";

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

export type OutcomeKind = "any" | "result" | "error";

/** A pure transform over frames — the `where` clause. */
export type WhereFn = (frames: Frames) => Frames | Promise<Frames>;

declare const MatcherBrand: unique symbol;

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
  transform?: WhereFn;
  /** The declarative form of the step's transform, when authored as ops. */
  transformOps?: readonly WhereOp[];
  /** Author-chosen name for the reaction this step lowers to (see `.named()`). */
  stepName?: string;
}

/** Public executable node accepted by `then`: a step in the firing's pipeline. */
export type ThenNode = StepNode;

export type ThenClause = ThenNode[];

/** The raw object a reaction function returns before it is registered by name. */
export interface ReactionDeclaration {
  when: TriggerPattern[];
  where?: WhereFn;
  /** The declarative form of `where`, when authored as ops — the data the IR keeps. */
  whereOps?: readonly AnyWhereOp[];
  then: ThenClause;
  coverage?: string[];
}

export interface ReactionCase {
  readonly where: readonly unknown[];
  readonly then?: readonly ThenNode[];
  readonly cases?: readonly ReactionCase[];
}

export interface ReactionPartition {
  readonly declarations: readonly ReactionDeclaration[];
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

/** A chainable dispatch step returned by `request(action, input, output?)`. */
export interface RequestChain extends StepNode {
  where(...conditions: Condition[]): RequestChain;
  where(fn: WhereFn): RequestChain;
  /** Name the reaction this step lowers to, instead of the derived `Name#n`. */
  named(name: string): RequestChain;
}

/** The builder returned by `when(...)`. */
export interface WhenBuilder {
  where(...conditions: Condition[]): WhenBuilderWithWhere;
  where(fn: WhereFn): WhenBuilderWithFunctionWhere;
  then(...nodes: ThenNode[]): ReactionDeclaration;
  either(...cases: ReactionCase[]): ReactionPartition;
}

/** A `when` builder after `.where(...)`. */
export interface WhenBuilderWithWhere {
  then(...nodes: ThenNode[]): ReactionDeclaration;
  either(...cases: ReactionCase[]): ReactionPartition;
}

export interface WhenBuilderWithFunctionWhere {
  then(...nodes: ThenNode[]): ReactionDeclaration;
}
