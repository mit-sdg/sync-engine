/**
 * {@link Frames} — the working set of a synchronization.
 *
 * A *frame* is one row of variable bindings (keyed by `symbol`). A `Frames`
 * value is an ordered bag of such rows and behaves like a relational
 * intermediate result: `when` matching produces it, `where` transforms it, and
 * `then` consumes it.
 *
 * `Frames` extends `Array` and is wrapped in a `Proxy` so that every standard
 * array method which returns a new array (`map`, `filter`, `flatMap`, `slice`,
 * `concat`, `reverse`, `sort`, `splice`, …) transparently returns a `Frames`
 * again, keeping the fluent API closed over the type. The query helpers
 * (`query` / `queryAsync`) are excluded from this auto-wrapping because they
 * already construct and return `Frames` themselves (possibly inside a Promise).
 */
import type { Frame, Mapping } from "./types.ts";

/** Infers the new frame keys contributed by a query's `output` mapping. */
type ExtractSymbolMappings<TOutputMapping, TFunctionOutput> = {
  [K in keyof TOutputMapping as TOutputMapping[K] extends symbol
    ? TOutputMapping[K]
    : never]: K extends keyof TFunctionOutput ? TFunctionOutput[K] : never;
};

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
    predicate: (value: TFrame, index: number, array: TFrame[]) => unknown,
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
    predicate: (value: TFrame, index: number, array: TFrame[]) => unknown,
    thisArg?: unknown,
  ): TFrame | undefined;

  slice(start?: number, end?: number): this;

  concat(...items: ConcatArray<TFrame>[]): this;
  concat(...items: (TFrame | ConcatArray<TFrame>)[]): this;

  reverse(): this;
  sort(compareFn?: (a: TFrame, b: TFrame) => number): this;

  splice(start: number, deleteCount?: number): this;
  splice(start: number, deleteCount: number, ...items: TFrame[]): this;

  // --- Frames enrichment helpers ---

  /** Bind `symbol` to a literal or computed value for every frame. */
  bind<TSymbol extends symbol>(
    symbol: TSymbol,
    valueOrFn: unknown | ((frame: TFrame) => unknown),
  ): Frames<TFrame & Record<TSymbol, unknown>>;

  /** Filter frames by a predicate (delegates to `filter` with type-narrowing). */
  guard<S extends TFrame>(
    predicate: (value: TFrame, index: number, array: TFrame[]) => value is S,
  ): Frames<S>;
  guard(predicate: (value: TFrame, index: number, array: TFrame[]) => unknown): this;

  /** Run a side effect for each frame and pass the frames through unchanged. */
  tap(effect: (frame: TFrame) => void): this;

  /**
   * Enrich every frame with the result of an async operation.
   * Calls `fn` for each frame in parallel; the string keys of each result
   * become new symbol bindings on the corresponding frame.
   */
  enrich(fn: (frame: TFrame) => Promise<Record<string, unknown>>): Promise<Frames>;

  /**
   * Inner join: fan each frame over a query result, dropping frames
   * with no matches. Delegates to `query`.
   */
  innerJoin<
    TFunction extends (...args: never[]) => unknown[],
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = ReturnType<TFunction> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(
    queryFn: TFunction,
    input: TInputMapping,
    output: TOutputMapping,
  ): Frames<TNewFrame>;
  innerJoin<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(
    queryFn: TFunction,
    input: TInputMapping,
    output: TOutputMapping,
  ): Promise<Frames<TNewFrame>>;

  /**
   * Left join: like innerJoin but preserves frames with no matches
   * (symbols get `undefined`). Delegates to `queryOptional`.
   */
  leftJoin<
    TFunction extends (...args: never[]) => unknown[],
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = ReturnType<TFunction> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(
    queryFn: TFunction,
    input: TInputMapping,
    output: TOutputMapping,
  ): Frames<TNewFrame>;
  leftJoin<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(
    queryFn: TFunction,
    input: TInputMapping,
    output: TOutputMapping,
  ): Promise<Frames<TNewFrame>>;

  /**
   * Collect a single value from each frame into an array bound to a new
   * symbol. Produces exactly one output frame containing the collected array.
   */
  collectOne<TSymbol extends symbol, TKey extends symbol>(
    symbol: TSymbol,
    key: TKey,
  ): Frames<Record<TSymbol, unknown[]>>;
}

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "@null";
  if (value === undefined) return "@undefined";
  if (typeof value === "bigint") return `@bigint:${String(value)}`;
  if (typeof value !== "object") return `@${typeof value}:${String(value)}`;
  if (seen.has(value)) return "@circular";
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((v) => stableSerialize(v, seen)).join(",");
    return `@A{${items}}`;
  }
  const keys = Object.keys(value).sort();
  const inner = keys
    .map((k) => `${k}:${stableSerialize((value as Record<string, unknown>)[k], seen)}`)
    .join(",");
  const symKeys = Object.getOwnPropertySymbols(value).sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  const symInner = symKeys
    .map((s) => `${String(s)}:${stableSerialize((value as Record<symbol, unknown>)[s], seen)}`)
    .join(",");
  const combined = [inner, symInner].filter(Boolean).join(",");
  return `@O{${combined}}`;
}

