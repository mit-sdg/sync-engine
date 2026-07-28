/** A schema-library-neutral runtime check. Validators inspect but do not transform values. */
export type ValidationResult = { ok: true } | { ok: false; detail?: string };

export type EndpointValidator = (value: unknown) => ValidationResult;

export interface EndpointValidators {
  readonly input?: EndpointValidator;
  readonly output?: EndpointValidator;
}

export type RuntimeValidation =
  | { ok: true }
  | { ok: false; detail?: string; errorClass: "ValidationFailure" | "ValidatorFault" };

export function validateRuntimeValue(
  validator: EndpointValidator,
  value: unknown,
): RuntimeValidation {
  try {
    const result = validator(value);
    if (result?.ok === true) return { ok: true };
    return {
      ok: false,
      errorClass: "ValidationFailure",
      ...(typeof result?.detail === "string" ? { detail: result.detail } : {}),
    };
  } catch {
    return { ok: false, errorClass: "ValidatorFault" };
  }
}

export function assertEndpointValidators(value: EndpointValidators, path: string): void {
  if (value === null || typeof value !== "object") {
    throw new Error(`endpoint(...): validators for "${path}" must be an object.`);
  }
  for (const kind of ["input", "output"] as const) {
    const validator = value[kind];
    if (validator !== undefined && typeof validator !== "function") {
      throw new Error(`endpoint(...): ${kind} validator for "${path}" must be a function.`);
    }
  }
}
