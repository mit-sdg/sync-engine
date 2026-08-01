/** Type-only witnesses used to infer view signatures and formed result trees. */

export type BindingKind = "input" | "output" | "free";

declare const LogicVariableType: unique symbol;

/** A runtime logic-variable symbol whose declaration identity survives in TypeScript. */
export type LogicVariable<
  Kind extends BindingKind = BindingKind,
  Name extends string = string,
> = symbol & {
  readonly [LogicVariableType]: readonly [kind: Kind, name: Name];
};

/** Select one or several literal names from one binding partition. */
export interface BindingVariables<Kind extends BindingKind> {
  <const Name extends string>(name: Name): LogicVariable<Kind, Name>;
  <const Names extends readonly [string, string, ...string[]]>(
    ...names: Names
  ): { readonly [Name in Names[number]]: LogicVariable<Kind, Name> };
}

/** One constraint learned by placing a logic variable in a typed slot. */
export interface BindingFact<
  Kind extends BindingKind = BindingKind,
  Name extends string = string,
  Value = unknown,
  Maybe extends boolean = boolean,
> {
  readonly kind: Kind;
  readonly name: Name;
  readonly value: Value;
  readonly maybe: Maybe;
}

declare const FactsType: unique symbol;

/** Phantom facts carried by authored lines, operations, blocks, and nodes. */
export interface CarriesFacts<Facts = never> {
  [FactsType]?(facts: Facts): void;
}

export type FactsOf<Value> = Value extends CarriesFacts<infer Facts> ? Facts : never;

type IsAny<Value> = 0 extends 1 & Value ? true : false;
declare const UnconstrainedType: unique symbol;
export interface Unconstrained {
  readonly [UnconstrainedType]: true;
}
// biome-ignore lint/suspicious/noExplicitAny: an unconstrained fact is intentionally refinable by an explicit contract.
type ContractWildcard = any;
type SafeValue<Value> =
  IsAny<Value> extends true ? Unconstrained : unknown extends Value ? Unconstrained : Value;

type FactFor<Value, Variable, Maybe extends boolean> =
  Variable extends LogicVariable<infer Kind, infer Name>
    ? BindingFact<Kind, Name, SafeValue<Value>, Maybe>
    : never;

export type FactFromVariable<Value, Variable, Maybe extends boolean = false> = FactFor<
  Value,
  Variable,
  Maybe
>;

/** Constraints contributed by typed slots in one authored pattern. */
export type FactsFromPattern<Shape, Pattern, Maybe extends boolean = false> = Shape extends object
  ? Pattern extends object
    ? {
        [Key in keyof Pattern & keyof Shape]: FactFor<Shape[Key], Pattern[Key], Maybe>;
      }[keyof Pattern & keyof Shape]
    : never
  : never;

export type MaybeFacts<Facts> =
  Facts extends BindingFact<infer Kind, infer Name, infer Value, boolean>
    ? BindingFact<Kind, Name, Value, true>
    : never;

/** Preserve known facts while allowing an explicit contract to refine unconstrained leaves. */
export type ContractFacts<Facts> =
  Facts extends BindingFact<infer Kind, infer Name, infer Value, infer Maybe>
    ? BindingFact<Kind, Name, [Value] extends [Unconstrained] ? ContractWildcard : Value, Maybe>
    : never;

type FactNames<Facts, Kind extends BindingKind> =
  Facts extends BindingFact<Kind, infer Name, unknown, boolean> ? Name : never;

type AllFactNames<Facts> =
  Facts extends BindingFact<BindingKind, infer Name, unknown, boolean> ? Name : never;

type ValuesFor<Facts, Kind extends BindingKind, Name extends string> =
  Facts extends BindingFact<Kind, infer FactName, infer Value, infer Maybe>
    ? FactName extends Name
      ? [Value] extends [Unconstrained]
        ? Unconstrained
        : { readonly value: Maybe extends true ? Value | null : Value }
      : never
    : never;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type InferredValue<Facts, Kind extends BindingKind, Name extends string> = [
  Exclude<ValuesFor<Facts, Kind, Name>, Unconstrained>,
] extends [never]
  ? unknown
  : UnionToIntersection<Exclude<ValuesFor<Facts, Kind, Name>, Unconstrained>> extends {
        readonly value: infer Value;
      }
    ? Value
    : unknown;

type PreciseShapeFromFacts<Facts, Kind extends BindingKind> = {
  readonly [Name in FactNames<Facts, Kind>]: InferredValue<Facts, Kind, Name>;
};

/** The callable input or output mapping learned from a declaration's facts. */
export type ShapeFromFacts<Facts, Kind extends BindingKind> =
  string extends AllFactNames<Facts> ? Record<string, unknown> : PreciseShapeFromFacts<Facts, Kind>;

