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

import { brand, hasBrand, LineBrand, RelationViewBrand } from "./brands.ts";
import type { InstrumentedQuery, Mapping } from "../reactions/types.ts";
import type { QueryPromise } from "./query-contracts.ts";

/** A view declared as a relation: named inputs, promised outputs, a body. */
export interface RelationView {
  (pattern: Mapping): ViewReadLine;
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
  holds(): RelationView;
  one(): RelationView;
  optional(): RelationView;
  many(): RelationView;
}

export function isRelationView(value: unknown): value is RelationView {
  return (
    typeof value === "function" &&
    (value as unknown as Record<symbol, unknown>)[RelationViewBrand] === true
  );
}

export function brandRelationView<T extends object>(ref: T): T {
  return brand(ref, RelationViewBrand);
}

/**
 * A pattern over one row shape: each slot takes the row's own type (a literal
 * test), a variable (open or test by unification), or is omitted.
 */
export type SlotPattern<Row> = { readonly [K in keyof Row]?: Row[K] | symbol };

interface LineShape<Row, Self> {
  readonly in: Mapping;
  readonly out: Mapping;
  readonly not: Mapping;
  /** Match output fields, testing literals or bound variables and binding new variables. */
  readonly is: {
    (pattern: SlotPattern<Row>): Self;
    /** Negated slot tests: each stated slot's value differs from the row's. */
    not(pattern: SlotPattern<Row>): Self;
  };
}

/** A plain line whose source is one concept query. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export interface QueryReadLine<Row = any> extends LineShape<Row, QueryReadLine<Row>> {
  readonly query: InstrumentedQuery;
  readonly view?: never;
}

/** A plain line whose source is one derived relation view. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export interface ViewReadLine<Row = any> extends LineShape<Row, ViewReadLine<Row>> {
  readonly query?: never;
  readonly view: RelationView;
}

/** One plain line: query-backed or view-backed, with the same condition shape. */
// biome-ignore lint/suspicious/noExplicitAny: `any` keeps every typed line accepted as an untyped condition.
export type ReadLine<Row = any> = QueryReadLine<Row> | ViewReadLine<Row>;

export function isReadLine(value: unknown): value is ReadLine {
  return hasBrand(value, LineBrand);
}

export function isQueryReadLine(value: unknown): value is QueryReadLine {
  return isReadLine(value) && value.query !== undefined;
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
  if (pattern === null || typeof pattern !== "object" || Array.isArray(pattern)) {
    throw new Error(`${operation}(...) takes a pattern mapping of output fields.`);
  }
}

/** Construct a read from a query or view and its input pattern. @internal */
export function lineOf(
  source: { query: (...args: never[]) => unknown },
  input: Mapping,
): QueryReadLine;
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
