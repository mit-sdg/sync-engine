/**
 * Small, Bun-native utilities shared across the engine.
 *
 * The engine deliberately avoids Node's `node:*` modules so that it reads as
 * idiomatic Bun. Both helpers below have native global / `Bun.*` equivalents.
 */

/**
 * Symbol used to install a custom inspection representation on a value.
 *
 * This is the same well-known symbol that `console.log` (and `Bun.inspect`)
 * honour to render a value, exposed here under one name so callers don't have
 * to reach into `Bun.inspect.custom` directly.
 */
export const inspectCustom = Bun.inspect.custom;

/**
 * Format a value for human-readable logs using Bun's native inspector.
 *
 * Used wherever the engine previously relied on `node:util`'s `inspect`.
 */
export function inspect(value: unknown): string {
  return Bun.inspect(value);
}

/** Generate a fresh, globally-unique identifier (native `crypto.randomUUID`). */
export function uuid(): string {
  return crypto.randomUUID();
}
