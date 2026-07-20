/** Formers name and shape read answers at the edge. */

import { conditionOp } from "./where-ops.ts";
import type { Condition, FindOp, WhereOp } from "./where-ops.ts";
import { isReadLine } from "./lines.ts";
import type { ReadLine } from "./lines.ts";
import type { Vars } from "../reactions/types.ts";
import type { ViewBlock } from "./views.ts";
import { sentenceVars, slotVariables, slotsOf } from "./sentence.ts";
import {
  type Arranged,
  brandNode,
  type CountNode,
  type DistinctNode,
  type EachNode,
  type FirstNode,
  type FormerEntry,
  type FormerCallNode,
  type FormerNode,
  type FormerRef,
  formerRefWith,
  type FusedFormer,
  isFormerNode,
  isFusedFormer,
  isFormerUse,
  type LeafNode,
  type RecordNode,
  contributedKeys,
  type FormerUse,
  useFormer,
} from "./former-nodes.ts";
import { assertBound, symbolsUsed } from "./former-analysis.ts";
import { lowerFormerBody } from "./lower.ts";

/** The ordering vocabulary: `arranged.oldest`, `arranged.newest`, `arranged.by(v)`. */
export const arranged = {
  /** Record order, represented by the query's row order. */
  oldest: { order: "oldest" } as Arranged,
  /** The record's own order, reversed. */
  newest: { order: "newest" } as Arranged,
  /** Order on a value the matches carry. */
  by(variable: symbol, order: "ascending" | "descending" = "ascending"): Arranged {
    if (typeof variable !== "symbol") {
      throw new Error("arranged.by(variable) orders on a bound variable.");
    }
    return { by: variable, order };
  },
} as const;

// ── Builders ───────────────────────────────────────────────────────────────

function assertSelectionWhere(
  op: string,
  where: readonly (Condition | WhereOp)[] | undefined,
): WhereOp[] {
  const ops: WhereOp[] = [];
  for (const item of where ?? []) {
    const kind = (item as { op?: unknown })?.op;
    if (kind === "count") {
      throw new Error(
        `${op}(...): count(...) cannot filter a selection. ` +
          "End the selection with .count(), or put count(...) in a view.",
      );
    }
    if (kind === "earlier") {
      throw new Error(
        `${op}(...): a former answers from standing state, not the flow's record — earlier(...) belongs to a reaction's own where.`,
      );
    }
    ops.push(conditionOp(item, `${op}(...)`) as WhereOp);
  }
  return ops;
}

/** A leaf: a bound variable shown as the value it holds. @internal */
export function leaf(variable: symbol): LeafNode {
  if (typeof variable !== "symbol") throw new Error("leaf(variable) takes a bound variable.");
  return brandNode({ node: "leaf" as const, var: variable });
}

/** A formed object whose flat fragment splices are being stated. */
export interface FormNode extends RecordNode {
  splicing(...uses: readonly (FusedFormer | FormerUse)[]): FormNode;
}

function entryNode(key: string, value: FormerEntry): FormerNode {
  if (typeof value === "symbol") return brandNode({ node: "leaf" as const, var: value });
  if (isFormerNode(value)) return value;
  const use = isFormerUse(value) ? value : isFusedFormer(value) ? useFormer(value) : undefined;
  if (use !== undefined) {
    return brandNode({ node: "former" as const, use } satisfies FormerCallNode);
  }
  throw new Error(`form(...): entry "${key}" must be a bound name or a formed value.`);
}

function buildForm(entries: Record<string, FormerEntry>, conditions: readonly WhereOp[]): FormNode {
  const entryList: Array<readonly [string, FormerNode]> = [];
  for (const [key, value] of Object.entries(entries ?? {})) {
    entryList.push([key, entryNode(key, value)]);
  }
  const splices: FormerUse[] = [];
  const node = brandNode({
    node: "record" as const,
    where: [...conditions],
    entries: entryList,
    splices,
  });
  const chain = node as unknown as FormNode;
  Object.defineProperty(node, "splicing", {
    enumerable: false,
    value: (...values: readonly (FusedFormer | FormerUse)[]): FormNode => {
      const uses = values.map((value) =>
        isFormerUse(value) ? value : isFusedFormer(value) ? useFormer(value) : undefined,
      );
      if (uses.some((use) => use === undefined)) {
        throw new Error(".splicing(...) takes named formers with their slots filled.");
      }
      const claimed = new Set(entryList.map(([key]) => key));
      for (const existing of splices) {
        for (const key of contributedKeys(existing.fused.former)) claimed.add(key);
      }
      for (const use of uses as FormerUse[]) {
        if (use.fused.former.body.node !== "record") {
          throw new Error(`.splicing(...): "${use.fused.former.formerName}" is not record-rooted.`);
        }
        for (const key of contributedKeys(use.fused.former)) {
          if (claimed.has(key)) {
            throw new Error(
              `form(...): splice "${use.fused.former.formerName}" collides on key "${key}" — ` +
                "a spliced key may not shadow the host's or another splice's.",
            );
          }
          claimed.add(key);
        }
        splices.push(use);
      }
      return chain;
    },
  });
  return chain;
}

