/**
 * Which memoized query answers each outside invocation may reuse, under
 * `queryCache: "since-dispatch"`.
 *
 * Every outside invocation, direct `form` and direct query root opens a new
 * dispatch point. Until it settles, reads done for its flow reuse only answers
 * whose query began at or after that point, so it sees every change that
 * landed before it began, as when every cache is cleared at dispatch. Unlike
 * clearing, invocations already running keep the answers they read. Any other
 * read uses the current point, which is what clearing at each dispatch gives.
 */
export class InvocationReads {
  private latest = 0;
  private readonly sinceByFlow = new Map<string, number>();
  /** Points of the reads still open, in the order they opened, which is ascending. */
  private readonly open = new Set<number>();

  /** Open a new dispatch point for `flow`; the returned function closes it once. */
  openFor(flow: string): () => void {
    const since = ++this.latest;
    this.sinceByFlow.set(flow, since);
    this.open.add(since);
    return () => {
      if (!this.open.delete(since)) return;
      if (this.sinceByFlow.get(flow) === since) this.sinceByFlow.delete(flow);
    };
  }

  /** The earliest point whose answers reads for `flow` may reuse now. */
  since(flow: string | undefined): number {
    return (flow === undefined ? undefined : this.sinceByFlow.get(flow)) ?? this.latest;
  }

  /** The point an answer begun now carries; every open read may reuse it. */
  get current(): number {
    return this.latest;
  }

  /** Answers begun before this point can no longer be reused by any read. */
  get oldest(): number {
    for (const since of this.open) return since;
    return this.latest;
  }
}

/** Dispatch points for an assembly's `queryCache` mode; undefined unless it is "since-dispatch". */
export function invocationReadsFor(queryCache: string | undefined): InvocationReads | undefined {
  return queryCache === "since-dispatch" ? new InvocationReads() : undefined;
}
