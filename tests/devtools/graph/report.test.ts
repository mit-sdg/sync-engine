import { describe, expect, test } from "vite-plus/test";
import { assembleReport } from "@sync-engine/devtools/graph/report.ts";
import { When, Then, SyncConcept } from "@sync-engine/engine";
import type { RequestBoundary } from "@sync-engine/devtools/graph/types.ts";
import type { Vars } from "@sync-engine/engine";

class CounterConcept {
  count = 0;
  increment(_: unknown) {
    this.count++;
    return { count: this.count };
  }
}

class RequestingConcept {
  request(_input: unknown) {
    return {};
  }
  respond(_body: unknown) {
    return {};
  }
}

function makeBoundary(): RequestBoundary {
  return {
    conceptClass: RequestingConcept,
    entryAction: "request",
    exitAction: "respond",
    pathKey: "path",
  };
}

describe("assembleReport", () => {
  test("returns a SyncGraphReport with expected keys", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(report).toHaveProperty("graph");
    expect(report).toHaveProperty("reachability");
    expect(report).toHaveProperty("diagnostics");
    expect(report).toHaveProperty("meta");
  });

  test("meta includes totalSyncs, totalEndpoints, totalConcepts, and generatedAt", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(report.meta.totalSyncs).toBe(1);
    expect(report.meta.totalConcepts).toBeGreaterThanOrEqual(1);
    expect(typeof report.meta.totalEndpoints).toBe("number");
    expect(typeof report.meta.generatedAt).toBe("string");
  });

  test("graph has nodes and edges arrays", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(Array.isArray(report.graph.nodes)).toBe(true);
    expect(Array.isArray(report.graph.edges)).toBe(true);
  });

  test("reachability is an array", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(Array.isArray(report.reachability)).toBe(true);
  });

  test("diagnostics has findings array and summary", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(Array.isArray(report.diagnostics.findings)).toBe(true);
    expect(report.diagnostics.summary).toHaveProperty("totalFindings");
    expect(report.diagnostics.summary).toHaveProperty("correctnessSmells");
    expect(report.diagnostics.summary).toHaveProperty("complexityHeuristics");
  });

  test("custom diagnostic plugins are run", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
    });

    let pluginCalled = false;
    const plugin = {
      name: "test-plugin",
      detect: (_graph: any, _reachability: any) => {
        pluginCalled = true;
        return [];
      },
    };

    assembleReport(sync, boundary, [plugin]);
    expect(pluginCalled).toBe(true);
  });

  test("empty engine produces report with zero syncs", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const report = assembleReport(sync, boundary);

    expect(report.meta.totalSyncs).toBe(0);
    expect(Array.isArray(report.diagnostics.findings)).toBe(true);
  });

  test("multiple syncs are counted", () => {
    const sync = new SyncConcept();
    const boundary = makeBoundary();

    const instrumented = sync.instrument({ Counter: new CounterConcept() });
    const { Counter } = instrumented;

    sync.register({
      Increment: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}]),
      }),
      DoubleIncrement: (_vars: Vars) => ({
        when: When([Counter.increment, {}]),
        then: Then([Counter.increment, {}], [Counter.increment, {}]),
      }),
    });

    const report = assembleReport(sync, boundary);

    expect(report.meta.totalSyncs).toBe(2);
  });
});
