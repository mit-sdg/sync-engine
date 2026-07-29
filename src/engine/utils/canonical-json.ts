import { ordinal } from "./ordinal.ts";
import { setOwn } from "./own-property.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Validate and copy a value into canonical key order without reordering arrays. */
export function canonicalValue(value: unknown): JsonValue {
  return canonicalize(value, new WeakSet(), "$", false) as JsonValue;
}

function canonicalize(
  value: unknown,
  seen: WeakSet<object>,
  path: string,
  inArray: boolean,
): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return value;
  }
  if (value === undefined && !inArray) return undefined;
  if (typeof value !== "object") {
    throw new TypeError(`${path} contains a non-JSON ${typeof value} value.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        const projected = canonicalize(entry, seen, `${path}[${index}]`, true);
        if (projected === undefined) {
          throw new TypeError(`${path}[${index}] contains undefined.`);
        }
        return projected;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-plain object.`);
    }
    const projected: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort(ordinal)) {
      const entry = canonicalize(
        (value as Record<string, unknown>)[key],
        seen,
        `${path}.${key}`,
        false,
      );
      if (entry !== undefined) setOwn(projected, key, entry);
    }
    return projected;
  } finally {
    seen.delete(value);
  }
}

/** Canonical UTF-16 JSON with a final newline for files and standard output. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

/**
 * Strict design-time equality over the canonical JSON projection: symbol
 * keys and `undefined` entries drop out, and non-JSON values throw. For
 * lenient equality over live runtime values, see `structurallyEqual` in the
 * reads value-equality module.
 */
export function canonicallyEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

/** A deterministic content identifier for canonical design data. */
export function canonicalDigest(value: unknown): string {
  const text = canonicalJson(value);
  let high = 0x811c9dc5;
  let low = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193) >>> 0;
    low = Math.imul(low ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `fnv1a64-${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}
