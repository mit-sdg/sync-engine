/**
 * One home for the flat wire envelope: the JSON body a transport carries in
 * place of an {@link InvocationResult}, and the reading that recovers a result
 * from a respond output or wire reply. A success is its bare value; an error
 * is `{ error }` — a domain value that already spells itself as an error
 * envelope passes through untouched, a framework code carries its optional
 * `detail`. The distinction the flat form drops (domain vs framework) is
 * carried on the way back by the internal `errorKind` tag when present.
 */

import { domainError, FRAMEWORK_ERROR_KIND_FIELD, frameworkError, success } from "./errors.ts";
import type { EmittedFrameworkErrorCode, InvocationResult } from "./errors.ts";

/**
 * An {@link InvocationResult} as its flat wire body: the success value bare,
 * a domain value as-is when it already reads as an error envelope (else
 * wrapped in `{ error }`), a framework code as `{ error, detail? }`.
 */
export function toEnvelope(result: InvocationResult): unknown {
  if (result.ok) return result.value;
  if (result.error.kind === "domain") {
    const value = result.error.value;
    return typeof value === "object" && value !== null && "error" in value
      ? value
      : { error: value };
  }
  return {
    error: result.error.code,
    ...(result.error.detail !== undefined ? { detail: result.error.detail } : {}),
  };
}

/** Serialize a value with the same JSON rules used by the HTTP boundary. */
export function serializeJsonValue(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("A boundary value must be representable as JSON.");
  }
  return serialized;
}

/** Apply the HTTP boundary's JSON projection to an in-process value. */
export function toJsonValue(value: unknown): unknown {
  return JSON.parse(serializeJsonValue(value)) as unknown;
}

/** Serialize one result exactly as the HTTP boundary carries it. */
export function serializeEnvelope(result: InvocationResult): string {
  return serializeJsonValue(toEnvelope(result));
}

/** Apply the HTTP boundary's JSON projection to an in-process result. */
export function toJsonEnvelope(result: InvocationResult): unknown {
  return toJsonValue(toEnvelope(result));
}

/**
 * A respond output or wire reply read back as an {@link InvocationResult}: the
 * internal `errorKind` tag names a framework fault, a bare `error` key names a
 * domain error, and anything else is the success body.
 */
export function fromEnvelope(output: Record<string, unknown>): InvocationResult {
  if (output[FRAMEWORK_ERROR_KIND_FIELD] === "framework" && typeof output.error === "string") {
    return frameworkError(output.error as EmittedFrameworkErrorCode);
  }
  if (typeof output === "object" && output !== null && "error" in output) {
    return domainError(output.error);
  }
  return success(output);
}
