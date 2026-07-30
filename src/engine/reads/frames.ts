/**
 * {@link Frames} — the working set of a reaction.
 *
 * A *frame* is one row of variable bindings (keyed by `symbol`). A `Frames`
 * value is an ordered bag of such rows and behaves like a relational
 * intermediate result: `when` matching produces it, `where` transforms it, and
 * `then` consumes it.
 *
 * `Frames` extends `Array`, so every standard array method which returns a new
 * array (`map`, `filter`, `flatMap`, `slice`, `concat`, `reverse`, `sort`,
 * `splice`, …) transparently returns a `Frames` again through the default
 * species constructor, keeping the fluent API closed over the type.
 */
import type { Frame, Mapping } from "@engine/reactions/types";
import { structurallyEqual } from "./value-equality.ts";
import { hasMarkerKey, isVarIR } from "./ir.ts";
import { setOwn } from "@engine/utils/own-property";

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
    const bound = Object.hasOwn(frame, key);
    return { isVariable: true, bound, value: bound ? frame[key] : undefined };
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
 * Variable values are looked up in the frame; unbound variables are omitted
 * so callers can distinguish absent optional inputs. Literals pass through.
 * Shared by where ops and formers.
 */
export function bindInputMapping(frame: Frame, input: Mapping): Mapping {
  const bound: Mapping = {};
  for (const [key, binding] of Object.entries(input)) {
    const read = readPatternValue(binding, frame);
    if (!read.isVariable || read.bound) {
      setOwn(bound, key, read.value);
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
      if (row === null || typeof row !== "object" || !Object.hasOwn(row, outputKey)) {
        unifies = false;
        break;
      }
      const rowValue = (row as Record<string, unknown>)[outputKey];
      const key = varKeyOf(pattern);
      if (key !== undefined) {
        if (Object.hasOwn(newFrame, key) && !structurallyEqual(newFrame[key], rowValue)) {
          unifies = false;
          break;
        }
        setOwn(newFrame, key, rowValue);
      } else if (!structurallyEqual(readPatternValue(pattern, frame).value, rowValue)) {
        unifies = false;
        break;
      }
    }
    if (unifies) into.push(newFrame);
  }
}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The interface overloads Array methods so fluent frame transforms keep their narrowed return types.
export class Frames<TFrame extends Frame = Frame> extends Array<TFrame> {}
