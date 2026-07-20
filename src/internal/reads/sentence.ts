/** Shared slot parsing and callable-reference construction for views and formers. */

import type { Mapping, Vars } from "../reactions/types.ts";
import { isPlainMapping } from "./matchers.ts";

const SLOT = /\(([^()]*)\)/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function slotsOf(sentence: string): string[] {
  const slots: string[] = [];
  for (const match of sentence.matchAll(SLOT)) {
    const slot = match[1].trim();
    if (slot === "") continue;
    if (!IDENTIFIER.test(slot)) {
      throw new Error(`Sentence "${sentence}": slot "(${match[1]})" is not a single name.`);
    }
    if (slots.includes(slot)) {
      throw new Error(`Sentence "${sentence}": slot "(${slot})" appears twice.`);
    }
    slots.push(slot);
  }
  return slots;
}

/**
 * Return a logic-variable proxy and the symbols it created. Repeated access to
 * one name returns the same symbol, so slots and local bindings use the same
 * representation.
 */
export function sentenceVars(): { vars: Vars; minted: Map<string, symbol> } {
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
  return { vars, minted };
}

/**
 * Resolve each slot to the variable its builder minted. A slot the builder
 * never read is a definition error — `kind` names the definition ("View" /
 * "Former") and `verb` what its slots are meant to do ("constrains" /
 * "shapes") in that error.
 */
export function slotVariables(
  kind: string,
  sentence: string,
  slots: readonly string[],
  minted: Map<string, symbol>,
  verb: string,
): symbol[] {
  return slots.map((slot) => {
    const variable = minted.get(slot);
    if (variable === undefined) {
      throw new Error(
        `${kind} "${sentence}": slot "(${slot})" is never used — a slot that ${verb} ` +
          "nothing does not belong in the sentence.",
      );
    }
    return variable;
  });
}

/** The parts a finished sentence needs to become its callable reference. */
export interface SentenceRefSpec<Ref, Fused> {
  /** The definition's word, for the arity error: "View" / "Former". */
  kind: string;
  sentence: string;
  slots: readonly string[];
  slotVars: readonly symbol[];
  /** The property the ref carries its name under: "viewName" / "formerName". */
  nameKey: string;
  /** The property the ref carries its tree under: "alternatives" / "body". */
  payloadKey: string;
  payload: unknown;
  /** Fuse the finished ref with a slot mapping — `fuseView` / `fuseFormer`. */
  fuse: (ref: Ref, input: Mapping) => Fused;
  /**
   * Answer a sentence-view call whose one argument maps slot names to values.
   * When absent for a former, every call fills slots positionally.
   */
  line?: (ref: Ref, input: Mapping) => unknown;
}

/**
 * Build the callable reference a defined sentence becomes: called with its
 * slot values (arity-checked, filled positionally into a slot mapping) it
 * fuses, and it carries its name, slots, slot variables, and payload as
 * inspectable properties.
 */
export function sentenceRef<Ref extends (...slotValues: unknown[]) => Fused, Fused>(
  spec: SentenceRefSpec<Ref, Fused>,
): Ref {
  const ref = ((...slotValues: unknown[]): Fused => {
    if (spec.line !== undefined && slotValues.length === 1 && isPlainMapping(slotValues[0])) {
      return spec.line(ref, slotValues[0]) as Fused;
    }
    if (slotValues.length !== spec.slots.length) {
      throw new Error(
        `${spec.kind} "${spec.sentence}" takes ${spec.slots.length} slot value(s) ` +
          `(${spec.slots.join(", ")}), got ${slotValues.length}.`,
      );
    }
    const input: Mapping = {};
    spec.slots.forEach((slot, index) => {
      input[slot] = slotValues[index];
    });
    return spec.fuse(ref, input);
  }) as Ref;
  Object.defineProperties(ref, {
    [spec.nameKey]: { value: spec.sentence, enumerable: true },
    slots: { value: [...spec.slots], enumerable: true },
    slotVars: { value: [...spec.slotVars], enumerable: false },
    [spec.payloadKey]: { value: spec.payload, enumerable: false },
  });
  return ref;
}
