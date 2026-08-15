import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationExamples } from "../examples/register.ts";
import { filesBelow } from "../src/command/files-below.ts";
import { workspaceBuildOrder, workspaceById, workspacePath, type Workspace } from "./workspaces.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(resolve(tmpdir(), "sync-engine-package-"));
const expectedAuthor = "Barish Namazov and Eagon Meng";
const coreWorkspace = workspaceById("core");
const analysisWorkspace = workspaceById("analysis");
const multiInstanceWorkspaces = [coreWorkspace, workspaceById("http")];

interface RuntimeConsumerCheck {
  readonly filename: string;
  readonly runners: readonly ("node" | "bun")[];
  readonly timeout?: number;
}

interface ConsumerFixture {
  readonly workspaceId: string;
  readonly runtimeChecks?: readonly RuntimeConsumerCheck[];
}

const consumerFixtures: readonly ConsumerFixture[] = [
  { workspaceId: "core" },
  { workspaceId: "http" },
  {
    workspaceId: "analysis",
    runtimeChecks: [
      { filename: "analysis-ir-import-isolation.mjs", runners: ["node"] },
      {
        filename: "analysis-consumer-scenario.mjs",
        runners: ["node", "bun"],
        timeout: 30_000,
      },
    ],
  },
];

interface NpmPackResult {
  filename: string;
  size: number;
  unpackedSize: number;
  files: Array<{ path: string; mode: number }>;
}

interface PackageManifest {
  author: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports: Record<string, { import: string; types: string }>;
  license: string;
  name: string;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  publishConfig?: { access?: string; tag?: string };
  repository?: { directory?: string };
  version: string;
}

interface PackedWorkspace {
  workspace: Workspace;
  manifest: PackageManifest;
  tarball: string;
  entries: Set<string>;
}

interface DependencyManifest {
  dependencies: Record<string, string>;
  [key: string]: unknown;
}

function commandEnv(): NodeJS.ProcessEnv {
  return { ...process.env, BUN_INSTALL_CACHE_DIR: resolve(temporary, "cache"), TMPDIR: temporary };
}

function run(command: string, args: string[], cwd = root, timeout?: number): void {
  // Reuse the Bun executable that launched this check. A toolchain shim may
  // require package-manager metadata that intentionally npm-only consumers omit.
  const executable = command === "bun" ? process.execPath : command;
  execFileSync(executable, args, {
    cwd,
    env: commandEnv(),
    stdio: "inherit",
    ...(timeout === undefined ? {} : { timeout }),
  });
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpm(args: string[], cwd = root): void {
  run(npmCommand(), args, cwd);
}

function requireEntry(entries: Set<string>, path: string): void {
  if (!entries.has(`package/${path}`)) throw new Error(`packed package omits ${path}`);
}

function requireExecutable(packed: NpmPackResult, path: string): void {
  // Windows archives do not carry a meaningful POSIX executable bit. The
  // Linux publication job and every POSIX package check enforce it.
  if (process.platform === "win32") return;
  const mode = packed.files.find((file) => file.path === path)?.mode;
  if (mode === undefined || (mode & 0o100) === 0) {
    throw new Error(`packed package does not mark ${path} executable`);
  }
}

function portablePath(path: string): string {
  return path.split(sep).join(posix.sep);
}

function tarballSpecifier(from: string, tarball: string): string {
  return `file:${portablePath(relative(from, tarball))}`;
}

function packageEntrypoint(workspace: Workspace, entrypoint: string): string {
  return entrypoint === "."
    ? workspace.packageName
    : `${workspace.packageName}/${entrypoint.slice(2)}`;
}

function packWithNpm(cwd: string, destination: string): NpmPackResult {
  const output = execFileSync(
    npmCommand(),
    ["pack", "--json", "--loglevel=error", "--pack-destination", destination],
    {
      cwd,
      env: commandEnv(),
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    },
  );
  const jsonStart = output.search(/^\[/m);
  if (jsonStart === -1) throw new Error("npm pack did not emit its JSON manifest");
  const parsed = JSON.parse(output.slice(jsonStart)) as NpmPackResult[];
  if (parsed.length !== 1) throw new Error(`npm pack described ${parsed.length} artifacts`);
  const packed = parsed[0];
  if (packed.size <= 0 || packed.unpackedSize <= 0) {
    throw new Error("npm pack reported an empty artifact");
  }
  return packed;
}

function packedPathExists(entries: Set<string>, path: string): boolean {
  const entry = `package/${path.replace(/\/+$/, "")}`;
  return (
    entries.has(entry) ||
    entries.has(`${entry}/`) ||
    [...entries].some((item) => item.startsWith(`${entry}/`))
  );
}

async function writePackageManifest(path: string, manifest: DependencyManifest): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function verifyPackedDocLinks(entries: Set<string>, installed: string): Promise<void> {
  for (const entry of entries) {
    if (!entry.startsWith("package/") || !entry.endsWith(".md")) continue;
    const documentPath = entry.slice("package/".length);
    // Released changelog entries are immutable and may name documentation paths
    // that existed only in the corresponding package version.
    if (documentPath === "CHANGELOG.md") continue;
    const markdown = await readFile(resolve(installed, documentPath), "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (
        /^(?:https?:|mailto:|reaction:|view:|former:|computation:)/.test(target) ||
        target.startsWith("#")
      )
        continue;
      const relativeTarget = target.split("#", 1)[0].replace(/^<|>$/g, "");
      const packedTarget = posix.normalize(posix.join(posix.dirname(documentPath), relativeTarget));
      if (packedTarget.startsWith("../") || !packedPathExists(entries, packedTarget)) {
        throw new Error(`${documentPath} links to ${target}, which is absent from the package`);
      }
    }
  }
}

function workspaceArtifact(
  artifacts: ReadonlyMap<string, PackedWorkspace>,
  workspace: Workspace,
): PackedWorkspace {
  const artifact = artifacts.get(workspace.id);
  if (artifact === undefined) throw new Error(`No packed artifact for ${workspace.id}`);
  return artifact;
}

function workspaceDependencies(
  manifest: PackageManifest,
): Array<Record<string, string> | undefined> {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ];
}

