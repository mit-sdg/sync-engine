/**
 * Value matchers usable inside `when` patterns: `oneOf(...)` is a closed
 * equality disjunction, serializable as data.
 */

import type { Matcher, Mapping } from "../reactions/types.ts";
import { brand, hasBrand } from "./brands.ts";

const MatcherBrand: unique symbol = Symbol("MatcherBrand");

/** Create an inspectable equality matcher. */
export function oneOf(...candidates: unknown[]): Matcher {
  if (candidates.length === 0) throw new Error("oneOf(...) requires at least one candidate.");
  const node = {
    kind: "oneOf",
    candidates,
    label: `oneOf(${candidates.map(String).join(", ")})`,
  } as unknown as Matcher;
  return brand(node, MatcherBrand);
}

/** Whether a value is a matcher built by this module. */
export function isMatcher(value: unknown): value is Matcher {
  return hasBrand(value, MatcherBrand);
}

/** Convenience guard for pattern walkers: a plain string-keyed mapping. */
export function isPlainMapping(value: unknown): value is Mapping {
  if (value === null || typeof value !== "object") return false;
  if (isMatcher(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
