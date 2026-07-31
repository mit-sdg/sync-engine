/** Normalize a structural thenable without adding a microtask for synchronous values. */
export function normalizePromiseLike<T>(value: T): Promise<Awaited<T>> | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }
  let then: unknown;
  try {
    then = (value as { then?: unknown }).then;
  } catch (error) {
    return Promise.reject(error);
  }
  if (typeof then !== "function") return undefined;
  return new Promise((resolve, reject) => {
    queueMicrotask(() => {
      try {
        Reflect.apply(then, value, [resolve, reject]);
      } catch (error) {
        reject(error);
      }
    });
  });
}
