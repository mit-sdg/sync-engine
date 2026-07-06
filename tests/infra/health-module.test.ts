import { describe, expect, test } from "vite-plus/test";
import { HealthModule } from "@sync-engine/infra/health-module.ts";
import type { InfraRoute, JobStatus } from "@sync-engine/infra/types.ts";

function makeJobStatuses(overrides: Partial<JobStatus>[] = []): JobStatus[] {
  return overrides.map((o) => ({
    name: o.name ?? "test_job",
    lastRun: o.lastRun ?? null,
    lastStatus: o.lastStatus ?? null,
    lastError: o.lastError ?? null,
    lastDurationMs: o.lastDurationMs ?? null,
  }));
}

function getRoute(mod: HealthModule, path: string): InfraRoute {
  const routes = mod.routes ?? [];
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`Route ${path} not found`);
  return route;
}

interface ReadyBody {
  status: string;
  ready: boolean;
  checks: { mongodb: string; indexes: string; migrations?: string };
  details: Record<string, string>;
  jobs: {
    total: number;
    failing: number;
    details?: Array<{ name: string; lastError: string | null }>;
  };
}

describe("HealthModule", () => {
  test("GET /health returns 200 { status: 'ok' }", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
    });
    const route = getRoute(mod, "/health");

    const res = await route.handler();
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body).toEqual({ status: "ok" });
  });

  test("GET /ready without readinessCheck — no jobs — returns 200", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(200);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("ok");
    expect(body.ready).toBe(true);
    expect(body.checks).toEqual({
      mongodb: "not configured",
      indexes: "not configured",
    });
    expect(body.jobs.total).toBe(0);
  });

  test("GET /ready without readinessCheck — failing jobs — returns 503", async () => {
    const jobStatuses = makeJobStatuses([
      {
        name: "daily_obligations",
        lastRun: "2025-06-01T00:00:00Z",
        lastStatus: "failure",
        lastError: "timeout",
        lastDurationMs: 5000,
      },
    ]);
    const mod = new HealthModule({
      getJobStatuses: () => jobStatuses,
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(503);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("degraded");
    expect(body.ready).toBe(false);
    expect(body.jobs.failing).toBe(1);
    expect(body.jobs.details).toEqual([{ name: "daily_obligations", lastError: "timeout" }]);
  });

  test("GET /ready with readinessCheck — healthy — returns 200", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => ({
        ready: true,
        mongodb: true,
        indexes: true,
        details: {},
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(200);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("ok");
    expect(body.ready).toBe(true);
    expect(body.checks).toEqual({
      mongodb: "ok",
      indexes: "ok",
      migrations: "not configured",
    });
  });

  test("GET /ready with readinessCheck — DB down — returns 503", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => ({
        ready: false,
        mongodb: false,
        indexes: false,
        details: { mongo: "connection refused" },
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(503);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("degraded");
    expect(body.ready).toBe(false);
    expect(body.checks).toEqual({
      mongodb: "down",
      indexes: "missing",
      migrations: "not configured",
    });
    expect(body.details).toEqual({ mongo: "connection refused" });
  });

  test("GET /ready with readinessCheck — ready but failing job — returns 503", async () => {
    const jobStatuses = makeJobStatuses([
      {
        name: "session_expiry",
        lastRun: "2025-06-01T12:00:00Z",
        lastStatus: "failure",
        lastError: "timeout",
        lastDurationMs: 2000,
      },
    ]);
    const mod = new HealthModule({
      getJobStatuses: () => jobStatuses,
      readinessCheck: async () => ({
        ready: true,
        mongodb: true,
        indexes: true,
        details: {},
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(503);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("degraded");
    expect(body.ready).toBe(false);
    expect(body.jobs.failing).toBe(1);
  });

  test("GET /ready with readinessCheck — throws — returns 503", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => {
        throw new Error("boom");
      },
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(503);

    const body = res.body as unknown as ReadyBody;
    expect(body.status).toBe("error");
    expect(body.ready).toBe(false);
    expect(body.checks).toEqual({
      mongodb: "down",
      indexes: "unknown",
    });
    expect(body.details).toEqual({ error: "boom" });
  });

  test("GET /ready with readinessCheck — migrations applied", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => ({
        ready: true,
        mongodb: true,
        indexes: true,
        details: {},
        migrations: { applied: true, missing: [] },
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    expect(res.status).toBe(200);

    const body = res.body as unknown as ReadyBody;
    expect(body.checks.migrations).toBe("ok");
  });

  test("GET /ready with readinessCheck — migrations pending but ready", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => ({
        ready: true,
        mongodb: true,
        indexes: true,
        details: {},
        migrations: { applied: false, missing: [3, 4] },
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    // The ready flag is true → 200; migrations status is informational only
    expect(res.status).toBe(200);

    const body = res.body as unknown as ReadyBody;
    expect(body.checks.migrations).toBe("pending");
  });

  test("GET /ready with readinessCheck — migrations error but ready", async () => {
    const mod = new HealthModule({
      getJobStatuses: () => [],
      readinessCheck: async () => ({
        ready: true,
        mongodb: true,
        indexes: true,
        details: {},
        migrations: {
          applied: false,
          missing: [1],
          error: "migration_1_failed",
        },
      }),
    });
    const route = getRoute(mod, "/ready");

    const res = await route.handler();
    // The ready flag is true → 200; migrations status is informational
    expect(res.status).toBe(200);

    const body = res.body as unknown as ReadyBody;
    expect(body.checks.migrations).toBe("error");
  });
});
