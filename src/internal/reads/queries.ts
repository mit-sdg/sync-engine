/**
 * A query's return shape states its cardinality. One record is one answer; an
 * array of records is any number of answers. Anything else is a query fault.
 */

import type { Frame, InstrumentedQuery, Mapping } from "../reactions/types.ts";
import { bindInputMapping } from "./frames.ts";
import type { QueryPromise } from "./query-contracts.ts";

/**
 * A query returned something other than one record or an array of records.
 * This is a runtime fault, never a refusal: queries have no refusal posture, so
 * a malformed answer is thrown rather than recorded.
 */
export class QueryAnswerFault extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryAnswerFault";
  }
}

/** Query metadata used in cardinality-fault messages. */
export interface NamedQuery {
  queryName?: string;
  queryLabel?: string;
  queryPromise?: QueryPromise;
}

/**
 * A state read ranges only over a concept query — an instrumented,
 * `_`-prefixed method carrying a `queryName`; an arbitrary function is not
 * one. `op` names the calling site for the message, and `hint` completes the
 * requirement sentence (a closing period by default, a fuller clause where a
 * site has more to say).
 */
export function assertConceptQuery(query: unknown, op: string, hint = "."): InstrumentedQuery {
  if (typeof query !== "function" || (query as InstrumentedQuery).queryName === undefined) {
    throw new Error(
      `${op}(...) requires a concept query (an instrumented \`_\`-prefixed method)${hint}`,
    );
  }
  return query as InstrumentedQuery;
}

function labelOf(query: NamedQuery): string {
  return query.queryLabel ?? query.queryName ?? "query";
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  return typeof value === "object" ? "a record" : typeof value;
}

/**
 * Normalize a query answer into rows. A record becomes one row and an array
 * supplies the rows. Scalars, null, and arrays containing non-record values
 * raise query faults.
 */
export function rowsOfAnswer(value: unknown, query: NamedQuery): unknown[] {
  const label = labelOf(query);
  if (query.queryPromise === "one") {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) return [value];
    throw new QueryAnswerFault(
      `Query ${label} promises "one" and answered ${describe(value)} — it must return one record.`,
    );
  }
  if (Array.isArray(value)) {
    const invalid = value.findIndex(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    );
    if (invalid !== -1) {
      throw new QueryAnswerFault(
        `Query ${label} answered an array whose row ${invalid + 1} is ${describe(value[invalid])} — ` +
          "every query row must be a record.",
      );
    }
    if (query.queryPromise === "optional" && value.length > 1) {
      throw new QueryAnswerFault(
        `Query ${label} promises "optional" and answered ${value.length} rows — it may return at most one.`,
      );
    }
    return value;
  }
  if (query.queryPromise === "optional" || query.queryPromise === "many") {
    throw new QueryAnswerFault(
      `Query ${label} promises "${query.queryPromise}" and answered ${describe(value)} — it must return an array of rows.`,
    );
  }
  if (value !== null && typeof value === "object") {
    return [value];
  }
  throw new QueryAnswerFault(
    `Query ${label} answered ${describe(value)} — a query returns one record or an array of records.`,
  );
}

/**
 * Fill a query input pattern from the current frame, invoke the query, and
 * normalize its answer to rows. Each caller decides how to handle an unbound
 * input.
 */
export async function queryRows(
  query: InstrumentedQuery,
  input: Mapping,
  frame: Frame,
): Promise<unknown[]> {
  return rowsOfAnswer(await query(bindInputMapping(frame, input)), query);
}
