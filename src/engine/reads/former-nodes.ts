/**
 * The former algebra's node shapes. The builder-time nodes here carry live
 * references and symbols; a finished {@link FormerRef} carries the IR —
 * `former(...)` lowers at the definition boundary, and the IR body is what
 * registers, evaluates, exports, and renders.
 */

import { brand, FormerUseBrand, hasBrand } from "./brands.ts";
import { objectRef } from "./sentence.ts";
import type { Mapping } from "@engine/reactions/types";
import { liveOf } from "./ir.ts";
import type { FormerNodeIR } from "./ir.ts";
import type { QueryPromise } from "./query-metadata.ts";
import type { FindOp, WhereOp } from "./where-ops.ts";
import type {
  CarriesFacts,
  CarriesFormedValue,
  ContractFacts,
  ExactPattern,
  FactsFromPattern,
  FormerRoot,
  InputPattern,
  TypedFormerNode,
  ValueExpression,
} from "./type-inference.ts";

// ── Node shapes ────────────────────────────────────────────────────────────

/** How a comprehension orders what it kept. */
export type Arranged =
  | { readonly order: "oldest" | "newest" }
  | { readonly by: symbol; readonly order: "ascending" | "descending" };

/** The selection every comprehension-shaped node shares: source line and refinements. */
interface Selection {
  readonly from: FindOp;
  readonly where: readonly WhereOp[];
}

/** A named former read at a record entry or splice. */
export interface FormerUse<
  Fused extends FusedFormer = FusedFormer,
  Whether extends boolean = boolean,
> {
  readonly fused: Fused;
  readonly whether: Whether;
}

export interface RecordNode<
  Expression = ValueExpression<unknown>,
  Blank = ValueExpression<unknown>,
  Facts = any,
> extends TypedFormerNode<Expression, Blank, Facts, "record"> {
  readonly node: "record";
  readonly where: readonly WhereOp[];
  readonly entries: ReadonlyArray<readonly [string, FormerNode]>;
  readonly splices: readonly FormerUse[];
}

export interface EachNode<
  Expression = ValueExpression<unknown>,
  Blank = ValueExpression<unknown>,
  Facts = any,
>
  extends Selection, TypedFormerNode<Expression, Blank, Facts, "selection"> {
  readonly node: "each";
  readonly arranged?: Arranged;
  readonly as: FormerNode;
}

export interface CountNode<Facts = any>
  extends Selection, TypedFormerNode<number, 0, Facts, "selection"> {
  readonly node: "count";
}

export interface FirstNode<Expression = ValueExpression<unknown>, Facts = any>
  extends Selection, TypedFormerNode<Expression, null, Facts, "selection"> {
  readonly node: "first";
  readonly arranged?: Arranged;
  readonly value: symbol;
}

export interface DistinctNode<Expression = ValueExpression<unknown>, Facts = any>
  extends Selection, TypedFormerNode<Expression, Expression, Facts, "selection"> {
  readonly node: "distinct";
  readonly value: symbol;
}

interface LeafNode {
  readonly node: "leaf";
  readonly var: symbol;
}

export interface FormerCallNode {
  readonly node: "former";
  readonly use: FormerUse;
}

export type FormerNode =
  | LeafNode
  | RecordNode<any, any, any>
  | FormerCallNode
  | EachNode<any, any, any>
  | CountNode<any>
  | FirstNode<any, any>
  | DistinctNode<any, any>;

/** What a record entry accepts: a leaf, a smaller shape, or a named former. */
export type FormerEntry = symbol | FormerNode | FusedFormer | FormerUse;

const FormerNodeBrand: unique symbol = Symbol("FormerNodeBrand");
const FusedFormerBrand: unique symbol = Symbol("FusedFormerBrand");

export function brandNode<T extends object>(node: T): T {
  return brand(node, FormerNodeBrand);
}

export function isFormerNode(value: unknown): value is FormerNode {
  return hasBrand(value, FormerNodeBrand);
}

export function isFormerUse(value: unknown): value is FormerUse {
  return hasBrand(value, FormerUseBrand);
}

/** Every key a record-rooted former contributes, including nested contributions. */
export function contributedKeys(ref: FormerRef): string[] {
  const root = ref.body;
  if (root.node !== "record") return [];
  const keys = Object.keys(root.entries);
  for (const nested of root.splices ?? []) {
    const fragment = liveOf(nested) as FormerRef | undefined;
    if (fragment !== undefined) keys.push(...contributedKeys(fragment));
  }
  return keys;
}

/** A defined former, callable with its input mapping to produce the fused reference. */
type FusedValue<Present, Promise extends Exclude<QueryPromise, "many">> = Promise extends "optional"
  ? Present | null
  : Present;
declare const FormerRefType: unique symbol;
type IsAny<Value> = 0 extends 1 & Value ? true : false;
// biome-ignore lint/suspicious/noExplicitAny: explicit contracts may refine leaves that inference could not constrain.
type ContractWildcard = any;
type ContractWitness<Value> =
  IsAny<Value> extends true
    ? ContractWildcard
    : unknown extends Value
      ? ContractWildcard
      : Value extends readonly (infer Item)[]
        ? ContractWitness<Item>[]
        : Value extends object
          ? { [Key in keyof Value]: ContractWitness<Value[Key]> }
          : Value;

