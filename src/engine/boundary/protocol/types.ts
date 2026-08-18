import { FrameworkErrorCode as Codes } from "@engine/utils/framework-error-codes";
import type { FrameworkErrorCode as FrameworkErrorCodeValue } from "@engine/utils/framework-error-codes";
import type { InputContractDecl } from "./endpoints.ts";

/** The structural shape accepted by typed boundary clients and invokers. */
export type ContractShape = Record<string, { input: unknown; output: unknown; error?: unknown }>;

/** The value carried inside a wire error envelope. */
export type DomainErrorValue<T> = T extends { error: infer E } ? E : T;

/**
 * The application facts a gateway may rely on. It deliberately contains no
 * concepts, reactions, engine instance, or transport details.
 */
export interface ApplicationInterface {
  readonly routes: Readonly<Record<string, InputContractDecl>>;
  readonly prefixes?: Readonly<Record<string, InputContractDecl>>;
}

export type InvocationResult<TOutput = unknown, TDomainError = unknown> =
  | { ok: true; value: TOutput }
  | {
      ok: false;
      error:
        | { kind: "domain"; value: TDomainError }
        | { kind: "framework"; code: FrameworkErrorCodeValue; detail?: string };
    };

export const FrameworkErrorCode = Codes;
export type FrameworkErrorCode = FrameworkErrorCodeValue;

const frameworkErrorCodes = new Set<string>(Object.values(FrameworkErrorCode));

export function isFrameworkErrorCode(value: unknown): value is FrameworkErrorCodeValue {
  return typeof value === "string" && frameworkErrorCodes.has(value);
}

export function success<T>(value: T): InvocationResult<T, never> {
  return { ok: true, value };
}

export function domainError<E>(value: E): InvocationResult<never, E> {
  return { ok: false, error: { kind: "domain", value } };
}

export function frameworkError(
  code: FrameworkErrorCodeValue,
  detail?: string,
): InvocationResult<never, never> {
  return { ok: false, error: { kind: "framework", code, detail } };
}
