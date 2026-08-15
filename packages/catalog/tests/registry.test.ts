import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { CatalogRegistry } from "../src/registry.ts";

describe("catalog registry", () => {
  test("loads the curated index and exposes plain asset selectors", async () => {
    const registry = await CatalogRegistry.load();
    expect([...registry.entries.keys()]).toHaveLength(24);
    const concept = registry.entries.get("concept/selecting");
    expect(concept?.kind).toBe("concept");
    if (concept?.kind !== "concept") throw new Error("missing selecting concept");
    expect(concept.design).toBe("spec.md");
    expect(CatalogRegistry.sources(concept).map(({ selector }) => selector)).toContain(
      "memory/selecting.memory.ts",
    );

    const recipe = registry.entries.get("recipe/workshop-selection");
    expect(recipe?.kind).toBe("recipe");
    if (recipe?.kind !== "recipe") throw new Error("missing workshop-selection recipe");
    expect(recipe.requires).toEqual(["concept/gathering", "concept/selecting"]);
    expect(CatalogRegistry.sources(recipe).map(({ selector }) => selector)).toContain(
      "workshop-selection.ts",
    );
  });

  test("rejects a missing declared asset", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-registry-"));
    try {
      await cp(new URL("../entries/", import.meta.url), root, { recursive: true });
      await unlink(join(root, "concept/selecting/selecting.shared.ts"));
      await expect(CatalogRegistry.load(root)).rejects.toThrow(
        "concept/selecting: declared source does not exist: selecting.shared.ts",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects malformed manifests and dependency indexes", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-registry-"));
    try {
      await cp(new URL("../entries/", import.meta.url), root, { recursive: true });
      const manifestPath = join(root, "concept/selecting/manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
      manifest.extra = true;
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
      await expect(CatalogRegistry.load(root)).rejects.toThrow("has unknown field extra");

      await cp(
        new URL("../entries/concept/selecting/manifest.json", import.meta.url),
        manifestPath,
      );
      await writeFile(join(root, "index.json"), '["bad/manifest.json"]\n');
      await expect(CatalogRegistry.load(root)).rejects.toThrow("invalid entry index path");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects recipe-only fields on the wrong entry kind", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-registry-"));
    try {
      await cp(new URL("../entries/", import.meta.url), root, { recursive: true });
      const path = join(root, "recipe/workshop-selection/manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      manifest.implementations = {};
      await writeFile(path, `${JSON.stringify(manifest)}\n`);
      await expect(CatalogRegistry.load(root)).rejects.toThrow(
        "recipe/workshop-selection: recipe cannot declare implementations",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    [
      "invalid schema",
      (value: Record<string, unknown>) => (value.schema = 1),
      "invalid manifest identity",
    ],
    [
      "invalid design path",
      (value: Record<string, unknown>) => (value.design = "../spec.md"),
      "must be a local file name",
    ],
    [
      "concept requirements",
      (value: Record<string, unknown>) => (value.requires = []),
      "concept cannot declare requires",
    ],
    [
      "missing implementations",
      (value: Record<string, unknown>) => (value.implementations = {}),
      "concept needs an implementation",
    ],
    [
      "invalid implementation name",
      (value: Record<string, unknown>) =>
        (value.implementations = { Bad: { summary: "bad", sources: ["selecting.memory.ts"] } }),
      "invalid implementation Bad",
    ],
    [
      "empty implementation summary",
      (value: Record<string, unknown>) =>
        (value.implementations = { memory: { summary: "", sources: ["selecting.memory.ts"] } }),
      "needs a summary",
    ],
    [
      "duplicate common sources",
      (value: Record<string, unknown>) =>
        (value.sources = ["selecting.shared.ts", "selecting.shared.ts"]),
      "repeats a source",
    ],
  ])("rejects a concept manifest with %s", async (_case, mutate, message) => {
    const root = await mkdtemp(join(tmpdir(), "catalog-registry-"));
    try {
      await cp(new URL("../entries/", import.meta.url), root, { recursive: true });
      const path = join(root, "concept/selecting/manifest.json");
      const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      mutate(manifest);
      await writeFile(path, `${JSON.stringify(manifest)}\n`);
      await expect(CatalogRegistry.load(root)).rejects.toThrow(message);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