type ContractBlankLeaf<Value> = Value extends readonly unknown[]
  ? [] | null
  : Value extends object
    ? { [Key in keyof Value]: ContractBlankLeaf<Value[Key]> } | null
    : Value extends number
      ? 0 | null
      : null;

type ContractBlank<Value> = Value extends readonly unknown[]
  ? []
  : Value extends object
    ? { [Key in keyof Value]: ContractBlankLeaf<Value[Key]> }
    : Value extends number
      ? 0 | null
      : null;

// biome-ignore lint/suspicious/noExplicitAny: bare FormerRef is the erased internal declaration contract.
type AnyFormerInput = any;

type ContainsBroad<Value> =
  IsAny<Value> extends true
    ? true
    : unknown extends Value
      ? true
      : Value extends readonly (infer Item)[]
        ? ContainsBroad<Item>
        : Value extends object
          ? true extends {
              [Key in keyof Value]-?: ContainsBroad<Value[Key]>;
            }[keyof Value]
            ? true
            : false
          : false;

export interface FormerRef<
  Input extends object = AnyFormerInput,
  Present = unknown,
  Blank = unknown,
  Promise extends Exclude<QueryPromise, "many"> = Exclude<QueryPromise, "many">,
  Root extends FormerRoot = FormerRoot,
> {
  readonly [FormerRefType]: {
    readonly input: (value: ContractWitness<Input>) => void;
    readonly result: ContractWitness<Present>;
    readonly promise: Promise;
    readonly root: Root;
  };
  <const Pattern extends InputPattern<Input>>(
    input: ExactPattern<Input, Pattern>,
  ): FusedFormer<
    FusedValue<ContractWitness<Present>, Promise>,
    ContractWitness<Present>,
    ContractWitness<Blank>,
    ContractFacts<FactsFromPattern<Input, Pattern>>,
    Root
  >;
  readonly formerName: string;
  readonly ins: readonly string[];
  readonly inputVars: readonly symbol[];
  readonly bindings: readonly string[];
  readonly promise: Exclude<QueryPromise, "many">;
  /** The former's tree, as the IR states it — the registered, exported, evaluated form. */
  readonly body: FormerNodeIR;
  /** State that this record-rooted former may decline. */
  optional(): FormerRef<Input, Present, Blank, "optional", Root>;
}

type BroadInputFields<Input extends object> = {
  [Key in keyof Input]-?: ContainsBroad<Input[Key]>;
}[keyof Input];

/** A compact explicit contract for a required named former. */
export type Former<
  Input extends object,
  Present,
  Blank = ContractBlank<Present>,
  Promise extends Exclude<QueryPromise, "many"> = "one",
  Root extends FormerRoot = FormerRoot,
> = true extends BroadInputFields<Input> ? never : FormerRef<Input, Present, Blank, Promise, Root>;

/** A former fused with its input mapping — what a then input or `formTree` takes. */
export interface FusedFormer<
  Value = unknown,
  Present = Value,
  Blank = unknown,
  Facts = any,
  Root extends FormerRoot = FormerRoot,
>
  extends CarriesFormedValue<Value>, CarriesFacts<Facts> {
  readonly former: FormerRef<
    Record<string, unknown>,
    Present,
    Blank,
    Exclude<QueryPromise, "many">,
    Root
  >;
  readonly in: Mapping;
}

export function isFusedFormer(value: unknown): value is FusedFormer {
  return hasBrand(value, FusedFormerBrand);
}

/** Fuse a former ref with its object-shaped input for reaction IR registration. */
export function fuseFormer(ref: FormerRef, input: Mapping): FusedFormer {
  return brand({ former: ref, in: input }, FusedFormerBrand) as unknown as FusedFormer;
}

export function useFormer<Fused extends FusedFormer, const Whether extends boolean = false>(
  fused: Fused,
  whether: Whether = false as Whether,
): FormerUse<Fused, Whether> {
  if (!isFusedFormer(fused)) {
    throw new Error("a former use takes a named former with its input mapping filled.");
  }
  return brand({ fused, whether }, FormerUseBrand);
}

/** A former evaluation fault caused by a violated promise. */
export class FormerFault extends Error {
  readonly code: "FORMER_NONE" | "FORMER_MANY";
  constructor(code: "FORMER_NONE" | "FORMER_MANY", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "FormerFault";
    this.code = code;
  }
}

/**
 * Construct a {@link FormerRef} from validated parts. Both `former(...)` and
 * `registerFormers(...)` use this function.
 * @internal
 */
export function formerRefWith(
  name: string,
  ins: readonly string[],
  inputVars: readonly symbol[],
  bindings: readonly string[],
  promise: Exclude<QueryPromise, "many">,
  body: FormerNodeIR,
): FormerRef {
  const ref = objectRef<FormerRef, FusedFormer>({
    kind: "Former",
    name,
    inputs: ins,
    nameKey: "formerName",
    properties: {
      inputVars: { value: [...inputVars], enumerable: false },
      body: { value: body, enumerable: false },
      promise: { value: promise, enumerable: true },
      bindings: { value: [...bindings], enumerable: true },
      optional: {
        value: (): FormerRef => {
          if (body.node !== "record") {
            throw new Error(`Former "${name}": a selection always answers and cannot be optional.`);
          }
          return formerRefWith(name, ins, inputVars, bindings, "optional", body);
        },
      },
    },
    fuse: fuseFormer,
  });
  return ref;
}
