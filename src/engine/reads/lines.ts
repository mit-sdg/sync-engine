/**
 * Build typed reads from concept queries and views.
 *
 * Calling a query or view supplies its input pattern. `.is(...)` describes
 * output fields: a literal or previously bound variable tests a field, while
 * a new variable binds that field for later conditions and consequences. The
 * query or view declaration determines how many rows may match.
 *
 * ```ts
 * Sessioning._getUser({ session }).is({ user })   // plain: inputs call, outputs .is
 * Grading._gradeOf({ submission })                // bare call: existence
 * mayEditPost({ user, post })                     // a view is the same line shape
 * Posting._getPost({ post }).is.not({ author: user })  // negated slot tests
 * ```
 *
 * `where-ops.ts` defines `no`, `whether`, and evaluation of these reads.
 */

import { brand, hasBrand, hasFuncBrand, LineBrand, RelationViewBrand } from "./brands.ts";
import type { InstrumentedQuery, Mapping } from "@engine/reactions/types";
import type { QueryPromise } from "./query-metadata.ts";
import { isPlainObject } from "./matchers.ts";
import type {
  CarriesFacts,
  ExactPattern,
  FactsFromPattern,
  InputPattern,
  PartialPattern,
} from "./type-inference.ts";

/** A view declared as a relation: named inputs, promised outputs, a body. */
declare const RelationViewType: unique symbol;
export interface RelationView<
  // biome-ignore lint/suspicious/noExplicitAny: bare RelationView is the intentionally erased declaration contract.
  Input extends object = any,
  // biome-ignore lint/suspicious/noExplicitAny: bare RelationView is the intentionally erased declaration contract.
  Output extends object = any,
  Promise extends QueryPromise | undefined = QueryPromise | undefined,
> {
  readonly [RelationViewType]: {
    readonly input: (value: Input) => void;
    readonly output: Output;
    readonly promise: Promise;
  };
  <const Pattern extends InputPattern<Input>>(
    pattern: ExactPattern<Input, Pattern>,
  ): ViewReadLine<
    Output,
    FactsFromPattern<Input, Pattern>,
    never,
    Promise extends QueryPromise ? Promise : "optional"
  >;
  readonly viewName: string;
  /** Input names declared by the view's input bag. */
  readonly ins: readonly string[];
  /** Output names declared by the view's output bag and matched through `.is`. */
  readonly outs: readonly string[];
  /** Free names local to the view body. */
  readonly bindings: readonly string[];
  /** The declared promise; absent for a pure predicate view (no outs). */
  readonly promise?: QueryPromise;
  /** Whether this no-output view explicitly ends in `holds()`. */
  readonly holdsPredicate: boolean;
  /** The where blocks, as IR — stacked blocks are alternatives. */
  readonly alternatives: readonly (readonly unknown[])[];
  holds(): RelationView<Input, Output, undefined>;
  one(): RelationView<Input, Output, "one">;
  optional(): RelationView<Input, Output, "optional">;
  many(): RelationView<Input, Output, "many">;
}

export function isRelationView(value: unknown): value is RelationView {
  return hasFuncBrand(value, RelationViewBrand);
}

export function brandRelationView<T extends object>(ref: T): T {
  return brand(ref, RelationViewBrand);
}

/**
 * A pattern over one row shape: each slot takes the row's own type (a literal
 * test), a variable (open or test by unification), or is omitted.
 */
export type SlotPattern<Row> = PartialPattern<Row>;

interface LineShape {
  readonly in: Mapping;
  readonly out: Mapping;
  readonly not: Mapping;
}

/** A plain line whose source is one concept query. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export interface QueryReadLine<
  Row = any,
  InputFacts = never,
  OutputFacts = never,
  Promise extends QueryPromise = QueryPromise,
>
  extends LineShape, CarriesFacts<InputFacts | OutputFacts> {
  readonly query: InstrumentedQuery;
  readonly view?: never;
  readonly queryPromise?: Promise;
  /** Match output fields, testing literals or bound variables and binding new variables. */
  readonly is: {
    <const Pattern extends SlotPattern<Row>>(
      pattern: ExactPattern<Row, Pattern>,
    ): QueryReadLine<Row, InputFacts, OutputFacts | FactsFromPattern<Row, Pattern>, Promise>;
    /** Negated slot tests: each stated slot's value differs from the row's. */
    not<const Pattern extends SlotPattern<Row>>(
      pattern: ExactPattern<Row, Pattern>,
    ): QueryReadLine<Row, InputFacts, OutputFacts | FactsFromPattern<Row, Pattern>, Promise>;
  };
}

