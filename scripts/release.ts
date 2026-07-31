import { createHash } from "node:crypto";
import { activeWorkflowSource, externalWorkflowActions, workflowUses } from "./workflow.ts";
import { workspaceById, workspaceCatalog, type Workspace } from "./workspaces.ts";

const coreWorkspace = workspaceById("core");
const publishedWorkspaces: readonly Workspace[] = workspaceCatalog;
const workspaceReleaseManifests = publishedWorkspaces
  .filter((workspace) => workspace.id !== coreWorkspace.id)
  .map((workspace) => workspace.packageManifest);
const exampleManifests = [
  "examples/reading-circle/package.json",
  "examples/operations-room/package.json",
  "examples/production-http/package.json",
] as const;
const bunFixtureManifests = ["tests/package/application/package.json"] as const;
const nodeFixtureManifests = [
  "tests/package/multi-instance/client/package.json",
  "tests/package/multi-instance/backend/package.json",
] as const;
export const ownedDependencyManifests = [
  ...exampleManifests,
  ...bunFixtureManifests,
  ...nodeFixtureManifests,
] as const;
export const releaseManifestPaths = [
  ...workspaceReleaseManifests,
  ...ownedDependencyManifests,
] as const;
const bunProjectManifests = [...exampleManifests, ...bunFixtureManifests] as const;
const nodeProjectManifests = [...bunProjectManifests, ...nodeFixtureManifests] as const;
const typescriptManifests = nodeProjectManifests;
const scaffoldManifest = "src/command/scaffold/package.json";
const sharedDevelopmentDependencies = [
  ["@types/node", [...exampleManifests, "tests/package/multi-instance/backend/package.json"]],
  ["vite", exampleManifests],
  ["vite-plus", exampleManifests],
] as const;

export const releaseSourcePaths = [
  "package.json",
  "bun.lock",
  ...workspaceReleaseManifests,
  "packages/http/README.md",
  "packages/http/public-surface.md",
  "README.md",
  "CHANGELOG.md",
  "docs/releasing.md",
  "docs/llms.txt",
  "docs/index.md",
  "docs/public-surface.md",
  "docs/semantics.md",
  "docs/operations.md",
  "docs/cli.md",
  "docs/guide/getting-started.md",
  "SUPPORT.md",
  "SECURITY.md",
  scaffoldManifest,
  ...ownedDependencyManifests,
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  "scripts/update-release-manifests.ts",
  "scripts/check-release.ts",
  "scripts/verify-release.ts",
  "scripts/verify-package.ts",
  "scripts/release.ts",
  "scripts/workspaces.ts",
] as const;

const expectedActions = new Map([
  ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
  ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
  ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
]);
const requiredHeadings = [
  "Compatibility",
  "Migration",
  "Generated formats",
  "Runtime and security support",
] as const;
const releasedChangelogDigests = new Map([
  ["1.0.0-beta.3", "e644cd9a57e5fbab73ad9b226ce949cb3b063cbeff5d2930e7dad208be685312"],
  ["1.0.0-beta.2", "cdef275ed21a2cfb588db739d846cf11c035261569094eaed5229ea6a08fdfc5"],
  ["1.0.0-beta.1", "6129bc25f0138fa5c376adeaaba385731df07ec6ba9817b1019d3ed56caeaf9f"],
  ["1.0.0-beta.0", "76ed4b9cc2498f2f9d5e9a209e0ab470b4f7030713da05f2f96482b3c4698823"],
  ["1.0.0-alpha.0", "92e21d62558b5e7aa66a5c2c30c20633534f5dfc144506bd11e9643f8cd7dd21"],
  ["0.3.0", "fb8d76294b0d86f67c00fdc92c0a7b27a7cad0afbe0b5f335f3764087919c309"],
  ["0.2.0", "1310093297ca2e60f0fe99beb6e74ad86e864cbfc98d4feaf3b8b8858adfcd21"],
  ["0.1.1", "8d14d20525ef8a9e501c58610c33b278ec6c5cc61335bf7eb9995d9c71e196f5"],
  ["0.1.0", "9cd7baf8a9d9646e728dc3b23fc28500955a780c5a4e86b1f5321b4b380c96e8"],
]);
const publishVerificationGates = [
  "bun run release:check",
  "bun run check",
  "bun run test",
  "bun run coverage",
  "bun run declarations:check",
  "bun run examples:check",
  "bun scripts/examples.ts scenario",
  "bun run package:check",
  "bun audit",
] as const;