/** Methods that own their return value and must NOT be auto-rewrapped. */
const UNWRAPPED_METHODS = new Set<PropertyKey>([
  "query",
  "queryAsync",
  "queryOptional",
  "queryOptionalAsync",
  "bind",
  "guard",
  "enrich",
  "innerJoin",
  "leftJoin",
  "collectOne",
]);

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: The interface overloads Array methods so fluent frame transforms keep their narrowed return types.
export class Frames<TFrame extends Frame = Frame> extends Array<TFrame> {
  constructor(...frames: TFrame[]) {
    super(...frames);
    // Re-wrap array-returning methods so the fluent API stays a `Frames`.
    // biome-ignore lint/correctness/noConstructorReturn: Returning this proxy keeps built-in Array methods closed over Frames.
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function" || UNWRAPPED_METHODS.has(prop)) {
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

  /**
   * Resolve a query's `input` mapping against a single frame.
   *
   * Symbol values are looked up in the frame (and must be bound — an unbound
   * symbol is a programming error); literal values pass through unchanged.
   */
  private static bindInput(frame: Frame, input: Mapping): Mapping {
    const bound: Mapping = {};
    for (const [key, binding] of Object.entries(input)) {
      if (typeof binding === "symbol") {
        bound[key] = frame[binding];
      } else {
        bound[key] = binding;
      }
    }
    return bound;
  }

  /**
   * Expand one source frame by a query's result rows into the accumulator.
   *
   * Each row yields a fresh frame extending `frame` with the `output` symbol
   * bindings. A query that returns no rows contributes nothing — the source
   * frame is dropped, giving inner-join / fan-out semantics.
   */
  private static expandOutputs(
    into: Frames,
    frame: Frame,
    rows: unknown[],
    output: Record<string, symbol>,
  ): void {
    for (const row of rows) {
      const newFrame: Record<symbol, unknown> = { ...frame };
      for (const [outputKey, symbolKey] of Object.entries(output)) {
        if (typeof symbolKey === "symbol" && row && typeof row === "object" && outputKey in row) {
          newFrame[symbolKey] = (row as Record<string, unknown>)[outputKey];
        }
      }
      into.push(newFrame as Frame);
    }
  }

  /**
   * Like {@link expandOutputs}, but preserves the source frame when `rows` is
   * empty — left-join semantics. When the query returns rows the behaviour is
   * identical to `expandOutputs`.
   */
  private static expandOptionalOutputs(
    into: Frames,
    frame: Frame,
    rows: unknown[],
    output: Record<string, symbol>,
  ): void {
    if (rows.length === 0) {
      into.push({ ...frame } as Frame);
      return;
    }
    Frames.expandOutputs(into, frame, rows, output);
  }

  // Overloads: sync and async query function variants
  query<
    TFunction extends (...args: never[]) => unknown[],
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = ReturnType<TFunction> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Frames<TNewFrame>;
  query<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Promise<Frames<TNewFrame>>;
  /**
   * Fan each frame out over the rows returned by `f`.
   *
   * Works with both synchronous (`unknown[]`) and asynchronous
   * (`Promise<unknown[]>`) query functions, returning `Frames` or
   * `Promise<Frames>` to match. Frames whose query yields zero rows are dropped
   * (intentional inner-join semantics).
   */
  query(
    f: (...args: never[]) => unknown[] | Promise<unknown[]>,
    input: Record<string, unknown>,
    output: Record<string, symbol>,
  ): Frames | Promise<Frames> {
    const result = new Frames();
    const promises: Promise<void>[] = [];

    for (const frame of this) {
      const boundInput = Frames.bindInput(frame, input);
      const rows = f(boundInput as never);
      if (rows instanceof Promise) {
        promises.push(rows.then((arr) => Frames.expandOutputs(result, frame, arr, output)));
      } else {
        Frames.expandOutputs(result, frame, rows, output);
      }
    }

    if (promises.length > 0) {
      return Promise.allSettled(promises).then(() => result);
    }
    return result;
  }

  /**
   * Always-async variant of {@link query}, for query functions that return a
   * Promise. Semantics per frame are identical to {@link query}.
   */
  async queryAsync<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Promise<Frames<TNewFrame>> {
    const result = new Frames<TNewFrame>();
    for (const frame of this) {
      const boundInput = Frames.bindInput(frame, input);
      const rows = await f(boundInput as Parameters<TFunction>[0]);
      Frames.expandOutputs(result as Frames, frame, rows, output);
    }
    return result;
  }

  // Overloads: sync and async queryOptional variants
  queryOptional<
    TFunction extends (...args: never[]) => unknown[],
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = ReturnType<TFunction> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Frames<TNewFrame>;
  queryOptional<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Promise<Frames<TNewFrame>>;
  /**
   * Fan each frame out over the rows returned by `f`, or preserve the source
   * frame when `f` returns zero rows (left-join semantics).
   *
   * Works with both synchronous (`unknown[]`) and asynchronous
   * (`Promise<unknown[]>`) query functions, returning `Frames` or
   * `Promise<Frames>` to match. Frames whose query yields zero rows are
   * preserved with no additional bindings from the query.
   */
  queryOptional(
    f: (...args: never[]) => unknown[] | Promise<unknown[]>,
    input: Record<string, unknown>,
    output: Record<string, symbol>,
  ): Frames | Promise<Frames> {
    const result = new Frames();
    const promises: Promise<void>[] = [];

    for (const frame of this) {
      const boundInput = Frames.bindInput(frame, input);
      const rows = f(boundInput as never);
      if (rows instanceof Promise) {
        promises.push(rows.then((arr) => Frames.expandOptionalOutputs(result, frame, arr, output)));
      } else {
        Frames.expandOptionalOutputs(result, frame, rows, output);
      }
    }

    if (promises.length > 0) {
      return Promise.allSettled(promises).then(() => result);
    }
    return result;
  }

  /**
   * Always-async variant of {@link queryOptional}, for query functions that
   * return a Promise. Semantics per frame are identical to
   * {@link queryOptional}.
   */
  async queryOptionalAsync<
    TFunction extends (...args: never[]) => Promise<unknown[]>,
    TInputMapping extends Record<string, unknown>,
    TOutputMapping extends Record<string, symbol>,
    TFunctionOutput = Awaited<ReturnType<TFunction>> extends (infer U)[] ? U : never,
    TNewFrame extends Frame = TFrame & ExtractSymbolMappings<TOutputMapping, TFunctionOutput>,
  >(f: TFunction, input: TInputMapping, output: TOutputMapping): Promise<Frames<TNewFrame>> {
    const result = new Frames<TNewFrame>();
    for (const frame of this) {
      const boundInput = Frames.bindInput(frame, input);
      const rows = await f(boundInput as Parameters<TFunction>[0]);
      Frames.expandOptionalOutputs(result as Frames, frame, rows, output);
    }
    return result;
  }

  /**
   * Group frames by their non-collected symbol keys, gathering the `collect`
   * symbols of each group into an array bound to `as`.
   *
   * Within a group, each collected symbol is keyed by its `.description` in the
   * produced records, so downstream code reads them by name.
   *
   * Frames that carry none of the collected symbols are silently skipped. This
   * allows {@link queryOptional} to preserve parent rows that later flow
   * through `collectAs` without introducing phantom collected entries.
   */
  collectAs<TAsSymbol extends symbol>(collect: symbol[], as: TAsSymbol): Frames {
    const groups = new Map<string, { groupFrame: Frame; collected: Record<string, unknown>[] }>();

    for (const frame of this) {
      const groupKeys: Frame = {};
      const collectedRecord: Record<string, unknown> = {};

      for (const symbolKey of Object.getOwnPropertySymbols(frame)) {
        const value = (frame as Record<symbol, unknown>)[symbolKey];
        if (collect.includes(symbolKey)) {
          const symbolName = symbolKey.description || String(symbolKey);
          collectedRecord[symbolName] = value;
        } else {
          groupKeys[symbolKey] = value;
        }
      }

      const groupKey = stableSerialize(groupKeys);

      let group = groups.get(groupKey);
      if (group === undefined) {
        group = { groupFrame: groupKeys, collected: [] };
        groups.set(groupKey, group);
      }

      if (Object.keys(collectedRecord).length > 0) {
        group.collected.push(collectedRecord);
      }
    }

    const result = new Frames();
    for (const { groupFrame, collected } of groups.values()) {
      result.push({ ...groupFrame, [as]: collected } as Frame);
    }
    return result;
  }

  /**
   * Like {@link collectAs}, but guarantees exactly one output frame even when
   * `this` is empty — the common cause of a synchronization silently failing to
   * fire.
   *
   * A list endpoint typically starts from a single request frame, fans out via
   * `.query` (which drops the frame when a query returns nothing), then collects
   * the results back into one list. If the query yields zero rows the request
   * frame is lost and no response is ever sent. `aggregate` restores it: pass the
   * originating `base` frame (captured before the queries) and, when there is
   * nothing to collect, it emits `base` with `as` bound to an empty array.
   *
   * @param base    bindings that must survive into the `then` clause (e.g. `request`).
   * @param collect symbols to gather into the list.
   * @param as      symbol the collected list is bound to.
   */
  aggregate(base: Frame, collect: symbol[], as: symbol): Frames {
    if (this.length === 0) {
      return new Frames({ ...base, [as]: [] } as Frame);
    }
    return this.collectAs(collect, as);
  }

  /**
   * Bind `symbol` to a literal value or a computed value for every frame.
   *
   * When `valueOrFn` is a function it receives the frame and its return value
   * is bound. Otherwise the literal value is shared across all result frames.
   */
  bind<TSymbol extends symbol>(
    symbol: TSymbol,
    valueOrFn: unknown | ((frame: TFrame) => unknown),
  ): Frames {
    const result = new Frames();
    const fn =
      typeof valueOrFn === "function" ? (valueOrFn as (frame: TFrame) => unknown) : undefined;
    for (const frame of this) {
      result.push({
        ...frame,
        [symbol]: fn ? fn(frame) : valueOrFn,
      } as Frame);
    }
    return result;
  }

  /**
   * Filter frames by a predicate — delegates to `this.filter`.
   * Provided as a named convenience for readability in `where` clauses.
   */
  guard(predicate: (value: TFrame, index: number, array: TFrame[]) => unknown): this {
    // SAFETY: `this.filter` returns `Frames<TFrame>` (re-wrapped by the Proxy).
    // The cast to `this` is required because TypeScript cannot prove that a
    // polymorphic `this` type (which may be a narrower subclass of Frames) is
    // structurally assignable from `Frames<TFrame>`. At runtime, `guard` is
    // always called on a Frames instance, so the cast is sound.
    return this.filter(predicate) as unknown as this;
  }

  /**
   * Run a side effect for each frame, returning the same frames so it chains
   * inside a `where` (e.g. logging dropped/failed frames after a `guard`).
   */
  tap(effect: (frame: TFrame) => void): this {
    for (const frame of this) effect(frame);
    return this;
  }

  /**
   * Enrich every frame with the result of an async operation.
   *
   * Calls `fn` for each frame in parallel and spreads the returned keys onto
   * each frame. String keys from the result object are converted to symbols
   * so they are consistently accessible across frames within this call. A
   * single failure does not discard sibling results — the original frame is
   * preserved.
   */
  async enrich(fn: (frame: TFrame) => Promise<Record<string, unknown>>): Promise<Frames> {
    const frames = [...this];
    const symMap = new Map<string, symbol>();
    const results = await Promise.allSettled(
      frames.map(async (frame) => {
        const extra = await fn(frame);
        const symbolized: Record<symbol, unknown> = {};
        for (const [key, value] of Object.entries(extra)) {
          let sym = symMap.get(key);
          if (sym === undefined) {
            sym = Symbol(key);
            symMap.set(key, sym);
          }
          symbolized[sym] = value;
        }
        return { ...frame, ...symbolized } as Frame;
      }),
    );
    const enriched = results.map((r, i) =>
      r.status === "fulfilled" ? r.value : ({ ...frames[i] } as Frame),
    );
    return new Frames(...enriched);
  }

  /**
   * Inner join: fan each frame over a query result, dropping frames with no
   * matches. Delegates to `query`.
   */
  innerJoin(
    queryFn: (...args: never[]) => unknown[] | Promise<unknown[]>,
    input: Record<string, unknown>,
    output: Record<string, symbol>,
  ): Frames | Promise<Frames> {
    return this.query(queryFn as (...args: never[]) => unknown[], input, output);
  }

  /**
   * Left join: like {@link innerJoin} but preserves frames with no matches
   * (output symbols are `undefined`). Delegates to `queryOptional`.
   */
  leftJoin(
    queryFn: (...args: never[]) => unknown[] | Promise<unknown[]>,
    input: Record<string, unknown>,
    output: Record<string, symbol>,
  ): Frames | Promise<Frames> {
    return this.queryOptional(queryFn as (...args: never[]) => unknown[], input, output);
  }

  /**
   * Collect the value bound to `key` from every frame into a single array,
   * bound to `symbol` on a single output frame.
   *
   * Frames where `key` is unbound are skipped during collection. When no frames
   * carry the key, the output frame is still emitted with an empty array.
   */
  collectOne<TSymbol extends symbol, TKey extends symbol>(symbol: TSymbol, key: TKey): Frames {
    const collected: unknown[] = [];
    for (const frame of this) {
      const v = (frame as Record<symbol, unknown>)[key as symbol];
      if (v !== undefined) {
        collected.push(v);
      }
    }
    const frame: Frame = { [symbol]: collected };
    return new Frames(frame);
  }
}