function rejectForbiddenManifestDependencies(
  workspace: Workspace,
  manifest: PackageManifest,
): void {
  for (const forbiddenId of workspace.forbiddenWorkspaceIds) {
    const forbidden = workspaceById(forbiddenId);
    if (
      workspaceDependencies(manifest).some(
        (dependencies) => forbidden.packageName in (dependencies ?? {}),
      )
    ) {
      throw new Error(`${workspace.id} package manifest depends on ${forbidden.packageName}`);
    }
  }
}

function verifyManifestPolicy(workspace: Workspace, manifest: PackageManifest): void {
  if (manifest.license !== "Apache-2.0") {
    throw new Error(`${workspace.id} package license is ${manifest.license}; expected Apache-2.0`);
  }
  if (manifest.author !== expectedAuthor) {
    throw new Error(
      `${workspace.id} package author is ${manifest.author}; expected ${expectedAuthor}`,
    );
  }
  if (workspace.publication === "npm") {
    if (manifest.private !== undefined) {
      throw new Error(`${workspace.id} published package must omit private`);
    }
    if (manifest.publishConfig?.access !== "public" || manifest.publishConfig.tag !== "beta") {
      throw new Error(`${workspace.id} published package must use public access and the beta tag`);
    }
  } else if (manifest.private !== true) {
    throw new Error(`${workspace.id} private package must set private to true`);
  }
  for (const dependencies of workspaceDependencies(manifest)) {
    for (const [name, range] of Object.entries(dependencies ?? {})) {
      if (/^(?:file|workspace):/.test(range)) {
        throw new Error(`${workspace.id} packed package uses local range ${name}@${range}`);
      }
    }
  }
  if (
    workspace.id === analysisWorkspace.id &&
    manifest.repository?.directory !== analysisWorkspace.directory
  ) {
    throw new Error(
      `${workspace.id} package repository.directory must be ${analysisWorkspace.directory}`,
    );
  }
  rejectForbiddenManifestDependencies(workspace, manifest);
}

