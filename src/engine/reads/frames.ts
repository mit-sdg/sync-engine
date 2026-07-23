/**
 * {@link Frames} — the working set of a reaction.
 *
 * A *frame* is one row of variable bindings (keyed by `symbol`). A `Frames`
 * value is an ordered bag of such rows and behaves like a relational
 * intermediate result: `when` matching produces it, `where` transforms it, and
 * `then` consumes it.
 *
 * `Frames` extends `Array` and is wrapped in a `Proxy` so that every standard
 * array method which returns a new array (`map`, `filter`, `flatMap`, `slice`,
 * `concat`, `reverse`, `sort`, `splice`, …) transparently returns a `Frames`
 * again, keeping the fluent API closed over the type.
 */
import type { Frame, Mapping } from "../reactions/types.ts";
import { structurallyEqual } from "./value-equality.ts";
import { hasMarkerKey, isVarIR } from "./ir.ts";

/**
 * The frame key a variable leaf binds under: a symbol for authored
 * (pipeline-path) variables, the name itself for an IR `{ $var }` marker,
 * `undefined` for anything that is not a variable.
 */
export function varKeyOf(leaf: unknown): string | symbol | undefined {
  if (typeof leaf === "symbol") return leaf;
  if (isVarIR(leaf)) return leaf.$var;
  return undefined;
}

/**
 * Read one pattern value against a frame: a variable (either leaf world)
 * resolves to its binding — `undefined` when unbound — and a literal is
 * itself, with the IR's `$lit` escape unwrapped.
 */
export function readPatternValue(
  value: unknown,
  frame: Frame,
): { isVariable: boolean; bound?: boolean; value: unknown } {
  const key = varKeyOf(value);
  if (key !== undefined) {
    return { isVariable: true, bound: key in frame, value: frame[key] };
  }
  if (typeof value === "object" && value !== null && hasMarkerKey(value, "$lit")) {
    return { isVariable: false, value: (value as { $lit: unknown }).$lit };
  }
  return { isVariable: false, value };
}

export interface Frames<TFrame extends Frame = Frame> {
  map<U extends Frame>(
    callbackfn: (value: TFrame, index: number, array: TFrame[]) => U,
    thisArg?: unknown,
  ): Frames<U>;
  map<U>(callbackfn: (value: TFrame, index: number, array: TFrame[]) => U, thisArg?: unknown): U[];
  filter<S extends TFrame>(
    predicate: (value: TFrame, index: number, array: TFrame[]) => value is S,
    thisArg?: unknown,
  ): Frames<S>;
  filter(
    predicate: (value: TFrame, index: number, array: TFrame[]) => boolean,
    thisArg?: unknown,
  ): this;

  flatMap<U extends Frame>(
    callback: (value: TFrame, index: number, array: TFrame[]) => U | ReadonlyArray<U>,
    thisArg?: unknown,
  ): Frames<U>;
  flatMap<U>(
    callback: (value: TFrame, index: number, array: TFrame[]) => U | ReadonlyArray<U>,
    thisArg?: unknown,
  ): U[];

  find<S extends TFrame>(
    predicate: (value: TFrame, index: number, array: TFrame[]) => value is S,
    thisArg?: unknown,
  ): S | undefined;
  find(
    predicate: (value: TFrame, index: number, array: TFrame[]) => boolean,
    thisArg?: unknown,
  ): TFrame | undefined;

  slice(start?: number, end?: number): this;

  concat(...items: ConcatArray<TFrame>[]): this;
  concat(...items: (TFrame | ConcatArray<TFrame>)[]): this;

  reverse(): this;
  sort(compareFn?: (a: TFrame, b: TFrame) => number): this;

  splice(start: number, deleteCount?: number): Frames<TFrame>;
  splice(start: number, deleteCount: number, ...items: TFrame[]): Frames<TFrame>;
}

/**
 * Resolve a query's `input` mapping against a single frame.
 *
 * Symbol values are looked up in the frame (and must be bound — an unbound
 * symbol is a programming error); literal values pass through unchanged.
 * Shared by where ops and formers.
 */
export function bindInputMapping(frame: Frame, input: Mapping): Mapping {
  const bound: Mapping = {};
  for (const [key, binding] of Object.entries(input)) {
    const read = readPatternValue(binding, frame);
    if (read.isVariable) {
      if (read.bound) bound[key] = read.value;
    } else {
      bound[key] = read.value;
    }
  }
  return bound;
}

/**
 * Expand one source frame by a query's result rows into the accumulator.
 *
 * Each row yields a fresh frame extending `frame` with the `output` symbol
 * bindings — and bindings **unify**: a fresh variable binds the row's value,
 * while an already-bound variable is an equality test, and a row whose value
 * differs contributes nothing. This is the binding behavior used by a line
 * ("an already-bound name tests equality instead"), and the same discipline
 * trigger patterns keep. A query that returns no unifiable rows contributes
 * nothing — the source frame is dropped, giving inner-join / fan-out
 * semantics.
 */
export function expandOutputRows(
  into: Frames,
  frame: Frame,
  rows: unknown[],
  output: Mapping,
): void {
  for (const row of rows) {
    const newFrame: Frame = { ...frame };
    let unifies = true;
    for (const [outputKey, pattern] of Object.entries(output)) {
      if (row === null || typeof row !== "object" || !(outputKey in row)) {
        unifies = false;
        break;
      }
      const rowValue = (row as Record<string, unknown>)[outputKey];
      const key = varKeyOf(pattern);
      if (key !== undefined) {
        if (key in frame && !structurallyEqual(frame[key], rowValue)) {
          unifies = false;
          break;
        }
        newFrame[key] = rowValue;
      } else if (!structurallyEqual(readPatternValue(pattern, frame).value, rowValue)) {
        unifies = false;
        break;
      }
    }
    if (unifies) into.push(newFrame);
  }
}

export { structurallyEqual } from "./value-equality.ts";

/** Keep the first occurrence of each structurally equal frame. */
export function distinctFrames(frames: Frames): Frames {
  const distinct = new Frames();
  for (const frame of frames) {
    if (![...distinct].some((prior) => structurallyEqual(prior, frame))) distinct.push(frame);
  }
  return distinct;
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The interface overloads Array methods so fluent frame transforms keep their narrowed return types.
export class Frames<TFrame extends Frame = Frame> extends Array<TFrame> {
  constructor(...frames: TFrame[]) {
    super(...frames);
    // Re-wrap array-returning methods so the fluent API stays a `Frames`.
    // biome-ignore lint/correctness/noConstructorReturn: Returning this proxy keeps built-in Array methods closed over Frames.
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") {
          return value;
        }
        return function (this: Frames<TFrame>, ...args: unknown[]) {
          const result = value.apply(this, args);
          if (Array.isArray(result) && !(result instanceof Frames)) {
            return new Frames(...result);
          }
          return result;
        };
      },
    });
  }
}
