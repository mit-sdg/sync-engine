/**
 * An application-supplied, schema-library-neutral runtime check. Validators are
 * never inferred from concept specification prose and do not transform values.
 */
export type ValidationResult = { ok: true } | { ok: false; detail?: string };

export type EndpointValidator = (value: unknown) => ValidationResult;

export interface EndpointValidators {
  readonly input?: EndpointValidator;
  readonly output?: EndpointValidator;
  readonly domainError?: EndpointValidator;
}

type RuntimeValidation =
  | { ok: true }
  | { ok: false; detail?: string; errorClass: "ValidationFailure" }
  | { ok: false; errorClass: "ValidatorFault"; fault: unknown };

export function validateRuntimeValue(
  validator: EndpointValidator,
  value: unknown,
): RuntimeValidation {
  try {
    const result = validator(value);
    const promise = normalizePromiseLike(result);
    if (promise !== undefined) {
      void promise.catch(() => undefined);
      return { ok: false, errorClass: "ValidationFailure" };
    }
    if (result?.ok === true) return { ok: true };
    return {
      ok: false,
      errorClass: "ValidationFailure",
      ...(typeof result?.detail === "string" ? { detail: result.detail } : {}),
    };
  } catch (error) {
    return { ok: false, errorClass: "ValidatorFault", fault: error };
  }
}

export function assertEndpointValidators(value: EndpointValidators, path: string): void {
  if (value === null || typeof value !== "object") {
    throw new Error(`endpoint(...): validators for "${path}" must be an object.`);
  }
  for (const kind of ["input", "output", "domainError"] as const) {
    const validator = value[kind];
    if (validator !== undefined && typeof validator !== "function") {
      throw new Error(`endpoint(...): ${kind} validator for "${path}" must be a function.`);
    }
  }
}
import { normalizePromiseLike } from "@engine/utils/promise-like";
