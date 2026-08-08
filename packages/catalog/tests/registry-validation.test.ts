import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { loadCatalog } from "../src/registry.ts";

const directories: string[] = [];
type ManifestCase = readonly [
  string,
  { index: unknown } | { value: unknown } | { edit: (value: any) => void },
  string,
];
type ConceptCase = readonly [string, (value: any) => void, string];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function bundle(id = "bundle/sample") {
  return {
    schema: 1,
    id,
    kind: "bundle",
    summary: "A useful bundle.",
    files: [{ source: "file.ts", target: "$root/file.ts" }],
  };
}

function concept(id = "concept/sample", name = "Sample") {
  return {
    schema: 1,
    id,
    kind: "concept",
    summary: "A useful concept.",
    files: [{ source: "registry.ts", target: `$concepts/${id.slice(8)}/registry.ts` }],
    variants: {
      memory: {
        summary: "Memory implementation.",
        files: [{ source: "sample.ts", target: `$concepts/${id.slice(8)}/sample.ts` }],
      },
    },
    concept: {
      name,
      registration: `$concepts/${id.slice(8)}/registry.ts`,
      export: id.slice(8).replaceAll("-", ""),
    },
  };
}

async function registry(
  manifests: Array<{ path: string; value: unknown }>,
  options: { writeSources?: boolean; index?: unknown } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "catalog-registry-"));
  directories.push(root);
  const paths = manifests.map(({ path }) => `${path}/manifest.json`);
  await writeFile(join(root, "index.json"), `${JSON.stringify(options.index ?? paths)}\n`);
  for (const { path, value } of manifests) {
    const directory = join(root, path);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), `${JSON.stringify(value)}\n`);
    if (options.writeSources === false || typeof value !== "object" || value === null) continue;
    const manifest = value as {
      files?: Array<{ source?: unknown }>;
      variants?: Record<string, { files?: Array<{ source?: unknown }> }>;
    };
    const files = [
      ...(Array.isArray(manifest.files) ? manifest.files : []),
      ...Object.values(manifest.variants ?? {}).flatMap((variant) =>
        Array.isArray(variant?.files) ? variant.files : [],
      ),
    ];
    for (const file of files) {
      if (
        typeof file !== "object" ||
        file === null ||
        typeof file.source !== "string" ||
        file.source === "" ||
        file.source.startsWith("../")
      ) {
        continue;
      }
      const target = join(directory, file.source);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, "export {};\n");
    }
  }
  return root;
}

