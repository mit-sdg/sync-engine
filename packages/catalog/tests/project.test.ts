import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vite-plus/test";
import { integrationGuidance, readProject } from "../src/project.ts";

describe("catalog project analysis", () => {
  test("recommends core setup without writing setup files", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-project-"));
    try {
      await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
      const result = await readProject(root);
      expect(result.guidance.join("\n")).toContain("sync-engine setup");
      expect(result.guidance.join("\n")).toContain("tsconfig.json");
      expect((await integrationGuidance(root, "memory")).join("\n")).toContain(
        'implementations("memory", {})',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports partial configuration and recognizes integrated floor construction", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-project-partial-"));
    try {
      await import("node:fs/promises").then(({ mkdir }) => mkdir(join(root, "src")));
      await writeFile(
        join(root, "package.json"),
        '{"scripts":{"test":"vp test","check":"tsc --noEmit"}}\n',
      );
      await writeFile(join(root, "tsconfig.json"), '{"include":["tests"]}\n');
      await writeFile(join(root, "generated.config.ts"), "export default {};\n");
      await writeFile(
        join(root, "src/concept-set.ts"),
        'import { catalogRegistrations } from "./catalog/registrations.generated.ts";\nexport const registrations = { ...catalogRegistrations };\n',
      );
      await writeFile(
        join(root, "src/composition.ts"),
        'import { catalogComposition } from "./catalog/composition.generated.ts";\nexport const composition = { ...catalogComposition };\n',
      );
      await writeFile(
        join(root, "src/assembly.ts"),
        'applicationConcepts.implementations("mongo", { db });\n',
      );
      const project = await readProject(root);
      expect(project.guidance.join("\n")).toContain("does not appear to cover");
      const guidance = await integrationGuidance(root, "mongo");
      expect(guidance).toEqual(["Selected catalog floor: mongo"]);
      await writeFile(join(root, "tsconfig.json"), "not json\n");
      expect((await readProject(root)).guidance.join("\n")).toContain("could not be analyzed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects missing and invalid package manifests", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-project-invalid-"));
    try {
      await expect(readProject(root)).rejects.toThrow("package.json");
      await writeFile(join(root, "package.json"), "{\n");
      await expect(readProject(root)).rejects.toThrow("invalid");
      await writeFile(join(root, "package.json"), "[]\n");
      await expect(readProject(root)).rejects.toThrow("object");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
