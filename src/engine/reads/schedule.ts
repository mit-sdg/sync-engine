/**
 * Derive an evaluation order for an orderless `where` conjunction.
 * Registration places a line after the lines that bind its required names.
 * The same pass rejects fresh names under `no` or `.is.not` and records which
 * names each line opens for later unused-binding checks.
 */

import { varNamesInPattern } from "./former-analysis.ts";
import type { ViewOpIR, WhereOpIR } from "./ir.ts";

type AnyOpIR = WhereOpIR | ViewOpIR;

/** The names an op needs bound before it can evaluate. */
export function opNeedsIR(op: AnyOpIR): string[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [
        ...varNamesInPattern(op.in),
        ...("not" in op && op.not !== undefined ? varNamesInPattern(op.not) : []),
      ];
    case "no":
      // Nothing fresh under a denial: the whole line reads over bound names.
      return [...varNamesInPattern(op.in), ...varNamesInPattern(op.out)];
    case "holds":
    case "compute":
    case "count":
      return varNamesInPattern(op.in);
    case "custom":
      return [...op.in];
    case "earlier":
      return [];
  }
}

/** The names an op can open, given what is already bound. */
export function opOpensIR(op: AnyOpIR, bound: ReadonlySet<string>): string[] {
  const fresh = (names: string[]): string[] => [...new Set(names.filter((n) => !bound.has(n)))];
  switch (op.op) {
    case "find":
    case "whether":
      return fresh(varNamesInPattern(op.out));
    case "compute":
    case "count":
      return fresh([op.out]);
    case "custom":
      return fresh([...op.out]);
    case "earlier":
      return fresh([...varNamesInPattern(op.when.input), ...varNamesInPattern(op.when.output)]);
    default:
      return [];
  }
}

/** Every name an op's patterns mention, opening or not — the lint's counts. */
export function opNamesIR(op: AnyOpIR): string[] {
  switch (op.op) {
    case "find":
    case "whether":
      return [
        ...varNamesInPattern(op.in),
        ...varNamesInPattern(op.out),
        ...("not" in op && op.not !== undefined ? varNamesInPattern(op.not) : []),
      ];
    case "no":
      return [...varNamesInPattern(op.in), ...varNamesInPattern(op.out)];
    case "holds":
      return varNamesInPattern(op.in);
    case "compute":
    case "count":
      return [...varNamesInPattern(op.in), op.out];
    case "custom":
      return [...op.in, ...op.out];
    case "earlier":
      return [...varNamesInPattern(op.when.input), ...varNamesInPattern(op.when.output)];
  }
}

/** What one scheduled block settled: the order, and each op's opened names. */
export interface ScheduledBlock<Op extends AnyOpIR> {
  ordered: Op[];
  /** Names bound after the block runs. */
  bound: Set<string>;
  /** Per ordered op, the names it opens. */
  opens: Map<Op, string[]>;
}

function describeOp(op: AnyOpIR): string {
  switch (op.op) {
    case "find":
    case "whether":
    case "no": {
      const source =
        "view" in op && op.view !== undefined
          ? String(op.view)
          : "query" in op && op.query !== undefined
            ? `${op.query.concept}.${op.query.query}`
            : "?";
      return `${op.op === "find" ? "" : `${op.op} `}${source}`;
    }
    case "holds":
      return op.computation;
    case "compute":
      return `compute ${op.computation}`;
    case "count":
      return `count ${op.query.concept}.${op.query.query}`;
    case "custom":
      return `custom ${op.fnRef}`;
    case "earlier":
      return `earlier ${op.when.concept}.${op.when.action}`;
  }
}

/** Names tested by a negative condition: `no`'s pattern or an `.is.not` pattern. */
function negativeNames(op: AnyOpIR): string[] {
  if (op.op === "no") return varNamesInPattern(op.out);
  if ((op.op === "find" || op.op === "whether") && "not" in op && op.not !== undefined) {
    return varNamesInPattern(op.not);
  }
  return [];
}

/**
 * Derive the evaluable order of one conjunction: greedily place, in authored
 * order, every op whose needs are met; repeat until the block is placed.
 * Any line that cannot be placed produces a registration error naming the
 * unbound value or invalid denial.
 */
export function scheduleBlock<Op extends AnyOpIR>(
  ops: readonly Op[],
  initial: ReadonlySet<string>,
  site: string,
): ScheduledBlock<Op> {
  const remaining = [...ops];
  const bound = new Set(initial);
  const ordered: Op[] = [];
  const opens = new Map<Op, string[]>();
  while (remaining.length > 0) {
    const index = remaining.findIndex((op) => opNeedsIR(op).every((name) => bound.has(name)));
    if (index === -1) {
      const openable = new Set(bound);
      for (const op of remaining) {
        for (const name of opOpensIR(op, new Set())) openable.add(name);
      }
      for (const op of remaining) {
        const missing = opNeedsIR(op).filter((name) => !bound.has(name));
        const denied = negativeNames(op).filter(
          (name) => missing.includes(name) && !openable.has(name),
        );
        if (denied.length > 0) {
          throw new Error(
            `${site}: "${denied[0]}" is new inside ${describeOp(op)}; ` +
              "no(...) can only test names bound by an earlier plain line.",
          );
        }
      }
      const blocked = remaining[0];
      const missing = opNeedsIR(blocked).filter((name) => !bound.has(name));
      throw new Error(
        `${site}: the conditions cannot be ordered — ${describeOp(blocked)} needs ` +
          `"${missing.join('", "')}", which no line opens.`,
      );
    }
    const [op] = remaining.splice(index, 1);
    const opened = opOpensIR(op, bound);
    opens.set(op, opened);
    for (const name of opened) bound.add(name);
    ordered.push(op);
  }
  return { ordered, bound, opens };
}
