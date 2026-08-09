import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { activeWorkflowSource, externalWorkflowActions, workflowUses } from "./workflow.ts";
import { workspaceById, workspaceCatalog, type Workspace } from "./workspaces.ts";

const coreWorkspace = workspaceById("core");
const httpWorkspace = workspaceById("http");
const analysisWorkspace = workspaceById("analysis");
const catalogWorkspace = workspaceById("catalog");
const releaseWorkspaces: readonly Workspace[] = workspaceCatalog;
const publishedWorkspaces = releaseWorkspaces.filter(
  (workspace) => workspace.publication === "npm",
);
const workspaceReleaseManifests = releaseWorkspaces
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
  "packages/analysis/README.md",
  "packages/analysis/public-surface.md",
  "packages/catalog/README.md",
  "packages/catalog/public-surface.md",
  "packages/catalog/CONTRIBUTING.md",
  "README.md",
  "CHANGELOG.md",
  "docs/project/releasing.md",
  "docs/user/llms.txt",
  "docs/user/index.md",
  "docs/user/overview.md",
  "docs/user/design.md",
  "docs/user/guide/authoring.md",
  "docs/user/guide/persistence-recovery.md",
  "docs/user/guide/read-construction.md",
  "docs/user/guide/reviewing-a-design.md",
  "docs/user/reference/concept-specification.md",
  "docs/user/reference/public-api.md",
  "docs/user/reference/semantics.md",
  "docs/user/reference/operations.md",
  "docs/user/reference/cli.md",
  "SUPPORT.md",
  "SECURITY.md",
  ...ownedDependencyManifests,
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
  "scripts/update-release-manifests.ts",
  "scripts/check-release.ts",
  "scripts/verify-release.ts",
  "scripts/verify-package.ts",
  "scripts/build.ts",
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
  ["1.0.0-beta.7", "efab8a6f95bceca630f2cecc76bf8f45b24ab34a2d6c6600c9f27c30feb25f34"],
  ["1.0.0-beta.6", "05f202994a49062077b236d6888fd06f951c0025784bf31ac941babedfc3a344"],
  ["1.0.0-beta.5", "af1af8e82fb30e1910108d17f3c127012ab1eaa95e592a26dea767018666d603"],
  ["1.0.0-beta.4", "7034de9308ad503fa95b2999fc3c941d3e36ee44dd006dcc1b733fa7e14fd58d"],
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

function betaOneVersion(value: string | undefined): value is string {
  const match = /^1\.0\.0-beta\.(0|[1-9]\d*)$/.exec(value ?? "");
  return match !== null && Number.isSafeInteger(Number(match[1]));
}

