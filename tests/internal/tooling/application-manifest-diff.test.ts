import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "@mit-sdg/sync-engine/assembly";
import { vocabulary } from "@mit-sdg/sync-engine/advanced";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { applicationManifest, renderApplicationManifest } from "@mit-sdg/sync-engine/tooling";
import type { ApplicationManifestV1 } from "@mit-sdg/sync-engine/tooling";
import { diffApplicationManifests } from "@engine/tooling/application-manifest-diff";
import { applicationManifestDigest } from "@engine/tooling/application-manifest-format";
import { inspectGenerated } from "@engine/tooling/generated-artifacts";
import { loadGeneratedApplication } from "@command/generated-config";
import { ordinal } from "@engine/utils/ordinal";
import { describe, expect, test } from "vite-plus/test";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const main = join(root, "src/command/main.ts");
const packagingConfigPath = "tests/packaging/application/generated.config.ts";
const words = vocabulary({ concepts: {}, computations: {} });

const equivalentDefault = {
  first: { alpha: 1, beta: 2 },
  second: ["one", "two"],
};
const reorderedEquivalentDefault = {
  second: ["one", "two"],
  first: { beta: 2, alpha: 1 },
};
const oldCompoundDefault = {
  nested: { phase: "old", retained: true },
  values: [1, { selected: "old" }],
};
const currentCompoundDefault = {
  nested: { phase: "new", retained: true },
  values: [1, { selected: "old" }],
};

const Stable = endpoint("/stable", () => receive().then(respond({ ok: true })), {
  input: {
    required: ["id", "obsolete"],
    defaults: {
      changed: 1,
      compound: oldCompoundDefault,
      removed: "old",
      reordered: equivalentDefault,
    },
  },
});
const Removed = endpoint("/removed", () => receive().then(respond({ ok: true })), {
  input: {
    required: ["legacy"],
    defaults: { legacy: { state: "removed" } },
  },
});
const CurrentStable = endpoint("/stable", () => receive().then(respond({ ok: true })), {
  input: {
    required: ["id", "required"],
    defaults: {
      added: true,
      changed: 2,
      compound: currentCompoundDefault,
      reordered: reorderedEquivalentDefault,
    },
  },
});
const Added = endpoint("/added", () => receive().then(respond({ ok: true })), {
  input: {
    required: ["introduced"],
    defaults: { introduced: { state: "added" } },
  },
});
const Shared = endpoint("/stable", () => receive().then(respond({ ok: true })));

function fixtureManifest(): ApplicationManifestV1 {
  return applicationManifest(assemble({ vocabulary: words, composition: { Stable, Removed } }));
}

function changedFixtureManifest(): ApplicationManifestV1 {
  return applicationManifest(
    assemble({ vocabulary: words, composition: { Stable: CurrentStable, Added, Shared } }),
  );
}

function refusalManifest(code: string): ApplicationManifestV1 {
  class Refusing {
    static readonly outcomes = { act: { refusals: [code] } } as const;

    act() {
      return {};
    }
  }
  return applicationManifest(
    assemble({
      vocabulary: vocabulary({ concepts: { Refusing }, computations: {} }),
      composition: {},
    }),
  );
}

function reseal(manifest: ApplicationManifestV1): ApplicationManifestV1 {
  manifest.digest = applicationManifestDigest(manifest);
  return manifest;
}

function withInputDefault(
  manifest: ApplicationManifestV1,
  path: string,
  key: string,
  value: unknown,
): ApplicationManifestV1 {
  const input = {
    ...manifest.inputContracts[path]!,
    defaults: { ...manifest.inputContracts[path]!.defaults, [key]: value },
  };
  manifest.inputContracts = { ...manifest.inputContracts, [path]: input };
  manifest.endpoints = manifest.endpoints.map((endpoint) =>
    endpoint.path === path ? { ...endpoint, input } : endpoint,
  );
  return reseal(manifest);
}

function run(...args: string[]) {
  return spawnSync("bun", [main, ...args], { cwd: root, encoding: "utf8" });
}

async function manifestFor(config: string): Promise<ApplicationManifestV1> {
  const application = await loadGeneratedApplication(config, root);
  return inspectGenerated(application, (assembled) => applicationManifest(assembled));
}

async function checkedManifest(): Promise<ApplicationManifestV1> {
  return manifestFor(packagingConfigPath);
}

