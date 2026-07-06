/**
 * SchedulerModule — pluggable background job runner.
 *
 * Manages periodic jobs with multi-instance MongoDB leases (so only
 * one process runs each job at a time).  Does NOT contain domain
 * logic — each job's `run()` should fire a concept action (e.g.
 * `Ticking.tick`) whose side effects live in syncs.
 *
 * The module is app-agnostic: zero imports from `@concepts` or `@sdk`.
 */

import type { InfraModule, JobStatus } from "@sync-engine/infra/types.ts";
import type { Db } from "mongodb";

// ── Re-export for convenience ──

export type { JobStatus };

// ── Lease internals ──

// Process-unique lease owner id — stable for the lifetime of the process
// so that multiple instances (or restarts) never fight over the same lease.
const INSTANCE_ID = crypto.randomUUID();
const JOB_LEASES_COLLECTION = "_jobLeases";

interface JobLeaseDoc {
  _id: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
  lastRun: string | null;
  lastStatus: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

// ── Public types ──

export interface SchedulerLogger {
  info(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
}

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  ttlMs: number;
  /** The job's work. Should fire a concept action, NOT contain domain logic. */
  run(): Promise<void>;
}

// ── Module ──

export class SchedulerModule implements InfraModule {
  readonly name = "scheduler";

  private jobs: ScheduledJob[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private jobStatuses = new Map<string, JobStatus>();
  private leasePrefix: string;

  constructor(
    private db: Db,
    namespace?: string,
    private logger?: SchedulerLogger,
  ) {
    this.leasePrefix = namespace ? `${namespace}_` : "";
  }

  /** Declare a job to run on schedule. */
  register(job: ScheduledJob): void {
    this.jobs.push(job);
    this.ensureJobStatus(job.name);
  }

  /** Start all registered job timers. */
  start(): void {
    for (const job of this.jobs) {
      const interval = setInterval(() => this.runJob(job), job.intervalMs);
      this.intervals.push(interval);
    }
  }

  /** Stop all job timers. */
  stop(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }

  /** Get current job statuses (for metrics/health). */
  getJobStatuses(): JobStatus[] {
    return [...this.jobStatuses.values()];
  }

  /** Load persisted job statuses from MongoDB (called at startup). */
  async loadJobStatusesFromDb(): Promise<void> {
    try {
      const docs = await this.db
        .collection<JobLeaseDoc>(JOB_LEASES_COLLECTION)
        .find({})
        .toArray();
      for (const doc of docs) {
        const logicalName =
          this.leasePrefix && doc._id.startsWith(this.leasePrefix)
            ? doc._id.slice(this.leasePrefix.length)
            : doc._id;
        const status = this.ensureJobStatus(logicalName);
        status.lastRun = doc.lastRun ?? null;
        status.lastStatus = doc.lastStatus ?? null;
        status.lastError = doc.lastError ?? null;
        status.lastDurationMs = doc.lastDurationMs ?? null;
      }
    } catch {
      // Collection may not exist yet
    }
  }

  // ── Private ──

  private nsName(name: string): string {
    return `${this.leasePrefix}${name}`;
  }

  private ensureJobStatus(name: string): JobStatus {
    const existing = this.jobStatuses.get(name);
    if (existing) return existing;

    const status: JobStatus = {
      name,
      lastRun: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
    };
    this.jobStatuses.set(name, status);
    return status;
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const jobName = this.nsName(job.name);
    const started = Date.now();
    try {
      if (!(await this.acquireJobLease(jobName, job.ttlMs))) return;

      await job.run();

      const duration = Date.now() - started;
      this.recordJobSuccess(job.name, duration);
      await this.syncJobLeaseStatus(jobName, "completed", null, duration);
      await this.releaseJobLease(jobName);
    } catch (err: unknown) {
      const duration = Date.now() - started;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordJobFailure(job.name, err, duration);
      await this.syncJobLeaseStatus(jobName, "failed", errorMsg, duration);
      await this.releaseJobLease(jobName);
    }
  }

  // ── Lease helpers (identical semantics to current jobs.ts) ──

  private async acquireJobLease(
    jobName: string,
    ttlMs: number,
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    try {
      const leases = this.db.collection<JobLeaseDoc>(JOB_LEASES_COLLECTION);
      const result = await leases.findOneAndUpdate(
        {
          _id: jobName,
          $or: [{ expiresAt: { $lt: now } }, { owner: INSTANCE_ID }],
        },
        {
          $set: {
            owner: INSTANCE_ID,
            acquiredAt: now,
            expiresAt,
          },
          $setOnInsert: {
            _id: jobName,
            lastRun: null,
            lastStatus: null,
            lastError: null,
            lastDurationMs: null,
          },
        },
        { upsert: true, returnDocument: "after" },
      );
      if (!result) return false;
      return result.owner === INSTANCE_ID;
    } catch (e: unknown) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
  }

  private async releaseJobLease(jobName: string): Promise<void> {
    await this.db
      .collection<JobLeaseDoc>(JOB_LEASES_COLLECTION)
      .updateOne(
        { _id: jobName, owner: INSTANCE_ID },
        { $set: { expiresAt: new Date() } },
      );
  }

  private async syncJobLeaseStatus(
    jobName: string,
    status: "completed" | "failed",
    error: string | null,
    durationMs: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const lastStatus: "success" | "failure" =
      status === "completed" ? "success" : "failure";
    try {
      await this.db.collection<JobLeaseDoc>(JOB_LEASES_COLLECTION).updateOne(
        { _id: jobName, owner: INSTANCE_ID },
        {
          $set: {
            lastRun: now,
            lastStatus,
            lastError: error,
            lastDurationMs: durationMs,
          },
        },
      );
    } catch {
      // Best-effort status update — lease may have expired
    }
  }

  // ── Status tracking ──

  private recordJobSuccess(name: string, durationMs: number): void {
    const status = this.ensureJobStatus(name);
    status.lastRun = new Date().toISOString();
    status.lastStatus = "success";
    status.lastError = null;
    status.lastDurationMs = durationMs;
    this.logger?.info("job completed", { job: name, durationMs });
  }

  private recordJobFailure(
    name: string,
    err: unknown,
    durationMs: number,
  ): void {
    const status = this.ensureJobStatus(name);
    status.lastRun = new Date().toISOString();
    status.lastStatus = "failure";
    status.lastError = err instanceof Error ? err.message : String(err);
    status.lastDurationMs = durationMs;
    this.logger?.error("job failed", { job: name, durationMs, error: err });
  }
}
