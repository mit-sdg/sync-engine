/**
 * Declare typed application endpoints over request and response actions.
 * {@link RequestBoundaryActions} describes the required action pair, and the
 * generated `ContractShape` supplies endpoint types to the client.
 */

import type { InstrumentedAction } from "../reactions/types.ts";

// An endpoint may declare required keys and defaults for its input object.
// Admission runs before the request is recorded. Required keys test presence,
// so explicit null passes; concept actions remain responsible for validating
// values. Endpoints without a declaration use their receive pattern.

export interface InputContractDecl {
  /** Keys the body must contain; a missing key returns `INVALID_INPUT`. */
  required?: readonly string[];
  /** Values assigned to declared keys that are absent before invocation. */
  defaults?: Readonly<Record<string, unknown>>;
}

export type Prettify<T> = { [K in keyof T]: T[K] } & {};

// ── Request-boundary actions ─────────────────────────────────────────────

export interface RequestBoundaryActions {
  request: InstrumentedAction;
  respond: InstrumentedAction;
}

// ── renderInputContracts — the contracts as a spec section ──────────────

/**
 * Render declared input contracts as a Markdown section in the generated
 * assembled read-back.
 */
export function renderInputContracts(contracts: Record<string, InputContractDecl>): string {
  const paths = Object.keys(contracts).sort();
  if (paths.length === 0) return "";
  const lines: string[] = [
    "## Endpoint input contracts",
    "",
    "Before recording an action ask, the boundary rejects a body that is not an",
    "object or lacks a required key. The response uses `INVALID_INPUT` and names",
    "the path or missing key. A declared default fills an absent key. Endpoints",
    "not listed here have no explicit input contract.",
    "",
  ];
  for (const path of paths) {
    const { required = [], defaults = {} } = contracts[path];
    const parts: string[] = [];
    if (required.length > 0) parts.push(`requires ${required.map((k) => `\`${k}\``).join(", ")}`);
    for (const [key, value] of Object.entries(defaults)) {
      parts.push(`fills \`${key}\` with ${JSON.stringify(value)} when absent`);
    }
    if (parts.length > 0) lines.push(`- \`${path}\` — ${parts.join("; ")}`);
  }
  lines.push("");
  return lines.join("\n");
}
