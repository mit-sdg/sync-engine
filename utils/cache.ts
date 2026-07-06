type AnyFn = (...args: never[]) => unknown;

export interface CacheOptions {
  /** Maximum number of entries to retain before evicting the oldest. */
  maxSize?: number;
  /** Time-to-live for each entry, in milliseconds. */
  ttlMs?: number;
}

export const DEFAULT_CACHE_MAX_SIZE = 1000;
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface CachedFn<T extends AnyFn> {
  (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T>;
  /** Drop every cached entry (alias of {@link clear}). */
  invalidate: () => void;
  /** Drop every cached entry. */
  clear: () => void;
  /** Number of entries currently held. */
  readonly size: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

function serialize(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (arg instanceof Date) return arg.getTime().toString();
  if (typeof arg === "object") {
    const keys = Object.keys(arg).sort();
    return `{${keys.map((k) => `${k}:${serialize((arg as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return String(arg);
}

function stableKey(args: unknown[]): string {
  return args.map(serialize).join("|");
}

export function cached<T extends AnyFn>(fn: T, options?: CacheOptions): CachedFn<T> {
  const maxSize = options?.maxSize ?? DEFAULT_CACHE_MAX_SIZE;
  const ttlMs = options?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
  let cache = new Map<string, CacheEntry>();

  // Insert (or refresh) an entry, then evict the oldest entries while over
  // capacity. Re-inserting moves the key to the end of the Map's insertion
  // order so it counts as most-recently-used.
  const store = (key: string, value: unknown): void => {
    cache.delete(key);
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (cache.size > maxSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const wrapper = function (this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const key = stableKey(args as unknown[]);
    const existing = cache.get(key);
    if (existing !== undefined) {
      if (existing.expiresAt > Date.now()) {
        // Refresh recency for LRU ordering.
        cache.delete(key);
        cache.set(key, existing);
        return existing.value as ReturnType<T>;
      }
      // Expired — drop it and recompute below.
      cache.delete(key);
    }

    const result = fn.apply(this, args) as unknown;
    if (result instanceof Promise) {
      store(key, result);
      result.then(
        (r: unknown) => {
          // Only commit if this pending promise is still the cached entry;
          // a concurrent invalidate/clear must not be resurrected.
          const entry = cache.get(key);
          if (entry !== undefined && entry.value === result) store(key, r);
        },
        () => {
          const entry = cache.get(key);
          if (entry !== undefined && entry.value === result) cache.delete(key);
        },
      );
      return result as ReturnType<T>;
    }

    store(key, result);
    return result as ReturnType<T>;
  };

  wrapper.invalidate = () => {
    cache = new Map();
  };

  wrapper.clear = () => {
    cache = new Map();
  };

  Object.defineProperty(wrapper, "size", {
    get(): number {
      return cache.size;
    },
  });

  return wrapper as CachedFn<T>;
}
