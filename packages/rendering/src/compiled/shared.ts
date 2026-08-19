// Formation machinery shared by the presentation-family compilers. Each family
// owns its placement language and formed output; portable-value comparison,
// canonicalization, and query-owned row identity are one implementation.

import type { RendererRead } from "../language/renderer.ts";

export function samePortableValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => samePortableValue(entry, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort((a, b) => a.localeCompare(b));
  const rightKeys = Object.keys(rightRecord).sort((a, b) => a.localeCompare(b));
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && samePortableValue(leftRecord[key], rightRecord[key]),
    )
  );
}

export function canonicalPortable(value: unknown, path = "identity"): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalPortable(entry, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${path} contains a non-portable ${typeof value} value.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object.`);
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [
        key,
        canonicalPortable((value as Record<string, unknown>)[key], `${path}.${key}`),
      ]),
  );
}

export function hex(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Resolve one answered row's query-owned identity: the address segment for the
 * row and, when the query promises identity, its canonical key. Duplicate
 * identities and missing identity fields are refused at the caller's site.
 */
export function identifyRow(
  read: Pick<RendererRead, "concept" | "query" | "identity">,
  cardinality: "each" | "where",
  record: Record<string, unknown>,
  rowIndex: number,
  identities: Set<string>,
  site: string,
): { readonly segment: string; readonly key?: string } {
  if (cardinality === "each" && read.identity !== undefined) {
    for (const field of read.identity) {
      if (!Object.hasOwn(record, field)) {
        throw new TypeError(
          `${site}: ${read.concept}.${read.query} row ${rowIndex + 1} has no identity field ${JSON.stringify(field)}.`,
        );
      }
    }
    const key = JSON.stringify(canonicalPortable(read.identity.map((field) => record[field])));
    if (identities.has(key)) {
      throw new TypeError(
        `${site}: ${read.concept}.${read.query} answered duplicate row identity.`,
      );
    }
    identities.add(key);
    return { segment: `key-${hex(key)}`, key };
  }
  return { segment: cardinality === "where" ? "present" : `index-${rowIndex}` };
}
