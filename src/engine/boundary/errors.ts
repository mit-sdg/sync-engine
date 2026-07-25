import { FrameworkErrorCode as Codes } from "@engine/utils/framework-error-codes";
import type {
  EmittedFrameworkErrorCode,
  FrameworkErrorCode as FrameworkErrorCodeValue,
} from "@engine/utils/framework-error-codes";

export type InvocationResult<TOutput = unknown, TDomainError = unknown> =
  | { ok: true; value: TOutput }
  | {
      ok: false;
      error:
        | { kind: "domain"; value: TDomainError }
        | { kind: "framework"; code: EmittedFrameworkErrorCode; detail?: string };
    };

export const FrameworkErrorCode = Codes;
export type FrameworkErrorCode = FrameworkErrorCodeValue;
export type { EmittedFrameworkErrorCode };

/** Internal request-boundary tag used to keep framework faults out of domain errors. */
export const FRAMEWORK_ERROR_KIND_FIELD = "errorKind";

export function success<T>(value: T): InvocationResult<T, never> {
  return { ok: true, value };
}

export function domainError<E>(value: E): InvocationResult<never, E> {
  return { ok: false, error: { kind: "domain", value } };
}

export function frameworkError(
  code: EmittedFrameworkErrorCode,
  detail?: string,
): InvocationResult<never, never> {
  return { ok: false, error: { kind: "framework", code, detail } };
}
