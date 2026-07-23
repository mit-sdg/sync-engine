/**
 * Query memoization between mutations.
 *
 * Instrumentation invalidates every query cache before and after an action
 * body. This module owns only cache identity and rejected-promise eviction.
 */

type AnyFn = (...args: never[]) => unknown;

export interface MemoizedQuery<T extends AnyFn> {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>;
  invalidate(): void;
}

interface IdentityTable {
  symbols: Map<symbol, number>;
  functions: WeakMap<Function, number>;
  next: number;
}

function identityTable(): IdentityTable {
  return { symbols: new Map(), functions: new WeakMap(), next: 1 };
}

/** Build a deterministic key without conflating cyclic, collection, or identity values. */
export function queryCacheKey(args: readonly unknown[], identities = identityTable()): string {
  const seen = new Map<object, number>();
  let nextReference = 1;

  const referenceId = (value: object): number => {
    const known = seen.get(value);
    if (known !== undefined) return known;
    const id = nextReference++;
    seen.set(value, id);
    return id;
  };

  const encode = (value: unknown): string => {
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

    const existing = seen.get(value);
    if (existing !== undefined) return `ref:${existing}`;
    const id = referenceId(value);
    if (value instanceof Date) return `date:${id}:${value.getTime()}`;
    if (value instanceof RegExp) return `regexp:${id}:${value.source}/${value.flags}`;
    if (Array.isArray(value)) return `array:${id}:[${value.map(encode).join(",")}]`;
    if (value instanceof Map) {
      const entries = [...value.entries()]
        .map(([key, entry]) => `${encode(key)}=>${encode(entry)}`)
        .sort();
      return `map:${id}:{${entries.join(",")}}`;
    }
    if (value instanceof Set) return `set:${id}:{${[...value].map(encode).sort().join(",")}}`;

    const prototype = Object.getPrototypeOf(value);
    const label = prototype === null ? "null" : (prototype.constructor?.name ?? "object");
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode((value as Record<string, unknown>)[key])}`);
    return `object:${label}:${id}:{${entries.join(",")}}`;
  };

  return args.map(encode).join("|");
}

/** Memoize a query until invalidated; a rejected promise is never retained. */
export function memoizeQuery<T extends AnyFn>(fn: T): MemoizedQuery<T> {
  let cache = new Map<string, unknown>();
  const identities = identityTable();
  const wrapper = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const key = queryCacheKey(args, identities);
    if (cache.has(key)) return cache.get(key) as ReturnType<T>;
    const result = fn.call(this, ...args);
    cache.set(key, result);
    if (result instanceof Promise) {
      result.catch(() => {
        if (cache.get(key) === result) cache.delete(key);
      });
    }
    return result as ReturnType<T>;
  };
  wrapper.invalidate = () => {
    cache = new Map();
  };
  return wrapper as MemoizedQuery<T>;
}
