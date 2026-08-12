import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setupProject } from "@command/setup";
import { describe, expect, test } from "vite-plus/test";

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", packageManager: "bun@1.3.14" }, null, 2)}\n`,
  );
  return root;
}

describe("sync-engine setup", () => {
  test("creates a concept-free application and is idempotent", async () => {
    const root = await project();
    try {
      const first = await setupProject(root);
      expect(first.written).toEqual([
        "tsconfig.json",
        "src/vocabulary.ts",
        "src/assembly.ts",
        "generated.config.ts",
        "src/main.ts",
      ]);
      expect(await readFile(join(root, "src/vocabulary.ts"), "utf8")).toContain("conceptSet({})");
      expect(await readFile(join(root, "src/assembly.ts"), "utf8")).toContain("composition: {}");
      expect(await readFile(join(root, "generated.config.ts"), "utf8")).toContain(
        'vocabulary: { module: new URL("./src/vocabulary.ts", import.meta.url) }',
      );
      expect(await readFile(join(root, "tsconfig.json"), "utf8")).toContain('"types": ["node"]');
      expect(first.guidance.join("\n")).toContain("@types/node");
      const second = await setupProject(root);
      expect(second.written).toEqual([]);
      expect(second.verified).toHaveLength(5);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not overwrite or create a dependent file against incompatible source", async () => {
    const root = await project();
    try {
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(join(root, "src"), { recursive: true }),
      );
      await writeFile(join(root, "src/vocabulary.ts"), "export const custom = {};\n");
      const result = await setupProject(root);
      expect(await readFile(join(root, "src/vocabulary.ts"), "utf8")).toBe(
        "export const custom = {};\n",
      );
      expect(result.written).not.toContain("src/assembly.ts");
      expect(result.guidance.join("\n")).toContain("src/assembly.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not create a descriptor for an incompatible application vocabulary", async () => {
    const root = await project();
    try {
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(join(root, "src"), { recursive: true }),
      );
      await writeFile(join(root, "src/vocabulary.ts"), "export const custom = {};\n");
      await writeFile(
        join(root, "src/assembly.ts"),
        "export function assembleApplication() { return {}; }\n",
      );
      const result = await setupProject(root);
      expect(result.written).not.toContain("generated.config.ts");
      expect(result.guidance.join("\n")).toContain("vocabulary module");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not treat export text in comments as an integration", async () => {
    const root = await project();
    try {
      await import("node:fs/promises").then(({ mkdir }) =>
        mkdir(join(root, "src"), { recursive: true }),
      );
      await writeFile(
        join(root, "src/vocabulary.ts"),
        "// export const applicationConcepts = {}; export const vocabulary = {};\n",
      );
      const result = await setupProject(root);
      expect(result.written).not.toContain("src/assembly.ts");
      expect(result.guidance.join("\n")).toContain("src/assembly.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.each([
    ["invalid JSON", "{", "valid JSON"],
    ["a non-object manifest", "[]", "package object"],
    [
      "a non-Bun package manager",
      JSON.stringify({ packageManager: "npm@11" }),
      "packageManager must name Bun",
    ],
    [
      "conflicting core declarations",
      JSON.stringify({
        dependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.8" },
        devDependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.6" },
      }),
      "conflicting @mit-sdg/sync-engine",
    ],
    [
      "an incompatible core version",
      JSON.stringify({ dependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.6" } }),
      "must be declared at",
    ],
    [
      "conflicting @types/node declarations",
      JSON.stringify({
        dependencies: { "@types/node": "24.0.0" },
        devDependencies: { "@types/node": "^24.0.0" },
      }),
      "conflicting @types/node",
    ],
    [
      "conflicting TypeScript declarations",
      JSON.stringify({
        dependencies: { typescript: "6.0.0" },
        devDependencies: { typescript: "^6.0.0" },
      }),
      "conflicting TypeScript",
    ],
    [
      "an incompatible TypeScript version",
      JSON.stringify({ devDependencies: { typescript: "5.9.0" } }),
      "is incompatible",
    ],
  ])("rejects %s", async (_label, manifest, message) => {
    const root = await project();
    try {
      await writeFile(join(root, "package.json"), manifest);
      await expect(setupProject(root)).rejects.toThrow(message);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("requires an existing Bun package", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-empty-"));
    try {
      await expect(setupProject(root)).rejects.toThrow("no package.json");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
