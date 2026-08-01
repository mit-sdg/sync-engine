/** Formers name and shape read answers at the edge. */

import { conditionOp } from "./where-ops.ts";
import type { Condition, FindOp, WhereOp } from "./where-ops.ts";
import { isReadLine } from "./lines.ts";
import type { ReadLine } from "./lines.ts";
import type { ViewBlock } from "./views.ts";
import {
  assertSeparateBags,
  bindingBag,
  type FreeBindings,
  type InputBindings,
} from "./sentence.ts";
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
  type RecordNode,
  contributedKeys,
  type FormerUse,
  useFormer,
} from "./former-nodes.ts";
import type { Mapping } from "@engine/reactions/types";
import { assertFormerBindings } from "./former-bindings.ts";
import { operationFootprint, symbolsInMapping } from "./operation-footprint.ts";
import { lowerFormerBody } from "./former-lowering.ts";
import type {
  BlankExpressionOf,
  BlankOfNode,
  ExpressionOf,
  FactFromVariable,
  FactsOf,
  LogicVariable,
  ResultOfNode,
  RootOf,
  ShapeFromFacts,
  ValueExpression,
} from "./type-inference.ts";

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

type EntryExpression<Entry> = Entry extends LogicVariable
  ? Entry
  : Entry extends FormerNode
    ? ExpressionOf<Entry>
    : Entry extends FormerUse<infer Fused, infer IsWhether>
      ? Fused extends FusedFormer<unknown, infer Present, infer Blank>
        ? ValueExpression<IsWhether extends true ? Present | Blank : Present>
        : ValueExpression<unknown>
      : Entry extends FusedFormer<unknown, infer Present>
        ? ValueExpression<Present>
        : ValueExpression<unknown>;

type EntryBlank<Entry> = Entry extends LogicVariable
  ? null
  : Entry extends FormerNode
    ? BlankExpressionOf<Entry>
    : ValueExpression<null>;

type EntryFacts<Entry> = Entry extends LogicVariable
  ? FactFromVariable<unknown, Entry>
  : Entry extends FormerUse<infer Fused>
    ? FactsOf<Fused>
    : FactsOf<Entry>;

type EntryExpressions<Entries extends Record<string, FormerEntry>> = {
  readonly [Key in keyof Entries]: EntryExpression<Entries[Key]>;
};

type EntryBlanks<Entries extends Record<string, FormerEntry>> = {
  readonly [Key in keyof Entries]: EntryBlank<Entries[Key]>;
};

type EntryFactUnion<Entries extends Record<string, FormerEntry>> = {
  [Key in keyof Entries]: EntryFacts<Entries[Key]>;
}[keyof Entries];

type RecordEntries<Expression> =
  Expression extends Record<string, unknown>
    ? Expression
    : Record<string, ValueExpression<unknown>>;

type ValueAt<Value, Key extends PropertyKey> = Value extends unknown
  ? Key extends keyof Value
    ? Value[Key]
    : never
  : never;

type StaticEntries<Value> = [Value] extends [object]
  ? { readonly [Key in keyof Value & string]: ValueExpression<ValueAt<Value, Key>> }
  : Record<never, never>;

type FusedResult<Use> =
  Use extends FormerUse<infer Fused, infer IsWhether>
    ? Fused extends FusedFormer<unknown, infer Present, infer Blank>
      ? IsWhether extends true
        ? Present | Blank
        : Present
      : never
    : Use extends FusedFormer<unknown, infer Present>
      ? Present
      : never;

type FusedBlank<Use> =
  Use extends FormerUse<infer Fused>
    ? Fused extends FusedFormer<unknown, unknown, infer Blank>
      ? Blank
      : never
    : Use extends FusedFormer<unknown, unknown, infer Blank>
      ? Blank
      : never;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

type MergeRecord<Left, Right> = {
  readonly [Key in keyof Left | keyof Right]: Key extends keyof Right
    ? Right[Key]
    : Key extends keyof Left
      ? Left[Key]
      : never;
};

type EntriesForUse<Use> = Use extends FusedFormer | FormerUse
  ? StaticEntries<FusedResult<Use>>
  : never;
