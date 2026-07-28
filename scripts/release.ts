import { createHash } from "node:crypto";

export const ownedDependencyManifests = [
  "examples/reading-circle/package.json",
  "examples/operations-room/package.json",
  "examples/production-http/package.json",
  "tests/package/application/package.json",
  "tests/package/multi-instance/client/package.json",
  "tests/package/multi-instance/backend/package.json",
] as const;

const exampleManifests = ownedDependencyManifests.slice(0, 3);
const bunProjectManifests = [
  "package.json",
  ...exampleManifests,
  "tests/package/application/package.json",
  "src/command/scaffold/package.json",
] as const;
const nodeProjectManifests = [
  ...bunProjectManifests,
  "tests/package/multi-instance/client/package.json",
  "tests/package/multi-instance/backend/package.json",
] as const;
const typescriptManifests = nodeProjectManifests;

export const releaseSourcePaths = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "docs/releasing.md",
  "SUPPORT.md",
  "SECURITY.md",
  "src/command/scaffold/package.json",
  ...ownedDependencyManifests,
  ".github/workflows/ci.yml",
  ".github/workflows/publish.yml",
  ".github/CODEOWNERS",
  ".github/dependabot.yml",
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
const expectedEngines = { bun: ">=1.3.14 <1.4", node: ">=24 <25" } as const;
const expectedTypeScript = ">=6 <7";
const expectedPackageManager = "bun@1.3.14";
const releasedChangelogDigests = new Map([
  ["1.0.0-alpha.0", "92e21d62558b5e7aa66a5c2c30c20633534f5dfc144506bd11e9643f8cd7dd21"],
  ["0.3.0", "fb8d76294b0d86f67c00fdc92c0a7b27a7cad0afbe0b5f335f3764087919c309"],
  ["0.2.0", "1310093297ca2e60f0fe99beb6e74ad86e864cbfc98d4feaf3b8b8858adfcd21"],
  ["0.1.1", "8d14d20525ef8a9e501c58610c33b278ec6c5cc61335bf7eb9995d9c71e196f5"],
  ["0.1.0", "9cd7baf8a9d9646e728dc3b23fc28500955a780c5a4e86b1f5321b4b380c96e8"],
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activeWorkflowSource(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
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
  const version = root?.version;
  if (typeof version !== "string" || !/^1\.0\.0-beta\.(?:0|[1-9]\d*)$/.test(version)) {
    failures.push("package.json: version must match 1.0.0-beta.N without leading zeroes");
  }

  const publishTag = object(root?.publishConfig)?.tag;
  if (publishTag !== "beta") failures.push('package.json: publishConfig.tag must be "beta"');

  const packageFiles = root?.files;
  for (const policy of ["SUPPORT.md", "SECURITY.md"]) {
    if (!Array.isArray(packageFiles) || !packageFiles.includes(policy)) {
      failures.push(`package.json: files must ship ${policy}`);
    }
  }
  if (object(root?.scripts)?.["release:check"] !== "bun scripts/check-release.ts") {
    failures.push("package.json: release:check must run bun scripts/check-release.ts");
  }

  if (typeof version === "string") {
    for (const path of ownedDependencyManifests) {
      const dependency = object(manifest(path)?.dependencies)?.["@mit-sdg/sync-engine"];
      if (dependency !== version) {
        failures.push(`${path}: @mit-sdg/sync-engine must equal ${version}`);
      }
    }
  }

  for (const path of nodeProjectManifests) {
    const value = object(manifest(path)?.engines)?.node;
    if (value !== expectedEngines.node) {
      failures.push(`${path}: engines.node must be ${expectedEngines.node}`);
    }
  }
  for (const path of bunProjectManifests) {
    const project = manifest(path);
    const value = object(project?.engines)?.bun;
    if (value !== expectedEngines.bun) {
      failures.push(`${path}: engines.bun must be ${expectedEngines.bun}`);
    }
    if (project?.packageManager !== expectedPackageManager) {
      failures.push(`${path}: packageManager must be ${expectedPackageManager}`);
    }
  }
  for (const path of typescriptManifests) {
    const project = manifest(path);
    const value =
      object(project?.dependencies)?.typescript ?? object(project?.devDependencies)?.typescript;
    if (value !== expectedTypeScript) {
      failures.push(`${path}: TypeScript range must be ${expectedTypeScript}`);
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
      if (version === "1.0.0-beta.0" && heading[1] !== "2026-07-28") {
        failures.push("CHANGELOG.md: 1.0.0-beta.0 must be dated 2026-07-28");
      }
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

  const readme = sources.get("README.md") ?? "";
  if (typeof version === "string" && !readme.includes(`\`@${version}\``)) {
    failures.push(`README.md: exact evaluation version must be @${version}`);
  }

  const releasing = sources.get("docs/releasing.md") ?? "";
  for (const fact of [
    "npm deprecate @mit-sdg/sync-engine@1.0.0-alpha.0",
    "install @mit-sdg/sync-engine@$VERSION or use @beta",
    "versions deprecated --json",
    "never\n  `@alpha`",
  ]) {
    if (!releasing.includes(fact)) {
      failures.push(`docs/releasing.md: missing alpha retirement fact ${fact}`);
    }
  }

  const support = sources.get("SUPPORT.md") ?? "";
  for (const fact of [
    "Only the newest beta is supported.",
    "Node.js `>=24 <25`",
    "Bun `>=1.3.14 <1.4`",
    "TypeScript `>=6 <7`",
    "sync-engine.application-manifest` version 2",
    "sync-engine.application-dependency-graph` version 2",
  ]) {
    if (!support.includes(fact)) failures.push(`SUPPORT.md: missing supported policy fact ${fact}`);
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
    "/CHANGELOG.md",
    "/SUPPORT.md",
    "/SECURITY.md",
    "/docs/releasing.md",
    "/scripts/release.ts",
    "/scripts/check-release.ts",
  ]) {
    const line = codeowners.split(/\r?\n/).find((candidate) => candidate.startsWith(`${path} `));
    if (line === undefined || !line.includes("@BarishNamazov") || !line.includes("@eagonmeng")) {
      failures.push(`.github/CODEOWNERS: ${path} must require both release code owners`);
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
    const uses = [...source.matchAll(/\buses:\s*([^\s#]+)/g)].map((match) => match[1] ?? "");
    for (const use of uses) {
      if (use.startsWith("./")) continue;
      const separator = use.lastIndexOf("@");
      const action = use.slice(0, separator);
      const reference = use.slice(separator + 1);
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
    if (bunVersions.length !== bunSetups || bunVersions.some((value) => value !== "1.3.14")) {
      failures.push(`${path}: every setup-bun step must pin bun-version 1.3.14`);
    }
  }

  const ci = activeWorkflowSource(sources.get(".github/workflows/ci.yml") ?? "");
  for (const fact of [
    "permissions:\n  contents: read",
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
  for (const name of ["package", "test"]) {
    const job = workflowJob(ci, name);
    for (const fact of [
      "- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
      'node-version: "24"',
    ]) {
      if (!hasWorkflowLine(job, fact)) {
        failures.push(`.github/workflows/ci.yml: ${name} job is missing ${fact}`);
      }
    }
  }

  const publish = activeWorkflowSource(sources.get(".github/workflows/publish.yml") ?? "");
  const verify = workflowJob(publish, "verify");
  const publication = workflowJob(publish, "publish");
  for (const fact of [
    "name: Publish beta",
    '- "v1.0.0-beta.*"',
    "permissions:\n  contents: read",
  ]) {
    if (!publish.includes(fact)) failures.push(`.github/workflows/publish.yml: missing ${fact}`);
  }
  for (const gate of [
    "bun run release:check",
    "bun run check",
    "bun run test",
    "bun run coverage",
    "bun run build",
    "bun run declarations:check",
    "bun run examples:check",
    "bun run scenario",
    "bun run package:check",
    "bun audit",
  ]) {
    if (!hasRunCommand(verify, gate)) {
      failures.push(`.github/workflows/publish.yml: verify job must run ${gate}`);
    }
  }
  for (const fact of [
    "- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    'node-version: "24"',
  ]) {
    if (!hasWorkflowLine(verify, fact)) {
      failures.push(`.github/workflows/publish.yml: verify job is missing ${fact}`);
    }
  }
  const verifyOrder = [
    "bun run release:check",
    "bun run check",
    "bun run test",
    "bun run coverage",
    "bun run build",
    "bun run declarations:check",
    "bun run examples:check",
    "bun run scenario",
    "bun run package:check",
    "bun audit",
  ].map((command) => runCommandPosition(verify, command));
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
  for (const fact of ["needs: verify", "id-token: write", "name: npm"]) {
    if (!hasWorkflowLine(publication, fact)) {
      failures.push(`.github/workflows/publish.yml: publish job is missing ${fact}`);
    }
  }
  for (const command of [
    "sha256sum --check release/package.tgz.sha256",
    "npm publish release/package.tgz --provenance --tag beta --access public",
  ]) {
    if (!hasRunCommand(publication, command)) {
      failures.push(`.github/workflows/publish.yml: publish job is missing ${command}`);
    }
  }
  for (const forbidden of ["setup-bun@", "bun install", "bun run", "prepack"]) {
    if (publication.includes(forbidden)) {
      failures.push(`.github/workflows/publish.yml: publish job must not rebuild (${forbidden})`);
    }
  }
  if (/^\s+(?:-\s+)?if:/m.test(publication)) {
    failures.push(".github/workflows/publish.yml: publish steps must not be conditional");
  }
  if (/^\s+continue-on-error:/m.test(publication)) {
    failures.push(".github/workflows/publish.yml: publish steps must not continue on error");
  }
  if ((publish.match(/id-token:\s*write/g) ?? []).length !== 1) {
    failures.push(".github/workflows/publish.yml: only publish may receive id-token: write");
  }
  const sourceValidation = [
    ["GITHUB_REF_NAME", "if (process.env.GITHUB_REF_NAME !== expected"],
    ["GITHUB_SHA", 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'],
    ["origin/main", 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main'],
    ["origin main fetch", "git fetch --no-tags origin main"],
    [
      "live tag fetch",
      'git fetch --force --no-tags origin "refs/tags/$GITHUB_REF_NAME:refs/tags/$GITHUB_REF_NAME"',
    ],
    ["annotated tag", 'test "$(git cat-file -t "refs/tags/$GITHUB_REF_NAME")" = tag'],
    ["live tag commit", 'test "$(git rev-parse "refs/tags/$GITHUB_REF_NAME^{}")" = "$GITHUB_SHA"'],
    ["[1-9]\\d*", "/^1\\.0\\.0-beta\\.(?:0|[1-9]\\d*)$/"],
  ] as const;
  for (const [fact, source] of sourceValidation) {
    if (!verify.includes(source)) {
      failures.push(`.github/workflows/publish.yml: verify source validation is missing ${fact}`);
    }
    if (!publication.includes(source)) {
      failures.push(`.github/workflows/publish.yml: publish source validation is missing ${fact}`);
    }
  }
  for (const fact of [
    "SYNC_ENGINE_VERIFIED_TARBALL: release/package.tgz",
    "sha256sum release/package.tgz > release/package.tgz.sha256",
    "name: verified-npm-package",
  ]) {
    if (!publish.includes(fact)) {
      failures.push(`.github/workflows/publish.yml: verified artifact flow is missing ${fact}`);
    }
  }
  if (/\bgh\s+release\b/.test(publish)) {
    failures.push(".github/workflows/publish.yml: must not create a GitHub release");
  }

  return failures;
}
