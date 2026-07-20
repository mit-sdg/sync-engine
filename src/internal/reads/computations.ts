/**
 * Named, pure calculations over values already in hand.
 *
 * A computation is part of a vocabulary, alongside its concepts. Its name is
 * therefore local to an assembly: importing a module never registers engine
 * behavior as a side effect. Applying a ref only fuses it with its named input
 * pattern; the engine that receives the reaction checks that the vocabulary
 * actually assembled the ref.
 */

import type { Mapping } from "../reactions/types.ts";
import { brand, hasBrand } from "./brands.ts";

/** The runtime shape of a computation: one input mapping in, one value out. */
export type ComputationFn = (input: Mapping) => unknown | Promise<unknown>;

export type ComputationSource = "standard" | "vocabulary";

/** A named computation ref, callable with an input pattern. */
export interface ComputationRef {
  (input: Mapping): FusedComputation;
  readonly computationName: string;
  readonly fn: ComputationFn;
  readonly source: ComputationSource;
}

/** A computation ref fused with its input pattern. */
export interface FusedComputation {
  readonly computation: ComputationRef;
  readonly in: Mapping;
}

const FusedBrand: unique symbol = Symbol("FusedBrand");

export function isFusedComputation(value: unknown): value is FusedComputation {
  return hasBrand(value, FusedBrand);
}

/** Construct inert named data. Vocabulary construction is the public owner. */
export function computationRef(
  name: string,
  fn: ComputationFn,
  source: ComputationSource,
): ComputationRef {
  if (name === "") throw new Error("A computation needs a name.");
  if (typeof fn !== "function") throw new Error(`Computation "${name}" needs a function.`);
  const ref = ((input: Mapping): FusedComputation => {
    return brand({ computation: ref, in: input }, FusedBrand);
  }) as ComputationRef;
  Object.defineProperties(ref, {
    computationName: { value: name, enumerable: true },
    fn: { value: fn, enumerable: false },
    source: { value: source, enumerable: false },
  });
  return ref;
}

const ltRef = computationRef(
  "lt",
  ({ left, right }) => (left as never) < (right as never),
  "standard",
);
const leRef = computationRef(
  "le",
  ({ left, right }) => (left as never) <= (right as never),
  "standard",
);
const gtRef = computationRef(
  "gt",
  ({ left, right }) => (left as never) > (right as never),
  "standard",
);
const geRef = computationRef(
  "ge",
  ({ left, right }) => (left as never) >= (right as never),
  "standard",
);
const amongRef = computationRef(
  "among",
  ({ value, collection }) => (Array.isArray(collection) ? collection.includes(value) : false),
  "standard",
);

export function lt(left: unknown, right: unknown): FusedComputation {
  return ltRef({ left, right });
}
export function le(left: unknown, right: unknown): FusedComputation {
  return leRef({ left, right });
}
export function gt(left: unknown, right: unknown): FusedComputation {
  return gtRef({ left, right });
}
export function ge(left: unknown, right: unknown): FusedComputation {
  return geRef({ left, right });
}
export function among(value: unknown, collection: unknown): FusedComputation {
  return amongRef({ value, collection });
}

/** The built-in order and membership relations, read as closed lines. */
export const is = { lt, le, gt, ge, among } as const;

/** Engine-provided computation refs installed into every engine instance. */
export const standardComputations: readonly ComputationRef[] = [
  ltRef,
  leRef,
  gtRef,
  geRef,
  amongRef,
];
