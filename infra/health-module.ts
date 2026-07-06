/**
 * HealthModule — pluggable liveness and readiness endpoints.
 *
 * Provides GET /health (always 200) and GET /ready (200/503 based on
 * DB connectivity, index state, migration status, and job health).
 *
 * The readiness check is injected via config so this module stays
 * app-agnostic (no concept or edumen-specific imports).
 */

import type {
  InfraModule,
  InfraResponse,
  InfraRoute,
  JobStatus,
} from "@sync-engine/infra/types.ts";

// ── Configuration ──

export interface HealthModuleConfig {
  /** Returns job statuses (provided by scheduler module or external). */
  getJobStatuses: () => JobStatus[];
  /** Optional readiness check (app-specific — e.g., MongoDB + migrations). */
  readinessCheck?: () => Promise<ReadinessResult>;
}

export interface ReadinessResult {
  ready: boolean;
  mongodb: boolean;
  indexes: boolean;
  details: Record<string, string>;
  migrations?: { applied: boolean; missing: number[]; error?: string };
}

// ── Helpers ──

function result(body: Record<string, unknown>, status: number): InfraResponse {
  return { status, body };
}

function failingJobDetails(jobStatuses: JobStatus[]) {
  return jobStatuses
    .filter((j) => j.lastStatus === "failure")
    .map((j) => ({ name: j.name, lastError: j.lastError }));
}

// ── Module ──

export class HealthModule implements InfraModule {
  readonly name = "health";

  constructor(private config: HealthModuleConfig) {}

  get routes(): InfraRoute[] {
    return [
      {
        method: "GET",
        path: "/health",
        auth: "none",
        handler: () => this.handleHealth(),
      },
      {
        method: "GET",
        path: "/ready",
        auth: "none",
        handler: () => this.handleReady(),
      },
    ];
  }

  private handleHealth(): InfraResponse {
    return result({ status: "ok" }, 200);
  }

  private async handleReady(): Promise<InfraResponse> {
    const jobStatuses = this.config.getJobStatuses();
    const failingJobs = failingJobDetails(jobStatuses);

    if (!this.config.readinessCheck) {
      if (failingJobs.length > 0) {
        return result(
          {
            status: "degraded",
            ready: false,
            checks: {
              mongodb: "not configured",
              indexes: "not configured",
            },
            jobs: {
              total: jobStatuses.length,
              failing: failingJobs.length,
              details: failingJobs,
            },
          },
          503,
        );
      }
      return result(
        {
          status: "ok",
          ready: true,
          checks: {
            mongodb: "not configured",
            indexes: "not configured",
          },
          jobs: {
            total: jobStatuses.length,
            failing: 0,
          },
        },
        200,
      );
    }

    try {
      const readiness = await this.config.readinessCheck();
      const ready = readiness.ready && failingJobs.length === 0;
      const statusCode = ready ? 200 : 503;
      return result(
        {
          status: ready ? "ok" : "degraded",
          ready,
          checks: {
            mongodb: readiness.mongodb ? "ok" : "down",
            indexes: readiness.indexes ? "ok" : "missing",
            migrations: readiness.migrations
              ? readiness.migrations.applied
                ? "ok"
                : readiness.migrations.error
                  ? "error"
                  : "pending"
              : "not configured",
          },
          details: readiness.details,
          jobs: {
            total: jobStatuses.length,
            failing: failingJobs.length,
            details: failingJobs,
          },
        },
        statusCode,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return result(
        {
          status: "error",
          ready: false,
          checks: {
            mongodb: "down",
            indexes: "unknown",
          },
          details: { error: message },
          jobs: {
            total: jobStatuses.length,
            failing: failingJobs.length,
          },
        },
        503,
      );
    }
  }
}