type BlanksForUse<Use> = Use extends FusedFormer | FormerUse
  ? StaticEntries<FusedBlank<Use>>
  : never;

type SpliceEntries<Uses extends readonly (FusedFormer | FormerUse)[]> = UnionToIntersection<
  EntriesForUse<Uses[number]>
>;

type SpliceBlanks<Uses extends readonly (FusedFormer | FormerUse)[]> = UnionToIntersection<
  BlanksForUse<Uses[number]>
>;

type SpliceFacts<Uses extends readonly (FusedFormer | FormerUse)[]> = Uses[number] extends infer Use
  ? Use extends FormerUse<infer Fused>
    ? FactsOf<Fused>
    : FactsOf<Use>
  : never;

/** A formed object whose flat fragment splices are being stated. */
export interface FormNode<Expression = any, Blank = any, Facts = any> extends RecordNode<
  Expression,
  Blank,
  Facts
> {
  splicing<const Uses extends readonly (FusedFormer | FormerUse)[]>(
    ...uses: Uses
  ): FormNode<
    MergeRecord<RecordEntries<Expression>, SpliceEntries<Uses>>,
    MergeRecord<RecordEntries<Blank>, SpliceBlanks<Uses>>,
    Facts | SpliceFacts<Uses>
  >;
}

export type FormNodeOf<Entries extends Record<string, FormerEntry>, Facts = never> = FormNode<
  EntryExpressions<Entries>,
  EntryBlanks<Entries>,
  Facts | EntryFactUnion<Entries>
>;

function entryNode<Entry extends FormerEntry>(key: string, value: Entry): FormerNode {
  if (typeof value === "symbol") {
    return brandNode({ node: "leaf" as const, var: value }) as unknown as FormerNode;
  }
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
        throw new Error(".splicing(...) takes named formers with their input mappings filled.");
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

export function form<const Entries extends Record<string, FormerEntry>>(
  entries: Entries,
): FormNodeOf<Entries> {
  return buildForm(entries, []) as FormNodeOf<Entries>;
}

export function formFrom<
  Block extends ViewBlock,
  const Entries extends Record<string, FormerEntry>,
>(block: Block, entries: Entries): FormNodeOf<Entries, FactsOf<Block>> {
  return buildForm(
    entries,
    assertSelectionWhere("form", block as readonly WhereOp[]),
  ) as FormNodeOf<Entries, FactsOf<Block>>;
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
  }) as unknown as EachNode;
}

/** How many matched — the selection consumed by a count instead of carried. @internal */
function countOf(from: FindOp, options: { where?: readonly WhereOp[] } = {}): CountNode {
  return brandNode({
    node: "count" as const,
    from,
    where: assertSelectionWhere(".count", options.where),
  }) as unknown as CountNode;
}

/**
 * One bound value read off the first match, by the comprehension's own
 * ordering: `the createdAt of the first … arranged by createdAt, descending`.
 * An empty selection reads as `null`.
 * @internal
 */
function firstOf(
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
  }) as unknown as FirstNode;
}

/** The distinct values of a variable the selection binds, first-seen order. @internal */
function distinctOf(
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
  }) as unknown as DistinctNode;
}

// ── The selection chain ──────────────────────────────────────────────

/** How a captured selection orders itself: a bound variable, or the record's own order. */
type ArrangedWord = "newest" | "oldest";

function arrangedBy(variable: symbol, order: "ascending" | "descending"): Arranged {
  if (typeof variable !== "symbol") {
    throw new Error("arranged(variable) orders on a bound variable.");
  }
  return { by: variable, order };
}

/** The consumers a captured selection may end in — exactly one, always. */
interface SelectionConsumers<Facts = any> {
  /** Carry each match as one object. */
  form<const Entries extends Record<string, FormerEntry>>(
    entries: Entries,
  ): EachFormNode<EntryExpressions<Entries>, EntryBlanks<Entries>, Facts | EntryFactUnion<Entries>>;
  /** How many matched. */
  count(): CountNode<Facts>;
  /** One bound value read off the first match, by the selection's ordering. */
  first<Variable extends symbol>(
    value: Variable,
  ): FirstNode<Variable | null, Facts | FactFromVariable<unknown, Variable>>;
  /** The distinct values of a variable the selection binds, first-seen order. */
  distinct<Variable extends symbol>(
    value: Variable,
  ): DistinctNode<Variable[], Facts | FactFromVariable<unknown, Variable>>;
}