export function form(entries: Record<string, FormerEntry>): FormNode {
  return buildForm(entries, []);
}

export function formFrom(block: ViewBlock, entries: Record<string, FormerEntry>): FormNode {
  return buildForm(entries, assertSelectionWhere("form", block as readonly WhereOp[]));
}

/** The comprehension: range, keep, arrange, and carry a smaller former per match. @internal */
function buildEach(
  from: FindOp,
  options: { where?: readonly WhereOp[]; arranged?: Arranged; as: FormerEntry },
): EachNode {
  const as =
    typeof options.as === "symbol"
      ? brandNode({ node: "leaf" as const, var: options.as })
      : options.as;
  if (!isFormerNode(as)) {
    throw new Error("each(...): `as` must describe the formed value for each matching row.");
  }
  return brandNode({
    node: "each" as const,
    from,
    where: assertSelectionWhere("each", options.where),
    ...(options.arranged !== undefined ? { arranged: options.arranged } : {}),
    as,
  });
}

/** How many matched — the selection consumed by a count instead of carried. @internal */
export function countOf(from: FindOp, options: { where?: readonly WhereOp[] } = {}): CountNode {
  return brandNode({
    node: "count" as const,
    from,
    where: assertSelectionWhere(".count", options.where),
  });
}

/**
 * One bound value read off the first match, by the comprehension's own
 * ordering: `the createdAt of the first … arranged by createdAt, descending`.
 * An empty selection reads as `null`.
 * @internal
 */
export function firstOf(
  from: FindOp,
  options: { where?: readonly WhereOp[]; arranged?: Arranged; value: symbol },
): FirstNode {
  if (typeof options.value !== "symbol") {
    throw new Error(".first(value) requires a variable bound by the selection.");
  }
  return brandNode({
    node: "first" as const,
    from,
    where: assertSelectionWhere(".first", options.where),
    ...(options.arranged !== undefined ? { arranged: options.arranged } : {}),
    value: options.value,
  });
}

/** The distinct values of a variable the selection binds, first-seen order. @internal */
export function distinctOf(
  from: FindOp,
  options: { where?: readonly WhereOp[]; value: symbol },
): DistinctNode {
  if (typeof options.value !== "symbol") {
    throw new Error(".distinct(value) requires a variable bound by the selection.");
  }
  return brandNode({
    node: "distinct" as const,
    from,
    where: assertSelectionWhere(".distinct", options.where),
    value: options.value,
  });
}

// ── The selection chain ──────────────────────────────────────────────

/** How a captured selection orders itself: a bound variable, or the record's own order. */
type ArrangedWord = "newest" | "oldest";

/** The consumers a captured selection may end in — exactly one, always. */
export interface SelectionConsumers {
  /** Carry each match as one object. */
  form(entries: Record<string, FormerEntry>): EachFormNode;
  /** How many matched. */
  count(): CountNode;
  /** One bound value read off the first match, by the selection's ordering. */
  first(value: symbol): FirstNode;
  /** The distinct values of a variable the selection binds, first-seen order. */
  distinct(value: symbol): DistinctNode;
}

export interface EachFormNode extends EachNode {
  splicing(...uses: readonly (FusedFormer | FormerUse)[]): EachFormNode;
}

/** A captured selection mid-statement: order it, refine it, then consume it. */
export interface SelectionBuilder extends SelectionConsumers {
  /** Refine the selection with condition lines (never `earlier`, never `count`). */
  where(...conditions: readonly Condition[]): SelectionBuilder;
  /** Order the matches: `.arranged(v)`, `.arranged(v, "descending")`, `.arranged("newest")`. */
  arranged(variable: symbol, order?: "ascending" | "descending"): SelectionBuilder;
  arranged(order: ArrangedWord): SelectionBuilder;
}

interface SelectionSpec {
  readonly from: FindOp;
  readonly where: readonly WhereOp[];
  readonly arranged?: Arranged;
}