function compatiblePeer(version: string): string {
  return version;
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
  if (!betaOneVersion(facts.version)) {
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
  const rootDependencies = object(root.dependencies) ?? {};
  const projected = new Map<string, string>();
  const workspaceVersions = new Map(
    releaseWorkspaces.map((workspace) => [workspace.packageName, facts.version]),
  );

  for (const workspace of releaseWorkspaces) {
    if (workspace.id === coreWorkspace.id) continue;
    const path = workspace.packageManifest;
    const manifest = object(JSON.parse(sources.get(path) ?? ""));
    if (manifest === undefined) throw new Error(`${path} must contain an object`);
    manifest.version = facts.version;
    if (workspace.publication === "npm") {
      delete manifest.private;
      const publishConfig = object(manifest.publishConfig) ?? {};
      manifest.publishConfig = publishConfig;
      publishConfig.access = object(root.publishConfig)?.access;
      publishConfig.tag = object(root.publishConfig)?.tag;
    } else {
      manifest.private = true;
      delete manifest.publishConfig;
    }
    const engines = object(manifest.engines) ?? {};
    manifest.engines = engines;
    engines.node = facts.node;
    if (workspace.bins !== undefined) engines.bun = facts.bun;
    const peerDependencies = object(manifest.peerDependencies) ?? {};
    manifest.peerDependencies = peerDependencies;
    for (const peerId of workspace.peerWorkspaceIds) {
      const peer = workspaceById(peerId);
      const peerVersion = workspaceVersions.get(peer.packageName);
      if (peerVersion !== undefined)
        peerDependencies[peer.packageName] = compatiblePeer(peerVersion);
    }
    if (workspace.id === catalogWorkspace.id) {
      manifest.peerDependenciesMeta = {
        [coreWorkspace.packageName]: { optional: true },
      };
    }
    if (workspace.rootRuntimeDependencies.length > 0) {
      const dependencies = object(manifest.dependencies) ?? {};
      manifest.dependencies = dependencies;
      for (const dependency of workspace.rootRuntimeDependencies) {
        const range = rootDependencies[dependency];
        if (typeof range !== "string") {
          throw new Error(`package.json is missing dependencies.${dependency}`);
        }
        dependencies[dependency] = range;
        delete peerDependencies[dependency];
      }
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
    for (const workspace of releaseWorkspaces) {
      if (!(workspace.packageName in dependencies)) continue;
      dependencies[workspace.packageName] = workspaceVersions.get(workspace.packageName);
    }
    delete dependencies.typescript;
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

function lockManifestField(source: string, field: string): string {
  return (
    new RegExp(`^      "${escapeRegExp(field)}": \\{([\\s\\S]*?)^      \\},?$`, "m").exec(
      source,
    )?.[1] ?? ""
  );
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
  const manifests = new Map<string, JsonObject | undefined>();

  for (const path of releaseSourcePaths) {
    if (!sources.has(path)) failures.push(`${path}: required release source is missing`);
  }

  function manifest(path: string): JsonObject | undefined {
    if (manifests.has(path)) return manifests.get(path);
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
      manifests.set(path, undefined);
      return undefined;
    }
  }

  const root = manifest("package.json");
  const facts = releaseFacts(root);
  const version = facts.version;
  if (!betaOneVersion(version)) {
    failures.push("package.json: version must match 1.0.0-beta.N without leading zeroes");
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
  if (publishTag !== "beta") failures.push('package.json: publishConfig.tag must be "beta"');
  if (object(root?.publishConfig)?.access !== "public") {
    failures.push('package.json: publishConfig.access must be "public"');
  }

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
  if (!lockRoot.includes(`"name": "${coreWorkspace.packageName}"`)) {
    failures.push(`bun.lock: root workspace name must be ${coreWorkspace.packageName}`);
  }
  for (const workspace of releaseWorkspaces) {
    if (workspace.id === coreWorkspace.id) continue;
    const lockWorkspace =
      new RegExp(
        `^    "${escapeRegExp(workspace.directory)}": \\{([\\s\\S]*?)^    \\},?$`,
        "m",
      ).exec(lock)?.[1] ?? "";
    if (!lockWorkspace.includes(`"version": "${version}"`)) {
      failures.push(`bun.lock: ${workspace.id} workspace version must equal ${version}`);
    }
    for (const peerId of workspace.peerWorkspaceIds) {
      const peer = workspaceById(peerId);
      const lockPeers = lockManifestField(lockWorkspace, "peerDependencies");
      if (
        typeof version === "string" &&
        !lockPeers.includes(`"${peer.packageName}": "${compatiblePeer(version)}"`)
      ) {
        failures.push(
          `bun.lock: ${workspace.id} peer ${peer.packageName} must equal ${compatiblePeer(version)}`,
        );
      }
    }
    for (const dependency of workspace.rootRuntimeDependencies) {
      const expected = object(root?.dependencies)?.[dependency];
      const lockDependencies = lockManifestField(lockWorkspace, "dependencies");
      if (
        typeof expected !== "string" ||
        !lockDependencies.includes(`"${dependency}": "${expected}"`)
      ) {
        failures.push(
          `bun.lock: ${workspace.id} dependency ${dependency} must equal ${String(expected)}`,
        );
      }
    }
  }
  const coreWorkspaceResolution = `"${coreWorkspace.packageName}": ["${coreWorkspace.packageName}@root:",`;
  if (!lock.includes(coreWorkspaceResolution)) {
    failures.push(`bun.lock: core package must resolve to the root workspace`);
  }

  for (const workspace of releaseWorkspaces) {
    const project = manifest(workspace.packageManifest);
    if (project?.name !== workspace.packageName) {
      failures.push(`${workspace.packageManifest}: name must be ${workspace.packageName}`);
    }
    if (workspace.id === coreWorkspace.id) continue;
    if (workspace.publication === "npm") {
      if (project?.private !== undefined) {
        failures.push(`${workspace.packageManifest}: published workspaces must omit private`);
      }
      if (object(project?.publishConfig)?.access !== "public") {
        failures.push(`${workspace.packageManifest}: publishConfig.access must be "public"`);
      }
      if (object(project?.publishConfig)?.tag !== "beta") {
        failures.push(`${workspace.packageManifest}: publishConfig.tag must be "beta"`);
      }
    } else {
      if (project?.private !== true) {
        failures.push(`${workspace.packageManifest}: private workspaces must set private to true`);
      }
      if (project?.publishConfig !== undefined) {
        failures.push(`${workspace.packageManifest}: private workspaces must omit publishConfig`);
      }
    }
    const expectedPeers = workspace.peerWorkspaceIds
      .map((peerId) => workspaceById(peerId).packageName)
      .sort();
    const actualPeers = Object.keys(object(project?.peerDependencies) ?? {}).sort();
    if (!isDeepStrictEqual(actualPeers, expectedPeers)) {
      failures.push(
        `${workspace.packageManifest}: peerDependencies must contain only ${expectedPeers.join(", ")}`,
      );
    }
    if (
      workspace.id === catalogWorkspace.id &&
      object(object(project?.peerDependenciesMeta)?.[coreWorkspace.packageName])?.optional !== true
    ) {
      failures.push(
        `${workspace.packageManifest}: ${coreWorkspace.packageName} peer must be optional`,
      );
    }
    for (const dependency of workspace.rootRuntimeDependencies) {
      const expected = object(root?.dependencies)?.[dependency];
      if (object(project?.dependencies)?.[dependency] !== expected) {
        failures.push(
          `${workspace.packageManifest}: dependencies.${dependency} must equal ${String(expected)}`,
        );
      }
    }
    if (
      workspace.id === analysisWorkspace.id &&
      object(project?.repository)?.directory !== analysisWorkspace.directory
    ) {
      failures.push(
        `${workspace.packageManifest}: repository.directory must be ${analysisWorkspace.directory}`,
      );
    }
  }

  const parsedReleaseManifests = releaseManifestPaths.map((path) => manifest(path));
  if (parsedReleaseManifests.every((project) => project !== undefined)) {
    try {
      for (const [path, expectedSource] of projectReleaseManifests(sources)) {
        const actual = manifest(path);
        const expected = object(JSON.parse(expectedSource));
        if (
          actual !== undefined &&
          expected !== undefined &&
          !isDeepStrictEqual(actual, expected)
        ) {
          failures.push(`${path}: release-owned facts are stale; run bun run release:update`);
        }
      }
    } catch (error) {
      failures.push(
        `release manifests: projection failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
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

  const releasing = sources.get("docs/project/releasing.md") ?? "";
  for (const fact of [
    "npm deprecate @mit-sdg/sync-engine@$PRERELEASE_VERSION",
    "install @mit-sdg/sync-engine@$VERSION or use @beta",
    "versions deprecated --json",
    "never\n  overwrite an existing tag or tarball",
  ]) {
    if (!releasing.includes(fact)) {
      failures.push(`docs/project/releasing.md: missing prerelease retirement fact ${fact}`);
    }
  }

  const support = sources.get("SUPPORT.md") ?? "";
  const analysisFormatFacts = [
    "sync-engine.application-index` version 2",
    "sync-engine.impact-trace` version 2",
    "sync-engine.application-source-index` version 2",
    "sync-engine.application-project-analysis` version 2",
  ] as const;
  const supportFacts = [
    "Only the newest beta is supported.",
    "sync-engine.application-manifest` version 5",
    "@mit-sdg/sync-engine-analysis/ir",
    "@mit-sdg/sync-engine-analysis/project",
    "analysis package requires the exact matching core beta as a peer dependency",
    "TypeScript is a normal runtime dependency of the analysis package",
    ...analysisFormatFacts,
    "expectedProjectDigest",
    "Granular facade results are bounded immutable data",
    "analysis package is generic infrastructure and does not package guidance",
  ];
  if (facts.node !== undefined) supportFacts.push(`Node.js \`${facts.node}\``);
  if (facts.bun !== undefined) supportFacts.push(`Bun \`${facts.bun}\``);
  if (facts.typescript !== undefined) supportFacts.push(`TypeScript \`${facts.typescript}\``);
  for (const fact of supportFacts) {
    if (!support.includes(fact)) failures.push(`SUPPORT.md: missing supported policy fact ${fact}`);
  }

  for (const [path, facts] of [
    [
      "packages/analysis/README.md",
      [
        "independently published public",
        "@mit-sdg/sync-engine-analysis/ir",
        "@mit-sdg/sync-engine-analysis/project",
        ...analysisFormatFacts,
        "expectedProjectDigest",
      ],
    ],
    [
      "packages/analysis/public-surface.md",
      [
        "public package",
        "@mit-sdg/sync-engine-analysis/ir",
        "@mit-sdg/sync-engine-analysis/project",
        ...analysisFormatFacts,
        "expectedProjectDigest",
      ],
    ],
  ] as const) {
    const source = sources.get(path) ?? "";
    for (const fact of facts) {
      if (!source.includes(fact))
        failures.push(`${path}: missing analysis publication fact ${fact}`);
    }
    if (/private preview|repository-private|not published/i.test(source)) {
      failures.push(`${path}: must describe the published analysis package`);
    }
  }

  const security = sources.get("SECURITY.md") ?? "";
  for (const fact of [
    "security/advisories/new",
    "acknowledgement within three business days",
    "update at least weekly",
    "Newest `1.0.0-beta.x`",
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
    ...releaseWorkspaces
      .filter((workspace) => workspace.id !== coreWorkspace.id)
      .map((workspace) => `/${workspace.directory}/`),
    "/CHANGELOG.md",
    "/SUPPORT.md",
    "/SECURITY.md",
    "/docs/project/releasing.md",
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
    "push:\n    branches: [main]",
    "permissions:\n  contents: read",
    "name: Pack & import workspaces",
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
  const publicationPolicies = [
    { workspace: coreWorkspace, jobName: "publish-core", needs: "needs: verify" },
    {
      workspace: analysisWorkspace,
      jobName: "publish-analysis",
      needs: "needs: [verify, publish-core]",
    },
    {
      workspace: httpWorkspace,
      jobName: "publish-http",
      needs: "needs: [verify, publish-core, publish-analysis]",
    },
    {
      workspace: catalogWorkspace,
      jobName: "publish-catalog",
      needs: "needs: [verify, publish-core]",
    },
  ] as const;
  const publicationJobs = publicationPolicies.map((policy) => ({
    ...policy,
    source: workflowJob(publish, policy.jobName),
  }));
  const checkedPublishJobs: Array<readonly [string, string]> = [
    ["verify", verify],
    ...publicationJobs.map(({ jobName, source }) => [jobName, source] as const),
  ];
  for (const fact of [
    "name: Publish beta",
    '- "v1.0.0-beta.*"',
    "permissions:\n  contents: read",
  ]) {
    if (!publish.includes(fact)) failures.push(`.github/workflows/publish.yml: missing ${fact}`);
  }
  for (const gate of publishVerificationGates) {
    if (!hasRunCommand(verify, gate)) {
      failures.push(`.github/workflows/publish.yml: verify job must run ${gate}`);
    }
  }
  if (nodeMajor !== undefined) {
    for (const [name, job] of checkedPublishJobs) {
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
  const reviewedJobOrder = ["verify", ...publicationPolicies.map(({ jobName }) => jobName)];
  const jobPositions = reviewedJobOrder.map((name) => publish.indexOf(`\n  ${name}:`));
  if (
    jobPositions.some((position) => position < 0) ||
    jobPositions.some((position, index) => index > 0 && position <= jobPositions[index - 1])
  ) {
    failures.push(
      ".github/workflows/publish.yml: verify and publication jobs must remain in reviewed order",
    );
  }
  const publicationActions = [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  ];
  for (const { workspace, jobName, needs, source } of publicationJobs) {
    for (const fact of [needs, "id-token: write", "name: npm"]) {
      if (!hasWorkflowLine(source, fact)) {
        failures.push(`.github/workflows/publish.yml: ${jobName} job is missing ${fact}`);
      }
    }
    if (!isDeepStrictEqual(workflowUses(source), publicationActions)) {
      failures.push(
        `.github/workflows/publish.yml: ${jobName} must use checkout, setup-node, and download-artifact only`,
      );
    }
    const tarball = `release/${workspace.verifiedTarball}`;
    const checksum = `sha256sum --check ${tarball}.sha256`;
    const publication = `npm publish ./${tarball} --provenance --tag beta --access public`;
    const checksumPosition = runCommandPosition(source, checksum);
    const publicationPosition = runCommandPosition(source, publication);
    if (checksumPosition < 0) {
      failures.push(`.github/workflows/publish.yml: ${jobName} job is missing ${checksum}`);
    }
    if (publicationPosition < 0) {
      failures.push(`.github/workflows/publish.yml: ${jobName} job is missing ${publication}`);
    }
    if (
      checksumPosition >= 0 &&
      publicationPosition >= 0 &&
      checksumPosition >= publicationPosition
    ) {
      failures.push(
        `.github/workflows/publish.yml: ${jobName} checksum verification must precede npm publish`,
      );
    }
    if ((source.match(/\bnpm\s+publish\b/g) ?? []).length !== 1) {
      failures.push(
        `.github/workflows/publish.yml: ${jobName} job must contain exactly one npm publish command`,
      );
    }
    if (!source.includes(tarball)) {
      failures.push(`.github/workflows/publish.yml: publish must include ${workspace.id} tarball`);
    }
    for (const forbidden of [
      "setup-bun@",
      "bun install",
      "bun run",
      "npm install",
      "npm pack",
      "npm run",
      "prepack",
    ]) {
      if (source.includes(forbidden)) {
        failures.push(
          `.github/workflows/publish.yml: ${jobName} job must not rebuild (${forbidden})`,
        );
      }
    }
    if (/^\s+(?:-\s+)?if:/m.test(source)) {
      failures.push(`.github/workflows/publish.yml: ${jobName} steps must not be conditional`);
    }
    if (/^\s+continue-on-error:/m.test(source)) {
      failures.push(`.github/workflows/publish.yml: ${jobName} steps must not continue on error`);
    }
  }
  if ((publish.match(/id-token:\s*write/g) ?? []).length !== publicationJobs.length) {
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
    ["v1 beta", "/^1\\.0\\.0-beta\\.(0|[1-9]\\d*)$/"],
    ["safe numeric components", "Number.isSafeInteger(Number(beta[1]))"],
    ["`v${core.version}`", "`v${core.version}`"],
    ["core.version !== http.version", "core.version !== http.version"],
    ["core.version !== analysis.version", "core.version !== analysis.version"],
    ["core.version !== catalog.version", "core.version !== catalog.version"],
  ] as const;
  for (const [fact, source] of sourceValidation) {
    for (const [jobName, job] of checkedPublishJobs) {
      if (!job.includes(source)) {
        failures.push(
          `.github/workflows/publish.yml: ${jobName} source validation is missing ${fact}`,
        );
      }
    }
  }
  for (const workspace of releaseWorkspaces) {
    for (const [jobName, job] of checkedPublishJobs) {
      const manifestPath = `./${workspace.packageManifest}`;
      if (!job.includes(manifestPath)) {
        failures.push(
          `.github/workflows/publish.yml: ${jobName} source validation is missing ${workspace.packageManifest}`,
        );
      }
    }
  }
  for (const fact of ["SYNC_ENGINE_VERIFIED_TARBALLS: release", "name: verified-npm-package"]) {
    if (!verify.includes(fact)) {
      failures.push(`.github/workflows/publish.yml: verified artifact flow is missing ${fact}`);
    }
  }
  for (const workspace of publishedWorkspaces) {
    const tarball = `release/${workspace.verifiedTarball}`;
    const checksum = `sha256sum ${tarball} > ${tarball}.sha256`;
    if (!hasRunCommand(verify, checksum)) {
      failures.push(`.github/workflows/publish.yml: verified artifact flow is missing ${checksum}`);
    }
    for (const artifact of [tarball, `${tarball}.sha256`]) {
      if (!hasWorkflowLine(verify, artifact)) {
        failures.push(`.github/workflows/publish.yml: verified artifact upload omits ${artifact}`);
      }
    }
  }
  if (/\bgh\s+release\b/.test(publish)) {
    failures.push(".github/workflows/publish.yml: must not create a GitHub release");
  }

  return failures;
}
