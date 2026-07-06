export function serializeError(err: unknown, depth = 0): Record<string, unknown> {
  if (depth > 10) return { message: "[max error depth]" };
  if (err instanceof Error) {
    const result: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if (err.cause) {
      result.cause = serializeError(err.cause, depth + 1);
    }
    return result;
  }
  return { message: String(err) };
}

/**
 * Credential-shaped key patterns that are sensitive in *any* application,
 * independent of domain. These always apply — even before an app registers
 * its policy — so a framework consumer that forgets to configure redaction
 * still never leaks a password, token, or API key.
 */
export const UNIVERSAL_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /session/i,
  /auth/i,
  /api[_-]?key/i,
];

/**
 * An application's domain redaction policy: the exact field names and any
 * extra patterns that are sensitive in *this* domain (e.g. PII, financials).
 * The framework owns only the universal credential patterns; the policy is
 * injected once at bootstrap via {@link configureRedaction}.
 */
export interface RedactionPolicy {
  /** Exact field names to redact, matched case-insensitively. */
  fields?: Iterable<string>;
  /** Domain patterns to redact, applied on top of the universal set. */
  patterns?: readonly RegExp[];
}

// Active policy. Defaults to the universal patterns only; the app extends it
// once at bootstrap. The universal patterns are always honored.
let policyFields: ReadonlySet<string> = new Set();
let policyPatterns: readonly RegExp[] = UNIVERSAL_SENSITIVE_PATTERNS;

/**
 * Register the application's domain redaction policy. Call once at bootstrap,
 * before any logging or journal sanitization. Idempotent: a later call simply
 * replaces the registered domain policy; the universal patterns persist.
 */
export function configureRedaction(policy: RedactionPolicy): void {
  policyFields = new Set(Array.from(policy.fields ?? [], (field) => field.toLowerCase()));
  policyPatterns = [...UNIVERSAL_SENSITIVE_PATTERNS, ...(policy.patterns ?? [])];
}

function isSensitive(key: string): boolean {
  if (policyFields.has(key.toLowerCase())) return true;
  return policyPatterns.some((pattern) => pattern.test(key));
}

export function redact(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[max depth]";
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Error) return serializeError(obj);
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