async function verifyPackedWorkspace(
  workspace: Workspace,
  manifest: PackageManifest,
  packed: NpmPackResult,
): Promise<PackedWorkspace> {
  const budget = workspace.packageBudget;
  if (packed.files.length > budget.files) {
    throw new Error(
      `${workspace.id} packed package has ${packed.files.length} files; budget is ${budget.files}`,
    );
  }
  if (packed.size > budget.packedBytes) {
    throw new Error(
      `${workspace.id} packed package is ${packed.size} bytes; budget is ${budget.packedBytes}`,
    );
  }
  if (packed.unpackedSize > budget.unpackedBytes) {
    throw new Error(
      `${workspace.id} unpacked package is ${packed.unpackedSize} bytes; budget is ${budget.unpackedBytes}`,
    );
  }
  if (manifest.name !== workspace.packageName) {
    throw new Error(
      `${workspace.id} package name is ${manifest.name}; expected ${workspace.packageName}`,
    );
  }
  const expectedFilename = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  if (packed.filename !== expectedFilename) {
    throw new Error(`npm packed ${packed.filename}; expected ${expectedFilename}`);
  }
  verifyManifestPolicy(workspace, manifest);

  const tarball = resolve(temporary, packed.filename);
  const packedManifest = JSON.parse(
    execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" }),
  ) as PackageManifest;
  if (packedManifest.name !== manifest.name || packedManifest.version !== manifest.version) {
    throw new Error(`${workspace.id} packed manifest identity differs from its source manifest`);
  }
  verifyManifestPolicy(workspace, packedManifest);
  manifest = packedManifest;
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const entries = new Set(listing.trim().split(/\r?\n/));
  if (
    workspace.id === coreWorkspace.id &&
    (entries.has("package/CONTRIBUTING.md") ||
      [...entries].some((entry) => entry.startsWith("package/docs/project/")))
  ) {
    throw new Error("core packed package contains project-only documentation");
  }
  if ([...entries].some((entry) => entry.endsWith(".map"))) {
    throw new Error("packed package contains source maps whose implementation sources are omitted");
  }
  for (const path of workspace.requiredPackedFiles) requireEntry(entries, path);
  if (workspace.id === coreWorkspace.id) {
    for (const path of await filesBelow(resolve(root, "docs"))) {
      const documentationPath = portablePath(relative(root, path));
      if (documentationPath.startsWith("docs/user/")) {
        requireEntry(entries, documentationPath);
      } else if (!documentationPath.startsWith("docs/project/")) {
        throw new Error(`${documentationPath} is outside a documentation audience directory`);
      }
    }
  }
  if (workspace.copiesExamples) {
    for (const path of await filesBelow(resolve(root, "examples"))) {
      requireEntry(entries, portablePath(relative(root, path)));
    }
  }
  for (const target of Object.values(manifest.exports)) {
    requireEntry(entries, target.import.replace(/^\.\//, ""));
    requireEntry(entries, target.types.replace(/^\.\//, ""));
  }
  const declaredBins = Object.values(manifest.bin ?? {}).map((path) => path.replace(/^\.\//, ""));
  for (const executable of workspace.bins) {
    if (!declaredBins.includes(executable))
      throw new Error(`${workspace.id} package must expose ./${executable} as a bin`);
    requireEntry(entries, executable);
    requireExecutable(packed, executable);
  }
  if (workspace.id === coreWorkspace.id) {
    for (const forbiddenId of coreWorkspace.forbiddenWorkspaceIds) {
      const forbidden = workspaceById(forbiddenId);
      if ([...entries].some((entry) => entry.startsWith(`package/${forbidden.directory}/`))) {
        throw new Error(`core package contains the ${forbidden.id} workspace`);
      }
    }
  }
  return { workspace, manifest, tarball, entries };
}

async function verifyInstalledWorkspace(
  artifact: PackedWorkspace,
  installed: string,
): Promise<void> {
  await verifyPackedDocLinks(artifact.entries, installed);
  const dist = resolve(installed, "dist");
  if (!existsSync(dist)) return;
  for (const path of await filesBelow(
    dist,
    (name) => name.endsWith(".js") || name.endsWith(".d.ts"),
  )) {
    const source = await readFile(path, "utf8");
    if (/['"]@(?:engine|root|sync-engine)\//.test(source)) {
      throw new Error(`${relative(installed, path)} contains a repository-only import alias`);
    }
    for (const forbiddenId of artifact.workspace.forbiddenWorkspaceIds) {
      const forbidden = workspaceById(forbiddenId);
      if (
        source.includes(`"${forbidden.packageName}`) ||
        source.includes(`'${forbidden.packageName}`)
      ) {
        throw new Error(`${relative(installed, path)} imports forbidden ${forbidden.packageName}`);
      }
    }
  }
}

function assertWorkspacePeers(
  workspace: Workspace,
  manifest: PackageManifest,
  artifacts: ReadonlyMap<string, PackedWorkspace>,
): void {
  for (const peerId of workspace.peerWorkspaceIds) {
    const peer = workspaceArtifact(artifacts, workspaceById(peerId));
    const expected = peer.manifest.version;
    if (manifest.peerDependencies?.[peer.workspace.packageName] !== expected) {
      throw new Error(
        `${workspace.id} must declare peer ${peer.workspace.packageName}@${expected}`,
      );
    }
  }
  const core = workspaceArtifact(artifacts, coreWorkspace);
  for (const dependency of workspace.rootRuntimeDependencies) {
    const expected = core.manifest.dependencies?.[dependency];
    if (
      expected === undefined ||
      manifest.dependencies?.[dependency] !== expected ||
      manifest.peerDependencies?.[dependency] !== undefined
    ) {
      throw new Error(
        `${workspace.id} must declare runtime dependency ${dependency}@${String(expected)}`,
      );
    }
  }
}

async function prepareWorkspaceDependencies<T extends DependencyManifest>(
  manifestPath: string,
  label: string,
  artifacts: ReadonlyMap<string, PackedWorkspace>,
  required: readonly Workspace[] = [coreWorkspace],
): Promise<T> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as T;
  for (const workspace of required) {
    const artifact = workspaceArtifact(artifacts, workspace);
    if (manifest.dependencies?.[workspace.packageName] !== artifact.manifest.version) {
      throw new Error(
        `${label} must depend on ${workspace.packageName} ${artifact.manifest.version}`,
      );
    }
  }
  for (const workspace of workspaceBuildOrder) {
    const artifact = workspaceArtifact(artifacts, workspace);
    const dependency = manifest.dependencies?.[workspace.packageName];
    if (dependency === undefined) continue;
    if (dependency !== artifact.manifest.version) {
      throw new Error(
        `${label} must depend on ${workspace.packageName} ${artifact.manifest.version}`,
      );
    }
    manifest.dependencies[workspace.packageName] = tarballSpecifier(
      dirname(manifestPath),
      artifact.tarball,
    );
  }
  return manifest;
}

function restoreWorkspaceDependencyVersions(
  manifest: DependencyManifest,
  artifacts: ReadonlyMap<string, PackedWorkspace>,
): void {
  for (const workspace of workspaceBuildOrder) {
    const artifact = workspaceArtifact(artifacts, workspace);
    if (manifest.dependencies[workspace.packageName] !== undefined) {
      manifest.dependencies[workspace.packageName] = artifact.manifest.version;
    }
  }
}

function entrypointImports(artifacts: readonly PackedWorkspace[]): string {
  return artifacts
    .flatMap((artifact) =>
      Object.keys(artifact.manifest.exports).map((entrypoint) => {
        const specifier = packageEntrypoint(artifact.workspace, entrypoint);
        return `import type * as ${specifier.replace(/[^a-z]/gi, "_")} from ${JSON.stringify(specifier)};`;
      }),
    )
    .join("\n");
}

function runtimeEntrypointImports(artifacts: readonly PackedWorkspace[]): string {
  return `await Promise.all(${JSON.stringify(
    artifacts.flatMap((artifact) =>
      Object.keys(artifact.manifest.exports).map((entrypoint) =>
        packageEntrypoint(artifact.workspace, entrypoint),
      ),
    ),
  )}.map((entrypoint) => import(entrypoint)));\n`;
}

const coreTransportScenario = `import { assemble, conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";
import { bindTransport, createGateway, endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { createClient } from "@mit-sdg/sync-engine/client";

const fence = String.fromCharCode(96).repeat(3);
const specification = [
  "# Noting",
  "",
  "## Purpose",
  "",
  "Keep short notes.",
  "",
  "## Principle",
  "",
  "Writing a note returns its identity.",
  "",
  "## Types",
  "",
  fence + "types",
  fence,
  "",
  "## State",
  "",
  fence + "state",
  "a set of Notes with",
  "  a text String",
  fence,
  "",
  "## Actions",
  "",
  fence + "actions",
  "write(text: String) : return (note: Note)",
  "  where true",
  "  then",
  "    add a new note with text",
  "    return note",
  fence,
  "",
  "## Queries",
  "",
  fence + "queries",
  fence,
].join("\\n");

class NotingConcept {
  write(_: { text: string }) {
    return { note: "note-1" };
  }
}

const noting = registerConcept({ class: NotingConcept, spec: specification });
const notingConcepts = conceptSet({ Noting: noting });
const { Noting } = notingConcepts.concepts;
const WriteNote = endpoint("/notes/write", ({ text, note }) =>
  receive({ text }).then(Noting.write({ text }).responds({ note })).then(respond({ note })),
);

type ScenarioWire = {
  "/notes/write": {
    input: { text: string };
    output: { note: string };
    error: { error: "INVALID_INPUT" };
  };
};

const application = assemble({
  conceptSet: notingConcepts,
  composition: { WriteNote },
});
const gateway = createGateway<ScenarioWire>({ application });
const binding = bindTransport({ application, gateway });
const client = createClient<ScenarioWire>({
  transport: async (request) => {
    const result = await binding.invoker.invoke(request.path as keyof ScenarioWire & string, request.input as never, {
      signal: request.signal,
    });
    return result.ok ? result.value : { error: "TRANSPORT_ERROR" };
  },
});
const written = await client["/notes/write"]({ text: "buy milk" });

if ("error" in written || written.note !== "note-1") {
  throw new Error("The custom transport binding scenario failed.");
}
`;

async function writeTypeScriptConfig(
  path: string,
  files: string[],
  options: { emit?: boolean; outDir?: string } = {},
): Promise<void> {
  await writeFile(
    path,
    `${JSON.stringify(
      {
        compilerOptions: {
          lib: ["ESNext", "DOM"],
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: options.emit !== true,
          ...(options.outDir === undefined ? {} : { outDir: options.outDir }),
          strict: true,
          skipLibCheck: false,
        },
        files,
      },
      null,
      2,
    )}\n`,
  );
}

async function verifyCoreOnlyConsumer(
  artifacts: ReadonlyMap<string, PackedWorkspace>,
): Promise<string> {
  const consumer = resolve(temporary, "core-consumer");
  const core = workspaceArtifact(artifacts, coreWorkspace);
  await mkdir(consumer);
  await writeFile(
    resolve(consumer, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: { [core.workspace.packageName]: tarballSpecifier(consumer, core.tarball) },
    })}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);

  const installed = resolve(consumer, "node_modules", ...core.workspace.packageName.split("/"));
  await verifyInstalledWorkspace(core, installed);
  for (const forbiddenId of core.workspace.forbiddenWorkspaceIds) {
    const forbidden = workspaceById(forbiddenId);
    if (existsSync(resolve(consumer, "node_modules", ...forbidden.packageName.split("/")))) {
      throw new Error(`core-only installation unexpectedly installed ${forbidden.packageName}`);
    }
  }

  await writeFile(resolve(consumer, "all-entrypoints.ts"), entrypointImports([core]));
  await writeFile(resolve(consumer, "runtime-import.mjs"), runtimeEntrypointImports([core]));
  await copyFile(
    resolve(root, "tests/packaging/node-runtime-scenario.ts"),
    resolve(consumer, "node-runtime-scenario.ts"),
  );
  await writeFile(resolve(consumer, "core-transport-scenario.ts"), coreTransportScenario);
  await writeTypeScriptConfig(resolve(consumer, "tsconfig.entrypoints.json"), [
    "all-entrypoints.ts",
  ]);
  await writeTypeScriptConfig(
    resolve(consumer, "tsconfig.runtime.json"),
    ["node-runtime-scenario.ts", "core-transport-scenario.ts"],
    { emit: true, outDir: "compiled" },
  );
  const tsc = resolve(consumer, "node_modules/typescript/bin/tsc");
  run("node", [tsc, "--project", "tsconfig.entrypoints.json"], consumer);
  run("node", [tsc, "--project", "tsconfig.runtime.json"], consumer);
  run("node", [resolve(consumer, "runtime-import.mjs")], consumer);
  run("node", [resolve(consumer, "compiled/node-runtime-scenario.js")], consumer);
  run("node", [resolve(consumer, "compiled/core-transport-scenario.js")], consumer);
  return consumer;
}

async function verifyCombinedConsumer(
  artifacts: ReadonlyMap<string, PackedWorkspace>,
): Promise<void> {
  const consumer = resolve(temporary, "combined-consumer");
  const packed = workspaceBuildOrder.map((workspace) => workspaceArtifact(artifacts, workspace));
  await mkdir(consumer);
  await writeFile(
    resolve(consumer, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: Object.fromEntries(
        packed.map((artifact) => [
          artifact.workspace.packageName,
          tarballSpecifier(consumer, artifact.tarball),
        ]),
      ),
    })}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
  for (const artifact of packed) {
    await verifyInstalledWorkspace(
      artifact,
      resolve(consumer, "node_modules", ...artifact.workspace.packageName.split("/")),
    );
  }
  await writeFile(resolve(consumer, "all-entrypoints.ts"), entrypointImports(packed));
  await writeFile(resolve(consumer, "runtime-import.mjs"), runtimeEntrypointImports(packed));
  const consumerContractFiles = consumerFixtures.map(
    ({ workspaceId }) => `${workspaceId}-consumer-contract.ts`,
  );
  const runtimeConsumerChecks: Array<RuntimeConsumerCheck & { path: string }> = [];
  for (const fixture of consumerFixtures) {
    const workspace = workspaceById(fixture.workspaceId);
    const fixtureRoot = workspacePath(root, workspace, "tests/packaging");
    const contract = `${fixture.workspaceId}-consumer-contract.ts`;
    await copyFile(resolve(fixtureRoot, contract), resolve(consumer, contract));
    for (const check of fixture.runtimeChecks ?? []) {
      const destination = resolve(consumer, check.filename);
      await copyFile(resolve(fixtureRoot, check.filename), destination);
      runtimeConsumerChecks.push({ ...check, path: destination });
    }
  }
  await writeTypeScriptConfig(resolve(consumer, "tsconfig.json"), [
    "all-entrypoints.ts",
    ...consumerContractFiles,
  ]);
  run(
    "node",
    [resolve(consumer, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    consumer,
  );
  run("node", [resolve(consumer, "runtime-import.mjs")], consumer);
  for (const check of runtimeConsumerChecks) {
    for (const runner of check.runners) run(runner, [check.path], consumer, check.timeout);
  }
}

async function verifyCatalogAlone(artifacts: ReadonlyMap<string, PackedWorkspace>): Promise<void> {
  const catalog = workspaceArtifact(artifacts, workspaceById("catalog"));
  const consumer = resolve(temporary, "catalog-only");
  await mkdir(consumer, { recursive: true });
  await writePackageManifest(resolve(consumer, "package.json"), {
    name: "catalog-only",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "bun@1.3.14",
    dependencies: { [catalog.workspace.packageName]: tarballSpecifier(consumer, catalog.tarball) },
  });
  run("bun", ["install", "--ignore-scripts"], consumer);
  if (existsSync(resolve(consumer, "node_modules/@mit-sdg/sync-engine"))) {
    throw new Error("catalog-only installation unexpectedly installed core");
  }
  const executable = catalog.manifest.bin?.catalog;
  if (executable === undefined) throw new Error("catalog package does not provide catalog");
  const command = resolve(
    consumer,
    "node_modules",
    ...catalog.workspace.packageName.split("/"),
    executable,
  );
  run("bun", [command, "list"], consumer);
  run("bun", [command, "show", "recipe/workshop-selection"], consumer);
  for (const entry of ["concept/commanding", "concept/filing", "concept/holding"]) {
    run("bun", [command, "show", entry], consumer);
  }
  run(
    "bun",
    [command, "source", "concept/selecting", "memory/selecting.memory.ts", "--raw"],
    consumer,
  );
  run("bun", [command, "source", "concept/filing", "node/filing.ts", "--raw"], consumer);
}

async function verifySkillAlone(artifacts: ReadonlyMap<string, PackedWorkspace>): Promise<void> {
  const skill = workspaceArtifact(artifacts, workspaceById("skill"));
  const consumer = resolve(temporary, "skill-only");
  await mkdir(consumer, { recursive: true });
  const analysis = workspaceArtifact(artifacts, workspaceById("analysis"));
  const catalog = workspaceArtifact(artifacts, workspaceById("catalog"));
  const core = workspaceArtifact(artifacts, coreWorkspace);
  if (
    skill.manifest.dependencies?.[analysis.workspace.packageName] !== analysis.manifest.version ||
    skill.manifest.dependencies?.[catalog.workspace.packageName] !== catalog.manifest.version
  ) {
    throw new Error("skill must depend on the exact matching analysis and catalog versions");
  }
  await writePackageManifest(resolve(consumer, "package.json"), {
    name: "skill-only",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "bun@1.3.14",
    dependencies: {
      [skill.workspace.packageName]: tarballSpecifier(consumer, skill.tarball),
      [analysis.workspace.packageName]: tarballSpecifier(consumer, analysis.tarball),
      [catalog.workspace.packageName]: tarballSpecifier(consumer, catalog.tarball),
      [core.workspace.packageName]: tarballSpecifier(consumer, core.tarball),
    },
  });
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
  for (const required of ["sync-engine", "sync-engine-analysis", "catalog"]) {
    if (!existsSync(resolve(consumer, "node_modules/.bin", required))) {
      throw new Error(`skill installation did not expose ${required}`);
    }
  }
  await mkdir(resolve(consumer, "src"), { recursive: true });
  await writeFile(
    resolve(consumer, "src/concepts.ts"),
    `import { conceptSet } from "@mit-sdg/sync-engine/assembly";
export const applicationConceptSet = conceptSet({});
`,
  );
  await writeFile(
    resolve(consumer, "generated.config.ts"),
    `import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./src/concepts.ts";
export default { title: "Packed analysis", design: { version: 1, documents: [] }, assemble: () => assemble({ conceptSet: applicationConceptSet, composition: {} }) };
`,
  );
  const nested = resolve(consumer, "nested/project");
  await mkdir(nested, { recursive: true });
  const analysisBin = resolve(consumer, "node_modules/.bin/sync-engine-analysis");
  run(analysisBin, ["summary"], nested);
  run(analysisBin, ["search", "nothing", "--json", "--limit", "1"], nested);
  const isolationHook = resolve(consumer, "analysis-cli-isolation.mjs");
  await writeFile(
    isolationHook,
    `import { registerHooks } from "node:module";
const loaded = [];
registerHooks({ resolve(specifier, context, nextResolve) { const result = nextResolve(specifier, context); loaded.push(result.url); return result; } });
process.on("exit", () => { const forbidden = loaded.filter((url) => url.includes("sync-engine-analysis/dist/project/")); if (forbidden.length) { console.error("manifest-only analysis loaded project analysis", forbidden); process.exitCode = 91; } });
`,
  );
  execFileSync(analysisBin, ["summary"], {
    cwd: nested,
    env: { ...commandEnv(), NODE_OPTIONS: `--import=${isolationHook}` },
    stdio: "inherit",
  });
  try {
    execFileSync(analysisBin, ["describe", "malformed"], {
      cwd: nested,
      env: commandEnv(),
      encoding: "utf8",
    });
    throw new Error("packed analysis accepted a malformed reference");
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    if (
      failure.status !== 1 ||
      failure.stdout !== "" ||
      !failure.stderr?.includes("Malformed reference")
    ) {
      throw error;
    }
  }
  const installed = resolve(consumer, "node_modules", ...skill.workspace.packageName.split("/"));
  const entry = await readFile(resolve(installed, "skills/sync-engine/SKILL.md"), "utf8");
  if (
    !entry.startsWith("---\nname: sync-engine\ndescription:") ||
    !entry.includes("Native subagents are required")
  ) {
    throw new Error("skill package does not contain the required sync-engine Agent Skill");
  }
  if (skill.manifest.bin !== undefined) {
    throw new Error("documentation-only skill package unexpectedly declares an executable");
  }
  const bin = resolve(
    consumer,
    "node_modules/.bin",
    process.platform === "win32" ? "sync-engine-skill.cmd" : "sync-engine-skill",
  );
  if (existsSync(bin)) throw new Error("skill-only installation exposed an obsolete executable");
}

async function verifySetupAndExamples(
  artifacts: ReadonlyMap<string, PackedWorkspace>,
  coreConsumer: string,
): Promise<void> {
  const core = workspaceArtifact(artifacts, coreWorkspace);
  const installed = resolve(coreConsumer, "node_modules", ...core.workspace.packageName.split("/"));
  const setup = resolve(temporary, "setup-application");
  const executable = core.manifest.bin?.["sync-engine"];
  if (executable === undefined) throw new Error("core package does not provide sync-engine");
  await mkdir(setup, { recursive: true });
  await writePackageManifest(resolve(setup, "package.json"), {
    name: "setup-application",
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "bun@1.3.14",
    scripts: {
      generate: "sync-engine artifacts pin",
      check:
        "sync-engine check --config generated.config.ts && sync-engine artifacts check && tsc --noEmit",
      start: "bun src/main.ts",
      test: "vp test",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      [core.workspace.packageName]: core.manifest.version,
    },
    devDependencies: { "@types/node": "^24.0.0", typescript: "^6.0.0", "vite-plus": "0.2.6" },
  });
  run("bun", [resolve(installed, executable), "setup"], setup);
  run("bun", [resolve(installed, executable), "setup"], setup);
  const setupManifestPath = resolve(setup, "package.json");
  const setupManifest = JSON.parse(await readFile(setupManifestPath, "utf8")) as DependencyManifest;
  setupManifest.dependencies[core.workspace.packageName] = tarballSpecifier(setup, core.tarball);
  await writePackageManifest(setupManifestPath, setupManifest);
  run("bun", ["install", "--ignore-scripts"], setup);
  run("bun", ["run", "generate"], setup);
  run("bun", ["run", "check"], setup);
  run("bun", ["run", "start"], setup);

  for (const example of Object.values(applicationExamples)) {
    const { directory } = example;
    const isolated = resolve(temporary, directory);
    await cp(resolve(installed, "examples", directory), isolated, { recursive: true });
    const manifestPath = resolve(isolated, "package.json");
    const manifest = await prepareWorkspaceDependencies(manifestPath, directory, artifacts);
    await writePackageManifest(manifestPath, manifest);
    run("bun", ["install", "--ignore-scripts"], isolated);
    run("bun", ["run", "check"], isolated);
    if ("scenario" in example) run("bun", ["run", "start"], isolated);
  }

  const standalone = resolve(temporary, "application");
  await cp(resolve(root, "tests/packaging/application"), standalone, { recursive: true });
  await rename(resolve(standalone, "tsconfig.project.json"), resolve(standalone, "tsconfig.json"));
  const standaloneManifestPath = resolve(standalone, "package.json");
  const standaloneManifest = await prepareWorkspaceDependencies(
    standaloneManifestPath,
    "package application",
    artifacts,
  );
  await writePackageManifest(standaloneManifestPath, standaloneManifest);
  run("bun", ["install", "--ignore-scripts"], standalone);
  run("bun", ["run", "generate"], standalone);
  run("bun", ["run", "typecheck"], standalone);
  run("bun", ["run", "principle"], standalone);
  run("bun", ["run", "start"], standalone);
}

async function inlineMultiInstanceConceptSpecifications(clientProject: string): Promise<void> {
  const runtimePath = resolve(clientProject, "dist/contract.js");
  let runtime = await readFile(runtimePath, "utf8");
  const imports = [
    ["effectsSpecification", "Effects.md"],
    ["entriesSpecification", "Entries.md"],
    ["faultingSpecification", "Faulting.md"],
  ] as const;
  for (const [binding, filename] of imports) {
    const statement = `import ${binding} from "../design/concepts/${filename}" with { type: "text" };`;
    if (!runtime.includes(statement)) {
      throw new Error(`multi-instance client output omits the authored ${filename} import`);
    }
    const specification = await readFile(
      resolve(clientProject, "design/concepts", filename),
      "utf8",
    );
    runtime = runtime.replace(statement, `const ${binding} = ${JSON.stringify(specification)};`);
  }
  await writeFile(runtimePath, runtime);
}

async function verifyMultiInstance(artifacts: ReadonlyMap<string, PackedWorkspace>): Promise<void> {
  const multiInstance = resolve(temporary, "multi-instance");
  await cp(resolve(root, "packages/http/tests/packaging/multi-instance"), multiInstance, {
    recursive: true,
  });
  const clientProject = resolve(multiInstance, "client");
  const backendProject = resolve(multiInstance, "backend");
  const clientManifestPath = resolve(clientProject, "package.json");
  const clientManifest = await prepareWorkspaceDependencies<
    DependencyManifest & { name: string; version: string }
  >(clientManifestPath, "multi-instance client", artifacts, multiInstanceWorkspaces);
  await writePackageManifest(clientManifestPath, clientManifest);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], clientProject);

  const core = workspaceArtifact(artifacts, coreWorkspace);
  const installedCore = resolve(
    clientProject,
    "node_modules",
    ...core.workspace.packageName.split("/"),
  );
  const executable = core.manifest.bin?.["sync-engine"];
  if (executable === undefined) throw new Error("core package does not provide sync-engine");
  run(
    "bun",
    [
      resolve(installedCore, executable),
      "artifacts",
      "pin-wire",
      "--config",
      "generated.config.ts",
    ],
    clientProject,
  );
  run(
    "node",
    [resolve(clientProject, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    clientProject,
  );
  // Node does not load Markdown modules. Tooling checks the authored imports,
  // then the packed runtime receives the exact checked text as ordinary JS.
  await inlineMultiInstanceConceptSpecifications(clientProject);

  restoreWorkspaceDependencyVersions(clientManifest, artifacts);
  await writePackageManifest(clientManifestPath, clientManifest);
  const packedClient = packWithNpm(clientProject, multiInstance);
  const expectedClientFilename = `${clientManifest.name
    .replace(/^@/, "")
    .replaceAll("/", "-")}-${clientManifest.version}.tgz`;
  if (packedClient.filename !== expectedClientFilename) {
    throw new Error(
      `npm packed multi-instance client as ${packedClient.filename}; expected ${expectedClientFilename}`,
    );
  }
  const clientEntries = new Set(packedClient.files.map(({ path }) => path));
  for (const path of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/generated/wire.js",
    "dist/generated/wire.d.ts",
  ]) {
    if (!clientEntries.has(path)) throw new Error(`packed multi-instance client omits ${path}`);
  }
  const clientTarball = resolve(multiInstance, packedClient.filename);

  for (const sourcePath of await filesBelow(resolve(backendProject, "src"), (name) =>
    name.endsWith(".ts"),
  )) {
    const source = await readFile(sourcePath, "utf8");
    if (/(?:\.\.\/)+client(?:\/|["'])/.test(source)) {
      throw new Error(
        `${relative(backendProject, sourcePath)} reaches into the generated client source tree`,
      );
    }
  }

  const backendManifestPath = resolve(backendProject, "package.json");
  const backendManifest = await prepareWorkspaceDependencies(
    backendManifestPath,
    "multi-instance backend",
    artifacts,
    multiInstanceWorkspaces,
  );
  if (
    backendManifest.dependencies["@sync-engine-fixture/multi-instance-client"] !==
    clientManifest.version
  ) {
    throw new Error(`multi-instance backend must depend on client ${clientManifest.version}`);
  }
  backendManifest.dependencies["@sync-engine-fixture/multi-instance-client"] = tarballSpecifier(
    backendProject,
    clientTarball,
  );
  await writePackageManifest(backendManifestPath, backendManifest);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], backendProject);
  run(
    "node",
    [resolve(backendProject, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    backendProject,
  );
  run("node", [resolve(backendProject, "dist/scenario.js")], backendProject, 30_000);
}

async function copyVerifiedTarballs(
  artifacts: ReadonlyMap<string, PackedWorkspace>,
): Promise<void> {
  const directory = process.env.SYNC_ENGINE_VERIFIED_TARBALLS;
  if (directory !== undefined) {
    const destinationDirectory = resolve(root, directory);
    await mkdir(destinationDirectory, { recursive: true });
    for (const workspace of workspaceBuildOrder.filter(
      (candidate) => candidate.publication === "npm",
    )) {
      const artifact = workspaceArtifact(artifacts, workspace);
      await copyFile(artifact.tarball, resolve(destinationDirectory, workspace.verifiedTarball));
    }
  }
}

try {
  const artifacts = new Map<string, PackedWorkspace>();
  for (const workspace of workspaceBuildOrder) {
    const manifest = JSON.parse(
      await readFile(resolve(root, workspace.packageManifest), "utf8"),
    ) as PackageManifest;
    const packed = packWithNpm(workspacePath(root, workspace), temporary);
    const artifact = await verifyPackedWorkspace(workspace, manifest, packed);
    artifacts.set(workspace.id, artifact);
  }
  for (const workspace of workspaceBuildOrder) {
    const artifact = workspaceArtifact(artifacts, workspace);
    assertWorkspacePeers(workspace, artifact.manifest, artifacts);
  }

  const coreConsumer = await verifyCoreOnlyConsumer(artifacts);
  await verifyCombinedConsumer(artifacts);
  await verifyCatalogAlone(artifacts);
  await verifySkillAlone(artifacts);
  await verifyMultiInstance(artifacts);
  await verifySetupAndExamples(artifacts, coreConsumer);
  await copyVerifiedTarballs(artifacts);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
