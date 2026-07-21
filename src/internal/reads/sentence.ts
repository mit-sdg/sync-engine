/** Binding bags and callable references shared by views and formers. */

import type { Mapping, Vars } from "../reactions/types.ts";
import { isPlainMapping } from "./matchers.ts";

/** One independently declared binding bag. */
declare const InputBindingsBrand: unique symbol;
declare const OutputBindingsBrand: unique symbol;
declare const FreeBindingsBrand: unique symbol;

export interface InputBindings extends Vars {
  readonly [InputBindingsBrand]: true;
}
export interface OutputBindings extends Vars {
  readonly [OutputBindingsBrand]: true;
}
export interface FreeBindings extends Vars {
  readonly [FreeBindingsBrand]: true;
}

export interface BindingBag<TVars extends Vars = Vars> {
  readonly vars: TVars;
  readonly minted: Map<string, symbol>;
}

/**
 * Create one logic-variable proxy. Repeated access to one name returns the
 * same symbol; separate bags keep the declaration's partitions visible.
 */
export function bindingBag<TVars extends Vars = Vars>(): BindingBag<TVars> {
  const minted = new Map<string, symbol>();
  const vars = new Proxy({} as Vars, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      let existing = minted.get(prop);
      if (existing === undefined) {
        existing = Symbol(prop);
        minted.set(prop, existing);
      }
      return existing;
    },
  });
  return { vars: vars as TVars, minted };
}

/** Reject one declared name appearing in two binding partitions. */
export function assertSeparateBags(
  kind: string,
  name: string,
  bags: ReadonlyArray<readonly [label: string, minted: ReadonlyMap<string, symbol>]>,
): void {
  const seen = new Map<string, string>();
  for (const [label, minted] of bags) {
    for (const binding of minted.keys()) {
      const prior = seen.get(binding);
      if (prior !== undefined) {
        throw new Error(
          `${kind} "${name}": "${binding}" is declared in both the ${prior} and ${label} binding bags.`,
        );
      }
      seen.set(binding, label);
    }
  }
}

/** The parts a finished definition needs to become an object-call reference. */
export interface ObjectRefSpec<Ref, Fused> {
  kind: string;
  name: string;
  inputs: readonly string[];
  inputVars: readonly symbol[];
  nameKey: string;
  payloadKey: string;
  payload: unknown;
  fuse: (ref: Ref, input: Mapping) => Fused;
}

/** Build a callable reference whose sole argument is its named input mapping. */
export function objectRef<Ref extends (input: Mapping) => Fused, Fused>(
  spec: ObjectRefSpec<Ref, Fused>,
): Ref {
  const ref = ((input: Mapping): Fused => {
    if (!isPlainMapping(input)) {
      throw new Error(`${spec.kind} "${spec.name}" takes one object-shaped input mapping.`);
    }
    for (const key of Object.keys(input)) {
      if (!spec.inputs.includes(key)) {
        throw new Error(
          `${spec.kind} "${spec.name}": "${key}" is not an input; expected (${spec.inputs.join(", ")}).`,
        );
      }
    }
    for (const inputName of spec.inputs) {
      if (!(inputName in input)) {
        throw new Error(`${spec.kind} "${spec.name}": required input "${inputName}" is missing.`);
      }
    }
    return spec.fuse(ref, input);
  }) as Ref;
  Object.defineProperties(ref, {
    [spec.nameKey]: { value: spec.name, enumerable: true },
    ins: { value: [...spec.inputs], enumerable: true },
    inputVars: { value: [...spec.inputVars], enumerable: false },
    [spec.payloadKey]: { value: spec.payload, enumerable: false },
  });
  return ref;
}
