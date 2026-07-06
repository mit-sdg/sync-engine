import { inspect as nodeInspect } from "node:util";

/**
 * Symbol used to install a custom inspection representation on a value.
 *
 * This is the same well-known symbol that `console.log` honours to render a
 * value, exposed here under one name so callers don't have to reach into
 * `util.inspect.custom` directly.
 */
export const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

/**
 * Format a value for human-readable logs using Node's util.inspect.
 */
export function inspect(value: unknown): string {
  return nodeInspect(value, { colors: true, depth: null });
}

/** Generate a fresh, globally-unique identifier (native `crypto.randomUUID`). */
export function uuid(): string {
  return crypto.randomUUID();
}
