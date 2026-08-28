import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  bootstrapApplication,
  conflictChoices,
  expectedSetupFiles,
  planBootstrap,
  readSkillRelease,
  realFiles,
  requiredPackages,
  runCommand,
  type BootstrapCommand,
  type BootstrapFiles,
  type CommandRunner,
  type RequiredPackage,
} from "../skills/sync-engine/scripts/bootstrap.ts";
import { rejectedValue } from "./test-support.ts";

const fixtureRoot = resolve("packages/skill/tests/fixtures/bootstrap");
const releasePath = resolve(fixtureRoot, "release.json");
const releaseVersion = "1.2.3-beta.4";
const bunVersion = "1.4.0";
const temporary: string[] = [];

const runtime = { bun: bunVersion, node: "24.0.0" } as const;

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function writeDisk(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

function release(
  packages = Object.fromEntries(requiredPackages.map(([name]) => [name, releaseVersion])),
) {
  return `${JSON.stringify({
    skill: releaseVersion,
    toolchain: { bun: bunVersion, node: ">=24 <25", typescript: ">=6 <7" },
    packages,
  })}\n`;
}

class MemoryFiles implements BootstrapFiles {
  readonly values = new Map<string, string>();
  readonly unsafe = new Set<string>();
  readonly writes: string[] = [];

  constructor(entries: Readonly<Record<string, string>> = {}) {
    for (const [path, value] of Object.entries(entries)) this.values.set(resolve(path), value);
  }

  clone(): MemoryFiles {
    const copy = new MemoryFiles(Object.fromEntries(this.values));
    for (const path of this.unsafe) copy.unsafe.add(path);
    return copy;
  }

  set(path: string, value: string): void {
    this.values.set(resolve(path), value);
  }

  async readText(path: string): Promise<string | undefined> {
    return this.values.get(resolve(path));
  }

  async writeText(path: string, contents: string): Promise<void> {
    const absolute = resolve(path);
    this.writes.push(absolute);
    this.values.set(absolute, contents);
  }

  async fileKind(
    path: string,
    _containmentRoot: string,
  ): Promise<"missing" | "regular" | "unsafe"> {
    const absolute = resolve(path);
    return this.unsafe.has(absolute) ? "unsafe" : this.values.has(absolute) ? "regular" : "missing";
  }

  async ensureDirectory(_path: string): Promise<void> {}
}

function filesWithRelease(): MemoryFiles {
  return new MemoryFiles({ [releasePath]: release() });
}

function writeTypescript(files: MemoryFiles, root: string, version = "6.0.3"): void {
  files.set(
    resolve(root, "node_modules/typescript/package.json"),
    JSON.stringify({ name: "typescript", version }),
  );
}

function writeInstalled(
  files: MemoryFiles,
  root: string,
  name: RequiredPackage,
  version = releaseVersion,
  target = "./dist/command.js",
): void {
  const executable = requiredPackages.find(([packageName]) => packageName === name)![1];
  const packageRoot = resolve(root, "node_modules", name);
  files.set(
    resolve(packageRoot, "package.json"),
    JSON.stringify({ name, version, bin: { [executable]: target } }),
  );
  files.set(resolve(packageRoot, target), "#!/usr/bin/env node\n");
}

function writeApplication(
  files: MemoryFiles,
  root: string,
  options: {
    coreVersion?: string;
    omit?: RequiredPackage;
    packageManager?: string | false;
    setup?: boolean;
    extra?: Readonly<Record<string, unknown>>;
  } = {},
): void {
  const dependencies: Partial<Record<RequiredPackage, string>> = {};
  for (const [name] of requiredPackages) {
    if (name === options.omit) continue;
    dependencies[name] =
      name === "@mit-sdg/sync-engine" ? (options.coreVersion ?? releaseVersion) : releaseVersion;
    writeInstalled(files, root, name, dependencies[name]);
  }
  files.set(
    resolve(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture-app",
        private: true,
        type: "module",
        ...(options.packageManager === false
          ? {}
          : { packageManager: options.packageManager ?? `bun@${bunVersion}` }),
        devDependencies: dependencies,
        ...options.extra,
      },
      null,
      2,
    )}\n`,
  );
  if (options.setup !== false) {
    files.set(resolve(root, "tsconfig.json"), "{}\n");
    files.set(resolve(root, "generated.config.ts"), "export default {};\n");
    writeTypescript(files, root);
  }
}

function specifier(value: string): readonly [RequiredPackage, string] {
  const at = value.lastIndexOf("@");
  return [value.slice(0, at) as RequiredPackage, value.slice(at + 1)];
}

function successfulRunner(
  files: MemoryFiles,
  beforeInstall?: () => void | Promise<void>,
): CommandRunner {
  return async (command) => {
    if (command.executable === "bun") {
      await beforeInstall?.();
      const path = resolve(command.cwd, "package.json");
      const manifest = JSON.parse((await files.readText(path))!) as Record<string, unknown>;
      const devDependencies = {
        ...(manifest.devDependencies as Record<string, string> | undefined),
      };
      for (const value of command.args.slice(3)) {
        const [name, version] = specifier(value);
        for (const section of [
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ]) {
          delete (manifest[section] as Record<string, string> | undefined)?.[name];
        }
        devDependencies[name] = version;
        writeInstalled(files, command.cwd, name, version);
      }
      manifest.devDependencies = devDependencies;
      await files.writeText(path, `${JSON.stringify(manifest, null, 2)}\n`);
    } else {
      files.set(resolve(command.cwd, "tsconfig.json"), "{}\n");
      files.set(resolve(command.cwd, "generated.config.ts"), "export default {};\n");
      writeTypescript(files, command.cwd);
    }
    return { exitCode: 0 };
  };
}

describe("bootstrap", () => {
  test("uses the real filesystem and command adapters without hiding failures", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-bootstrap-real-"));
    const outside = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-bootstrap-outside-"));
    temporary.push(root, outside);
    const nested = resolve(root, "nested");
    const file = resolve(nested, "value.txt");

    await realFiles.ensureDirectory(nested);
    await realFiles.writeText(file, "value\n");
    expect(await realFiles.readText(file)).toBe("value\n");
    expect(await realFiles.readText(resolve(root, "missing.txt"))).toBeUndefined();
    expect(await realFiles.fileKind(file, root)).toBe("regular");
    expect(await realFiles.fileKind(file, outside)).toBe("unsafe");
    expect(await realFiles.fileKind(nested, root)).toBe("unsafe");
    expect(await realFiles.fileKind(resolve(root, "missing.txt"), root)).toBe("missing");

    await expect(readSkillRelease(resolve(root, "missing.json"), realFiles)).rejects.toThrow(
      "Release manifest does not exist",
    );
    await realFiles.writeText(resolve(root, "invalid.json"), "not JSON");
    await expect(readSkillRelease(resolve(root, "invalid.json"), realFiles)).rejects.toThrow(
      "Invalid JSON",
    );
    await realFiles.writeText(resolve(root, "array.json"), "[]\n");
    await expect(readSkillRelease(resolve(root, "array.json"), realFiles)).rejects.toThrow(
      "Expected a JSON object",
    );
    await realFiles.writeText(resolve(root, "incomplete.json"), "{}\n");
    await expect(readSkillRelease(resolve(root, "incomplete.json"), realFiles)).rejects.toThrow(
      "Invalid release manifest",
    );

    await expect(
      runCommand({
        executable: process.execPath as BootstrapCommand["executable"],
        args: ["-e", ""],
        cwd: root,
      }),
    ).resolves.toEqual({ exitCode: 0 });
    await expect(
      runCommand({
        executable: resolve(root, "missing-command") as BootstrapCommand["executable"],
        args: [],
        cwd: root,
      }),
    ).rejects.toThrow();
  });

  test("validates the supplied exact release set", async () => {
    const files = filesWithRelease();
    await expect(readSkillRelease(releasePath, files)).resolves.toMatchObject({
      skill: releaseVersion,
      toolchain: { bun: bunVersion },
    });

    files.set(
      releasePath,
      release({
        ...Object.fromEntries(requiredPackages.map(([name]) => [name, releaseVersion])),
        "@mit-sdg/sync-engine-analysis": "^1.2.3",
      }),
    );
    expect(await rejectedValue(readSkillRelease(releasePath, files))).toEqual({
      name: "Error",
      message: "Release 1.2.3-beta.4 must pin @mit-sdg/sync-engine-analysis to that exact version",
    });
  });

  test("rejects mismatched Bun and Node runtimes", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "runtime-app");
    const bunMismatch = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime: { bun: "1.3.14", node: "24.0.0" } },
    );
    expect(bunMismatch).toMatchObject({
      state: "failed",
      error: "Running Bun 1.3.14 does not match 1.4.0",
    });

    const nodeMismatch = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime: { bun: bunVersion, node: "23.9.0" } },
    );
    expect(nodeMismatch).toMatchObject({
      state: "failed",
      error: "Running Node 23.9.0 does not satisfy >=24 <25",
    });
    expect(
      (
        await planBootstrap(
          { applicationRoot: root, releaseManifestPath: releasePath },
          { files, runtime },
        )
      ).state,
    ).toBe("new-app");
  });

  test("rejects an installed TypeScript outside the supported setup range", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "typescript-app");
    writeApplication(files, root);
    writeTypescript(files, root, "5.9.3");
    const plan = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime },
    );
    expect(plan).toMatchObject({
      state: "failed",
      error: "Installed TypeScript 5.9.3 does not satisfy >=6 <7",
    });
  });

  test("creates only a minimal manifest before exact Bun install and setup", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "Fresh App_λ");
    const plan = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime },
    );
    expect(plan.state).toBe("new-app");
    expect(plan.commands.map(({ executable }) => executable)).toEqual(["bun", "bunx"]);

    let beforeInstall: unknown;
    const result = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath },
      {
        files,
        runtime,
        runCommand: successfulRunner(files, async () => {
          beforeInstall = JSON.parse((await files.readText(resolve(root, "package.json")))!);
        }),
      },
    );
    expect(beforeInstall).toEqual({
      name: "sync-engine-app",
      private: true,
      type: "module",
      packageManager: `bun@${bunVersion}`,
    });
    expect(result.outcome).toBe("changed");
    expect(result.plan.state).toBe("ready");
    expect(result.commands[0]!.args).toEqual([
      "add",
      "--dev",
      "--exact",
      ...requiredPackages.map(([name]) => `${name}@${releaseVersion}`),
    ]);
    expect(result.commands[1]!.args).toEqual(["--no-install", "sync-engine", "setup"]);
    expect(result.changedPaths).toEqual([
      resolve(root, "package.json"),
      ...expectedSetupFiles.map((file) => resolve(root, file)),
    ]);
  });

  test("returns ready without commands and rejects an escaping executable target", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "ready-app");
    writeApplication(files, root);
    const ready = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath },
      {
        files,
        runtime,
        runCommand: async () => {
          throw new Error("must not run");
        },
      },
    );
    expect(ready.outcome).toBe("ready");
    expect(ready.commands).toEqual([]);

    const catalogRoot = resolve(root, "node_modules/@mit-sdg/sync-engine-catalog");
    files.set(
      resolve(catalogRoot, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine-catalog",
        version: releaseVersion,
        bin: { "sync-engine-catalog": "../../escaping.js" },
      }),
    );
    const broken = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime },
    );
    expect(broken).toMatchObject({
      state: "failed",
      error: "Escaping executable target: ../../escaping.js",
    });
  });

  test("rejects setup and installed-package symlink escapes", async () => {
    const memory = filesWithRelease();
    const memoryRoot = resolve(fixtureRoot, "unsafe-setup-app");
    writeApplication(memory, memoryRoot);
    memory.unsafe.add(resolve(memoryRoot, "tsconfig.json"));
    const unsafeSetup = await planBootstrap(
      { applicationRoot: memoryRoot, releaseManifestPath: releasePath },
      { files: memory, runtime },
    );
    expect(unsafeSetup).toMatchObject({
      state: "failed",
      error: `Unsafe setup file: ${resolve(memoryRoot, "tsconfig.json")}`,
    });

    await mkdir(fixtureRoot, { recursive: true });
    const root = await mkdtemp(resolve(fixtureRoot, "symlink-app-"));
    const outside = await mkdtemp(resolve(fixtureRoot, "outside-package-"));
    temporary.push(root, outside);
    const localRelease = resolve(root, "release.json");
    await writeDisk(localRelease, release());
    await writeDisk(
      resolve(root, "package.json"),
      JSON.stringify({
        name: "symlink-app",
        packageManager: `bun@${bunVersion}`,
        devDependencies: Object.fromEntries(
          requiredPackages.map(([name]) => [name, releaseVersion]),
        ),
      }),
    );
    await writeDisk(
      resolve(outside, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine",
        version: releaseVersion,
        bin: { "sync-engine": "./dist/command.js" },
      }),
    );
    await writeDisk(resolve(outside, "dist/command.js"), "#!/usr/bin/env node\n");
    const link = resolve(root, "node_modules/@mit-sdg/sync-engine");
    await mkdir(dirname(link), { recursive: true });
    await symlink(outside, link, "dir");

    const escaped = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: localRelease },
      { runtime },
    );
    expect(escaped).toMatchObject({
      state: "failed",
      error: `Unsafe installed package manifest: ${resolve(
        root,
        "node_modules/@mit-sdg/sync-engine/package.json",
      )}`,
    });
  });

  test("adds only missing tooling and preserves unrelated manifest fields", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "existing-app");
    writeApplication(files, root, {
      omit: "@mit-sdg/sync-engine-analysis",
      packageManager: false,
      setup: false,
      extra: { scripts: { test: "keep-me" }, custom: { untouched: true } },
    });
    const plan = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime },
    );
    expect(plan.state).toBe("missing-tooling");
    expect(plan.missingPackages).toEqual(["@mit-sdg/sync-engine-analysis"]);

    const result = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files, runtime, runCommand: successfulRunner(files) },
    );
    expect(result.outcome).toBe("changed");
    expect(result.commands.map(({ executable }) => executable)).toEqual(["bun", "bunx"]);
    expect(result.commands[0]!.args.slice(3)).toEqual([
      `@mit-sdg/sync-engine-analysis@${releaseVersion}`,
    ]);
    const manifest = JSON.parse((await files.readText(resolve(root, "package.json")))!) as Record<
      string,
      unknown
    >;
    expect(manifest.packageManager).toBe(`bun@${bunVersion}`);
    expect(manifest.scripts).toEqual({ test: "keep-me" });
    expect(manifest.custom).toEqual({ untouched: true });
  });

  test("makes conflict alignment explicit and represents continuation as a warning", async () => {
    const base = filesWithRelease();
    const root = resolve(fixtureRoot, "conflict-app");
    writeApplication(base, root, {
      coreVersion: "1.1.0",
      extra: { scripts: { test: "keep-me" } },
    });
    const plan = await planBootstrap(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files: base, runtime },
    );
    expect(plan.state).toBe("version-conflict");
    expect(plan.conflict).toMatchObject({
      selected: "1.1.0",
      canContinue: true,
      choices: conflictChoices,
    });
    expect(plan.missingPackages).toEqual([
      "@mit-sdg/sync-engine-analysis",
      "@mit-sdg/sync-engine-catalog",
    ]);

    const unchanged = base.clone();
    const before = new Map(unchanged.values);
    const waiting = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath },
      { files: unchanged, runtime, runCommand: successfulRunner(unchanged) },
    );
    expect(waiting.outcome).toBe("choice-required");
    expect(unchanged.values).toEqual(before);
    const stopped = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath, conflictChoice: "stop-unchanged" },
      { files: unchanged, runtime, runCommand: successfulRunner(unchanged) },
    );
    expect(stopped.outcome).toBe("stopped-unchanged");
    expect(unchanged.values).toEqual(before);

    const continuedFiles = base.clone();
    const continued = await bootstrapApplication(
      {
        applicationRoot: root,
        releaseManifestPath: releasePath,
        conflictChoice: "continue-with-warning",
      },
      { files: continuedFiles, runtime, runCommand: successfulRunner(continuedFiles) },
    );
    expect(continued.outcome).toBe("continued-with-warning");
    expect(continued.plan.state).toBe("version-conflict");
    expect(continued.warnings).toHaveLength(1);
    expect(continued.commands).toHaveLength(1);
    expect(continued.commands[0]!.args.slice(3)).toEqual([
      "@mit-sdg/sync-engine-analysis@1.1.0",
      "@mit-sdg/sync-engine-catalog@1.1.0",
    ]);
    for (const name of ["@mit-sdg/sync-engine-analysis", "@mit-sdg/sync-engine-catalog"] as const) {
      const manifest = JSON.parse(
        (await continuedFiles.readText(resolve(root, "node_modules", name, "package.json")))!,
      );
      expect(manifest.version).toBe("1.1.0");
    }

    const alignedFiles = base.clone();
    const aligned = await bootstrapApplication(
      {
        applicationRoot: root,
        releaseManifestPath: releasePath,
        conflictChoice: "align-pinned-release",
      },
      { files: alignedFiles, runtime, runCommand: successfulRunner(alignedFiles) },
    );
    expect(aligned.outcome).toBe("changed");
    expect(aligned.plan.state).toBe("ready");
    expect(aligned.commands).toHaveLength(1);
    expect(aligned.commands[0]!.args.slice(3)).toEqual(
      requiredPackages.map(([name]) => `${name}@${releaseVersion}`),
    );
    const alignedManifest = JSON.parse(
      (await alignedFiles.readText(resolve(root, "package.json")))!,
    );
    expect(alignedManifest.scripts).toEqual({ test: "keep-me" });
  });

  test("stops cleanly when install fails", async () => {
    const files = filesWithRelease();
    const root = resolve(fixtureRoot, "failed-app");
    const seen: BootstrapCommand[] = [];
    const result = await bootstrapApplication(
      { applicationRoot: root, releaseManifestPath: releasePath },
      {
        files,
        runtime,
        runCommand: async (command) => {
          seen.push(command);
          return { exitCode: 7, stderr: "registry unavailable" };
        },
      },
    );
    expect(result.outcome).toBe("failed");
    expect(result.plan.state).toBe("failed");
    expect(seen.map(({ executable }) => executable)).toEqual(["bun"]);
    expect(result.changedPaths).toEqual([resolve(root, "package.json")]);
    expect(await files.readText(resolve(root, "tsconfig.json"))).toBeUndefined();
  });

  test("fails without mutation for malformed manifests or another package manager", async () => {
    const files = filesWithRelease();
    const malformed = resolve(fixtureRoot, "malformed-app");
    files.set(resolve(malformed, "package.json"), "{not json");
    expect(
      (
        await planBootstrap(
          { applicationRoot: malformed, releaseManifestPath: releasePath },
          { files, runtime },
        )
      ).state,
    ).toBe("failed");

    const alternate = resolve(fixtureRoot, "alternate-manager-app");
    writeApplication(files, alternate, { packageManager: "npm@11.0.0" });
    const before = new Map(files.values);
    const result = await bootstrapApplication(
      { applicationRoot: alternate, releaseManifestPath: releasePath },
      {
        files,
        runtime,
        runCommand: async () => {
          throw new Error("must not run");
        },
      },
    );
    expect(result.outcome).toBe("failed");
    expect(result.plan.error).toBe(
      `packageManager must be exact bun@${bunVersion}; alternate package managers are not supported`,
    );
    expect(files.values).toEqual(before);
  });
});
