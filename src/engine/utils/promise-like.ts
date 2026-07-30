/** Normalize a structural thenable without adding a microtask for synchronous values. */
export function normalizePromiseLike<T>(value: T): Promise<Awaited<T>> | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  try {
    if (typeof (value as { then?: unknown }).then !== "function") return undefined;
  } catch (error) {
    return Promise.reject(error);
  }
  return Promise.resolve(value);
}
