import { describe, expect, test } from "bun:test";
import type { JobStatus } from "@sync-engine/infra/types.ts";
import { JobStatusRegistry } from "@sync-engine/runtime/job-status-registry.ts";

function status(name: string): JobStatus {
  return {
    name,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
  };
}

describe("JobStatusRegistry", () => {
  test("aggregates statuses across all sources", () => {
    const registry = new JobStatusRegistry();
    registry.add({ getJobStatuses: () => [status("a"), status("b")] });
    registry.add({ getJobStatuses: () => [status("c")] });

    expect(registry.all().map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  test("reads sources lazily — reflects live changes", () => {
    const registry = new JobStatusRegistry();
    let jobs: JobStatus[] = [];
    registry.add({ getJobStatuses: () => jobs });

    expect(registry.all()).toEqual([]);
    jobs = [status("late")];
    expect(registry.all().map((s) => s.name)).toEqual(["late"]);
  });

  test("disposer removes a source", () => {
    const registry = new JobStatusRegistry();
    const remove = registry.add({ getJobStatuses: () => [status("gone")] });

    expect(registry.all()).toHaveLength(1);
    remove();
    expect(registry.all()).toEqual([]);
  });
});
