import {
  AnalysisAbortedError,
  AnalysisLimitError,
  analyzeApplicationProject,
  applicationProjectAnalysisDigest,
  loadApplicationProject,
  renderApplicationProjectAnalysis,
} from "@mit-sdg/sync-engine-analysis/tooling";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  applicationProjectFixture,
  fixtureOptions,
  type ApplicationProjectFixture,
} from "./application-project-fixture.ts";

const fixtures: ApplicationProjectFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function fixture(options: { readonly large?: boolean } = {}): ApplicationProjectFixture {
  const value = applicationProjectFixture(options);
  fixtures.push(value);
  return value;
}

describe("application project worker", () => {
  test("returns the exact synchronous snapshot through the source worker URL", async () => {
    const project = fixture();
    const options = fixtureOptions(project);
    const synchronous = loadApplicationProject(options);
    const worker = await analyzeApplicationProject(options);

    expect(renderApplicationProjectAnalysis(worker)).toBe(
      renderApplicationProjectAnalysis(synchronous),
    );
    expect(applicationProjectAnalysisDigest(worker)).toBe(
      applicationProjectAnalysisDigest(synchronous),
    );
  });

  test("observes pre-abort before worker work and terminates in-flight analysis", async () => {
    const preAbort = new AbortController();
    preAbort.abort("before spawn");
    await expect(
      analyzeApplicationProject({
        ...fixtureOptions(fixture()),
        repositoryRoot: "/path/that/must/not/be-read",
        signal: preAbort.signal,
      }),
    ).rejects.toMatchObject({ name: "AnalysisAbortedError", reason: "before spawn" });

    const project = fixture({ large: true });
    const inFlight = new AbortController();
    const pending = analyzeApplicationProject({
      ...fixtureOptions(project),
      signal: inFlight.signal,
    });
    setTimeout(() => inFlight.abort("stop worker"), 0);
    await expect(pending).rejects.toBeInstanceOf(AnalysisAbortedError);
    await expect(pending).rejects.toMatchObject({ reason: "stop worker" });
  });

  test("rejects custom readers and reconstructs worker errors", async () => {
    const project = fixture();
    const options = fixtureOptions(project);
    await expect(
      analyzeApplicationProject({
        ...options,
        readFile: () => undefined,
      } as never),
    ).rejects.toThrow(/does not accept readFile/);
    await expect(
      analyzeApplicationProject({ ...options, limits: { maxProjectFiles: 0 } }),
    ).rejects.toBeInstanceOf(AnalysisLimitError);
    await expect(
      analyzeApplicationProject({ ...options, tsconfigPath: "missing.json" }),
    ).rejects.toThrow(/tsconfigPath could not be resolved/);
  });

  test("rejects malformed and non-cloneable worker options before spawning", async () => {
    const options = fixtureOptions(fixture());
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolValue: Record<PropertyKey, unknown> = { value: true };
    symbolValue[Symbol("hidden")] = true;
    const accessorValue: Record<string, unknown> = {};
    Object.defineProperty(accessorValue, "value", {
      enumerable: true,
      get: () => true,
    });
    const symbolOptions: Record<PropertyKey, unknown> = { ...options };
    symbolOptions[Symbol("hidden")] = true;
    const accessorOptions: Record<string, unknown> = { ...options };
    Object.defineProperty(accessorOptions, "hidden", {
      enumerable: false,
      value: true,
    });
    class CustomOptions {
      repositoryRoot = options.repositoryRoot;
    }

    const cases: readonly [string, unknown, RegExp][] = [
      ["null", null, /plain object/],
      ["array", [], /plain object/],
      ["custom prototype", Object.assign(new CustomOptions(), options), /plain object/],
      ["symbol option", symbolOptions, /symbol fields/],
      ["non-enumerable option", accessorOptions, /enumerable data field/],
      ["invalid signal", { ...options, signal: {} }, /AbortSignal/],
      ["non-finite number", { ...options, limits: { maxGraphNodes: Number.NaN } }, /finite/],
      ["bigint", { ...options, limits: { maxGraphNodes: 1n } }, /plain data/],
      ["function", { ...options, sourceRoots: [{ path: () => "app.ts" }] }, /plain data/],
      ["cycle", { ...options, limits: cyclic }, /cycles/],
      ["non-plain value", { ...options, limits: new Date(0) }, /plain objects and arrays/],
      ["nested symbol", { ...options, limits: symbolValue }, /symbol fields/],
      ["nested accessor", { ...options, limits: accessorValue }, /enumerable data field/],
    ];
    for (const [label, value, message] of cases) {
      await expect(analyzeApplicationProject(value as never), label).rejects.toThrow(message);
    }
  });
});
