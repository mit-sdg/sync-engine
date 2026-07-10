export type InvocationResult<TOutput = unknown, TDomainError = unknown> =
  | { ok: true; value: TOutput }
  | {
      ok: false;
      error:
        | { kind: "domain"; value: TDomainError }
        | { kind: "framework"; code: FrameworkErrorCode; detail?: string };
    };

export const FrameworkErrorCode = {
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_OUTPUT: "INVALID_OUTPUT",
  NOT_FOUND: "NOT_FOUND",
  TIMED_OUT: "TIMED_OUT",
  MULTIPLE_RESPONSES: "MULTIPLE_RESPONSES",
  TRANSPORT_ERROR: "TRANSPORT_ERROR",
  BAD_STATUS: "BAD_STATUS",
  BAD_RESPONSE: "BAD_RESPONSE",
  NETWORK_ERROR: "NETWORK_ERROR",
  BAD_JSON: "BAD_JSON",
  HEADER_RESOLUTION_FAILED: "HEADER_RESOLUTION_FAILED",
} as const;

export type FrameworkErrorCode = (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode];

export function success<T>(value: T): InvocationResult<T, never> {
  return { ok: true, value };
}

export function domainError<E>(value: E): InvocationResult<never, E> {
  return { ok: false, error: { kind: "domain", value } };
}

export function frameworkError(
  code: FrameworkErrorCode,
  detail?: string,
): InvocationResult<never, never> {
  return { ok: false, error: { kind: "framework", code, detail } };
}