interface EachFormNode<ItemExpression = any, ItemBlank = any, Facts = any> extends EachNode<
  ItemExpression[],
  ItemBlank[],
  Facts
> {
  splicing<const Uses extends readonly (FusedFormer | FormerUse)[]>(
    ...uses: Uses
  ): EachFormNode<
    MergeRecord<RecordEntries<ItemExpression>, SpliceEntries<Uses>>,
    MergeRecord<RecordEntries<ItemBlank>, SpliceBlanks<Uses>>,
    Facts | SpliceFacts<Uses>
  >;
}

/** A captured selection mid-statement: order it, refine it, then consume it. */
interface SelectionBuilder<Facts = any> extends SelectionConsumers<Facts> {
  /** Refine the selection with condition lines (never `earlier`, never `count`). */
  where<const Conditions extends readonly Condition[]>(
    ...conditions: Conditions
  ): SelectionBuilder<Facts | FactsOf<Conditions[number]>>;
  /** Order the matches: `.arranged(v)`, `.arranged(v, "descending")`, `.arranged("newest")`. */
  arranged<Variable extends symbol>(
    variable: Variable,
    order?: "ascending" | "descending",
  ): SelectionBuilder<Facts | FactFromVariable<unknown, Variable>>;
  arranged(order: ArrangedWord): SelectionBuilder<Facts>;
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
  return arrangedBy(first, order ?? "ascending");
}

