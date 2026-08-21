import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const requiredPackages = [
  ["@mit-sdg/sync-engine", "sync-engine"],
  ["@mit-sdg/sync-engine-analysis", "sync-engine-analysis"],
  ["@mit-sdg/sync-engine-catalog", "sync-engine-catalog"],
] as const;
export type RequiredPackage = (typeof requiredPackages)[number][0];
export const expectedSetupFiles = ["tsconfig.json", "generated.config.ts"] as const;
export const conflictChoices = [
  "align-pinned-release",
  "continue-with-warning",
  "stop-unchanged",
] as const;
export type ConflictChoice = (typeof conflictChoices)[number];

export interface SkillRelease {
  readonly skill: string;
  readonly toolchain: Readonly<{ bun: string; node: string; typescript: string }>;
  readonly packages: Readonly<Record<RequiredPackage, string>>;
}

export interface BootstrapFiles {
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly writeText: (path: string, contents: string) => Promise<void>;
  readonly fileKind: (
    path: string,
    containmentRoot: string,
  ) => Promise<"missing" | "regular" | "unsafe">;
  readonly ensureDirectory: (path: string) => Promise<void>;
}

export interface RuntimeVersions {
  readonly bun?: string;
  readonly node: string;
}

export interface BootstrapCommand {
  readonly executable: "bun" | "bunx";
  readonly args: readonly string[];
  readonly cwd: string;
}

export type CommandResult = Readonly<{ exitCode: number }>;

export type CommandRunner = (command: BootstrapCommand) => Promise<CommandResult>;
export type BootstrapState =
  | "ready"
  | "new-app"
  | "missing-tooling"
  | "version-conflict"
  | "failed";

export interface VersionConflict {
  readonly expected: string;
  readonly found: readonly string[];
  readonly selected?: string;
  readonly canContinue: boolean;
  readonly choices: typeof conflictChoices;
}

export interface BootstrapPlan {
  readonly state: BootstrapState;
  readonly applicationRoot: string;
  readonly release?: SkillRelease;
  readonly commands: readonly BootstrapCommand[];
  readonly missingPackages: readonly RequiredPackage[];
  readonly missingSetupFiles: readonly string[];
  readonly conflict?: VersionConflict;
  readonly error?: string;
}

export interface BootstrapOptions {
  readonly applicationRoot: string;
  readonly releaseManifestPath: string;
  readonly conflictChoice?: ConflictChoice;
}

export interface BootstrapDependencies {
  readonly files?: BootstrapFiles;
  readonly runCommand?: CommandRunner;
  readonly runtime?: RuntimeVersions;
}

export interface BootstrapResult {
  readonly outcome:
    | "ready"
    | "changed"
    | "choice-required"
    | "continued-with-warning"
    | "stopped-unchanged"
    | "failed";
  readonly plan: BootstrapPlan;
  readonly commands: readonly BootstrapCommand[];
  readonly warnings: readonly string[];
  readonly changedPaths: readonly string[];
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export const realFiles: BootstrapFiles = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  },
  async writeText(path, contents) {
    await writeFile(path, contents, "utf8");
  },
  async fileKind(path, containmentRoot) {
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) return "unsafe";
      const [actual, boundary] = await Promise.all([realpath(path), realpath(containmentRoot)]);
      return inside(boundary, actual) ? "regular" : "unsafe";
    } catch (error) {
      if (missing(error)) return "missing";
      throw error;
    }
  },
  async ensureDirectory(path) {
    await mkdir(path, { recursive: true });
  },
};

export const realRuntime: RuntimeVersions = {
  node: process.versions.node,
  ...(process.versions.bun === undefined ? {} : { bun: process.versions.bun }),
};