type FactsFromGroup<Groups> = Groups extends readonly [infer Facts] ? Facts : never;
type ValueFromGroups<
  Groups,
  Kind extends BindingKind,
  Name extends string,
> = Groups extends readonly [infer Facts] ? InferredValue<Facts, Kind, Name> : never;

/** Merge conjunction facts within each alternative, then union the alternatives' values. */
export type ShapeFromFactGroups<Groups, Kind extends BindingKind> =
  string extends AllFactNames<FactsFromGroup<Groups>>
    ? Record<string, unknown>
    : {
        readonly [Name in FactNames<FactsFromGroup<Groups>, Kind>]: ValueFromGroups<
          Groups,
          Kind,
          Name
        >;
      };

export type ValueOfVariable<Facts, Variable> =
  Variable extends LogicVariable<infer Kind, infer Name>
    ? InferredValue<Facts, Kind, Name>
    : unknown;

/** One pattern slot is either the slot's literal value or one logic variable. */
export type PatternValue<Value> = Value | symbol;

export type InputPattern<Input extends object> = {
  readonly [Key in keyof Input]: PatternValue<Input[Key]>;
};

export type PartialPattern<Shape> = {
  readonly [Key in keyof Shape]?: PatternValue<Shape[Key]>;
};

type ExactObject<Shape extends object, Pattern extends object> = Pattern &
  Record<Exclude<keyof Pattern, keyof Shape>, never> & {
    [Key in keyof Pattern & keyof Shape]: ExactValue<NonNullable<Shape[Key]>, Pattern[Key]>;
  };

type ExactValue<Shape, Pattern> = Shape extends unknown
  ? Pattern extends symbol
    ? Pattern
    : Shape extends readonly (infer ShapeItem)[]
      ? Pattern extends readonly (infer PatternItem)[]
        ? Pattern & readonly ExactValue<ShapeItem, PatternItem>[]
        : Pattern
      : Shape extends object
        ? Pattern extends object
          ? ExactObject<Shape, Pattern>
          : Pattern
        : Pattern
  : never;

export type ExactPattern<Shape, Pattern> = ExactValue<Shape, Pattern>;

/** Opaque values in a result expression are not recursively interpreted as formed trees. */
declare const ValueExpressionType: unique symbol;

export interface ValueExpression<Value> {
  readonly [ValueExpressionType]: Value;
}

export type ResolveExpression<Expression, Facts> =
  Expression extends ValueExpression<infer Value>
    ? Value
    : Expression extends LogicVariable
      ? ValueOfVariable<Facts, Expression>
      : Expression extends readonly (infer Item)[]
        ? Array<ResolveExpression<Item, Facts>>
        : Expression extends object
          ? { -readonly [Key in keyof Expression]: ResolveExpression<Expression[Key], Facts> }
          : Expression extends symbol
            ? unknown
            : Expression;

export type FormerRoot = "record" | "selection";

declare const FormerNodeType: unique symbol;

/** Phantom expression, blank shape, facts, and root kind carried by a former node. */
export interface TypedFormerNode<
  Expression = ValueExpression<unknown>,
  Blank = ValueExpression<unknown>,
  Facts = never,
  Root extends FormerRoot = FormerRoot,
> extends CarriesFacts<Facts> {
  readonly [FormerNodeType]?: {
    readonly expression: Expression;
    readonly blank: Blank;
    readonly root: Root;
  };
}

type FormerNodeTypingOf<Node> = Node extends {
  readonly [FormerNodeType]?: infer Typing;
}
  ? Exclude<Typing, undefined>
  : never;

export type ExpressionOf<Node> =
  FormerNodeTypingOf<Node> extends {
    readonly expression: infer Expression;
  }
    ? Expression
    : ValueExpression<unknown>;

export type BlankExpressionOf<Node> =
  FormerNodeTypingOf<Node> extends {
    readonly blank: infer Blank;
  }
    ? Blank
    : ValueExpression<unknown>;

export type RootOf<Node> =
  FormerNodeTypingOf<Node> extends {
    readonly root: infer Root extends FormerRoot;
  }
    ? Root
    : FormerRoot;

export type ResultOfNode<Node> = ResolveExpression<ExpressionOf<Node>, FactsOf<Node>>;
export type BlankOfNode<Node> = ResolveExpression<BlankExpressionOf<Node>, FactsOf<Node>>;

declare const FormedValueType: unique symbol;

/** Covariant phantom value carried by a fused former. */
export interface CarriesFormedValue<Value = unknown> {
  readonly [FormedValueType]: Value;
}
