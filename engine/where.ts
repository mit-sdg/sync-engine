/**
 * Composable building blocks for a sync's `where` clause.
 *
 * A `where` is a transform `Frames -> Frames` (optionally async). This module
 * provides the two pieces that the fluent {@link Frames} methods cannot express
 * on their own:
 *
 *  - {@link pipe} — compose several async **gates** left-to-right, so a `where`
 *    reads as a pipeline (`auth.granted`, then validation, then …) instead of
 *    imperative `frames = await gate(frames)` reassignment;
 *  - {@link read} — read a frame binding *typed*, recovering the value's type
 *    from its {@link Var} brand so call sites need no `as` cast.
 *
 * Both are surfaced under the {@link Where} namespace so the short, collision-
 * prone names (`pipe`, `read`) are never exported bare; a file opts in with
 * `const { pipe, read } = Where;`.
 */
import { Frames } from "./frames.ts";
import type { Frame } from "./types.ts";
import type { Var } from "./vars.ts";

/**
 * One stage of a `where` pipeline: a (possibly async) transform over the
 * working set. `auth.granted(...)`, validation lifts, and query steps all share
 * this shape, which is exactly the type a `where` clause itself accepts.
 */
export type Gate = (frames: Frames) => Frames | Promise<Frames>;

/**
 * Compose gates into a single gate that applies each in order, awaiting between
 * stages. With no gates it is the identity transform.
 */
export function pipe(...gates: Gate[]): Gate {
  return async (frames) => {
    let current = frames;
    for (const gate of gates) {
      current = await gate(current);
    }
    return current;
  };
}

/**
 * Read the value bound to `variable` in `frame`, typed as the variable's `T`.
 *
 * SAFETY: a `Var<T>` brands its symbol with the type its binding carries, and
 * the engine only ever binds a variable to a value of that type (request inputs
 * are validated at the boundary before a sync runs). Recovering it as `T` is
 * therefore sound. This is the one documented cast that lets every `where` read
 * frames without a cast of its own; declare optional fields as `T | undefined`
 * so the absence is reflected in the type rather than hidden.
 */
export function read<T>(frame: Frame, variable: Var<T>): T {
  return (frame as Record<symbol, unknown>)[variable] as T;
}

/** The opt-in namespace for the otherwise collision-prone `where` helpers. */
export const Where = { pipe, read } as const;
