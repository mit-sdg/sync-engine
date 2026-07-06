import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { SchedulerModule } from "@sync-engine/infra/scheduler-module.ts";
import { setupTestDb, type TestMongo } from "@sync-engine/utils/testing.ts";

interface LeaseDoc {
  _id: string;
  owner: string;
  acquiredAt: Date;
  expiresAt: Date;
  lastRun: string | null;
  lastStatus: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

let mongo: TestMongo;

describe("SchedulerModule", () => {
  beforeAll(async () => {
    mongo = await setupTestDb("scheduler_test");
  });

  beforeEach(async () => {
    try {
      await mongo.db.dropCollection("_jobLeases").catch(() => {});
    } catch {
      // Collection may not exist
    }
  });

  test("register() adds job to getJobStatuses()", () => {
    const scheduler = new SchedulerModule(mongo.db);
    scheduler.register({
      name: "daily_obligations",
      intervalMs: 60_000,
      ttlMs: 300_000,
      run: async () => {},
    });

    const statuses = scheduler.getJobStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].name).toBe("daily_obligations");
    expect(statuses[0].lastRun).toBeNull();
    expect(statuses[0].lastStatus).toBeNull();
  });

  test("register() creates only one entry per logical name (no duplicates)", () => {
    const scheduler = new SchedulerModule(mongo.db, "registry");
    scheduler.register({
      name: "daily_obligations",
      intervalMs: 60_000,
      ttlMs: 300_000,
      run: async () => {},
    });

    // Force a success recording — uses logical name, NOT namespaced name
    (scheduler as unknown as Record<string, () => void>).start?.();
    scheduler.stop();

    const statuses = scheduler.getJobStatuses();
    // Should still be exactly 1 entry
    expect(statuses.length).toBe(1);
    expect(statuses[0].name).toBe("daily_obligations");
  });

  test("loadJobStatusesFromDb() strips namespace prefix", async () => {
    const scheduler = new SchedulerModule(mongo.db, "registry");

    // Simulate a persisted lease doc with namespaced _id
    await mongo.db.collection<LeaseDoc>("_jobLeases").insertOne({
      _id: "registry_daily_obligations",
      owner: "some-instance",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
      lastRun: "2025-06-01T00:00:00Z",
      lastStatus: "success",
      lastError: null,
      lastDurationMs: 42,
    } satisfies LeaseDoc);

    await scheduler.loadJobStatusesFromDb();

    const statuses = scheduler.getJobStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].name).toBe("daily_obligations");
    expect(statuses[0].lastRun).toBe("2025-06-01T00:00:00Z");
    expect(statuses[0].lastStatus).toBe("success");
    expect(statuses[0].lastDurationMs).toBe(42);
  });

  test("loadJobStatusesFromDb() handles no prefix", async () => {
    const scheduler = new SchedulerModule(mongo.db);

    await mongo.db.collection<LeaseDoc>("_jobLeases").insertOne({
      _id: "session_expiry",
      owner: "some-instance",
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
      lastRun: "2025-06-01T12:00:00Z",
      lastStatus: "failure",
      lastError: "timeout",
      lastDurationMs: 999,
    } satisfies LeaseDoc);

    await scheduler.loadJobStatusesFromDb();

    const statuses = scheduler.getJobStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].name).toBe("session_expiry");
    expect(statuses[0].lastStatus).toBe("failure");
    expect(statuses[0].lastError).toBe("timeout");
  });

  test("recordJobSuccess updates status correctly", () => {
    const scheduler = new SchedulerModule(mongo.db);
    scheduler.register({
      name: "test_job",
      intervalMs: 1000,
      ttlMs: 10_000,
      run: async () => {},
    });

    // Access private method via type cast for testing
    const instance = scheduler as unknown as {
      recordJobSuccess(name: string, dur: number): void;
    };
    instance.recordJobSuccess("test_job", 150);

    const statuses = scheduler.getJobStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].lastStatus).toBe("success");
    expect(statuses[0].lastError).toBeNull();
    expect(statuses[0].lastDurationMs).toBe(150);
    expect(statuses[0].lastRun).not.toBeNull();
  });

  test("recordJobFailure updates status correctly", () => {
    const scheduler = new SchedulerModule(mongo.db);
    scheduler.register({
      name: "test_job",
      intervalMs: 1000,
      ttlMs: 10_000,
      run: async () => {},
    });

    const instance = scheduler as unknown as {
      recordJobFailure(name: string, err: unknown, dur: number): void;
    };
    instance.recordJobFailure("test_job", new Error("something broke"), 500);

    const statuses = scheduler.getJobStatuses();
    expect(statuses.length).toBe(1);
    expect(statuses[0].lastStatus).toBe("failure");
    expect(statuses[0].lastError).toBe("something broke");
    expect(statuses[0].lastDurationMs).toBe(500);
  });

  test("logger is called on success", () => {
    interface LogEntry {
      level: string;
      msg: string;
      meta?: { job: string; durationMs: number };
    }
    const logged: LogEntry[] = [];
    const logger = {
      info(msg: string, meta?: object) {
        logged.push({ level: "info", msg, meta: meta as LogEntry["meta"] });
      },
      error(msg: string, meta?: object) {
        logged.push({ level: "error", msg, meta: meta as LogEntry["meta"] });
      },
    };

    const scheduler = new SchedulerModule(mongo.db, undefined, logger);
    scheduler.register({
      name: "test_job",
      intervalMs: 1000,
      ttlMs: 10_000,
      run: async () => {},
    });

    const instance = scheduler as unknown as {
      recordJobSuccess(name: string, dur: number): void;
    };
    instance.recordJobSuccess("test_job", 42);

    expect(logged.length).toBe(1);
    expect(logged[0].level).toBe("info");
    expect(logged[0].msg).toBe("job completed");
    expect(logged[0].meta?.job).toBe("test_job");
    expect(logged[0].meta?.durationMs).toBe(42);
  });

  test("logger is called on failure", () => {
    interface LogEntry {
      level: string;
      msg: string;
      meta?: { job: string; durationMs: number; error: Error };
    }
    const logged: LogEntry[] = [];
    const logger = {
      info(msg: string, meta?: object) {
        logged.push({ level: "info", msg, meta: meta as LogEntry["meta"] });
      },
      error(msg: string, meta?: object) {
        logged.push({ level: "error", msg, meta: meta as LogEntry["meta"] });
      },
    };

    const scheduler = new SchedulerModule(mongo.db, undefined, logger);
    scheduler.register({
      name: "test_job",
      intervalMs: 1000,
      ttlMs: 10_000,
      run: async () => {},
    });

    const instance = scheduler as unknown as {
      recordJobFailure(name: string, err: unknown, dur: number): void;
    };
    const err = new Error("boom");
    instance.recordJobFailure("test_job", err, 500);

    expect(logged.length).toBe(1);
    expect(logged[0].level).toBe("error");
    expect(logged[0].msg).toBe("job failed");
    expect(logged[0].meta?.job).toBe("test_job");
    expect(logged[0].meta?.error).toBe(err);
  });

  test("start() and stop() manage timers", () => {
    const scheduler = new SchedulerModule(mongo.db);
    scheduler.register({
      name: "test_job",
      intervalMs: 60_000,
      ttlMs: 300_000,
      run: async () => {},
    });

    scheduler.start();
    // Can't easily test setInterval creation without timers mocks,
    // but we can verify stop() clears them without error.
    scheduler.stop();
    // No error thrown
  });

  afterAll(() => mongo.stop());
});
