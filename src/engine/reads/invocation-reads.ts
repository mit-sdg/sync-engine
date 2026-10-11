/**
 * Which memoized query answers each outside invocation may reuse, under
 * `queryCache: "since-dispatch"`.
 *
 * Every outside invocation opens a new dispatch point. Reads done for its flow
 * reuse only answers whose query began at or after that point, so the
 * invocation sees every change that landed before it was dispatched, as when
 * every cache is cleared at dispatch. Unlike clearing, invocations already
 * running keep the answers they read. A read that serves no invocation being
 * served uses the latest point, which is what clearing at each dispatch gives.
 */
export class InvocationReads {
  private latest = 0;
  private readonly sinceByFlow = new Map<string, number>();
  /** Dispatch points of invocations being served, oldest first. */
  private readonly running: number[] = [];
  private readonly ended = new Set<number>();

  /** Open a new dispatch point for `flow`; the returned function ends it once. */
  begin(flow: string): () => void {
    const since = ++this.latest;
    this.sinceByFlow.set(flow, since);
    this.running.push(since);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      if (this.sinceByFlow.get(flow) === since) this.sinceByFlow.delete(flow);
      this.ended.add(since);
      while (this.running.length > 0 && this.ended.delete(this.running[0]!)) this.running.shift();
    };
  }

  /** The earliest point whose answers reads for `flow` may reuse. */
  since(flow: unknown): number {
    return (typeof flow === "string" ? this.sinceByFlow.get(flow) : undefined) ?? this.latest;
  }

  /** The point an answer begun now carries; every invocation running may reuse it. */
  get now(): number {
    return this.latest;
  }

  /** Answers begun before this point can no longer be reused by any read. */
  get oldest(): number {
    return this.running[0] ?? this.latest;
  }
}

/** Dispatch points for an assembly's `queryCache` mode; undefined unless it is "since-dispatch". */
export function invocationReadsFor(queryCache: string | undefined): InvocationReads | undefined {
  return queryCache === "since-dispatch" ? new InvocationReads() : undefined;
}
