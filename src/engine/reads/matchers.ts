import type { Mapping } from "@engine/reactions/types";

/** Convenience guard for pattern walkers: a plain string-keyed mapping. */
export function isPlainMapping(value: unknown): value is Mapping {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