async function writeConceptFreeConfigs(directory: string): Promise<{
  empty: string;
  added: string;
}> {
  await writeFile(
    join(directory, "concepts.ts"),
    'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\n\n' +
      "export const applicationConceptSet = conceptSet({});\n",
  );
  const common =
    'import { assemble } from "@mit-sdg/sync-engine/assembly";\n' +
    'import { applicationConceptSet } from "./concepts.ts";\n\n';
  await writeFile(
    join(directory, "empty.config.ts"),
    common +
      "export default {\n" +
      "  assemble: () =>\n" +
      "    assemble({\n" +
      "      conceptSet: applicationConceptSet,\n" +
      "      instances: applicationConceptSet.implementations(),\n" +
      "      composition: {},\n" +
      "    }),\n" +
      '  title: "Empty diff fixture",\n' +
      '  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },\n' +
      "  design: { version: 1, documents: [] },\n" +
      "};\n",
  );
  await writeFile(
    join(directory, "added.md"),
    "# Added diff fixture\n\n[Added](reaction:Added).\n",
  );
  await writeFile(
    join(directory, "added.config.ts"),
    common +
      'import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";\n\n' +
      'const Added = endpoint("/added", () => receive().then(respond({ ok: true })));\n\n' +
      "export default {\n" +
      "  assemble: () =>\n" +
      "    assemble({\n" +
      "      conceptSet: applicationConceptSet,\n" +
      "      instances: applicationConceptSet.implementations(),\n" +
      "      composition: { Added },\n" +
      "    }),\n" +
      '  title: "Added diff fixture",\n' +
      '  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },\n' +
      '  design: { version: 1, documents: [new URL("./added.md", import.meta.url)] },\n' +
      "};\n",
  );
  return {
    empty: relative(root, join(directory, "empty.config.ts")),
    added: relative(root, join(directory, "added.config.ts")),
  };
}