/** A plain line whose source is one derived relation view. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export interface ViewReadLine<
  Row = any,
  InputFacts = never,
  OutputFacts = never,
  Promise extends QueryPromise = QueryPromise,
>
  extends LineShape, CarriesFacts<InputFacts | OutputFacts> {
  readonly query?: never;
  readonly view: RelationView;
  readonly viewPromise?: Promise;
  /** Match output fields, testing literals or bound variables and binding new variables. */
  readonly is: {
    <const Pattern extends SlotPattern<Row>>(
      pattern: ExactPattern<Row, Pattern>,
    ): ViewReadLine<Row, InputFacts, OutputFacts | FactsFromPattern<Row, Pattern>, Promise>;
    /** Negated slot tests: each stated slot's value differs from the row's. */
    not<const Pattern extends SlotPattern<Row>>(
      pattern: ExactPattern<Row, Pattern>,
    ): ViewReadLine<Row, InputFacts, OutputFacts | FactsFromPattern<Row, Pattern>, Promise>;
  };
}

/** One plain line: query-backed or view-backed, with the same condition shape. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export type ReadLine<
  Row = any,
  InputFacts = any,
  OutputFacts = any,
  Promise extends QueryPromise = QueryPromise,
> =
  | QueryReadLine<Row, InputFacts, OutputFacts, Promise>
  | ViewReadLine<Row, InputFacts, OutputFacts, Promise>;

export function isReadLine(value: unknown): value is ReadLine {
  return hasBrand(value, LineBrand);
}

type LineSource =
  | { query: InstrumentedQuery; view?: never }
  | { query?: never; view: RelationView };

function makeLine(
  source: { query: InstrumentedQuery; view?: never },
  input: Mapping,
  out: Mapping,
  not: Mapping,
): QueryReadLine;
function makeLine(
  source: { query?: never; view: RelationView },
  input: Mapping,
  out: Mapping,
  not: Mapping,
): ViewReadLine;
function makeLine(source: LineSource, input: Mapping, out: Mapping, not: Mapping): ReadLine {
  const is = (pattern: Mapping): ReadLine => {
    assertPattern(pattern, ".is");
    return source.query !== undefined
      ? makeLine({ query: source.query }, input, { ...out, ...pattern }, not)
      : makeLine({ view: source.view }, input, { ...out, ...pattern }, not);
  };
  is.not = (pattern: Mapping): ReadLine => {
    assertPattern(pattern, ".is.not");
    return source.query !== undefined
      ? makeLine({ query: source.query }, input, out, { ...not, ...pattern })
      : makeLine({ view: source.view }, input, out, { ...not, ...pattern });
  };
  const line = { ...source, in: input, out, not, is };
  return brand(line, LineBrand) as ReadLine;
}

function assertPattern(pattern: unknown, operation: string): void {
  if (!isPlainObject(pattern)) {
    throw new Error(`${operation}(...) takes a pattern mapping of output fields.`);
  }
}

/** Construct a read from a query or view and its input pattern. @internal */
export function lineOf<const Input extends Mapping>(
  source: { query: (...args: never[]) => unknown },
  input: Input,
): QueryReadLine<any, FactsFromPattern<Mapping, Input>>;
export function lineOf(source: { view: RelationView }, input: Mapping): ViewReadLine;
export function lineOf(
  source: LineSource | { query: (...args: never[]) => unknown },
  input: Mapping,
): ReadLine {
  assertPattern(input, "query or view input");
  return source.query !== undefined
    ? makeLine({ query: source.query as InstrumentedQuery }, input, {}, {})
    : makeLine({ view: source.view }, input, {}, {});
}
