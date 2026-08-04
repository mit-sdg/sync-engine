/**
 * Named, pure calculations over values already in hand.
 *
 * A computation is part of a vocabulary, alongside its concepts. Its name is
 * therefore local to an assembly: importing a module never registers engine
 * behavior as a side effect. Applying a ref only fuses it with its named input
 * pattern; the engine that receives the reaction checks that the vocabulary
 * actually assembled the ref.
 */

import type { Mapping } from "@engine/reactions/types";
import { brand, hasBrand } from "./brands.ts";
import type { ExactPattern, InputPattern } from "./type-inference.ts";

/** The runtime shape of a computation: one input mapping in, one value out. */
// biome-ignore lint/suspicious/noExplicitAny: bare ComputationFn is the constraint for arbitrary object-shaped computation inputs.
export type ComputationFn<Input extends object = any, Output = unknown> = {
  bivarianceHack(input: Input): Output | Promise<Output>;
}["bivarianceHack"];

type FunctionFields<Value extends object> = {
  [Key in keyof Value]-?: Value[Key] extends (...args: never[]) => unknown ? true : false;
}[keyof Value];
type IsAnyInput<Value> = 0 extends 1 & Value ? true : false;
type IsEmptyInput<Value> = Value extends object
  ? string extends keyof Value
    ? [Value[string & keyof Value]] extends [never]
      ? true
      : false
    : false
  : false;

/** Keep only one-argument computations whose runtime input is a mapping. */
export type CheckedComputationFns<Fns extends Record<string, ComputationFn>> = {
  [Name in keyof Fns]: Parameters<Fns[Name]> extends []
    ? Fns[Name]
    : Parameters<Fns[Name]> extends [infer Input]
      ? IsAnyInput<Input> extends true
        ? Fns[Name]
        : IsEmptyInput<Input> extends true
          ? Fns[Name]
          : [Input] extends [object]
            ? Input extends readonly unknown[] | ((...args: never[]) => unknown)
              ? never
              : true extends FunctionFields<Input>
                ? never
                : Fns[Name]
            : never
      : never;
};

type ComputationSource = "standard" | "vocabulary";

/** A named computation ref, callable with an input pattern. */
export type ComputationInput<Fn extends ComputationFn> =
  Parameters<Fn> extends [infer Input, ...unknown[]]
    ? [Input] extends [object]
      ? Input
      : Record<string, never>
    : Record<string, never>;

export interface ComputationRef<Fn extends ComputationFn = ComputationFn> {
  <const Pattern extends InputPattern<ComputationInput<Fn>>>(
    input: ExactPattern<ComputationInput<Fn>, Pattern>,
  ): FusedComputation<Fn>;
  readonly computationName: string;
  readonly fn: Fn;
  readonly source: ComputationSource;
}

/** A computation ref fused with its input pattern. */
export interface FusedComputation<Fn extends ComputationFn = ComputationFn> {
  readonly computation: ComputationRef<Fn>;
  readonly in: Mapping;
}

const FusedBrand: unique symbol = Symbol("FusedBrand");

export function isFusedComputation(value: unknown): value is FusedComputation {
  return hasBrand(value, FusedBrand);
}

/** Construct inert named data. Vocabulary construction is the public owner. */
export function computationRef<Fn extends ComputationFn>(
  name: string,
  fn: Fn,
  source: ComputationSource,
): ComputationRef<Fn> {
  if (name === "") throw new Error("A computation needs a name.");
  if (typeof fn !== "function") throw new Error(`Computation "${name}" needs a function.`);
  const ref = ((input: Mapping): FusedComputation<Fn> => {
    return brand({ computation: ref, in: input }, FusedBrand);
  }) as unknown as ComputationRef<Fn>;
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

function relation<Fn extends ComputationFn>(
  ref: ComputationRef<Fn>,
  input: Mapping,
): FusedComputation<Fn> {
  return ref(input as never);
}

type StandardRelation = (left: unknown, right: unknown) => FusedComputation;
type StandardRelations = Readonly<Record<"lt" | "le" | "gt" | "ge" | "among", StandardRelation>>;

/** The built-in order and membership relations, read as closed lines. */
export const is: StandardRelations = {
  lt: (left, right) => relation(ltRef, { left, right }),
  le: (left, right) => relation(leRef, { left, right }),
  gt: (left, right) => relation(gtRef, { left, right }),
  ge: (left, right) => relation(geRef, { left, right }),
  among: (value, collection) => relation(amongRef, { value, collection }),
};

/** Engine-provided computation refs installed into every engine instance. */
export const standardComputations: readonly ComputationRef<any>[] = [
  ltRef,
  leRef,
  gtRef,
  geRef,
  amongRef,
];
