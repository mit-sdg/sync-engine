/**
 * Lifecycle — a uniform teardown registry.
 *
 * Every long-lived resource (timer, scheduler, infra module, HTTP server, db
 * client) registers itself once as a {@link Stoppable}. Shutdown is a single
 * call to {@link Lifecycle.stopAll}, which stops everything in reverse
 * registration order and waits for all stops to settle. Adding a resource
 * never requires editing the teardown logic.
 *
 * App-agnostic: zero imports beyond the standard library.
 */

export interface Stoppable {
  stop(): void | Promise<void>;
}

export class Lifecycle {
  private readonly stoppables: Stoppable[] = [];

  /** Register a resource to be stopped on shutdown. */
  add(stoppable: Stoppable): void {
    this.stoppables.push(stoppable);
  }

  /**
   * Register a timer (from `setInterval`/`setTimeout`), wrapped so that
   * stopping it clears the timer.
   */
  addTimer(timer: ReturnType<typeof setInterval>): void {
    this.add({ stop: () => clearInterval(timer) });
  }

  /**
   * Stop every registered resource in reverse registration order, awaiting
   * all of them. A failure in one stop does not prevent the others from
   * running; the first error (if any) is re-thrown after all have settled.
   */
  async stopAll(): Promise<void> {
    const ordered = [...this.stoppables].reverse();
    this.stoppables.length = 0;

    // `then` so a synchronous throw in `stop()` becomes a rejection rather
    // than escaping the map and skipping the remaining resources.
    const results = await Promise.allSettled(
      ordered.map((s) => Promise.resolve().then(() => s.stop())),
    );

    const firstFailure = results.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (firstFailure) throw firstFailure.reason;
  }
}
