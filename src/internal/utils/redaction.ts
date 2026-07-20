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
  if (depth > 5) return "[max depth]";
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Error) return serializeError(obj);
  if (typeof obj === "bigint") return obj.toString();
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => redact(v, depth + 1));
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitive(key)) {
      result[key] = "[redacted]";
    } else if (value instanceof Error) {
      result[key] = serializeError(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = redact(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result;
}
