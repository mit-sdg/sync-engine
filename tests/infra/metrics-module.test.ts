import { describe, expect, test } from "bun:test";
import { MetricsModule } from "@sync-engine/infra/metrics-module.ts";
import type { JobStatus } from "@sync-engine/infra/types.ts";

describe("MetricsModule", () => {
  test("recordHttpRequest() increments requestCount once (no double-count)", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordHttpRequest();
    metrics.recordHttpRequest();

    const payload = metrics.getMetricsPayload();
    expect(payload.requests.total).toBe(2);
  });

  test("recordHttpError() increments errorCount", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordHttpError();
    metrics.recordHttpError();

    const payload = metrics.getMetricsPayload();
    expect(payload.requests.errors).toBe(2);
  });

  test("recordRouteLatency() accumulates route stats and status codes", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordRouteLatency("/auth/login", 200, 45);
    metrics.recordRouteLatency("/auth/login", 200, 55);
    metrics.recordRouteLatency("/auth/me", 200, 100);

    const payload = metrics.getMetricsPayload();
    expect(payload.routeLatency["/auth/login"].count).toBe(2);
    expect(payload.routeLatency["/auth/login"].avgMs).toBe(50);
    expect(payload.routeLatency["/auth/me"].count).toBe(1);
    expect(payload.statusCodes["200"]).toBe(3);
  });

  test("recordRateLimitHit() increments rate limit counter", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordRateLimitHit();
    metrics.recordRateLimitHit();

    const payload = metrics.getMetricsPayload();
    expect(payload.rateLimitHits).toBe(2);
  });

  test("recordValidationFailure() increments validation failure counter", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordValidationFailure();

    const payload = metrics.getMetricsPayload();
    expect(payload.validationFailures).toBe(1);
  });

  test("recordBodyTooLarge() increments bodyTooLargeHits counter", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordBodyTooLarge();

    const payload = metrics.getMetricsPayload();
    expect(payload.bodyTooLargeHits).toBe(1);
    // body-too-large is a separate counter, not folded into validationFailures
    expect(payload.validationFailures).toBe(0);
  });

  test("recordError maps INVALID_CREDENTIALS correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("INVALID_CREDENTIALS");
    metrics.recordError("INVALID_CREDENTIALS");

    const payload = metrics.getMetricsPayload();
    expect(payload.authFailures.invalidCredentials).toBe(2);
  });

  test("recordError maps UNAUTHORIZED correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("UNAUTHORIZED");

    const payload = metrics.getMetricsPayload();
    expect(payload.authFailures.unauthorized).toBe(1);
  });

  test("recordError maps FORBIDDEN correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("FORBIDDEN");

    const payload = metrics.getMetricsPayload();
    expect(payload.authFailures.forbidden).toBe(1);
  });

  test("recordError maps INVALID_SESSION correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("INVALID_SESSION");

    const payload = metrics.getMetricsPayload();
    expect(payload.authFailures.invalidSession).toBe(1);
  });

  test("recordError maps VALIDATION_FAILED correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("VALIDATION_FAILED");

    const payload = metrics.getMetricsPayload();
    expect(payload.validationFailures).toBe(1);
  });

  test("recordError maps RATE_LIMITED correctly", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("RATE_LIMITED");

    const payload = metrics.getMetricsPayload();
    expect(payload.rateLimitHits).toBe(1);
  });

  test("recordError ignores unknown error codes", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });
    metrics.recordError("SOME_UNKNOWN_CODE");

    const payload = metrics.getMetricsPayload();
    // All auth failure counters should remain 0
    expect(payload.authFailures.invalidCredentials).toBe(0);
    expect(payload.authFailures.unauthorized).toBe(0);
    expect(payload.authFailures.forbidden).toBe(0);
    expect(payload.authFailures.invalidSession).toBe(0);
    expect(payload.validationFailures).toBe(0);
    expect(payload.rateLimitHits).toBe(0);
  });

  test("getMetricsPayload() returns all required fields", () => {
    const jobStatus: JobStatus = {
      name: "daily_obligations",
      lastRun: "2025-01-01T00:00:00Z",
      lastStatus: "success",
      lastError: null,
      lastDurationMs: 150,
    };
    const metrics = new MetricsModule({ getJobStatuses: () => [jobStatus] });
    metrics.recordHttpRequest();
    metrics.recordHttpError();

    const payload = metrics.getMetricsPayload();

    // Top-level fields
    expect(payload).toHaveProperty("uptime");
    expect(payload).toHaveProperty("requests");
    expect(payload).toHaveProperty("statusCodes");
    expect(payload).toHaveProperty("routeLatency");
    expect(payload).toHaveProperty("authFailures");
    expect(payload).toHaveProperty("validationFailures");
    expect(payload).toHaveProperty("rateLimitHits");
    expect(payload).toHaveProperty("jobs");
    expect(payload).toHaveProperty("memory");
    expect(payload).toHaveProperty("nodeEnv");

    // Uptime shape
    expect(payload.uptime).toHaveProperty("ms");
    expect(payload.uptime).toHaveProperty("seconds");
    expect(payload.uptime).toHaveProperty("human");
    expect(typeof payload.uptime.human).toBe("string");
    expect(payload.uptime.ms).toBeGreaterThanOrEqual(0);

    // Memory shape
    expect(payload.memory).toHaveProperty("rss");
    expect(payload.memory).toHaveProperty("heapTotal");
    expect(payload.memory).toHaveProperty("heapUsed");
    expect(payload.memory).toHaveProperty("external");

    // Jobs
    expect(payload.jobs.length).toBe(1);
    expect(payload.jobs[0].name).toBe("daily_obligations");
  });

  test("getJobStatuses callback wires job statuses into payload", () => {
    const jobStatuses: JobStatus[] = [
      {
        name: "job_a",
        lastRun: "2025-06-01T00:00:00Z",
        lastStatus: "success",
        lastError: null,
        lastDurationMs: 42,
      },
      {
        name: "job_b",
        lastRun: "2025-06-02T00:00:00Z",
        lastStatus: "failure",
        lastError: "timeout",
        lastDurationMs: 999,
      },
    ];
    const metrics = new MetricsModule({ getJobStatuses: () => jobStatuses });

    const payload = metrics.getMetricsPayload();
    expect(payload.jobs).toEqual(jobStatuses);
  });

  test("attach() stores observer unsubscriber and stop() calls it", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });

    // Create a mock engine
    let unsubCalled = false;
    const mockEngine = {
      addObserver() {
        return () => {
          unsubCalled = true;
        };
      },
    } as unknown as Parameters<MetricsModule["attach"]>[0];

    metrics.attach(mockEngine);
    expect(unsubCalled).toBe(false);

    metrics.stop?.();
    expect(unsubCalled).toBe(true);
  });

  test("stop() handles multiple attached engines", () => {
    const metrics = new MetricsModule({ getJobStatuses: () => [] });

    let unsubCount = 0;
    function makeEngine() {
      return {
        addObserver() {
          return () => {
            unsubCount++;
          };
        },
      } as unknown as Parameters<MetricsModule["attach"]>[0];
    }

    metrics.attach(makeEngine());
    metrics.attach(makeEngine());
    metrics.attach(makeEngine());

    metrics.stop?.();
    expect(unsubCount).toBe(3);
  });
});
