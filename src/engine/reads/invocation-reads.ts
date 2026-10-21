/**
 * Which memoized query answers each outside invocation may reuse, under
 * `queryCache: "since-dispatch"`.
 *
 * Every outside invocation, direct `form` and direct query root opens a new
 * dispatch point. Until it returns, reads done for its flow reuse only answers
 * whose query began at or after that point, so it sees every change that
 * landed before it began, as when every cache is cleared at dispatch. Unlike
 * clearing, invocations already running can reuse the answers they read,
 * unless a later read of the same key replaced one with a newer answer. Any
 * other read uses the current point, which is what clearing at each dispatch
 * gives.
 *
 * A point stays open at most `holdMs`, the request deadline. After that its
 * flow reads at the latest point, which only reuses less, so a read that never
 * settles cannot keep every later answer.
 */
export class InvocationReads {
  constructor(private readonly holdMs?: number) {}

  private latest = 0;
  private readonly sinceByFlow = new Map<string, number>();
  /** Points of the reads still open, in the order they opened, which is ascending. */
  private readonly open = new Set<number>();

  /** Open a new dispatch point for `flow`; the returned function closes it once. */
  openFor(flow: string): () => void {
    const since = ++this.latest;
    this.sinceByFlow.set(flow, since);
    this.open.add(since);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (!this.open.delete(since)) return;
      if (this.sinceByFlow.get(flow) === since) this.sinceByFlow.delete(flow);
    };
    if (this.holdMs !== undefined) {
      timer = setTimeout(close, this.holdMs);
      // The hold only tidies the cache; it never keeps a process alive.
      (timer as { unref?: () => void }).unref?.();
    }
    return close;
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
export function invocationReadsFor(
  queryCache: string | undefined,
  holdMs?: number,
): InvocationReads | undefined {
  return queryCache === "since-dispatch" ? new InvocationReads(holdMs) : undefined;
}
