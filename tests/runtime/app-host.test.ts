import { describe, expect, test } from "vite-plus/test";
import { AppHost, type AppSink, type CreatedApp } from "@sync-engine/runtime";

interface FakeApp {
  id: string;
}

function recordingSink(events: string[]): AppSink<FakeApp> {
  return {
    registerApp: (prefix) => void events.push(`+${prefix}`),
    unregisterApp: (prefix) => void events.push(`-${prefix}`),
  };
}

describe("AppHost", () => {
  test("register builds the app, tracks it, and notifies the sink", async () => {
    const events: string[] = [];
    const host = new AppHost<FakeApp, { id: string }>(
      {
        create: (_prefix, params): CreatedApp<FakeApp> => ({
          app: { id: params.id },
          type: "tenant",
          resources: [],
        }),
      },
      recordingSink(events),
    );

    const entry = await host.register("ted", { id: "course-1" });

    expect(entry.app.id).toBe("course-1");
    expect(host.has("ted")).toBe(true);
    expect(host.get("ted")?.app.id).toBe("course-1");
    expect(host.entries()).toEqual({
      ted: { app: { id: "course-1" }, type: "tenant" },
    });
    expect(events).toEqual(["+ted"]);
  });

  test("register is idempotent — second call reuses entry, no rebuild or sink", async () => {
    const events: string[] = [];
    let builds = 0;
    const host = new AppHost<FakeApp, { id: string }>(
      {
        create: (_prefix, params): CreatedApp<FakeApp> => {
          builds += 1;
          return { app: { id: params.id }, type: "tenant", resources: [] };
        },
      },
      recordingSink(events),
    );

    const first = await host.register("ted", { id: "course-1" });
    const second = await host.register("ted", { id: "course-2" });

    expect(builds).toBe(1);
    expect(second).toBe(first);
    expect(events).toEqual(["+ted"]);
  });

  test("unregister stops resources in reverse order, drops the app, notifies sink", async () => {
    const events: string[] = [];
    const stops: string[] = [];
    const host = new AppHost<FakeApp, undefined>(
      {
        create: (prefix): CreatedApp<FakeApp> => ({
          app: { id: prefix },
          type: "tenant",
          resources: [
            { stop: () => void stops.push(`${prefix}:1`) },
            { stop: () => void stops.push(`${prefix}:2`) },
          ],
        }),
      },
      recordingSink(events),
    );

    await host.register("ted", undefined);
    await host.unregister("ted");

    expect(stops).toEqual(["ted:2", "ted:1"]);
    expect(host.has("ted")).toBe(false);
    expect(events).toEqual(["+ted", "-ted"]);
  });

  test("unregister is a no-op for an unknown prefix", async () => {
    const events: string[] = [];
    const host = new AppHost<FakeApp, undefined>(
      {
        create: (prefix) => ({
          app: { id: prefix },
          type: "tenant",
          resources: [],
        }),
      },
      recordingSink(events),
    );

    await host.unregister("missing");
    expect(events).toEqual([]);
  });

  test("stopAll stops every tenant's resources without notifying the sink", async () => {
    const events: string[] = [];
    const stops: string[] = [];
    const host = new AppHost<FakeApp, undefined>(
      {
        create: (prefix): CreatedApp<FakeApp> => ({
          app: { id: prefix },
          type: "tenant",
          resources: [{ stop: () => void stops.push(prefix) }],
        }),
      },
      recordingSink(events),
    );

    await host.register("a", undefined);
    await host.register("b", undefined);
    await host.stopAll();

    expect(stops.sort()).toEqual(["a", "b"]);
    // stopAll does not unregister, so no "-" sink events.
    expect(events).toEqual(["+a", "+b"]);
  });

  test("works without a sink", async () => {
    const host = new AppHost<FakeApp, undefined>({
      create: (prefix) => ({
        app: { id: prefix },
        type: "tenant",
        resources: [],
      }),
    });

    await host.register("solo", undefined);
    expect(host.values().map((e) => e.app.id)).toEqual(["solo"]);
    await host.unregister("solo");
    expect(host.values()).toEqual([]);
  });

  // unregister() stops all resources via allSettled and collects failures
  // into an AggregateError so no error is silently discarded.
  test("should stop all resources even when one stop() throws", async () => {
    const events: string[] = [];
    const stopped: string[] = [];
    const host = new AppHost<FakeApp, undefined>(
      {
        create: (prefix): CreatedApp<FakeApp> => ({
          app: { id: prefix },
          type: "tenant",
          resources: [
            { stop: () => void stopped.push(`${prefix}:1`) },
            {
              stop: () => {
                stopped.push(`${prefix}:fails`);
                throw new Error("stop failed");
              },
            },
            { stop: () => void stopped.push(`${prefix}:3`) },
          ],
        }),
      },
      recordingSink(events),
    );

    await host.register("ted", undefined);

    const err = await host.unregister("ted").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors.some((e) => String(e).includes("stop failed"))).toBe(
      true,
    );

    // All resources still ran despite the failure.
    expect(stopped).toContain("ted:1");
  });

  test("stopAll collects both sync throws and async rejections into AggregateError", async () => {
    const stopped: string[] = [];
    const host = new AppHost<FakeApp, undefined>({
      create: (prefix): CreatedApp<FakeApp> => ({
        app: { id: prefix },
        type: "tenant",
        resources: [
          {
            stop: () => {
              stopped.push("sync-fail");
              throw new Error("sync boom");
            },
          },
          {
            stop: async () => {
              stopped.push("async-fail");
              throw new Error("async boom");
            },
          },
          { stop: () => void stopped.push("ok") },
        ],
      }),
    });

    await host.register("a", undefined);

    const err = await host.stopAll().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors.some((e) => String(e).includes("sync boom"))).toBe(true);
    expect((err as AggregateError).errors.some((e) => String(e).includes("async boom"))).toBe(true);
    expect(stopped).toContain("sync-fail");
    expect(stopped).toContain("async-fail");
    expect(stopped).toContain("ok");
  });

  test("concurrent register() deduplicates — both calls return the same promise", async () => {
    let creates = 0;
    const host = new AppHost<FakeApp, { id: string }>({
      create: (_prefix, params): CreatedApp<FakeApp> => {
        creates += 1;
        return { app: { id: params.id }, type: "tenant", resources: [] };
      },
    });

    const [first, second] = await Promise.all([
      host.register("same", { id: "x" }),
      host.register("same", { id: "y" }),
    ]);

    expect(first).toBe(second);
    expect(creates).toBe(1);
    expect(host.values()).toHaveLength(1);
    expect(host.values()[0].app.id).toBe("x");
  });

  test("register() preempted by unregister() during async create does not add the app", async () => {
    let resolveCreate: (v: CreatedApp<FakeApp>) => void;
    const createPromise = new Promise<CreatedApp<FakeApp>>((r) => {
      resolveCreate = r;
    });

    const host = new AppHost<FakeApp, undefined>({
      create: (): CreatedApp<FakeApp> | Promise<CreatedApp<FakeApp>> => createPromise,
    });

    const regPromise = host.register("ted", undefined);
    await host.unregister("ted");

    resolveCreate!({
      app: { id: "ted" },
      type: "tenant",
      resources: [],
    });

    await regPromise;

    expect(host.has("ted")).toBe(false);
    expect(host.values()).toHaveLength(0);
  });
});
