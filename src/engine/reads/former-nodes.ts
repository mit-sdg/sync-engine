/**
 * The former algebra's node shapes. The builder-time nodes here carry live
 * references and symbols; a finished {@link FormerRef} carries the IR —
 * `former(...)` lowers at the definition boundary, and the IR body is what
 * registers, evaluates, exports, and renders.
 */

import { brand, FormerUseBrand, hasBrand } from "./brands.ts";
import { objectRef } from "./sentence.ts";
import type { Mapping } from "../reactions/types.ts";
import { liveOf } from "./ir.ts";
import type { FormerNodeIR } from "./ir.ts";
import type { QueryPromise } from "./query-contracts.ts";
import type { FindOp, WhereOp } from "./where-ops.ts";

// ── Node shapes ────────────────────────────────────────────────────────────

/** How a comprehension orders what it kept. */
export type Arranged =
  | { readonly order: "oldest" | "newest" }
  | { readonly by: symbol; readonly order: "ascending" | "descending" };

/** The selection every comprehension-shaped node shares: source line and refinements. */
export interface Selection {
  readonly from: FindOp;
  readonly where: readonly WhereOp[];
}

/** A named former read at a record entry or splice. */
export interface FormerUse {
  readonly fused: FusedFormer;
  readonly whether: boolean;
}

export interface RecordNode {
  readonly node: "record";
  readonly where: readonly WhereOp[];
  readonly entries: ReadonlyArray<readonly [string, FormerNode]>;
  readonly splices: readonly FormerUse[];
}

export interface EachNode extends Selection {
  readonly node: "each";
  readonly arranged?: Arranged;
  readonly as: FormerNode;
}

export interface CountNode extends Selection {
  readonly node: "count";
}

export interface FirstNode extends Selection {
  readonly node: "first";
  readonly arranged?: Arranged;
  readonly value: symbol;
}

export interface DistinctNode extends Selection {
  readonly node: "distinct";
  readonly value: symbol;
}

export interface LeafNode {
  readonly node: "leaf";
  readonly var: symbol;
}

export interface FormerCallNode {
  readonly node: "former";
  readonly use: FormerUse;
}

export type FormerNode =
  | LeafNode
  | RecordNode
  | FormerCallNode
  | EachNode
  | CountNode
  | FirstNode
  | DistinctNode;

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
export interface FormerRef {
  (input: Mapping): FusedFormer;
  readonly formerName: string;
  readonly ins: readonly string[];
  readonly inputVars: readonly symbol[];
  readonly bindings: readonly string[];
  readonly promise: Exclude<QueryPromise, "many">;
  /** The former's tree, as the IR states it — the registered, exported, evaluated form. */
  readonly body: FormerNodeIR;
  /** State that this record-rooted former may decline. */
  optional(): FormerRef;
}

/** A former fused with its input mapping — what a then input or `formTree` takes. */
export interface FusedFormer {
  readonly former: FormerRef;
  readonly in: Mapping;
}

export function isFusedFormer(value: unknown): value is FusedFormer {
  return hasBrand(value, FusedFormerBrand);
}

/** Fuse a former ref with its object-shaped input for reaction IR registration. */
export function fuseFormer(ref: FormerRef, input: Mapping): FusedFormer {
  return brand({ former: ref, in: input }, FusedFormerBrand);
}

export function useFormer(fused: FusedFormer, whether = false): FormerUse {
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
    inputVars,
    nameKey: "formerName",
    payloadKey: "body",
    payload: body,
    fuse: fuseFormer,
  });
  Object.defineProperty(ref, "promise", { value: promise, enumerable: true });
  Object.defineProperty(ref, "bindings", { value: [...bindings], enumerable: true });
  Object.defineProperty(ref, "optional", {
    value: (): FormerRef => {
      if (body.node !== "record") {
        throw new Error(`Former "${name}": a selection always answers and cannot be optional.`);
      }
      return formerRefWith(name, ins, inputVars, bindings, "optional", body);
    },
  });
  return ref;
}
