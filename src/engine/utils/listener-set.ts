/**
 * A set of listeners with safe notification: a listener that throws or
 * rejects is reported to `onError` and skipped without disrupting the
 * remaining listeners. Registration dedupes by identity, and notification
 * iterates over a snapshot so listeners may deregister mid-notify.
 */
export class ListenerSet<L> {
  private readonly listeners = new Set<L>();

  /** Register a listener; returns its deregistration. */
  add(listener: L): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
  }

  get size(): number {
    return this.listeners.size;
  }

  /**
   * Invoke every listener with `event`. A synchronous throw is reported to
   * `onError` immediately; a returned promise's rejection is reported when it
   * lands.
   */
  notify<E>(
    invoke: (listener: L, event: E) => unknown,
    event: E,
    onError: (error: unknown) => void,
  ): void {
    // eslint-disable-next-line unicorn/no-useless-spread -- Iterate a snapshot so listeners may deregister mid-notify.
    for (const listener of [...this.listeners]) {
      try {
        const returned = invoke(listener, event) as unknown;
        if (returned instanceof Promise) void returned.catch(onError);
      } catch (error) {
        onError(error);
      }
    }
  }
}
