/**
 * Derive an evaluation order for an orderless `where` conjunction.
 * Registration places a line after the lines that bind its required names.
 * The same pass rejects fresh names under `no` or `.is.not` and records which
 * names each line opens for later unused-binding checks.
 */

import type { ViewOpIR, WhereOpIR } from "./ir.ts";
import { operationFootprint } from "./operation-footprint.ts";

type AnyOpIR = WhereOpIR | ViewOpIR;

/** The names an op needs bound before it can evaluate. */
function opNeedsIR(op: AnyOpIR): string[] {
  return operationFootprint(op, "ir").requires;
}

/** The names an op can open, given what is already bound. */
function opOpensIR(op: AnyOpIR, bound: ReadonlySet<string>): string[] {
  const produced = operationFootprint(op, "ir").produces;
  return [...new Set(produced.filter((name) => !bound.has(name)))];
}

/** Every name an op's patterns mention, opening or not — the lint's counts. */
function opNamesIR(op: AnyOpIR): string[] {
  return operationFootprint(op, "ir").mentions;
}

/** What one scheduled block settled: the order, and each op's opened names. */
interface ScheduledBlock<Op extends AnyOpIR> {
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
      return `${op.op} ${source}`;
    }
    case "holds":
      return `holds ${op.computation}`;
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
  return operationFootprint(op, "ir").negative;
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
      const blocked = remaining.map((op) => {
        const missing = opNeedsIR(op).filter((name) => !bound.has(name));
        return `${describeOp(op)} needs "${missing.join('", "')}"`;
      });
      throw new Error(`${site}: the conditions cannot be ordered — ${blocked.join("; ")}.`);
    }
    const [op] = remaining.splice(index, 1);
    const opened = opOpensIR(op, bound);
    opens.set(op, opened);
    for (const name of opened) bound.add(name);
    ordered.push(op);
  }
  return { ordered, bound, opens };
}

/**
 * Reject names a scheduled line opens but nothing later reads: a name whose
 * only mention is the line that opens it is noise the author should drop.
 * `extras` counts uses outside the block (declared inputs and outputs).
 */
export function assertNoOrphanedOpens<Op extends AnyOpIR>(
  scheduled: ScheduledBlock<Op>,
  extras: readonly string[],
  site: string,
): void {
  const counts = new Map<string, number>();
  const add = (name: string): void => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const op of scheduled.ordered) for (const name of opNamesIR(op)) add(name);
  for (const name of extras) add(name);
  for (const op of scheduled.ordered) {
    if (op.op === "earlier") continue;
    for (const name of scheduled.opens.get(op) ?? []) {
      if ((counts.get(name) ?? 0) <= 1) {
        throw new Error(`${site}: "${name}" is opened and never used — omit the key instead.`);
      }
    }
  }
}
