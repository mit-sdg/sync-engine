import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupProject } from "@command/setup";
import { describe, expect, test } from "vite-plus/test";

type Manifest = Record<string, unknown>;

async function currentPackage(): Promise<{
  version: string;
  packageManager: string;
  dependencies: { typescript: string };
  devDependencies: { "@types/bun": string; "@types/node": string };
}> {
  return JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
}

async function project(manifest: Manifest = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", packageManager: "bun@1.4.0", ...manifest }, null, 2)}\n`,
  );
  return root;
}

async function manifestAt(root: string): Promise<{
  packageManager: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
}> {
  return JSON.parse(await readFile(join(root, "package.json"), "utf8"));
}

describe("sync-engine setup", () => {
  test("completes an existing manifest without installing, creates source, and is idempotent", async () => {
    const root = await project();
    const observed: string[] = [];
    try {
      const first = await setupProject(root, {
        install: async (installedRoot) => {
          observed.push(installedRoot);
        },
      });

      expect(first.manifestUpdated).toBe(true);
      expect(first.installation).toBe("skipped");
      expect(observed).toEqual([]);
      expect(first.guidance).toContain(
        "Review the project and updated package.json, then run `bun install` before validation.",
      );
      const manifest = await manifestAt(root);
      const current = await currentPackage();
      expect(manifest.dependencies["@mit-sdg/sync-engine"]).toBe(current.version);
      expect(manifest.devDependencies.typescript).toBe(current.dependencies.typescript);
      expect(manifest.devDependencies["@types/bun"]).toBe(current.devDependencies["@types/bun"]);
      expect(manifest.devDependencies["@types/node"]).toBe(current.devDependencies["@types/node"]);
      expect(manifest.scripts).toMatchObject({
        generate: "sync-engine artifacts pin",
        check: "sync-engine check && sync-engine artifacts check && tsc --noEmit",
        start: "bun src/main.ts",
      });
      expect(first.written).toEqual([
        ".gitignore",
        "tsconfig.json",
        "src/text.d.ts",
        "src/concepts.ts",
        "src/assembly.ts",
        "generated.config.ts",
        "src/main.ts",
      ]);
      expect(await readFile(join(root, "src/concepts.ts"), "utf8")).toContain("conceptSet({})");
      expect(await readFile(join(root, "src/assembly.ts"), "utf8")).toContain("composition: {}");
      expect(await readFile(join(root, "generated.config.ts"), "utf8")).toContain(
        "design: { version: 1, documents: [] }",
      );
      expect(await readFile(join(root, "tsconfig.json"), "utf8")).toContain(
        '"types": ["bun", "node"]',
      );
      expect(await readFile(join(root, "src/text.d.ts"), "utf8")).toContain(
        'declare module "*.md"',
      );
      expect(await readFile(join(root, "tsconfig.json"), "utf8")).not.toContain(
        "text.generated.d.ts",
      );

      const second = await setupProject(root, {
        install: async () => {
          throw new Error("an unchanged manifest must not install");
        },
      });
      expect(second.manifestUpdated).toBe(false);
      expect(second.installation).toBe("not-needed");
      expect(second.written).toEqual([]);
      expect(second.verified).toHaveLength(7);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("adds the canonical Bun package manager without installing an existing package", async () => {
    const root = await project({ packageManager: undefined });
    try {
      const result = await setupProject(root, {
        install: async () => {
          throw new Error("an existing package must not run its installer");
        },
      });
      expect(result.manifestUpdated).toBe(true);
      expect(result.installation).toBe("skipped");
      expect((await manifestAt(root)).packageManager).toBe((await currentPackage()).packageManager);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("preserves every compatible declaration and existing script byte-for-byte", async () => {
    const { version } = await currentPackage();
    const original = {
      dependencies: { "@mit-sdg/sync-engine": version, other: "1.2.3" },
      devDependencies: {
        typescript: "^6.0.0",
        "@types/bun": "^1.4.0",
        "@types/node": "^24.0.0",
      },
      scripts: {
        generate: "custom-generate",
        check: "custom-check",
        start: "custom-start",
        other: "custom-other",
      },
      custom: { retained: true },
    };
    const root = await project(original);
    const before = await readFile(join(root, "package.json"), "utf8");
    try {
      const result = await setupProject(root, {
        install: async () => {
          throw new Error("compatible declarations must not trigger installation");
        },
      });
      expect(result.manifestUpdated).toBe(false);
      expect(await readFile(join(root, "package.json"), "utf8")).toBe(before);
      expect(await manifestAt(root)).toMatchObject(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("never replaces existing source, config, or tsconfig files", async () => {
    const root = await project();
    const files = [
      ".gitignore",
      "tsconfig.json",
      "generated.config.ts",
      "src/text.d.ts",
      "src/concepts.ts",
      "src/assembly.ts",
      "src/main.ts",
    ];
    try {
      await mkdir(join(root, "src"), { recursive: true });
      for (const path of files) await writeFile(join(root, path), `application owned: ${path}\n`);
      const result = await setupProject(root, { install: false });
      expect(result.written).toEqual([]);
      for (const path of files) {
        expect(await readFile(join(root, path), "utf8")).toBe(`application owned: ${path}\n`);
      }
      expect(result.guidance.join("\n")).toContain(
        "Existing application-owned file left unchanged: tsconfig.json",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not create dependent files against an incompatible application concept set", async () => {
    const root = await project();
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/concepts.ts"), "export const custom = {};\n");
      const result = await setupProject(root, { install: false });
      expect(await readFile(join(root, "src/concepts.ts"), "utf8")).toBe(
        "export const custom = {};\n",
      );
      expect(result.written).not.toContain("src/assembly.ts");
      expect(result.written).not.toContain("generated.config.ts");
      expect(result.guidance.join("\n")).toContain("src/assembly.ts");
      expect(result.guidance.join("\n")).toContain("concept-set module");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not treat export text in comments as an integration", async () => {
    const root = await project();
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/concepts.ts"),
        "// export const applicationConceptSet = {};\n",
      );
      const result = await setupProject(root, { install: false });
      expect(result.written).not.toContain("src/assembly.ts");
      expect(result.guidance.join("\n")).toContain("src/assembly.ts");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports an installation failure after the manifest edit without writing templates", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-empty-"));
    try {
      await expect(
        setupProject(root, {
          install: async () => {
            expect((await manifestAt(root)).scripts.start).toBe("bun src/main.ts");
            throw new Error("offline");
          },
        }),
      ).rejects.toThrow(
        "package.json was updated, but Bun installation failed (offline). No setup source or configuration files were written",
      );
      expect((await manifestAt(root)).scripts.start).toBe("bun src/main.ts");
      await expect(readFile(join(root, "generated.config.ts"), "utf8")).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("offers an explicit no-install seam and reports the resulting obligation", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-empty-"));
    try {
      const result = await setupProject(root, { install: false });
      expect(result.installation).toBe("skipped");
      expect(result.guidance).toContain(
        "Bun installation was explicitly skipped; run `bun install` before validation.",
      );
      expect(result.written).toHaveLength(7);
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
        dependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.2" },
        devDependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.3" },
      }),
      "conflicting @mit-sdg/sync-engine",
    ],
    [
      "an incompatible core version",
      JSON.stringify({ dependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.1" } }),
      "@mit-sdg/sync-engine 1.0.0-beta.1 is incompatible",
    ],
    [
      "incompatible @types/bun",
      JSON.stringify({ devDependencies: { "@types/bun": "1.2.0" } }),
      "@types/bun 1.2.0 is incompatible",
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
      "incompatible @types/node",
      JSON.stringify({ devDependencies: { "@types/node": "23.0.0" } }),
      "@types/node 23.0.0 is incompatible",
    ],
    [
      "conflicting TypeScript declarations",
      JSON.stringify({
        dependencies: { typescript: "6.0.0" },
        devDependencies: { typescript: "^6.0.0" },
      }),
      "conflicting typescript",
    ],
    [
      "an incompatible TypeScript version",
      JSON.stringify({ devDependencies: { typescript: "5.9.0" } }),
      "typescript 5.9.0 is incompatible",
    ],
    [
      "an invalid scripts member",
      JSON.stringify({ scripts: { check: false } }),
      "scripts.check must be a string",
    ],
  ])("rejects %s", async (_label, manifest, message) => {
    const root = await project();
    try {
      await writeFile(join(root, "package.json"), manifest);
      await expect(setupProject(root, { install: false })).rejects.toThrow(message);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("creates a minimal private module package when package.json is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-empty-"));
    try {
      const installed: string[] = [];
      const result = await setupProject(root, {
        install: async (installedRoot) => {
          installed.push(installedRoot);
        },
      });
      const manifest = await manifestAt(root);
      expect(result.manifestUpdated).toBe(true);
      expect(result.installation).toBe("completed");
      expect(installed).toEqual([root]);
      expect(manifest).toMatchObject({
        private: true,
        type: "module",
        packageManager: "bun@1.4.0",
      });
      expect(result.written).toEqual([
        ".gitignore",
        "tsconfig.json",
        "src/text.d.ts",
        "src/concepts.ts",
        "src/assembly.ts",
        "generated.config.ts",
        "src/main.ts",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not install when a package-less directory already contains project files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sync-engine-setup-existing-"));
    try {
      await writeFile(join(root, "bunfig.toml"), '[install]\nregistry = "https://example.test"\n');
      const result = await setupProject(root, {
        install: async () => {
          throw new Error("a non-empty project must not run its package manager");
        },
      });

      expect(result.installation).toBe("skipped");
      expect(result.guidance).toContain(
        "Review the project and updated package.json, then run `bun install` before validation.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