describe("application manifest diff", () => {
  test("reports no changes for identical manifests", () => {
    const manifest = fixtureManifest();

    expect(diffApplicationManifests(manifest, manifest)).toEqual({
      status: "identical",
      old: { digest: manifest.digest },
      current: { digest: manifest.digest },
      breaking: [],
      nonBreaking: [],
    });
  });

  test("separates endpoint and granular input-contract changes by compatibility", () => {
    const oldManifest = withInputDefault(
      fixtureManifest(),
      "/stable",
      "reordered",
      equivalentDefault,
    );
    const report = diffApplicationManifests(
      oldManifest,
      withInputDefault(
        changedFixtureManifest(),
        "/stable",
        "reordered",
        reorderedEquivalentDefault,
      ),
    );

    expect(report.status).toBe("changed");
    expect(report.breaking).toEqual([
      {
        kind: "endpoint-removed",
        endpoint: { name: "Removed", path: "/removed" },
      },
      {
        kind: "endpoint-added",
        endpoint: { name: "Shared", path: "/stable" },
      },
      { kind: "input-required-added", path: "/stable", key: "required" },
      { kind: "input-default-added", path: "/stable", key: "added", value: true },
      {
        kind: "input-default-changed",
        path: "/stable",
        key: "changed",
        before: 1,
        after: 2,
      },
      {
        kind: "input-default-changed",
        path: "/stable",
        key: "compound",
        before: oldCompoundDefault,
        after: currentCompoundDefault,
      },
      { kind: "input-default-removed", path: "/stable", key: "removed", value: "old" },
    ]);
    expect(report.nonBreaking).toEqual([
      {
        kind: "endpoint-added",
        endpoint: { name: "Added", path: "/added" },
      },
      { kind: "input-required-removed", path: "/stable", key: "obsolete" },
    ]);
  });

  test("reports additions and removals in the refusal inventory as breaking", () => {
    expect(
      diffApplicationManifests(refusalManifest("REMOVED"), refusalManifest("ADDED")).breaking,
    ).toEqual([
      {
        kind: "refusal-code-removed",
        refusal: { concept: "Refusing", action: "act", code: "REMOVED" },
      },
      {
        kind: "refusal-code-added",
        refusal: { concept: "Refusing", action: "act", code: "ADDED" },
      },
    ]);
  });

  test("reports SSF-owned type removals as breaking and additions as non-breaking", async () => {
    const oldManifest = await checkedManifest();
    const currentManifest = structuredClone(oldManifest);
    const concept = currentManifest.design.concepts.find(
      ({ ownedTypes }) => ownedTypes.length > 0,
    )!;
    const removed = concept.ownedTypes[0]!;
    concept.ownedTypes = [...concept.ownedTypes.slice(1), "AddedType"].sort(ordinal);
    reseal(currentManifest);

    const report = diffApplicationManifests(oldManifest, currentManifest);

    expect(report.breaking).toEqual([
      {
        kind: "owned-type-removed",
        ownedType: { definition: concept.definition, type: removed },
      },
    ]);
    expect(report.nonBreaking).toEqual([
      {
        kind: "owned-type-added",
        ownedType: { definition: concept.definition, type: "AddedType" },
      },
    ]);
  }, 30_000);

  test("uses exit status zero for an addition and one for a removal", async () => {
    const directory = await mkdtemp(join(root, "tests/.sync-engine-diff-"));
    try {
      const configs = await writeConceptFreeConfigs(directory);
      const emptyManifest = join(directory, "empty.json");
      const addedManifest = join(directory, "added.json");
      await writeFile(emptyManifest, renderApplicationManifest(await manifestFor(configs.empty)));
      await writeFile(addedManifest, renderApplicationManifest(await manifestFor(configs.added)));

      const identical = run("artifacts", "diff", emptyManifest, "--config", configs.empty);
      expect({ status: identical.status, stderr: identical.stderr }).toEqual({
        status: 0,
        stderr: "",
      });
      expect(identical.stdout).toContain("Application manifest diff: identical");
      expect(identical.stdout).toContain("breaking changes:\n    none");

      const nonBreaking = run("artifacts", "diff", emptyManifest, "--config", configs.added);
      expect({ status: nonBreaking.status, stderr: nonBreaking.stderr }).toEqual({
        status: 0,
        stderr: "",
      });
      expect(nonBreaking.stdout).toContain('endpoint added: "Added" at "/added"');

      const breaking = run("artifacts", "diff", addedManifest, "--config", configs.empty);
      expect({ status: breaking.status, stderr: breaking.stderr }).toEqual({
        status: 1,
        stderr: "",
      });
      expect(breaking.stdout).toContain('endpoint removed: "Added" at "/added"');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  test("notes digest changes outside the compatibility inventories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-engine-manifest-diff-"));
    try {
      const oldManifest = structuredClone(await checkedManifest());
      const diagnostic = oldManifest.diagnostics[0]!;
      oldManifest.diagnostics[0] = {
        ...diagnostic,
        message: `${diagnostic.message} (previous report)`,
      };
      reseal(oldManifest);
      const old = join(directory, "untracked.json");
      await writeFile(old, renderApplicationManifest(oldManifest));

      const diff = run("artifacts", "diff", old, "--config", packagingConfigPath);
      expect({ status: diff.status, stderr: diff.stderr }).toEqual({ status: 0, stderr: "" });
      expect(diff.stdout).toContain("Application manifest diff: changed");
      expect(diff.stdout).toContain("breaking changes:\n    none");
      expect(diff.stdout).toContain("non-breaking changes:\n    none");
      expect(diff.stdout).toContain(
        "  note: the manifest digest changed outside the tracked compatibility inventories.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test("refuses malformed and unsupported old manifests before loading configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-engine-manifest-diff-"));
    try {
      const malformed = join(directory, "malformed.json");
      const replacedV1 = join(directory, "replaced-v1.json");
      const unsupported = join(directory, "unsupported.json");
      await writeFile(malformed, "{");
      await writeFile(
        replacedV1,
        JSON.stringify({ format: "sync-engine.application-manifest", version: 1 }),
      );
      await writeFile(unsupported, JSON.stringify({ ...fixtureManifest(), version: 2 }));

      const malformedResult = run("artifacts", "diff", malformed);
      expect({ status: malformedResult.status, stdout: malformedResult.stdout }).toEqual({
        status: 1,
        stdout: "",
      });
      expect(malformedResult.stderr).toContain(
        `artifacts diff: cannot decode old manifest ${JSON.stringify(malformed)}: Invalid application manifest JSON:`,
      );

      const replacedV1Result = run("artifacts", "diff", replacedV1);
      expect({ status: replacedV1Result.status, stdout: replacedV1Result.stdout }).toEqual({
        status: 1,
        stdout: "",
      });
      expect(replacedV1Result.stderr).toContain(
        `artifacts diff: cannot decode old manifest ${JSON.stringify(replacedV1)}: Invalid application manifest at $.generator`,
      );

      const unsupportedResult = run("artifacts", "diff", unsupported);
      expect({ status: unsupportedResult.status, stdout: unsupportedResult.stdout }).toEqual({
        status: 1,
        stdout: "",
      });
      expect(unsupportedResult.stderr).toBe(
        `artifacts diff: cannot decode old manifest ${JSON.stringify(unsupported)}: Invalid application manifest at $.version: expected 1.\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
