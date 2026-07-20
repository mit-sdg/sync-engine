/**
 * Declare the reference-carrying fields of each IR variant once.
 * Shared folds use these tables to visit queries, views, formers, patterns,
 * variables, triggers, and consequences. Evaluation, rendering, wire
 * generation, and matching keep their own variant-specific switches.
 */

import type {
  ConsequenceIR,
  FormerNodeIR,
  PatternIR,
  QueryRefIR,
  ReactionIR,
  SpliceIR,
  TriggerIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "./ir.ts";

/** What one field of a variant holds, as the fold drivers read it. */
type FieldKind =
  | "query" // a { concept, query } reference
  | "pattern" // a PatternIR of ValueIR leaves
  | "varName" // one bound-variable name
  | "outNames" // a role → variable-name binding map
  | "varNames" // a positional variable-name list
  | "computationName" // an installed calculation, by name
  | "viewName" // a registered view, by sentence
  | "fragmentName" // a registered former, by sentence
  | "trigger" // a nested action trigger (the `earlier` read)
  | "op" // one nested where op
  | "ops" // a nested where-op list
  | "splices" // a record's spliced fragments
  | "nodeMap" // named child former nodes
  | "node" // one child former node
  | "arrangedBy"; // an ordering that may name a variable

type FieldTable = Readonly<Record<string, FieldKind>>;

/** The where/view op vocabulary: every reference-carrying field, per op. */
export const OP_FIELDS: Readonly<Record<string, FieldTable>> = {
  find: { query: "query", view: "viewName", in: "pattern", out: "pattern", not: "pattern" },
  whether: { query: "query", view: "viewName", in: "pattern", out: "pattern", not: "pattern" },
  no: { query: "query", view: "viewName", in: "pattern", out: "pattern" },
  count: { query: "query", in: "pattern", out: "varName" },
  compute: { computation: "computationName", in: "pattern", out: "varName" },
  holds: { computation: "computationName", in: "pattern" },
  custom: { in: "varNames", out: "varNames" },
  earlier: { when: "trigger" },
};

/** The former-node vocabulary: every reference-carrying field, per variant. */
export const FORMER_NODE_FIELDS: Readonly<Record<FormerNodeIR["node"], FieldTable>> = {
  leaf: { var: "varName" },
  record: { where: "ops", entries: "nodeMap", splices: "splices" },
  former: { former: "fragmentName", in: "pattern" },
  each: {
    from: "op",
    where: "ops",
    arranged: "arrangedBy",
    as: "node",
  },
  count: { from: "op", where: "ops" },
  first: {
    from: "op",
    where: "ops",
    arranged: "arrangedBy",
    value: "varName",
  },
  distinct: { from: "op", where: "ops", value: "varName" },
};

/** The callbacks a fold may register — every one optional, every one a reference kind. */
export interface IRFold {
  /** Every where/view op, before its fields. */
  op?(op: WhereOpIR | ViewOpIR): void;
  /** Every `{ concept, query }` reference: selections and where reads. */
  query?(ref: QueryRefIR): void;
  /** Every input pattern. */
  pattern?(pattern: PatternIR): void;
  /** Every bound-variable name: out maps, aggregate values, leaves, custom footprints. */
  varName?(name: string): void;
  /** Every spliced fragment use. */
  splice?(use: SpliceIR): void;
  /** Every former node, before its fields. */
  node?(node: FormerNodeIR): void;
  /** Every trigger clause: a reaction's `when`, or an `earlier` read's pattern. */
  trigger?(clause: TriggerIR): void;
  /** Every consequence a reaction asks for. */
  consequence?(consequence: ConsequenceIR): void;
}

function foldField(value: unknown, kind: FieldKind, fold: IRFold): void {
  if (value === undefined) return;
  switch (kind) {
    case "query":
      fold.query?.(value as QueryRefIR);
      return;
    case "pattern":
      fold.pattern?.(value as PatternIR);
      return;
    case "varName":
      fold.varName?.(value as string);
      return;
    case "outNames":
      for (const name of Object.values(value as Record<string, string>)) fold.varName?.(name);
      return;
    case "varNames":
      for (const name of value as string[]) fold.varName?.(name);
      return;
    case "computationName":
    case "viewName":
    case "fragmentName":
      // Named definitions: visited through their op/splice callbacks, which
      // see the whole node — a bare name carries no structure to descend.
      return;
    case "trigger":
      fold.trigger?.(value as TriggerIR);
      return;
    case "op":
      foldOps([value as WhereOpIR], fold);
      return;
    case "ops":
      foldOps(value as readonly (WhereOpIR | ViewOpIR)[], fold);
      return;
    case "splices":
      for (const use of value as SpliceIR[]) {
        fold.splice?.(use);
        fold.pattern?.(use.in);
      }
      return;
    case "nodeMap":
      for (const child of Object.values(value as Record<string, FormerNodeIR>)) {
        foldFormerNode(child, fold);
      }
      return;
    case "node":
      foldFormerNode(value as FormerNodeIR, fold);
      return;
    case "arrangedBy": {
      const arranged = value as { by?: string };
      if (arranged.by !== undefined) fold.varName?.(arranged.by);
      return;
    }
  }
}

function foldByTable(value: object, table: FieldTable, fold: IRFold): void {
  for (const [field, kind] of Object.entries(table)) {
    foldField((value as Record<string, unknown>)[field], kind, fold);
  }
}

/** Walk a where-op list by the schema, visiting every reference. */
export function foldOps(ops: readonly (WhereOpIR | ViewOpIR)[], fold: IRFold): void {
  for (const op of ops) {
    fold.op?.(op);
    const table = OP_FIELDS[op.op];
    if (table !== undefined) foldByTable(op, table, fold);
  }
}

/** Walk a former's tree by the schema, visiting every reference. */
export function foldFormerNode(node: FormerNodeIR, fold: IRFold): void {
  fold.node?.(node);
  foldByTable(node, FORMER_NODE_FIELDS[node.node], fold);
}

/** Walk one `ReactionIR` entry: triggers, where ops, consequences. */
export function foldReaction(reaction: ReactionIR, fold: IRFold): void {
  for (const clause of reaction.when) fold.trigger?.(clause);
  foldOps(reaction.where, fold);
  for (const consequence of reaction.then) {
    fold.consequence?.(consequence);
    fold.pattern?.(consequence.input);
  }
}

/** Walk one view: every block's ops. */
export function foldView(view: ViewIR, fold: IRFold): void {
  for (const block of view.alternatives) foldOps(block, fold);
}