type JsonObject = Record<string, unknown>;

interface ReleaseFacts {
  version?: string;
  node?: string;
  bun?: string;
  typescript?: string;
  packageManager?: string;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function releaseFacts(root: JsonObject | undefined): ReleaseFacts {
  const engines = object(root?.engines);
  const dependencies = object(root?.dependencies);
  return {
    version: typeof root?.version === "string" ? root.version : undefined,
    node: typeof engines?.node === "string" ? engines.node : undefined,
    bun: typeof engines?.bun === "string" ? engines.bun : undefined,
    typescript: typeof dependencies?.typescript === "string" ? dependencies.typescript : undefined,
    packageManager: typeof root?.packageManager === "string" ? root.packageManager : undefined,
  };
}

function stableOneVersion(value: string | undefined): value is string {
  const match = /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? "");
  return (
    match !== null && match.slice(1).every((component) => Number.isSafeInteger(Number(component)))
  );
}

function compatiblePeer(version: string): string {
  return `^${version}`;
}

function majorRange(value: string | undefined): number | undefined {
  const match = /^>=(\d+) <(\d+)$/.exec(value ?? "");
  if (match === null) return undefined;
  const minimum = Number(match[1]);
  return Number(match[2]) === minimum + 1 ? minimum : undefined;
}

