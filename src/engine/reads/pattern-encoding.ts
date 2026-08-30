/** Shared encoding for authored patterns used by reactions, views, and formers. */

import { isQueryRef } from "@engine/reactions/authoring/references";
import { actionNameOf, conceptNameOf } from "@engine/reactions/concepts/introspect";
import type {
  ActionPattern,
  ChannelPattern,
  InstrumentedQuery,
  Mapping,
  TriggerPattern,
} from "@engine/reactions/types";
import { isFusedFormer } from "./former-nodes.ts";
import { withLive } from "./ir.ts";
import type {
  ActionTriggerIR,
  PatternIR,
  QueryRefIR,
  TriggerIR,
  ValueIR,
  WhereOpIR,
} from "./ir.ts";
import { isPlainMapping } from "./matchers.ts";
import { walkValueTree } from "./value-tree.ts";
import type { AnyWhereOp } from "./where-ops.ts";
import { setOwn } from "@engine/utils/own-property";

export class PatternVariables {
  private names = new Map<symbol, string>();
  private taken = new Set<string>();

  nameAs(variable: symbol, name: string): void {
    const existing = this.names.get(variable);
    if (existing === name) return;
    if (existing !== undefined || this.taken.has(name)) {
      throw new Error(`Variable name "${name}" is already taken.`);
    }
    this.names.set(variable, name);
    this.taken.add(name);
  }

  nameOf(variable: symbol): string {
    const existing = this.names.get(variable);
    if (existing !== undefined) return existing;
    const base =
      variable.description === undefined || variable.description === ""
        ? "v"
        : variable.description;
    let candidate = base;
    let counter = 1;
    while (this.taken.has(candidate)) {
      counter += 1;
      candidate = `${base}$${counter}`;
    }
    this.names.set(variable, candidate);
    this.taken.add(candidate);
    return candidate;
  }
}

function encodeValue(value: unknown, vars: PatternVariables): ValueIR {
  if (value === undefined) {
    throw new Error("Portable patterns cannot contain literal undefined; omit the key instead.");
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "symbol") return { $var: vars.nameOf(value) };
  if (isFusedFormer(value)) {
    return { $former: { name: value.former.formerName, in: encodePattern(value.in, vars) } };
  }
  if (value instanceof RegExp) return { $regexp: { source: value.source, flags: value.flags } };
  if (Array.isArray(value)) return value.map((item) => encodeValue(item, vars));
  if (isPlainMapping(value)) {
    const encoded: Record<string, ValueIR> = {};
    for (const [key, item] of Object.entries(value)) {
      setOwn(encoded, key, encodeValue(item, vars));
    }
    if (Object.keys(encoded).some((key) => key.startsWith("$"))) return { $lit: encoded };
    return encoded;
  }
  return withLive({ $is: `literal ${(value as object).constructor?.name ?? "value"}` }, value);
}

export function encodePattern(mapping: Mapping | undefined, vars: PatternVariables): PatternIR {
  const encoded: PatternIR = {};
  for (const [key, value] of Object.entries(mapping ?? {})) {
    setOwn(encoded, key, encodeValue(value, vars));
  }
  return encoded;
}

function exceptNames(clause: ChannelPattern): string[] {
  const names = clause.except.map((entry) => {
    const candidate =
      typeof entry === "function" ? ((entry as { concept?: object }).concept ?? entry) : entry;
    return conceptNameOf(candidate as object);
  });
  return [...new Set(names)];
}

function encodeActionTrigger(pattern: ActionPattern, vars: PatternVariables): ActionTriggerIR {
  return {
    kind: "action",
    concept: conceptNameOf(pattern.concept),
    action: actionNameOf(pattern.action),
    ...(pattern.posture !== undefined ? { posture: pattern.posture } : {}),
    ...(pattern.by !== undefined ? { by: pattern.by } : {}),
    input: encodePattern(pattern.input, vars),
    output: encodePattern(pattern.output, vars),
  };
}

export function encodeTrigger(pattern: TriggerPattern, vars: PatternVariables): TriggerIR {
  if ("channel" in pattern) {
    return {
      kind: "channel",
      channel: pattern.channel,
      pattern: encodePattern(pattern.pattern, vars),
      except: exceptNames(pattern),
      ...(pattern.exceptBy !== undefined && pattern.exceptBy.length > 0
        ? { exceptBy: [...pattern.exceptBy] }
        : {}),
      ...(pattern.by !== undefined ? { by: pattern.by } : {}),
    };
  }
  return encodeActionTrigger(pattern, vars);
}

/** The `{ concept, query }` names a query reference carries, live or static. */
export function queryRefOf(query: InstrumentedQuery): QueryRefIR {
  if (isQueryRef(query)) return { concept: query.refConcept, query: query.refQuery };
  return { concept: conceptNameOf(query.concept ?? {}), query: query.queryName ?? "?" };
}

export function encodeWhereOp(op: AnyWhereOp, vars: PatternVariables): WhereOpIR {
  switch (op.op) {
    case "earlier":
      return { op: "earlier", when: encodeActionTrigger(op.pattern, vars) };
    case "now":
      return { op: "now", out: vars.nameOf(op.out) };
    case "find":
    case "whether":
    case "no": {
      const not = "not" in op && op.not !== undefined ? op.not : undefined;
      const encoded = {
        op: op.op,
        ...(op.query !== undefined
          ? { query: queryRefOf(op.query) }
          : { view: op.view?.viewName ?? "?" }),
        in: encodePattern(op.in, vars),
        out: encodePattern(op.out, vars),
        ...(not !== undefined ? { not: encodePattern(not, vars) } : {}),
      };
      return op.view !== undefined ? withLive(encoded, op.view) : encoded;
    }
    case "holds":
      return withLive(
        {
          op: "holds" as const,
          computation: op.fused.computation.computationName,
          in: encodePattern(op.fused.in, vars),
        },
        op.fused.computation,
      );
    case "compute":
      return withLive(
        {
          op: "compute" as const,
          computation: op.computation.computationName,
          in: encodePattern(op.in, vars),
          out: typeof op.out === "symbol" ? vars.nameOf(op.out) : encodePattern(op.out, vars),
        },
        op.computation,
      );
    case "custom":
      return withLive(
        {
          op: "custom" as const,
          fnRef: op.name,
          opaque: true as const,
          in: op.in.map((variable) => vars.nameOf(variable)),
          out: op.out.map((variable) => vars.nameOf(variable)),
        },
        op.fn,
      );
  }
}

/** Collect the authored symbols recursively from a pattern mapping. */
export function patternVariables(...mappings: Array<Mapping | undefined>): Set<symbol> {
  const variables = new Set<symbol>();
  for (const mapping of mappings) {
    if (mapping === undefined) continue;
    walkValueTree(mapping, (value) => {
      if (typeof value === "symbol") variables.add(value);
    });
  }
  return variables;
}
