/**
 * Validate declared endpoint input for both direct invocation and the gateway.
 * The input must be an object containing each required key; explicit `null`
 * counts as present. Declared defaults fill absent keys. Both callers reuse the
 * same failure detail.
 */

import type { InputContractDecl } from "./endpoints.ts";

export type AdmitResult =
  | { ok: true; admitted: Record<string, unknown> }
  | { ok: false; detail: string };

/** Check `input` against `contract` and name `path` in every failure. */
export function admitInput(contract: InputContractDecl, path: string, input: unknown): AdmitResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, detail: `${path} requires a JSON object` };
  }
  const body = input as Record<string, unknown>;
  for (const key of contract.required ?? []) {
    if (!Object.hasOwn(body, key)) {
      return { ok: false, detail: `${path} requires "${key}"` };
    }
  }
  return { ok: true, admitted: { ...contract.defaults, ...body } };
}