function parseArranged(first: symbol | ArrangedWord, order?: "ascending" | "descending"): Arranged {
  if (first === "newest" || first === "oldest") {
    if (order !== undefined) {
      throw new Error('arranged("newest" | "oldest") takes no second argument.');
    }
    return { order: first };
  }
  return arranged.by(first, order ?? "ascending");
}

function consumersOf(spec: SelectionSpec): SelectionConsumers {
  return {
    form: (entries) => {
      const item = buildForm(entries, []);
      const node = buildEach(spec.from, {
        where: spec.where,
        ...(spec.arranged !== undefined ? { arranged: spec.arranged } : {}),
        as: item,
      }) as EachFormNode;
      Object.defineProperty(node, "splicing", {
        value: (...uses: readonly (FusedFormer | FormerUse)[]) => {
          item.splicing(...uses);
          return node;
        },
      });
      return node;
    },
    count: () => {
      if (spec.arranged !== undefined) {
        throw new Error(".count() does not use ordering; remove .arranged(...).");
      }
      return countOf(spec.from, { where: spec.where });
    },
    first: (value) =>
      firstOf(spec.from, {
        where: spec.where,
        ...(spec.arranged !== undefined ? { arranged: spec.arranged } : {}),
        value,
      }),
    distinct: (value) => {
      if (spec.arranged !== undefined) {
        throw new Error(".distinct(value) uses first-seen order; remove .arranged(...).");
      }
      return distinctOf(spec.from, {
        where: spec.where,
        value,
      });
    },
  };
}

function builderOf(spec: SelectionSpec): SelectionBuilder {
  return {
    where: (...conditions: readonly Condition[]) => {
      if (spec.where.length > 0) {
        throw new Error(".where(...) stated twice — combine the conditions into one list.");
      }
      return builderOf({ ...spec, where: assertSelectionWhere("each", conditions) });
    },
    arranged: ((first: symbol | ArrangedWord, order?: "ascending" | "descending") => {
      if (spec.arranged !== undefined) {
        throw new Error(".arranged(...) stated twice — a selection has one order.");
      }
      return builderOf({ ...spec, arranged: parseArranged(first, order) });
    }) as SelectionBuilder["arranged"],
    ...consumersOf(spec),
  };
}

/**
 * Capture every row explored by one concept-query line for production. Refine
 * the captured relation with `.where(...)`, order it with `.arranged(...)`,
 * then end it in one consumer (`.form`, `.count`, `.first`, `.distinct`).
 */
export function each(line: ReadLine): SelectionBuilder {
  if (!isReadLine(line)) {
    throw new Error("each(...) starts production from one plain query or view line.");
  }
  const from = conditionOp(line, "each(...)");
  if (from.op !== "find") throw new Error("each(...) starts production from one plain line.");
  return builderOf({ from, where: [] });
}

// ── The former itself ──────────────────────────────────────────────────────

/**
 * Define a former from a sentence with `(slot)` groups and a result builder.
 * The builder receives stable logic variables by name and returns a formed
 * object or captured selection. Put the question this former answers in the
 * doc comment above its definition.
 */
export function former(sentence: string, build: (vars: Vars) => FormerNode): FormerRef {
  const optional = sentence.endsWith(", if any");
  const name = optional ? sentence.slice(0, -", if any".length) : sentence;
  const slots = slotsOf(name);
  const { vars, minted } = sentenceVars();

  const body = build(vars);
  if (!isFormerNode(body)) {
    throw new Error(`Former "${sentence}": the builder must return a former node.`);
  }
  if (optional && body.node !== "record") {
    throw new Error(
      `Former "${sentence}": a selection always answers and takes no ", if any" tail.`,
    );
  }

  const slotVars = slotVariables("Former", name, slots, minted, "shapes");
  const used = new Set<symbol>();
  symbolsUsed(body, used);
  for (const [slot, variable] of minted) {
    if (slots.includes(slot) && !used.has(variable)) {
      throw new Error(
        `Former "${sentence}": slot "(${slot})" is never used — a slot that ` +
          "shapes nothing does not belong in the sentence.",
      );
    }
  }
  assertBound(sentence, body, new Set(slotVars));

  // The definition boundary: the checked builder tree lowers to the IR here,
  // and the IR body is what registers, evaluates, exports, and renders.
  return formerRefWith(
    name,
    slots,
    slotVars,
    optional ? "optional" : "one",
    lowerFormerBody(slotVars, body),
  );
}
