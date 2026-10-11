/**
 * Query memoization between mutations.
 *
 * Instrumentation invalidates every query cache before and after an action
 * body. This module owns only cache identity, rejected-promise eviction, and,
 * for `queryCache: "since-dispatch"`, which dispatch point each answer began at.
 */

type AnyFn = (...args: never[]) => unknown;

const MAX_QUERY_CACHE_KEY_DEPTH = 100;

class QueryCacheKeyDepthError extends Error {
  constructor() {
    super(`Query cache key exceeds maximum depth of ${MAX_QUERY_CACHE_KEY_DEPTH}`);
    this.name = "QueryCacheKeyDepthError";
  }
}

interface MemoizedQuery<T extends AnyFn> {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>;
  invalidate(): void;
}

interface DispatchPointMemoizedQuery<T extends AnyFn> extends MemoizedQuery<T> {
  /** Answer from an entry begun at or after `since`, or run the query and keep its answer. */
  readSince(since: number, args: Parameters<T>): ReturnType<T>;
  /** Forget every answer begun before `oldest`, which no read may reuse any more. */
  prune(oldest: number): void;
}

/** The dispatch point an answer begun now carries. */
export interface DispatchPoints {
  readonly now: number;
}

interface IdentityTable {
  symbols: Map<symbol, number>;
  functions: WeakMap<Function, number>;
  objects: WeakMap<object, number>;
  next: number;
}

function identityTable(): IdentityTable {
  return { symbols: new Map(), functions: new WeakMap(), objects: new WeakMap(), next: 1 };
}

/** Build a deterministic key without conflating cyclic, collection, or identity values. */
function queryCacheKey(args: readonly unknown[], identities = identityTable()): string {
  const active = new Map<object, number>();
  let nextReference = 1;

  const referenceId = (value: object): number => {
    const known = active.get(value);
    if (known !== undefined) return known;
    const id = nextReference++;
    active.set(value, id);
    return id;
  };

  const encode = (value: unknown, depth = 0): string => {
    if (depth > MAX_QUERY_CACHE_KEY_DEPTH) throw new QueryCacheKeyDepthError();
    if (value === null) return "null";
    switch (typeof value) {
      case "undefined":
        return "undefined";
      case "boolean":
        return `boolean:${value}`;
      case "number":
        return Number.isNaN(value) ? "number:NaN" : `number:${Object.is(value, -0) ? "-0" : value}`;
      case "bigint":
        return `bigint:${value}`;
      case "string":
        return `string:${JSON.stringify(value)}`;
      case "symbol": {
        const id = identities.symbols.get(value) ?? identities.next++;
        identities.symbols.set(value, id);
        return `symbol:${id}`;
      }
      case "function": {
        const id = identities.functions.get(value) ?? identities.next++;
        identities.functions.set(value, id);
        return `function:${id}`;
      }
      case "object":
        break;
    }

    if (value instanceof Date) return `date:${value.getTime()}`;
    const prototype = Object.getPrototypeOf(value);
    const structural = Array.isArray(value) || prototype === Object.prototype || prototype === null;
    if (!structural) {
      const id = identities.objects.get(value) ?? identities.next++;
      identities.objects.set(value, id);
      return `object:${id}`;
    }

    const existing = active.get(value);
    if (existing !== undefined) return `ref:${existing}`;
    const id = referenceId(value);
    if (Array.isArray(value)) {
      const entries = Array.from({ length: value.length }, (_, index) =>
        encode(value[index], depth + 1),
      ).join(",");
      active.delete(value);
      return `array:${id}:${value.length}:[${entries}]`;
    }

    const entries = Reflect.ownKeys(value)
      .map((key) => ({ key, encodedKey: encode(key, depth + 1) }))
      .sort((left, right) =>
        left.encodedKey < right.encodedKey ? -1 : left.encodedKey > right.encodedKey ? 1 : 0,
      )
      .map(
        ({ key, encodedKey }) =>
          `${encodedKey}:${encode((value as Record<PropertyKey, unknown>)[key], depth + 1)}`,
      );
    active.delete(value);
    return `record:${prototype === null ? "null" : "plain"}:${id}:{${entries.join(",")}}`;
  };

  return args.map((value) => encode(value)).join("|");
}

/** Memoize a query until invalidated; a rejected promise is never retained. */
export function memoizeQuery<T extends AnyFn>(fn: T): MemoizedQuery<T> {
  let cache = new Map<string, unknown>();
  const identities = identityTable();
  const wrapper = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    let key: string;
    try {
      key = queryCacheKey(args, identities);
    } catch (error) {
      if (error instanceof QueryCacheKeyDepthError) return fn.call(this, ...args) as ReturnType<T>;
      throw error;
    }
    if (cache.has(key)) return cache.get(key) as ReturnType<T>;
    const result = fn.call(this, ...args);
    const promise = normalizePromiseLike(result);
    if (promise !== undefined) {
      // Cache the normalized promise so structural thenables execute only once.
      cache.set(key, promise);
      void promise.catch(() => {
        if (cache.get(key) === promise) cache.delete(key);
      });
      return promise as ReturnType<T>;
    }
    cache.set(key, result);
    return result as ReturnType<T>;
  };
  wrapper.invalidate = () => {
    cache = new Map();
  };
  return wrapper as MemoizedQuery<T>;
}

/**
 * Memoize a query by the dispatch point each answer began at. A plain call
 * reuses only answers begun at the latest point, as when every cache is
 * cleared at dispatch; `readSince` reuses any answer begun at or after an
 * earlier point. One entry per key suffices: a fresh answer satisfies every
 * reader. A rejected promise is never retained.
 */
export function memoizeQuerySinceDispatch<T extends AnyFn>(
  fn: T,
  points: DispatchPoints,
): DispatchPointMemoizedQuery<T> {
  let cache = new Map<string, { value: unknown; begun: number }>();
  /** Keys in the order their answers began, grouped by point, for pruning. */
  let begun: { point: number; keys: string[] }[] = [];
  const identities = identityTable();
  const readSince = function (
    this: ThisParameterType<T>,
    since: number,
    args: Parameters<T>,
  ): ReturnType<T> {
    let key: string;
    try {
      key = queryCacheKey(args, identities);
    } catch (error) {
      if (error instanceof QueryCacheKeyDepthError) return fn.call(this, ...args) as ReturnType<T>;
      throw error;
    }
    const known = cache.get(key);
    if (known !== undefined && known.begun >= since) return known.value as ReturnType<T>;
    const point = points.now;
    const result = fn.call(this, ...args);
    const promise = normalizePromiseLike(result);
    // Cache the normalized promise so structural thenables execute only once.
    const entry = { value: promise ?? result, begun: point };
    cache.set(key, entry);
    const last = begun.at(-1);
    if (last?.point === point) last.keys.push(key);
    else begun.push({ point, keys: [key] });
    if (promise !== undefined) {
      const kept = cache;
      void promise.catch(() => {
        if (kept.get(key) === entry) kept.delete(key);
      });
    }
    return entry.value as ReturnType<T>;
  };
  const wrapper = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    return readSince.call(this, points.now, args);
  };
  wrapper.readSince = readSince;
  wrapper.invalidate = () => {
    cache = new Map();
    begun = [];
  };
  wrapper.prune = (oldest: number) => {
    while (begun.length > 0 && begun[0]!.point < oldest) {
      const { point, keys } = begun.shift()!;
      for (const key of keys) if (cache.get(key)?.begun === point) cache.delete(key);
    }
  };
  return wrapper as DispatchPointMemoizedQuery<T>;
}
import { normalizePromiseLike } from "./promise-like.ts";