function bunRange(value: string | undefined): string | undefined {
  const match = /^>=(\d+)\.(\d+)\.(\d+) <(\d+)\.(\d+)$/.exec(value ?? "");
  if (match === null) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (Number(match[4]) !== major || Number(match[5]) !== minor + 1) return undefined;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function projectReleaseManifests(sources: ReadonlyMap<string, string>): Map<string, string> {
  const root = object(JSON.parse(sources.get("package.json") ?? ""));
  if (root === undefined) throw new Error("package.json must contain an object");
  const facts = releaseFacts(root);
  if (Object.values(facts).some((value) => value === undefined)) {
    throw new Error("package.json is missing a release fact");
  }
  if (!stableOneVersion(facts.version)) {
    throw new Error("package.json contains an invalid release version");
  }
  const minimumBun = bunRange(facts.bun);
  if (
    majorRange(facts.node) === undefined ||
    majorRange(facts.typescript) === undefined ||
    minimumBun === undefined ||
    facts.packageManager !== `bun@${minimumBun}`
  ) {
    throw new Error("package.json contains an invalid release fact");
  }
  const rootDevelopment = object(root.devDependencies) ?? {};
  const projected = new Map<string, string>();
  const workspaceVersions = new Map(
    publishedWorkspaces.map((workspace) => [workspace.packageName, facts.version]),
  );

  for (const workspace of publishedWorkspaces) {
    if (workspace.id === coreWorkspace.id) continue;
    const path = workspace.packageManifest;
    const manifest = object(JSON.parse(sources.get(path) ?? ""));
    if (manifest === undefined) throw new Error(`${path} must contain an object`);
    manifest.version = facts.version;
    const engines = object(manifest.engines) ?? {};
    manifest.engines = engines;
    engines.node = facts.node;
    const peerDependencies = object(manifest.peerDependencies) ?? {};
    manifest.peerDependencies = peerDependencies;
    for (const peerId of workspace.peerWorkspaceIds) {
      const peer = workspaceById(peerId);
      const peerVersion = workspaceVersions.get(peer.packageName);
      if (peerVersion !== undefined)
        peerDependencies[peer.packageName] = compatiblePeer(peerVersion);
    }
    projected.set(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  for (const path of ownedDependencyManifests) {
    const manifest = object(JSON.parse(sources.get(path) ?? ""));
    if (manifest === undefined) throw new Error(`${path} must contain an object`);
    const dependencies = object(manifest.dependencies);
    const development = object(manifest.devDependencies);
    const engines = object(manifest.engines);
    if (dependencies === undefined || development === undefined || engines === undefined) {
      throw new Error(`${path} is missing dependencies, devDependencies, or engines`);
    }

    dependencies[coreWorkspace.packageName] = facts.version;
    for (const workspace of publishedWorkspaces) {
      if (!(workspace.packageName in dependencies)) continue;
      dependencies[workspace.packageName] = workspaceVersions.get(workspace.packageName);
    }
    development.typescript = facts.typescript;
    engines.node = facts.node;
    if ((bunProjectManifests as readonly string[]).includes(path)) {
      engines.bun = facts.bun;
      manifest.packageManager = facts.packageManager;
    }
    for (const [dependency, paths] of sharedDevelopmentDependencies) {
      if (!(paths as readonly string[]).includes(path)) continue;
      if (typeof rootDevelopment[dependency] !== "string") {
        throw new Error(`package.json is missing devDependencies.${dependency}`);
      }
      development[dependency] = rootDevelopment[dependency];
    }
    if ((exampleManifests as readonly string[]).includes(path)) {
      const overrides = object(manifest.overrides) ?? {};
      manifest.overrides = overrides;
      overrides.vite = rootDevelopment.vite;
    }
    projected.set(path, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return projected;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function workflowJob(source: string, name: string): string {
  const active = activeWorkflowSource(source);
  const marker = `\n  ${name}:`;
  const start = active.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const next = /\n  [A-Za-z0-9_-]+:\s*(?:\n|$)/.exec(active.slice(bodyStart));
  return next === null ? active.slice(start) : active.slice(start, bodyStart + next.index);
}

function hasWorkflowLine(source: string, expected: string): boolean {
  return activeWorkflowSource(source)
    .split("\n")
    .some((line) => line.trim() === expected);
}

function runCommandPosition(job: string, command: string): number {
  return job
    .split("\n")
    .findIndex((line) => line === `      - run: ${command}` || line === `        run: ${command}`);
}

function hasRunCommand(job: string, command: string): boolean {
  return runCommandPosition(job, command) >= 0;
}

function changelogSection(changelog: string, version: string): string | undefined {
  const start = changelog.indexOf(`## [${version}]`);
  if (start < 0) return undefined;
  const following = changelog.slice(start + 1);
  const boundaries = [/\n## \[/.exec(following), /\n\[[^\]\n]+\]:\s/.exec(following)]
    .flatMap((match) => (match === null ? [] : [match.index]))
    .sort((left, right) => left - right);
  return boundaries.length === 0
    ? changelog.slice(start)
    : changelog.slice(start, start + 1 + boundaries[0]);
}

export function checkRelease(sources: ReadonlyMap<string, string>): string[] {
  const failures: string[] = [];
  const manifests = new Map<string, JsonObject>();

  for (const path of releaseSourcePaths) {
    if (!sources.has(path)) failures.push(`${path}: required release source is missing`);
  }

  function manifest(path: string): JsonObject | undefined {
    const cached = manifests.get(path);
    if (cached !== undefined) return cached;
    const source = sources.get(path);
    if (source === undefined) return undefined;
    try {
      const parsed = object(JSON.parse(source));
      if (parsed === undefined) throw new Error("root value is not an object");
      manifests.set(path, parsed);
      return parsed;
    } catch (error) {
      failures.push(
        `${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      );
      return undefined;
    }
  }

  const root = manifest("package.json");
  const facts = releaseFacts(root);
  const version = facts.version;
  if (!stableOneVersion(version)) {
    failures.push("package.json: version must be a canonical stable 1.x version");
  }
  const nodeMajor = majorRange(facts.node);
  if (nodeMajor === undefined) {
    failures.push("package.json: engines.node must support exactly one major as >=N <N+1");
  }
  const bunVersion = bunRange(facts.bun);
  if (bunVersion === undefined) {
    failures.push("package.json: engines.bun must support exactly one minor as >=X.Y.Z <X.Y+1");
  }
  const typescriptMajor = majorRange(facts.typescript);
  if (typescriptMajor === undefined) {
    failures.push(
      "package.json: dependencies.typescript must support exactly one major as >=N <N+1",
    );
  }
  if (bunVersion === undefined || facts.packageManager !== `bun@${bunVersion}`) {
    failures.push("package.json: packageManager must pin the minimum supported Bun version");
  }

  const publishTag = object(root?.publishConfig)?.tag;
  if (publishTag !== "latest") failures.push('package.json: publishConfig.tag must be "latest"');

  const packageFiles = root?.files;
  for (const policy of ["SUPPORT.md", "SECURITY.md"]) {
    if (!Array.isArray(packageFiles) || !packageFiles.includes(policy)) {
      failures.push(`package.json: files must ship ${policy}`);
    }
  }
  if (object(root?.scripts)?.["release:check"] !== "bun scripts/check-release.ts") {
    failures.push("package.json: release:check must run bun scripts/check-release.ts");
  }
  if (object(root?.scripts)?.["release:update"] !== "bun scripts/update-release-manifests.ts") {
    failures.push("package.json: release:update must run bun scripts/update-release-manifests.ts");
  }
  if (!Array.isArray(root?.workspaces) || !root.workspaces.includes("packages/*")) {
    failures.push('package.json: workspaces must include "packages/*"');
  }
  if (object(root?.overrides)?.[coreWorkspace.packageName] !== "file:.") {
    failures.push(`package.json: overrides.${coreWorkspace.packageName} must equal file:.`);
  }

  const lock = sources.get("bun.lock") ?? "";
  const lockRoot = /^    "": \{([\s\S]*?)^    \},$/m.exec(lock)?.[1] ?? "";
  const lockHttp = /^    "packages\/http": \{([\s\S]*?)^    \},?$/m.exec(lock)?.[1] ?? "";
  if (!lockRoot.includes(`"name": "${coreWorkspace.packageName}"`)) {
    failures.push(`bun.lock: root workspace name must be ${coreWorkspace.packageName}`);
  }
  if (!lockHttp.includes(`"version": "${version}"`)) {
    failures.push(`bun.lock: HTTP workspace version must equal ${version}`);
  }
  if (
    typeof version === "string" &&
    !lockHttp.includes(`"${coreWorkspace.packageName}": "${compatiblePeer(version)}"`)
  ) {
    failures.push(
      `bun.lock: HTTP peer ${coreWorkspace.packageName} must equal ${compatiblePeer(version)}`,
    );
  }
  const coreWorkspaceResolution = `"${coreWorkspace.packageName}": ["${coreWorkspace.packageName}@root:",`;
  if (!lock.includes(coreWorkspaceResolution)) {
    failures.push(`bun.lock: core package must resolve to the root workspace`);
  }

  for (const workspace of publishedWorkspaces) {
    const project = manifest(workspace.packageManifest);
    if (project?.name !== workspace.packageName) {
      failures.push(`${workspace.packageManifest}: name must be ${workspace.packageName}`);
    }
    if (project?.version !== version) {
      failures.push(`${workspace.packageManifest}: version must equal ${version}`);
    }
    if (workspace.id === coreWorkspace.id) continue;
    if (object(project?.publishConfig)?.tag !== "latest") {
      failures.push(`${workspace.packageManifest}: publishConfig.tag must be "latest"`);
    }
    if (object(project?.engines)?.node !== facts.node) {
      failures.push(`${workspace.packageManifest}: engines.node must be ${facts.node}`);
    }
    for (const peerId of workspace.peerWorkspaceIds) {
      const peer = workspaceById(peerId);
      if (
        typeof version !== "string" ||
        object(project?.peerDependencies)?.[peer.packageName] !== compatiblePeer(version)
      ) {
        failures.push(
          `${workspace.packageManifest}: peerDependencies.${peer.packageName} must equal ^${version}`,
        );
      }
    }
  }

  if (typeof version === "string") {
    for (const path of ownedDependencyManifests) {
      const dependencies = object(manifest(path)?.dependencies);
      if (dependencies?.[coreWorkspace.packageName] !== version) {
        failures.push(`${path}: ${coreWorkspace.packageName} must equal ${version}`);
      }
      for (const workspace of publishedWorkspaces) {
        if (workspace.id === coreWorkspace.id || !(workspace.packageName in (dependencies ?? {}))) {
          continue;
        }
        if (dependencies?.[workspace.packageName] !== version) {
          failures.push(`${path}: ${workspace.packageName} must equal ${version}`);
        }
      }
    }
  }

  for (const path of nodeProjectManifests) {
    const value = object(manifest(path)?.engines)?.node;
    if (value !== facts.node) {
      failures.push(`${path}: engines.node must be ${facts.node}`);
    }
  }
  for (const path of bunProjectManifests) {
    const project = manifest(path);
    const value = object(project?.engines)?.bun;
    if (value !== facts.bun) {
      failures.push(`${path}: engines.bun must be ${facts.bun}`);
    }
    if (project?.packageManager !== facts.packageManager) {
      failures.push(`${path}: packageManager must be ${facts.packageManager}`);
    }
  }
  for (const path of typescriptManifests) {
    const project = manifest(path);
    const value =
      object(project?.dependencies)?.typescript ?? object(project?.devDependencies)?.typescript;
    if (value !== facts.typescript) {
      failures.push(`${path}: TypeScript range must be ${facts.typescript}`);
    }
  }
  const rootDevelopment = object(root?.devDependencies);
  for (const [dependency, paths] of sharedDevelopmentDependencies) {
    for (const path of paths) {
      const development = object(manifest(path)?.devDependencies);
      if (development?.[dependency] !== rootDevelopment?.[dependency]) {
        failures.push(`${path}: ${dependency} must match package.json`);
      }
    }
  }
  for (const path of exampleManifests) {
    const project = manifest(path);
    if (object(project?.overrides)?.vite !== rootDevelopment?.vite) {
      failures.push(`${path}: overrides.vite must match package.json devDependencies.vite`);
    }
  }

  const scaffold = manifest(scaffoldManifest);
  const scaffoldDevelopment = object(scaffold?.devDependencies);
  const scaffoldEngines = object(scaffold?.engines);
  for (const [owner, actual, expected] of [
    ["TypeScript range", scaffoldDevelopment?.typescript, "{{typescript}}"],
    ["engines.node", scaffoldEngines?.node, "{{node}}"],
    ["engines.bun", scaffoldEngines?.bun, "{{bun}}"],
    ["packageManager", scaffold?.packageManager, "{{packageManager}}"],
  ] as const) {
    if (actual !== expected) failures.push(`${scaffoldManifest}: ${owner} must be ${expected}`);
  }

  const changelog = sources.get("CHANGELOG.md") ?? "";
  if (typeof version === "string") {
    const heading = new RegExp(
      `^## \\[${escapeRegExp(version)}\\] - (\\d{4}-\\d{2}-\\d{2})$`,
      "m",
    ).exec(changelog);
    if (heading === null) {
      failures.push(`CHANGELOG.md: missing dated current entry for ${version}`);
    } else {
      const start = (heading.index ?? 0) + heading[0].length;
      const following = changelog.slice(start);
      const next = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m.exec(following);
      const current = following.slice(0, next?.index);
      for (const required of requiredHeadings) {
        if (!new RegExp(`^### ${escapeRegExp(required)}$`, "m").test(current)) {
          failures.push(`CHANGELOG.md: ${version} is missing the ${required} heading`);
        }
      }
      const previous = next?.[1];
      if (previous === undefined) {
        failures.push(`CHANGELOG.md: ${version} has no previous-version entry`);
      } else {
        const releaseLine = `[Release][${version}]`;
        const changesLine = `[Changes since ${previous}][${version}-compare]`;
        if (!current.includes(`${releaseLine} | ${changesLine}`)) {
          failures.push(`CHANGELOG.md: ${version} must include exact release and compare labels`);
        }
        const compareLink = `[${version}-compare]: https://github.com/mit-sdg/sync-engine/compare/v${previous}...v${version}`;
        if (!changelog.includes(compareLink)) {
          failures.push(`CHANGELOG.md: ${version} compare link must start at ${previous}`);
        }
      }
      const releaseLink = `[${version}]: https://github.com/mit-sdg/sync-engine/releases/tag/v${version}`;
      if (!changelog.includes(releaseLink)) {
        failures.push(`CHANGELOG.md: ${version} release link is missing or inexact`);
      }
    }
  }
  for (const [released, expectedDigest] of releasedChangelogDigests) {
    const section = changelogSection(changelog, released);
    const digest =
      section === undefined ? undefined : createHash("sha256").update(section).digest("hex");
    if (digest !== expectedDigest) {
      failures.push(`CHANGELOG.md: released ${released} entry must remain byte-faithful`);
    }
  }

  const releasing = sources.get("docs/releasing.md") ?? "";
  for (const fact of [
    "npm deprecate @mit-sdg/sync-engine@$PRERELEASE_VERSION",
    "install @mit-sdg/sync-engine@$VERSION or use @latest",
    "versions deprecated --json",
    "never\n  overwrite an existing tag or tarball",
  ]) {
    if (!releasing.includes(fact)) {
      failures.push(`docs/releasing.md: missing prerelease retirement fact ${fact}`);
    }
  }

  const support = sources.get("SUPPORT.md") ?? "";
  const supportFacts = [
    "Only the newest stable 1.x release is supported.",
    "sync-engine.application-manifest` version 3",
  ];
  if (facts.node !== undefined) supportFacts.push(`Node.js \`${facts.node}\``);
  if (facts.bun !== undefined) supportFacts.push(`Bun \`${facts.bun}\``);
  if (facts.typescript !== undefined) supportFacts.push(`TypeScript \`${facts.typescript}\``);
  for (const fact of supportFacts) {
    if (!support.includes(fact)) failures.push(`SUPPORT.md: missing supported policy fact ${fact}`);
  }

  const security = sources.get("SECURITY.md") ?? "";
  for (const fact of [
    "security/advisories/new",
    "acknowledgement within three business days",
    "update at least weekly",
    "Newest stable `1.x`",
  ]) {
    if (!security.includes(fact))
      failures.push(`SECURITY.md: missing security policy fact ${fact}`);
  }

  const codeowners = sources.get(".github/CODEOWNERS") ?? "";
  for (const path of [
    "/.github/workflows/",
    "/.github/CODEOWNERS",
    "/package.json",
    "/bun.lock",
    ...publishedWorkspaces
      .filter((workspace) => workspace.id !== coreWorkspace.id)
      .map((workspace) => `/${workspace.directory}/`),
    "/CHANGELOG.md",
    "/SUPPORT.md",
    "/SECURITY.md",
    "/docs/releasing.md",
    "/scripts/release.ts",
    "/scripts/check-release.ts",
    "/scripts/update-release-manifests.ts",
    "/scripts/verify-release.ts",
    "/scripts/verify-package.ts",
    "/scripts/workspaces.ts",
  ]) {
    const line = codeowners.split(/\r?\n/).find((candidate) => candidate.startsWith(`${path} `));
    if (line === undefined || !line.includes("@BarishNamazov") || !line.includes("@eagonmeng")) {
      failures.push(`.github/CODEOWNERS: ${path} must list both release code owners`);
    }
  }

  const dependabot = sources.get(".github/dependabot.yml") ?? "";
  for (const fact of ["package-ecosystem: github-actions", "interval: weekly"]) {
    if (!dependabot.includes(fact)) {
      failures.push(`.github/dependabot.yml: missing reviewed action-update fact ${fact}`);
    }
  }

  const workflows = [".github/workflows/ci.yml", ".github/workflows/publish.yml"];
  for (const path of workflows) {
    const source = activeWorkflowSource(sources.get(path) ?? "");
    const uses = workflowUses(source);
    for (const { use, action, reference } of externalWorkflowActions(source)) {
      const expected = expectedActions.get(action);
      if (expected === undefined) {
        failures.push(`${path}: external action ${action || use} is not in the reviewed pin set`);
      } else if (reference !== expected) {
        failures.push(`${path}: ${action} must use reviewed SHA ${expected}`);
      }
    }
    const bunSetups = uses.filter((use) => use.startsWith("oven-sh/setup-bun@")).length;
    const bunVersions = [...source.matchAll(/bun-version:\s*["']?([^\s"']+)/g)].map(
      (match) => match[1],
    );
    if (
      bunVersion !== undefined &&
      (bunVersions.length !== bunSetups || bunVersions.some((value) => value !== bunVersion))
    ) {
      failures.push(`${path}: every setup-bun step must pin bun-version ${bunVersion}`);
    }
  }

  const ci = activeWorkflowSource(sources.get(".github/workflows/ci.yml") ?? "");
  for (const fact of [
    "permissions:\n  contents: read",
    "name: Pack & import both workspaces",
    "run: bun run package:check",
    "name: Generated artifacts",
    "run: bun run examples:check",
    "name: CI required",
    "needs: [check, release, build, package, generated, scenario, test, coverage]",
  ]) {
    if (!ci.includes(fact)) failures.push(`.github/workflows/ci.yml: missing ${fact}`);
  }
  if (ci.includes("id-token: write")) {
    failures.push(".github/workflows/ci.yml: CI must not receive id-token: write");
  }
  if (nodeMajor !== undefined) {
    for (const name of ["package", "test"]) {
      const job = workflowJob(ci, name);
      for (const fact of [
        "- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        `node-version: "${nodeMajor}"`,
      ]) {
        if (!hasWorkflowLine(job, fact)) {
          failures.push(`.github/workflows/ci.yml: ${name} job is missing ${fact}`);
        }
      }
    }
  }

  const publish = activeWorkflowSource(sources.get(".github/workflows/publish.yml") ?? "");
  const verify = workflowJob(publish, "verify");
  const publishCore = workflowJob(publish, "publish-core");
  const publishHttp = workflowJob(publish, "publish-http");
  for (const fact of ["name: Publish stable", '- "v1.*.*"', "permissions:\n  contents: read"]) {
    if (!publish.includes(fact)) failures.push(`.github/workflows/publish.yml: missing ${fact}`);
  }
  for (const gate of publishVerificationGates) {
    if (!hasRunCommand(verify, gate)) {
      failures.push(`.github/workflows/publish.yml: verify job must run ${gate}`);
    }
  }
  if (nodeMajor !== undefined) {
    for (const [name, job] of [
      ["verify", verify],
      ["publish-core", publishCore],
      ["publish-http", publishHttp],
    ] as const) {
      for (const fact of [
        "- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
        `node-version: "${nodeMajor}"`,
      ]) {
        if (!hasWorkflowLine(job, fact)) {
          failures.push(`.github/workflows/publish.yml: ${name} job is missing ${fact}`);
        }
      }
    }
  }
  const verifyOrder = publishVerificationGates.map((command) =>
    runCommandPosition(verify, command),
  );
  if (
    verifyOrder.some((position) => position < 0) ||
    verifyOrder.some((position, index) => index > 0 && position <= verifyOrder[index - 1])
  ) {
    failures.push(".github/workflows/publish.yml: verify gates must remain in reviewed order");
  }
  if (verify.includes("environment:") || verify.includes("id-token: write")) {
    failures.push(".github/workflows/publish.yml: verify must be unprivileged");
  }
  if (/^\s+(?:-\s+)?if:/m.test(verify)) {
    failures.push(".github/workflows/publish.yml: verify steps must not be conditional");
  }
  if (/^\s+continue-on-error:/m.test(verify)) {
    failures.push(".github/workflows/publish.yml: verify steps must not continue on error");
  }
  for (const [name, job, dependency] of [
    ["publish-core", publishCore, "needs: verify"],
    ["publish-http", publishHttp, "needs: [verify, publish-core]"],
  ] as const) {
    for (const fact of [dependency, "id-token: write", "name: npm"]) {
      if (!hasWorkflowLine(job, fact)) {
        failures.push(`.github/workflows/publish.yml: ${name} job is missing ${fact}`);
      }
    }
  }
  for (const [name, job, checksum, publication] of [
    [
      "publish-core",
      publishCore,
      "sha256sum --check release/package.tgz.sha256",
      "npm publish ./release/package.tgz --provenance --tag latest --access public",
    ],
    [
      "publish-http",
      publishHttp,
      "sha256sum --check release/http-package.tgz.sha256",
      "npm publish ./release/http-package.tgz --provenance --tag latest --access public",
    ],
  ] as const) {
    const checksumPosition = runCommandPosition(job, checksum);
    const publicationPosition = runCommandPosition(job, publication);
    if (checksumPosition < 0) {
      failures.push(`.github/workflows/publish.yml: ${name} job is missing ${checksum}`);
    }
    if (publicationPosition < 0) {
      failures.push(`.github/workflows/publish.yml: ${name} job is missing ${publication}`);
    }
    if (
      checksumPosition >= 0 &&
      publicationPosition >= 0 &&
      checksumPosition >= publicationPosition
    ) {
      failures.push(
        `.github/workflows/publish.yml: ${name} checksum verification must precede npm publish`,
      );
    }
    if ((job.match(/\bnpm\s+publish\b/g) ?? []).length !== 1) {
      failures.push(
        `.github/workflows/publish.yml: ${name} job must contain exactly one npm publish command`,
      );
    }
  }
  for (const workspace of publishedWorkspaces) {
    const tarball = `release/${workspace.verifiedTarball}`;
    if (!publish.includes(tarball)) {
      failures.push(`.github/workflows/publish.yml: artifact flow omits ${tarball}`);
    }
    const publication = workspace.id === coreWorkspace.id ? publishCore : publishHttp;
    if (!publication.includes(tarball)) {
      failures.push(`.github/workflows/publish.yml: publish must include ${workspace.id} tarball`);
    }
  }
  for (const [name, publication] of [
    ["publish-core", publishCore],
    ["publish-http", publishHttp],
  ] as const) {
    for (const forbidden of ["setup-bun@", "bun install", "bun run", "prepack"]) {
      if (publication.includes(forbidden)) {
        failures.push(`.github/workflows/publish.yml: ${name} job must not rebuild (${forbidden})`);
      }
    }
    if (/^\s+(?:-\s+)?if:/m.test(publication)) {
      failures.push(`.github/workflows/publish.yml: ${name} steps must not be conditional`);
    }
    if (/^\s+continue-on-error:/m.test(publication)) {
      failures.push(`.github/workflows/publish.yml: ${name} steps must not continue on error`);
    }
  }
  if ((publish.match(/id-token:\s*write/g) ?? []).length !== 2) {
    failures.push(
      ".github/workflows/publish.yml: only publication jobs may receive id-token: write",
    );
  }
  const sourceValidation = [
    ["GITHUB_REF_NAME", "if (process.env.GITHUB_REF_NAME !=="],
    ["GITHUB_SHA", 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'],
    ["origin/main", 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main'],
    ["origin main fetch", "git fetch --no-tags origin main"],
    [
      "live tag fetch",
      'git fetch --force --no-tags origin "refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME"',
    ],
    ["annotated tag", 'test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag'],
    ["live tag commit", 'test "$(git rev-parse "refs/tags/$GITHUB_REF_NAME^{}")" = "$GITHUB_SHA"'],
    ["stable 1.x", "/^1\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/"],
    ["safe numeric components", "Number.isSafeInteger(Number(component))"],
    ["`v${core.version}`", "`v${core.version}`"],
    ["core.version !== http.version", "core.version !== http.version"],
  ] as const;
  for (const [fact, source] of sourceValidation) {
    for (const [jobName, job] of [
      ["verify", verify],
      ["publish-core", publishCore],
      ["publish-http", publishHttp],
    ] as const) {
      if (!job.includes(source)) {
        failures.push(
          `.github/workflows/publish.yml: ${jobName} source validation is missing ${fact}`,
        );
      }
    }
  }
  for (const workspace of publishedWorkspaces.filter(
    (workspace) => workspace.id !== coreWorkspace.id,
  )) {
    for (const [jobName, job] of [
      ["verify", verify],
      ["publish-core", publishCore],
      ["publish-http", publishHttp],
    ] as const) {
      if (!job.includes(`./${workspace.packageManifest}`)) {
        failures.push(
          `.github/workflows/publish.yml: ${jobName} source validation is missing ${workspace.packageManifest}`,
        );
      }
    }
  }
  for (const fact of [
    "SYNC_ENGINE_VERIFIED_TARBALLS: release",
    "sha256sum release/package.tgz > release/package.tgz.sha256",
    "name: verified-npm-package",
  ]) {
    if (!publish.includes(fact)) {
      failures.push(`.github/workflows/publish.yml: verified artifact flow is missing ${fact}`);
    }
  }
  for (const workspace of publishedWorkspaces) {
    const tarball = `release/${workspace.verifiedTarball}`;
    const checksum = `sha256sum ${tarball} > ${tarball}.sha256`;
    if (!publish.includes(checksum)) {
      failures.push(`.github/workflows/publish.yml: verified artifact flow is missing ${checksum}`);
    }
  }
  if (/\bgh\s+release\b/.test(publish)) {
    failures.push(".github/workflows/publish.yml: must not create a GitHub release");
  }

  return failures;
}
