/** True when an optional abort signal has already fired. */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Race `pending` against an optional timeout and an optional abort signal.
 * The first settlement wins; losing sides are cleaned up. A `pending`
 * rejection rejects the race; a timeout or an abort resolves with its
 * configured fallback (or `undefined` when none is configured).
 */
export function raceDeadline<T>(
  pending: Promise<T>,
  options: {
    timeoutMs?: number;
    onTimeout?: () => T;
    signal?: AbortSignal;
    onAbort?: () => T;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      settle();
    };
    const abort = () =>
      finish(() => resolve(options.onAbort === undefined ? (undefined as T) : options.onAbort()));
    const onTimeout = options.onTimeout;
    const timer =
      options.timeoutMs === undefined || onTimeout === undefined
        ? undefined
        : setTimeout(() => finish(() => resolve(onTimeout())), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (isAborted(options.signal)) abort();
    void pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}
