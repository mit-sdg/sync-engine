/**
 * MetricsModule — pluggable observability sink.
 *
 * Collects counters, latency histograms, and error breakdowns from two
 * sources:
 *  1. **Adapter-edge intake** — explicit method calls from the HTTP
 *     layer (recordHttpRequest, recordRouteLatency, etc.). Coverage:
 *     request count, status codes, route latency, rate-limit hits,
 *     validation failures, body-too-large.
 *  2. **Journal intake** — via `EngineObserver.onAction`. The
 *     observer watches Requesting events to break down domain errors
 *     (invalid credentials, unauthorized, forbidden, invalid session,
 *     validation failures, rate-limited).
 */

import type { EngineObserver, JournalEvent, SyncConcept } from "@sync-engine/engine";
import type {
  InfraModule,
  InfraResponse,
  InfraRoute,
  JobStatus,
} from "@sync-engine/infra/types.ts";

// ── Payload shape ──

export interface MetricsPayload {
  uptime: { ms: number; seconds: number; human: string };
  requests: { total: number; errors: number };
  statusCodes: Record<string, number>;
  routeLatency: Record<string, { count: number; avgMs: number }>;
  authFailures: {
    invalidCredentials: number;
    unauthorized: number;
    forbidden: number;
    invalidSession: number;
  };
  validationFailures: number;
  rateLimitHits: number;
  bodyTooLargeHits: number;
  jobs: JobStatus[];
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  nodeEnv: string;
}

// ── Module ──

/**
 * Identifies the request-boundary action whose input carries domain error
 * codes, so the journal observer can break errors down without hardcoding a
 * concept name. Defaults to the generic `Requesting.respond` boundary.
 */
export interface MetricsBoundary {
  conceptName: string;
  respondAction: string;
}

const DEFAULT_BOUNDARY: MetricsBoundary = {
  conceptName: "Requesting",
  respondAction: "respond",
};

export interface MetricsModuleConfig {
  getJobStatuses: () => JobStatus[];
  /** Request boundary to observe for domain-error breakdown. */
  boundary?: MetricsBoundary;
}

export class MetricsModule implements InfraModule {
  readonly name = "metrics";

  private readonly boundary: MetricsBoundary;

  constructor(private config: MetricsModuleConfig) {
    this.boundary = config.boundary ?? DEFAULT_BOUNDARY;
  }

  private startTime = Date.now();

  // Counters (replaces closure vars in multi-course-server.ts)
  private requestCount = 0;
  private errorCount = 0;
  private routeLatency = new Map<string, { count: number; totalMs: number }>();
  private statusCodes = new Map<number, number>();
  private authFailures = {
    invalidCredentials: 0,
    unauthorized: 0,
    forbidden: 0,
    invalidSession: 0,
  };
  private validationFailures = 0;
  private rateLimitHits = 0;
  private bodyTooLargeHits = 0;

  // ── Adapter-edge intake (for signals that never reach the journal) ──

  recordHttpRequest(): void {
    this.requestCount++;
  }

  recordHttpError(): void {
    this.errorCount++;
  }

  recordRouteLatency(route: string, status: number, ms: number): void {
    const entry = this.routeLatency.get(route) ?? { count: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += ms;
    this.routeLatency.set(route, entry);

    const sc = this.statusCodes.get(status) ?? 0;
    this.statusCodes.set(status, sc + 1);
  }

  recordRateLimitHit(): void {
    this.rateLimitHits++;
  }

  recordValidationFailure(): void {
    this.validationFailures++;
  }

  recordBodyTooLarge(): void {
    this.bodyTooLargeHits++;
  }

  /** Record an error code. Used by the HTTP adapter for errors that don't flow through the journal. */
  recordError(errCode: string): void {
    switch (errCode) {
      case "INVALID_CREDENTIALS":
        this.authFailures.invalidCredentials++;
        return;
      case "UNAUTHORIZED":
        this.authFailures.unauthorized++;
        return;
      case "FORBIDDEN":
        this.authFailures.forbidden++;
        return;
      case "INVALID_SESSION":
        this.authFailures.invalidSession++;
        return;
      case "VALIDATION_FAILED":
        this.validationFailures++;
        return;
      case "RATE_LIMITED":
        this.rateLimitHits++;
        return;
    }
  }

  // ── Journal intake ──

  private unsubObservers: Array<() => void> = [];

  attach(engine: SyncConcept): void {
    this.unsubObservers.push(engine.addObserver(this.observer));
  }

  stop(): void {
    for (const unsub of this.unsubObservers) {
      unsub();
    }
    this.unsubObservers = [];
  }

  private observer: EngineObserver = {
    onAction: (ev: JournalEvent) => {
      // Only observe the request boundary's respond action for domain error
      // breakdown. Errors flow through its input (the error key is part of
      // the response payload), not the output.
      if (ev.concept === this.boundary.conceptName && ev.action === this.boundary.respondAction) {
        const errCode = ev.input?.error;
        if (typeof errCode === "string") {
          this.recordError(errCode);
        }
      }
    },
  };

  // ── Metrics route ──

  get routes(): InfraRoute[] {
    return [
      {
        method: "GET",
        path: "/metrics",
        auth: "metrics-token",
        handler: () => this.handleMetrics(),
      },
    ];
  }

  private handleMetrics(): InfraResponse {
    // SAFETY: MetricsPayload is a closed, JSON-serializable object; widening it
    // to the neutral Record<string, unknown> body shape is sound.
    return {
      status: 200,
      body: this.getMetricsPayload() as unknown as Record<string, unknown>,
    };
  }

  // ── Payload (exact same shape as AGENTS.md:121-152) ──

  getMetricsPayload(): MetricsPayload {
    const uptime = Date.now() - this.startTime;
    const memUsage = process.memoryUsage();
    const latencyEntries: Record<string, { count: number; avgMs: number }> = {};
    for (const [route, entry] of this.routeLatency) {
      latencyEntries[route] = {
        count: entry.count,
        avgMs: entry.totalMs / entry.count,
      };
    }
    const statusEntries: Record<string, number> = {};
    for (const [code, count] of this.statusCodes) {
      statusEntries[String(code)] = count;
    }
    const jobEntries = this.config.getJobStatuses();
    return {
      uptime: {
        ms: uptime,
        seconds: Math.round(uptime / 1000),
        human: `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m ${Math.floor((uptime % 60000) / 1000)}s`,
      },
      requests: {
        total: this.requestCount,
        errors: this.errorCount,
      },
      statusCodes: statusEntries,
      routeLatency: latencyEntries,
      authFailures: { ...this.authFailures },
      validationFailures: this.validationFailures,
      rateLimitHits: this.rateLimitHits,
      bodyTooLargeHits: this.bodyTooLargeHits,
      jobs: jobEntries,
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
      },
      nodeEnv: process.env.NODE_ENV ?? "development",
    };
  }
}
