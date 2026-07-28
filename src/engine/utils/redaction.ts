import { setOwn } from "./own-property.ts";

function stableErrorName(error: Error): string {
  try {
    const constructor = (
      Object.getPrototypeOf(error) as { constructor?: { name?: unknown } } | null
    )?.constructor;
    const name = constructor?.name;
    return typeof name === "string" && /^[A-Za-z_$][\w$]{0,79}$/.test(name) ? name : "Error";
  } catch {
    return "Error";
  }
}

/**
 * Return human-readable text from a thrown value.
 *
 * This text is deliberately not sanitized or redacted. Use it only in a
 * caller-reviewed diagnostic channel, never as an automatic public envelope.
 */
export function describeError(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return "Unknown error";
  }
}

export function serializeError(err: unknown, depth = 0): Record<string, unknown> {
  void depth;
  try {
    return { name: err instanceof Error ? stableErrorName(err) : "NonErrorThrown" };
  } catch {
    return { name: "NonErrorThrown" };
  }
}

/**
 * Default patterns for sensitive field names. These patterns match object
 * keys. They do not inspect string values stored under other field names.
 */
export const UNIVERSAL_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /session/i,
  /auth/i,
  /api[_-]?key/i,
  /setup[_-]?key/i,
];

/**
 * Additional sensitive field names for one application. The default patterns
 * remain active alongside this policy.
 */
export interface RedactionPolicy {
  /** Exact field names to redact, matched case-insensitively. */
  fields?: Iterable<string>;
  /** Regular expressions matched against field names. */
  patterns?: readonly RegExp[];
}

export interface Redactor {
  redact(value: unknown, depth?: number): unknown;
}

function policyParts(policy: RedactionPolicy): {
  fields: ReadonlySet<string>;
  patterns: readonly RegExp[];
} {
  let fields: string[] = [];
  try {
    fields = Array.from(policy.fields ?? [], (field) => String(field).toLowerCase());
  } catch {
    // Non-iterable fields value - ignore.
  }
  return {
    fields: new Set(fields),
    patterns: [...UNIVERSAL_SENSITIVE_PATTERNS, ...(policy.patterns ?? [])],
  };
}

/** Create one immutable application-scoped field-name redactor. */
export function createRedactor(policy: RedactionPolicy = {}): Redactor {
  const { fields, patterns } = policyParts(policy);
  const isSensitive = (key: string): boolean => {
    if (fields.has(key.toLowerCase())) return true;
    return patterns.some((pattern) => {
      const lastIndex = pattern.lastIndex;
      try {
        pattern.lastIndex = 0;
        return pattern.test(key);
      } finally {
        pattern.lastIndex = lastIndex;
      }
    });
  };
  return {
    redact(value, depth = 0) {
      if (value === undefined) return undefined;
      return redactValue(value, depth, new WeakSet(), isSensitive);
    },
  };
}

const standaloneRedactor = createRedactor();

export function redact(obj: unknown, depth = 0): unknown {
  return standaloneRedactor.redact(obj, depth);
}

const MAX_REDACTION_DEPTH = 5;

/** Project arbitrary diagnostic data to a redacted value that JSON can always encode. */
function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  isSensitive: (key: string) => boolean,
): unknown {
  if (depth > MAX_REDACTION_DEPTH) return "[max depth]";
  if (value === null) return null;

  switch (typeof value) {
    case "undefined":
      return "[undefined]";
    case "boolean":
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : `[${String(value)}]`;
    case "bigint":
      return value.toString();
    case "symbol":
      return `[symbol ${value.description ?? ""}]`;
    case "function":
      return "[function]";
    case "object":
      break;
  }

  try {
    if (value instanceof Error) return serializeError(value);
    if (seen.has(value)) return "[circular]";
    seen.add(value);

    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        try {
          result.push(redactValue(value[index], depth + 1, seen, isSensitive));
        } catch {
          result.push("[unreadable]");
        }
      }
      return result;
    }

    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isFinite(time) ? value.toISOString() : "[invalid date]";
    }

    const result: Record<string, unknown> = {};
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      return "[unreadable]";
    }
    for (const key of keys) {
      if (isSensitive(key)) {
        setOwn(result, key, "[redacted]");
        continue;
      }
      try {
        setOwn(
          result,
          key,
          redactValue((value as Record<string, unknown>)[key], depth + 1, seen, isSensitive),
        );
      } catch {
        setOwn(result, key, "[unreadable]");
      }
    }
    return result;
  } catch {
    return "[unreadable]";
  }
}
