import { describe, expect, test } from "vite-plus/test";
import { vocabulary } from "@mit-sdg/sync-engine/language";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import {
  applicationManifest,
  affectedNodes,
  applicationDependencyGraph,
  applicationImpact,
  diagnosticsFail,
  renderApplicationManifest,
} from "@mit-sdg/sync-engine/tooling";

const words = vocabulary({ concepts: {}, computations: {} });
const First = endpoint(
  "/shared",
  ({ value }) => receive({ value }).then(respond({ source: "first", value })),
  {
    input: { required: ["value"], defaults: { z: 1, a: 2 } },
    validators: {
      input: (value) =>
        typeof (value as { value?: unknown }).value === "string" ? { ok: true } : { ok: false },
      output: () => ({ ok: true }),
    },
  },
);
const Second = endpoint("/shared", ({ value }) =>
  receive({ value }).then(respond({ source: "second", value })),
);

function application(reverse = false) {
  return assemble({
    vocabulary: words,
    composition: reverse ? { Second, First } : { First, Second },
    retention: "keepAll",
  });
}

describe("application manifest", () => {
  test("contains complete static design and structured endpoint diagnostics", () => {
    const manifest = applicationManifest(application());

    expect(manifest).toMatchObject({
      format: "sync-engine.application-manifest",
      version: 2,
      digest: expect.stringMatching(/^fnv1a64-[0-9a-f]{16}$/),
      localBehavior: { contract: null, observed: [] },
      endpoints: [
        {
          name: "First",
          path: "/shared",
          reactions: ["First"],
          validators: { input: true, output: true },
        },
        {
          name: "Second",
          path: "/shared",
          reactions: ["Second"],
          validators: { input: true, output: true },
        },
      ],
    });
    expect(manifest.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["ENDPOINT_PATH_OVERLAP", "MULTIPLE_RESPOND_CONSEQUENCES"]),
    );
    expect(diagnosticsFail(manifest.diagnostics)).toBe(false);
    expect(diagnosticsFail(manifest.diagnostics, "warnings")).toBe(true);
  });

  test("is JSON-round-trippable and byte-identical for equivalent assembly order", () => {
    const forward = renderApplicationManifest(applicationManifest(application()));
    const reverse = renderApplicationManifest(applicationManifest(application(true)));

    expect(JSON.parse(forward)).toEqual(JSON.parse(reverse));
    expect(forward).toBe(reverse);
    expect(forward).toMatch(/"defaults": \{\n\s+"a": 2,\n\s+"z": 1/);
  });

  test("keeps prototype-named defaults in canonical endpoint and contract design data", () => {
    const defaults = JSON.parse(
      '{"__proto__":{"constructor":1,"prototype":2},"constructor":3,"prototype":4}',
    );
    const Special = endpoint("/special", () => receive().then(respond({ ok: true })), {
      input: { defaults },
    });
    const app = assemble({ vocabulary: words, composition: { Special } });
    const manifest = applicationManifest(app);
    const contractDefaults = manifest.inputContracts["/special"].defaults as Record<
      string,
      unknown
    >;
    const endpointDefaults = manifest.endpoints[0].input.defaults as Record<string, unknown>;

    for (const retained of [contractDefaults, endpointDefaults]) {
      expect(Object.hasOwn(retained, "__proto__")).toBe(true);
      expect(Object.hasOwn(retained, "constructor")).toBe(true);
      expect(Object.hasOwn(retained, "prototype")).toBe(true);
      expect(Object.getPrototypeOf(retained)).toBe(Object.prototype);
    }
    const rendered = renderApplicationManifest(manifest);
    const roundTripped = JSON.parse(rendered);
    expect(roundTripped.inputContracts["/special"].defaults).toEqual(defaults);
    expect(roundTripped.endpoints[0].input.defaults).toEqual(defaults);
  });

  test("excludes retained occurrence state", async () => {
    const app = application();
    const before = renderApplicationManifest(applicationManifest(app));
    await app.invoker.invoke("/shared", { value: "recorded" });
    const after = renderApplicationManifest(applicationManifest(app));

    expect(after).toBe(before);
    expect(after).not.toContain("recorded");
    expect(after).not.toContain("occurrences");
  });

  test("the CLI prints canonical manifest JSON and exposes advisory diagnostics", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const config = "tests/package/application/generated.config.ts";
    const printed = spawnSync(
      "bun",
      ["src/command/main.ts", "artifacts", "manifest", "--config", config],
      { cwd: root, encoding: "utf8" },
    );
    expect(printed.status).toBe(0);
    expect(JSON.parse(printed.stdout)).toMatchObject({
      format: "sync-engine.application-manifest",
      version: 2,
    });
    expect(printed.stdout.endsWith("\n")).toBe(true);

    const checked = spawnSync(
      "bun",
      [
        "src/command/main.ts",
        "check",
        "--concepts",
        "tests/package/application/src/concepts",
        "--config",
        config,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Application diagnostic check passed");
  });

  test("derives stable dependency nodes, reverse impact, and changed outputs", () => {
    const before = applicationManifest(application());
    const graph = applicationDependencyGraph(before);
    const affected = affectedNodes(graph, ["reaction:First"]);

    expect(graph).toMatchObject({
      format: "sync-engine.application-dependency-graph",
      version: 2,
    });
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({ id: "action:RequestBoundary.request", kind: "action" }),
    );
    expect(affected).toEqual(
      expect.arrayContaining([
        "reaction:First",
        "endpoint:%2Fshared%23First",
        "output:%2Fshared%23First",
      ]),
    );

    const ChangedFirst = endpoint(
      "/shared",
      ({ value }) => receive({ value }).then(respond({ source: "changed", value })),
      {
        input: { required: ["value"], defaults: { a: 2, z: 1 } },
        validators: { input: () => ({ ok: true }), output: () => ({ ok: true }) },
      },
    );
    const changed = assemble({
      vocabulary: words,
      composition: { First: ChangedFirst, Second },
    });
    const impact = applicationImpact(before, applicationManifest(changed));
    expect(impact.wholeApplication).toBe(false);
    expect(impact.directlyChanged).toContain("reaction:First");
    expect(impact.endpoints).toContain("/shared#First");
    expect(impact.outputs).toContain("/shared#First");
  });
});
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
