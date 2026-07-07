/**
 * JobStatusRegistry — a lazily-read aggregator of job-status sources.
 *
 * Background schedulers come and go at runtime (per-tenant apps register and
 * unregister their own scheduler). Rather than wiring a mutable
 * `getAllJobStatuses` forward-reference through the composition root, each
 * scheduler registers itself as a source here, and the metrics/health modules
 * read the aggregate lazily via {@link JobStatusRegistry.all}.
 *
 * App-agnostic: depends only on its own `JobStatus` type.
 */

export interface JobStatus {
  name: string;
  lastRun: string | null;
  lastStatus: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

export interface JobStatusSource {
  getJobStatuses(): JobStatus[];
}

export class JobStatusRegistry {
  private readonly sources = new Set<JobStatusSource>();

  /** Register a source. Returns a disposer that removes it again. */
  add(source: JobStatusSource): () => void {
    this.sources.add(source);
    return () => {
      this.sources.delete(source);
    };
  }

  /** The flattened, current statuses across all registered sources. */
  all(): JobStatus[] {
    return [...this.sources].flatMap((s) => s.getJobStatuses());
  }
}