export const runCommand: CommandRunner = (command) =>
  new Promise((fulfill, reject) => {
    const child = spawn(command.executable, [...command.args], {
      cwd: command.cwd,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (exitCode) => fulfill({ exitCode: exitCode ?? 1 }));
  });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectFrom(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${path}`);
  }
  if (!record(value)) throw new Error(`Expected a JSON object in ${path}`);
  return value;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readSkillRelease(
  releaseManifestPath: string,
  files: BootstrapFiles = realFiles,
): Promise<SkillRelease> {
  const path = resolve(releaseManifestPath);
  const text = await files.readText(path);
  if (text === undefined) throw new Error(`Release manifest does not exist: ${path}`);
  const value = objectFrom(text, path);
  if (
    typeof value.skill !== "string" ||
    value.skill.trim() === "" ||
    !record(value.toolchain) ||
    !record(value.packages) ||
    ![value.toolchain.bun, value.toolchain.node, value.toolchain.typescript].every(
      (item) => typeof item === "string" && item.trim() !== "",
    )
  ) {
    throw new Error(`Invalid release manifest: ${path}`);
  }
  const skill = value.skill;
  const packages = {} as Record<RequiredPackage, string>;
  for (const [name] of requiredPackages) {
    if (value.packages[name] !== skill) {
      throw new Error(`Release ${skill} must pin ${name} to that exact version`);
    }
    packages[name] = skill;
  }
  const toolchain = value.toolchain as SkillRelease["toolchain"];
  return { skill, toolchain, packages };
}

function satisfiesMajorRange(version: string, range: string): boolean {
  const bounds = /^>=(\d+) <(\d+)$/.exec(range);
  const major = /^(\d+)(?:\.|$)/.exec(version);
  if (bounds === null || major === null)
    throw new Error(`Unsupported version or range: ${version} / ${range}`);
  return Number(major[1]) >= Number(bounds[1]) && Number(major[1]) < Number(bounds[2]);
}

function verifyRuntime(release: SkillRelease, runtime: RuntimeVersions): void {
  if (runtime.bun !== undefined && runtime.bun !== release.toolchain.bun) {
    throw new Error(`Running Bun ${runtime.bun} does not match ${release.toolchain.bun}`);
  }
  if (!satisfiesMajorRange(runtime.node, release.toolchain.node)) {
    throw new Error(`Running Node ${runtime.node} does not satisfy ${release.toolchain.node}`);
  }
}

type InstalledPackage = Readonly<{ version?: string; usable: boolean }>;

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

async function installedPackage(
  root: string,
  name: RequiredPackage,
  executable: string,
  files: BootstrapFiles,
): Promise<InstalledPackage> {
  const packageRoot = resolve(root, "node_modules", name);
  const path = resolve(packageRoot, "package.json");
  const manifestKind = await files.fileKind(path, root);
  if (manifestKind === "missing") return { usable: false };
  if (manifestKind === "unsafe") throw new Error(`Unsafe installed package manifest: ${path}`);
  const text = await files.readText(path);
  if (text === undefined) throw new Error(`Installed package manifest disappeared: ${path}`);
  let manifest: Record<string, unknown>;
  try {
    manifest = objectFrom(text, path);
  } catch {
    return { usable: false };
  }
  const version = typeof manifest.version === "string" ? manifest.version : undefined;
  const bin = manifest.bin;
  const target = typeof bin === "string" ? bin : record(bin) ? bin[executable] : undefined;
  if (manifest.name !== name || typeof target !== "string" || target === "") {
    return { ...(version === undefined ? {} : { version }), usable: false };
  }
  const executablePath = resolve(packageRoot, target);
  if (!inside(packageRoot, executablePath))
    throw new Error(`Escaping executable target: ${target}`);
  const targetKind = await files.fileKind(executablePath, packageRoot);
  if (targetKind === "unsafe") throw new Error(`Unsafe executable target: ${executablePath}`);
  return { ...(version === undefined ? {} : { version }), usable: targetKind === "regular" };
}

const dependencySections = ["dependencies", "devDependencies"] as const;

function declaredVersions(manifest: Record<string, unknown>, name: RequiredPackage): string[] {
  const versions: string[] = [];
  for (const section of dependencySections) {
    const dependencies = manifest[section];
    if (dependencies === undefined) continue;
    if (!record(dependencies)) throw new Error(`package.json ${section} must be an object`);
    const version = dependencies[name];
    if (version !== undefined && typeof version !== "string") {
      throw new Error(`package.json ${section}.${name} must be a string`);
    }
    if (typeof version === "string") versions.push(version);
  }
  return versions;
}

function install(
  root: string,
  version: string,
  packages: readonly RequiredPackage[],
): BootstrapCommand {
  return {
    executable: "bun",
    args: ["add", "--dev", "--exact", ...packages.map((name) => `${name}@${version}`)],
    cwd: root,
  };
}

function setup(root: string): BootstrapCommand {
  return { executable: "bunx", args: ["--no-install", "sync-engine", "setup"], cwd: root };
}

function failed(root: string, error: unknown, release?: SkillRelease): BootstrapPlan {
  return {
    state: "failed",
    applicationRoot: root,
    ...(release === undefined ? {} : { release }),
    commands: [],
    missingPackages: [],
    missingSetupFiles: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function inspectApplication(
  options: Pick<BootstrapOptions, "applicationRoot"> & { readonly release: SkillRelease },
  files: BootstrapFiles = realFiles,
  runtime: RuntimeVersions = realRuntime,
): Promise<BootstrapPlan> {
  const root = resolve(options.applicationRoot);
  try {
    verifyRuntime(options.release, runtime);
    const packagePath = resolve(root, "package.json");
    const packageKind = await files.fileKind(packagePath, root);
    if (packageKind === "missing") {
      const packages = requiredPackages.map(([name]) => name);
      return {
        state: "new-app",
        applicationRoot: root,
        release: options.release,
        commands: [install(root, options.release.skill, packages), setup(root)],
        missingPackages: packages,
        missingSetupFiles: [...expectedSetupFiles],
      };
    }
    if (packageKind === "unsafe") throw new Error(`Unsafe application manifest: ${packagePath}`);
    const packageText = await files.readText(packagePath);
    if (packageText === undefined)
      throw new Error(`Application manifest disappeared: ${packagePath}`);

    const manifest = objectFrom(packageText, packagePath);
    const expectedManager = `bun@${options.release.toolchain.bun}`;
    if (manifest.packageManager !== undefined && manifest.packageManager !== expectedManager) {
      throw new Error(
        `packageManager must be exact ${expectedManager}; alternate package managers are not supported`,
      );
    }
    const needsPackageManager = manifest.packageManager === undefined;
    const installed = new Map<RequiredPackage, InstalledPackage>();
    const declarations = new Map<RequiredPackage, string[]>();
    for (const [name, executable] of requiredPackages) {
      installed.set(name, await installedPackage(root, name, executable, files));
      declarations.set(name, declaredVersions(manifest, name));
    }

    const missingSetupFiles: string[] = [];
    for (const file of expectedSetupFiles) {
      const path = resolve(root, file);
      const kind = await files.fileKind(path, root);
      if (kind === "unsafe") throw new Error(`Unsafe setup file: ${path}`);
      if (kind === "missing") missingSetupFiles.push(file);
    }
    if (missingSetupFiles.length === 0) {
      const path = resolve(root, "node_modules/typescript/package.json");
      const kind = await files.fileKind(path, root);
      if (kind !== "regular") throw new Error(`TypeScript manifest is ${kind}: ${path}`);
      const text = await files.readText(path);
      const version = text === undefined ? undefined : objectFrom(text, path).version;
      if (
        typeof version !== "string" ||
        !satisfiesMajorRange(version, options.release.toolchain.typescript)
      ) {
        throw new Error(
          `Installed TypeScript ${String(version)} does not satisfy ${options.release.toolchain.typescript}`,
        );
      }
    }

    const core = "@mit-sdg/sync-engine" as const;
    const coreInstalled = installed.get(core)!;
    const coreDeclarations = declarations.get(core)!;
    const conflicting = [
      ...coreDeclarations.filter((item) => item !== options.release.skill),
      ...(coreInstalled.version !== undefined && coreInstalled.version !== options.release.skill
        ? [coreInstalled.version]
        : []),
    ];
    const selected = conflicting.length === 0 ? options.release.skill : coreInstalled.version;
    const missingPackages = requiredPackages
      .filter(([name]) => {
        if (name === core && conflicting.length > 0) return false;
        const found = installed.get(name)!;
        const declared = declarations.get(name)!;
        const expected =
          name === core ? options.release.skill : (selected ?? options.release.skill);
        return (
          !found.usable ||
          found.version !== expected ||
          declared.length === 0 ||
          declared.some((item) => item !== expected)
        );
      })
      .map(([name]) => name);

    if (conflicting.length > 0) {
      const canContinue =
        selected !== undefined &&
        coreInstalled.usable &&
        coreDeclarations.length > 0 &&
        coreDeclarations.every((item) => item === selected);
      return {
        state: "version-conflict",
        applicationRoot: root,
        release: options.release,
        commands: [],
        missingPackages,
        missingSetupFiles,
        conflict: {
          expected: options.release.skill,
          found: [...new Set(conflicting)],
          ...(selected === undefined ? {} : { selected }),
          canContinue,
          choices: conflictChoices,
        },
      };
    }

    const commands: BootstrapCommand[] = [];
    if (missingPackages.length > 0)
      commands.push(install(root, options.release.skill, missingPackages));
    if (missingSetupFiles.length > 0) commands.push(setup(root));
    const state = needsPackageManager || commands.length > 0 ? "missing-tooling" : "ready";
    return {
      state,
      applicationRoot: root,
      release: options.release,
      commands,
      missingPackages,
      missingSetupFiles,
    };
  } catch (error) {
    return failed(root, error, options.release);
  }
}

export async function planBootstrap(
  options: BootstrapOptions,
  dependencies: Pick<BootstrapDependencies, "files" | "runtime"> = {},
): Promise<BootstrapPlan> {
  const files = dependencies.files ?? realFiles;
  const runtime = dependencies.runtime ?? realRuntime;
  try {
    const release = await readSkillRelease(options.releaseManifestPath, files);
    return inspectApplication(
      { applicationRoot: options.applicationRoot, release },
      files,
      runtime,
    );
  } catch (error) {
    return failed(resolve(options.applicationRoot), error);
  }
}

async function pinPackageManager(plan: BootstrapPlan, files: BootstrapFiles): Promise<boolean> {
  if (plan.release === undefined) return false;
  const path = resolve(plan.applicationRoot, "package.json");
  if ((await files.fileKind(path, plan.applicationRoot)) !== "regular") {
    throw new Error(`Application manifest became unsafe: ${path}`);
  }
  const text = await files.readText(path);
  if (text === undefined) throw new Error(`Application manifest disappeared: ${path}`);
  const manifest = objectFrom(text, path);
  if (manifest.packageManager !== undefined) {
    if (manifest.packageManager === `bun@${plan.release.toolchain.bun}`) return false;
    throw new Error("Application packageManager changed during bootstrap");
  }
  await files.writeText(
    path,
    json({ ...manifest, packageManager: `bun@${plan.release.toolchain.bun}` }),
  );
  return true;
}

function usableForSetup(plan: BootstrapPlan, continuing: boolean): boolean {
  if (plan.missingPackages.length > 0) return false;
  return continuing
    ? plan.state === "version-conflict" && plan.conflict?.canContinue === true
    : plan.state === "ready" || plan.state === "missing-tooling";
}

export async function bootstrapApplication(
  options: BootstrapOptions,
  dependencies: BootstrapDependencies = {},
): Promise<BootstrapResult> {
  const files = dependencies.files ?? realFiles;
  const runner = dependencies.runCommand ?? runCommand;
  const runtime = dependencies.runtime ?? realRuntime;
  const initial = await planBootstrap(options, { files, runtime });
  const commands: BootstrapCommand[] = [];
  const warnings: string[] = [];
  const changed = new Set<string>();
  const result = (outcome: BootstrapResult["outcome"], plan: BootstrapPlan): BootstrapResult => ({
    outcome,
    plan,
    commands,
    warnings,
    changedPaths: [...changed],
  });

  if (initial.state === "failed") return result("failed", initial);
  if (initial.state === "ready") return result("ready", initial);
  const conflict = initial.state === "version-conflict";
  if (conflict && options.conflictChoice === undefined) return result("choice-required", initial);
  if (conflict && options.conflictChoice === "stop-unchanged")
    return result("stopped-unchanged", initial);
  const continuing = conflict && options.conflictChoice === "continue-with-warning";
  if (continuing && !initial.conflict?.canContinue) {
    return result(
      "failed",
      failed(initial.applicationRoot, "Existing core executable is not usable", initial.release),
    );
  }

  try {
    if (initial.state === "new-app") {
      await files.ensureDirectory(initial.applicationRoot);
      const path = resolve(initial.applicationRoot, "package.json");
      await files.writeText(
        path,
        json({
          name: basename(initial.applicationRoot) || "sync-engine-app",
          private: true,
          type: "module",
          packageManager: `bun@${initial.release!.toolchain.bun}`,
        }),
      );
      changed.add(path);
    } else if (await pinPackageManager(initial, files)) {
      changed.add(resolve(initial.applicationRoot, "package.json"));
    }

    const installPackages =
      initial.state === "new-app" || (conflict && options.conflictChoice === "align-pinned-release")
        ? requiredPackages.map(([name]) => name)
        : initial.missingPackages;
    if (installPackages.length > 0) {
      const version = continuing ? initial.conflict!.selected! : initial.release!.skill;
      const command = install(initial.applicationRoot, version, installPackages);
      commands.push(command);
      const output = await runner(command);
      if (output.exitCode !== 0) throw new Error(`Install exited ${output.exitCode}`);
      changed.add(resolve(initial.applicationRoot, "package.json"));
    }

    let current = await inspectApplication(
      { applicationRoot: initial.applicationRoot, release: initial.release! },
      files,
      runtime,
    );
    if (!usableForSetup(current, continuing)) {
      throw new Error("Install did not establish coherent required tooling");
    }
    if (current.missingSetupFiles.length > 0) {
      const command = setup(initial.applicationRoot);
      commands.push(command);
      const output = await runner(command);
      if (output.exitCode !== 0) throw new Error(`Setup exited ${output.exitCode}`);
      changed.add(resolve(initial.applicationRoot, "package.json"));
      for (const file of current.missingSetupFiles) {
        changed.add(resolve(initial.applicationRoot, file));
      }
      current = await inspectApplication(
        { applicationRoot: initial.applicationRoot, release: initial.release! },
        files,
        runtime,
      );
    }

    if (continuing) {
      if (!usableForSetup(current, true) || current.missingSetupFiles.length > 0) {
        throw new Error("Mismatched environment is not usable after bootstrap");
      }
      warnings.push(
        `Continuing with coherent sync-engine release ${current.conflict!.selected}; pinned release is ${current.conflict!.expected}`,
      );
      return result("continued-with-warning", current);
    }
    if (current.state !== "ready") throw new Error(`Bootstrap ended in state ${current.state}`);
    return result("changed", current);
  } catch (error) {
    return result("failed", failed(initial.applicationRoot, error, initial.release));
  }
}
