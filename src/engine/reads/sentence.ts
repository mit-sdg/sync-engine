/** Binding bags and callable references shared by views and formers. */

import type { Mapping } from "@engine/reactions/types";
import { isPlainMapping } from "./matchers.ts";
import type { BindingKind, BindingVariables } from "./type-inference.ts";

/** One independently declared binding bag. */
export type InputBindings = BindingVariables<"input">;
export type OutputBindings = BindingVariables<"output">;
export type FreeBindings = BindingVariables<"free">;

interface BindingBag<Kind extends BindingKind> {
  readonly vars: BindingVariables<Kind>;
  readonly minted: Map<string, symbol>;
}

/**
 * Create one logic-variable selector. Repeated selection of one name returns
 * the same symbol; separate selectors keep declaration partitions visible.
 */
export function bindingBag<Kind extends BindingKind>(): BindingBag<Kind> {
  const minted = new Map<string, symbol>();
  const variable = (name: string): symbol => {
    let existing = minted.get(name);
    if (existing === undefined) {
      existing = Symbol(name);
      minted.set(name, existing);
    }
    return existing;
  };
  const vars = (...names: string[]): symbol | Record<string, symbol> => {
    if (names.length === 0 || names.some((name) => typeof name !== "string" || name === "")) {
      throw new Error("A binding selector takes one or more non-empty names.");
    }
    if (names.length === 1) return variable(names[0]);
    return Object.fromEntries(names.map((name) => [name, variable(name)]));
  };
  return { vars: vars as BindingVariables<Kind>, minted };
}

/** Reject one declared name appearing in two binding partitions. */
export function assertSeparateBags(
  kind: string,
  name: string,
  bags: ReadonlyArray<readonly [label: string, names: Iterable<string>]>,
): void {
  const seen = new Map<string, string>();
  for (const [label, minted] of bags) {
    for (const binding of minted) {
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
interface ObjectRefSpec<Ref, Fused> {
  kind: string;
  name: string;
  inputs: readonly string[];
  nameKey: string;
  properties: PropertyDescriptorMap;
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
    ...spec.properties,
  });
  return ref;
}
