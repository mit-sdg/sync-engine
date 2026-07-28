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
  "CHANGELOG.md",
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
  ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
  ["oven-sh/setup-bun", "0c5077e51419868618aeaa5fe8019c62421857d6"],
  ["voidzero-dev/setup-vp", "250f29ce396baf5e8f24498e17c0dfdebabc26eb"],
]);
const requiredHeadings = [
  "Compatibility",
  "Migration",
  "Generated formats",
  "Runtime and security support",
] as const;
const expectedEngines = { bun: ">=1.3.14 <1.4", node: ">=24 <25" } as const;
const expectedTypeScript = ">=5.9 <6";
const expectedPackageManager = "bun@1.3.14";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  if (!changelog.includes("## [1.0.0-alpha.0] - 2026-07-27")) {
    failures.push("CHANGELOG.md: released 1.0.0-alpha.0 date must remain 2026-07-27");
  }

  const support = sources.get("SUPPORT.md") ?? "";
  for (const fact of [
    "Only the newest beta is supported.",
    "Node.js `>=24 <25`",
    "Bun `>=1.3.14 <1.4`",
    "TypeScript `>=5.9 <6`",
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
    const source = sources.get(path) ?? "";
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

  const ci = sources.get(".github/workflows/ci.yml") ?? "";
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

  const publish = sources.get(".github/workflows/publish.yml") ?? "";
  const verifyStart = publish.indexOf("\n  verify:");
  const publishStart = publish.indexOf("\n  publish:");
  const verify =
    verifyStart >= 0 && publishStart > verifyStart ? publish.slice(verifyStart, publishStart) : "";
  const publication = publishStart >= 0 ? publish.slice(publishStart) : "";
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
    if (!verify.includes(gate)) {
      failures.push(`.github/workflows/publish.yml: verify job must run ${gate}`);
    }
  }
  if (verify.includes("environment:") || verify.includes("id-token: write")) {
    failures.push(".github/workflows/publish.yml: verify must be unprivileged");
  }
  for (const fact of [
    "needs: verify",
    "id-token: write",
    "name: npm",
    "bun install --frozen-lockfile",
    "bun run release:check",
    "npm publish --provenance --tag beta --access public",
  ]) {
    if (!publication.includes(fact)) {
      failures.push(`.github/workflows/publish.yml: publish job is missing ${fact}`);
    }
  }
  if ((publish.match(/id-token:\s*write/g) ?? []).length !== 1) {
    failures.push(".github/workflows/publish.yml: only publish may receive id-token: write");
  }
  const sourceValidation = [
    ["GITHUB_REF_NAME", "if (process.env.GITHUB_REF_NAME !== expected"],
    ["GITHUB_SHA", 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'],
    ["origin/main", 'git merge-base --is-ancestor "$GITHUB_SHA" origin/main'],
    ["origin main fetch", "git fetch --no-tags origin main"],
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
  if (/\bgh\s+release\b/.test(publish)) {
    failures.push(".github/workflows/publish.yml: must not create a GitHub release");
  }

  return failures;
}