function consumersOf<Facts>(spec: SelectionSpec): SelectionConsumers<Facts> {
  return {
    form: (entries: Record<string, FormerEntry>) => {
      const item = buildForm(entries, []);
      const node = buildEach(spec.from, {
        where: spec.where,
        ...(spec.arranged !== undefined ? { arranged: spec.arranged } : {}),
        as: item,
      }) as unknown as EachFormNode;
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
    first: (value: symbol) =>
      firstOf(spec.from, {
        where: spec.where,
        ...(spec.arranged !== undefined ? { arranged: spec.arranged } : {}),
        value,
      }),
    distinct: (value: symbol) => {
      if (spec.arranged !== undefined) {
        throw new Error(".distinct(value) uses first-seen order; remove .arranged(...).");
      }
      return distinctOf(spec.from, {
        where: spec.where,
        value,
      });
    },
  } as unknown as SelectionConsumers<Facts>;
}

function builderOf<Facts>(spec: SelectionSpec): SelectionBuilder<Facts> {
  return {
    where: (...conditions: readonly Condition[]) => {
      if (spec.where.length > 0) {
        throw new Error(".where(...) stated twice — combine the conditions into one list.");
      }
      return builderOf<Facts | FactsOf<(typeof conditions)[number]>>({
        ...spec,
        where: assertSelectionWhere("each", conditions),
      });
    },
    arranged: ((first: symbol | ArrangedWord, order?: "ascending" | "descending") => {
      if (spec.arranged !== undefined) {
        throw new Error(".arranged(...) stated twice — a selection has one order.");
      }
      return builderOf({ ...spec, arranged: parseArranged(first, order) });
    }) as SelectionBuilder<Facts>["arranged"],
    ...consumersOf<Facts>(spec),
  } as SelectionBuilder<Facts>;
}

/**
 * Capture every row explored by one concept-query line for production. Refine
 * the captured relation with `.where(...)`, order it with `.arranged(...)`,
 * then end it in one consumer (`.form`, `.count`, `.first`, `.distinct`).
 */
export function each<Line extends ReadLine>(line: Line): SelectionBuilder<FactsOf<Line>> {
  if (!isReadLine(line)) {
    throw new Error("each(...) starts production from one plain query or view line.");
  }
  const from = conditionOp(line, "each(...)");
  if (from.op !== "find") throw new Error("each(...) starts production from one plain line.");
  return builderOf<FactsOf<Line>>({ from, where: [] });
}

/** Every variable a body mentions — the declared-vs-used check's census. */
function symbolsUsed(node: FormerNode, into: Set<symbol>): void {
  const fromMapping = (mapping: Mapping): void => {
    for (const variable of symbolsInMapping(mapping)) into.add(variable);
  };
  const fromOp = (op: WhereOp): void => {
    const footprint = operationFootprint(op, "authored");
    for (const variable of footprint.inputs) into.add(variable);
    // Relation outputs can test existing values; explicit operation outputs only produce them.
    if (op.op === "find" || op.op === "whether") {
      for (const variable of footprint.produces) into.add(variable);
    }
    if (op.op === "no") for (const variable of footprint.negative) into.add(variable);
  };
  switch (node.node) {
    case "leaf":
      into.add(node.var);
      return;
    case "record":
      for (const op of node.where) fromOp(op);
      for (const [, child] of node.entries) symbolsUsed(child, into);
      // A splice's anchors are uses of the host's variables.
      for (const use of node.splices) fromMapping(use.fused.in);
      return;
    case "former":
      fromMapping(node.use.fused.in);
      return;
    default: {
      fromMapping(node.from.in);
      fromMapping(node.from.not ?? {});
      for (const variable of symbolsInMapping(node.from.out)) into.add(variable);
      for (const op of node.where) fromOp(op);
      if (node.node === "each") symbolsUsed(node.as, into);
      if (node.node === "first" || node.node === "distinct") into.add(node.value);
      if (
        (node.node === "each" || node.node === "first") &&
        node.arranged !== undefined &&
        "by" in node.arranged
      ) {
        into.add(node.arranged.by);
      }
      return;
    }
  }
}

// ── The former itself ──────────────────────────────────────────────────────

/**
 * Define a former from a human name and explicit binding selectors.
 * The builder receives stable logic variables by name and returns a formed
 * object or captured selection. Put the question this former answers in the
 * doc comment above its definition.
 */
export function former<const Body extends FormerNode>(
  name: string,
  build: (inputs: InputBindings, bindings: FreeBindings) => Body,
): FormerRef<
  ShapeFromFacts<FactsOf<Body>, "input">,
  ResultOfNode<Body>,
  BlankOfNode<Body>,
  "one",
  RootOf<Body>
> {
  const inputs = bindingBag<"input">();
  const bindings = bindingBag<"free">();
  const body = build(inputs.vars, bindings.vars);
  if (!isFormerNode(body)) {
    throw new Error(`Former "${name}": the builder must return a former node.`);
  }
  assertSeparateBags("Former", name, [
    ["input", inputs.minted.keys()],
    ["free", bindings.minted.keys()],
  ]);
  const used = new Set<symbol>();
  symbolsUsed(body, used);
  const declared = new Set([...inputs.minted.values(), ...bindings.minted.values()]);
  for (const variable of used) {
    if (!declared.has(variable)) {
      throw new Error(
        `Former "${name}": binding "${String(variable.description ?? variable.toString())}" is not declared in the input or free binding bag.`,
      );
    }
  }
  for (const [input, variable] of inputs.minted) {
    if (!used.has(variable)) {
      throw new Error(`Former "${name}": input binding "${input}" is declared but never used.`);
    }
  }
  for (const [binding, variable] of bindings.minted) {
    if (!used.has(variable)) {
      throw new Error(`Former "${name}": free binding "${binding}" is declared but never used.`);
    }
  }
  const inputVars = [...inputs.minted.values()];

  // The definition boundary: the checked builder tree lowers to the IR here,
  // and the IR body is what registers, evaluates, exports, and renders.
  const lowered = lowerFormerBody(inputVars, body);
  assertFormerBindings(lowered, new Set(inputs.minted.keys()), name);
  return formerRefWith(
    name,
    [...inputs.minted.keys()],
    inputVars,
    [...bindings.minted.keys()],
    "one",
    lowered,
  ) as unknown as FormerRef<
    ShapeFromFacts<FactsOf<Body>, "input">,
    ResultOfNode<Body>,
    BlankOfNode<Body>,
    "one",
    RootOf<Body>
  >;
}
