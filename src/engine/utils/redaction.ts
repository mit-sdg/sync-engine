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
 * Return the stable class of a thrown value for an ordinary log.
 *
 * Messages, stacks, causes, and attached fields are deliberately omitted:
 * exception text can contain credentials, private paths, request URLs, or
 * attacker-controlled input. A value thrown without `Error` supplies no safe
 * class and is identified only as `NonErrorThrown`.
 */
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

// The current domain policy used by redact().
let policyFields: ReadonlySet<string> = new Set();
let policyPatterns: readonly RegExp[] = UNIVERSAL_SENSITIVE_PATTERNS;

/**
 * Replace the domain field-name policy used by subsequent {@link redact}
 * calls. The default field-name patterns remain active.
 */
export function configureRedaction(policy: RedactionPolicy): void {
  let fields: string[] = [];
  try {
    fields = Array.from(policy.fields ?? [], (field) => String(field).toLowerCase());
  } catch {
    // Non-iterable fields value — ignore.
  }
  policyFields = new Set(fields);
  policyPatterns = [...UNIVERSAL_SENSITIVE_PATTERNS, ...(policy.patterns ?? [])];
}

function isSensitive(key: string): boolean {
  if (policyFields.has(key.toLowerCase())) return true;
  return policyPatterns.some((pattern) => new RegExp(pattern).test(key));
}

export function redact(obj: unknown, depth = 0): unknown {
  if (obj === undefined) return undefined;
  return redactValue(obj, depth, new WeakSet());
}

/** Project arbitrary diagnostic data to a redacted value that JSON can always encode. */
function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > 5) return "[max depth]";
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
          result.push(redactValue(value[index], depth + 1, seen));
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
        result[key] = "[redacted]";
        continue;
      }
      try {
        result[key] = redactValue((value as Record<string, unknown>)[key], depth + 1, seen);
      } catch {
        result[key] = "[unreadable]";
      }
    }
    return result;
  } catch {
    return "[unreadable]";
  }
}