describe("catalog manifest validation", () => {
  test.each([
    ["object index", { index: {} }, "catalog index must be an array of strings"],
    ["non-object manifest", { value: null }, "must be an object"],
    ["unknown field", { edit: (value: any) => (value.extra = true) }, "unknown fields"],
    ["schema", { edit: (value: any) => (value.schema = 2) }, "schema must be 1"],
    ["entry ID", { edit: (value: any) => (value.id = "bad") }, "supported lowercase catalog ID"],
    ["kind", { edit: (value: any) => (value.kind = "unknown") }, "kind is not supported"],
    ["kind mismatch", { edit: (value: any) => (value.kind = "recipe") }, "id kind does not match"],
    ["summary", { edit: (value: any) => (value.summary = "") }, "summary must be non-empty"],
    ["file list", { edit: (value: any) => (value.files = {}) }, "files must be an array"],
    ["file record", { edit: (value: any) => (value.files = [null]) }, "must be an object"],
    ["file field", { edit: (value: any) => (value.files[0].extra = 1) }, "unknown fields"],
    ["target", { edit: (value: any) => (value.files[0].target = "file.ts") }, "supported target"],
    [
      "source traversal",
      { edit: (value: any) => (value.files[0].source = "../file.ts") },
      "remain inside",
    ],
    ["package name", { edit: (value: any) => (value.packages = { BAD: "1" }) }, "package range"],
  ] satisfies readonly ManifestCase[])("rejects malformed %s", async (_name, setup, message) => {
    if ("index" in setup) {
      await expect(loadCatalog(await registry([], { index: setup.index }))).rejects.toThrow(
        message,
      );
      return;
    }
    const value: any = "value" in setup ? setup.value : bundle();
    if ("edit" in setup) setup.edit(value);
    await expect(loadCatalog(await registry([{ path: "bundle/sample", value }]))).rejects.toThrow(
      message,
    );
  });

  test.each([
    [
      "non-concept variants",
      (value: any) => {
        value.id = "bundle/sample";
        value.kind = "bundle";
      },
      "only concepts may declare variants",
    ],
    ["invalid variant name", (value: any) => (value.variants = { BAD: {} }), "invalid variant"],
    [
      "empty variant summary",
      (value: any) => (value.variants.memory.summary = ""),
      "summary must be non-empty",
    ],
    ["empty variants", (value: any) => (value.variants = {}), "variants must not be empty"],
    [
      "missing concept metadata",
      (value: any) => delete value.concept,
      "needs metadata and variants",
    ],
    [
      "invalid concept metadata",
      (value: any) => (value.concept.name = "bad-name"),
      "metadata is invalid",
    ],
    [
      "uncopied registration",
      (value: any) => (value.concept.registration = "$concepts/sample/other.ts"),
      "does not copy its registration",
    ],
    [
      "duplicate targets",
      (value: any) => (value.variants.memory.files[0].target = value.files[0].target),
      "duplicate copied targets",
    ],
  ] satisfies readonly ConceptCase[])("rejects concept with %s", async (_name, edit, message) => {
    const value: any = concept();
    edit(value);
    await expect(loadCatalog(await registry([{ path: "concept/sample", value }]))).rejects.toThrow(
      message,
    );
  });

  test("rejects incomplete computation and recipe integration", async () => {
    const computation = {
      schema: 1,
      id: "computation/sample",
      kind: "computation",
      summary: "Compute.",
      files: [{ source: "sample.ts", target: "$computations/sample.ts" }],
    };
    await expect(
      loadCatalog(await registry([{ path: "computation/sample", value: computation }])),
    ).rejects.toThrow("needs integration metadata");

    const recipe = {
      schema: 1,
      id: "recipe/sample",
      kind: "recipe",
      summary: "Compose.",
      files: [{ source: "sample.ts", target: "$recipes/sample.ts" }],
      recipe: { module: "$recipes/other.ts", members: ["Sample"] },
    };
    await expect(
      loadCatalog(await registry([{ path: "recipe/sample", value: recipe }])),
    ).rejects.toThrow("does not copy its recipe module");
  });

  test("rejects missing, repeated, and cyclic dependencies", async () => {
    const missing = { ...bundle(), requires: ["concept/missing"] };
    await expect(
      loadCatalog(await registry([{ path: "bundle/sample", value: missing }])),
    ).rejects.toThrow("requires missing entry");

    const repeated = { ...bundle(), requires: ["bundle/other", "bundle/other"] };
    await expect(
      loadCatalog(
        await registry([
          { path: "bundle/sample", value: repeated },
          { path: "bundle/other", value: bundle("bundle/other") },
        ]),
      ),
    ).rejects.toThrow("repeats a dependency");

    const first = { ...bundle("bundle/first"), requires: ["bundle/second"] };
    const second = { ...bundle("bundle/second"), requires: ["bundle/first"] };
    await expect(
      loadCatalog(
        await registry([
          { path: "bundle/first", value: first },
          { path: "bundle/second", value: second },
        ]),
      ),
    ).rejects.toThrow("dependency cycle");
  });

  test("rejects duplicate concept names and missing source files", async () => {
    await expect(
      loadCatalog(
        await registry([
          { path: "concept/first", value: concept("concept/first", "Shared") },
          { path: "concept/second", value: concept("concept/second", "Shared") },
        ]),
      ),
    ).rejects.toThrow("both own Shared");

    await expect(
      loadCatalog(
        await registry([{ path: "bundle/sample", value: bundle() }], { writeSources: false }),
      ),
    ).rejects.toThrow();
  });
});
