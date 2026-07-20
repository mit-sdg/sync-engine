import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { filesBelow } from "./walk.ts";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "src");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
};
const publicSubpaths = new Set(
  Object.keys(packageJson.exports).map((subpath) => subpath.replace(/^\.\//, "")),
);
const concerns = new Set(["reactions", "reads", "boundary", "hosting", "tooling", "utils"]);
const dependencies = new Map([
  ["reactions", new Set(["reactions", "reads", "utils"])],
  ["reads", new Set(["reads", "reactions", "utils"])],
  ["boundary", new Set(["boundary", "reactions", "reads", "utils"])],
  ["hosting", new Set(["hosting", "reactions", "reads", "utils"])],
  ["tooling", new Set(["tooling", "boundary", "reactions", "reads", "utils"])],
  ["utils", new Set(["utils"])],
]);
const unsupportedTopLevelDirectories = new Set([
  "cli",
  "engine",
  "gateway",
  "hosting",
  "http",
  "runtime",
  "sdk",
  "storage",
]);
const unsupportedTestDirectories = new Set(["engine", "runtime", "sdk"]);
const eliminatedIdentifiers = new Set([
  "BAD_RESPONSE",
  "QueryContracts",
  "INVALID_OUTPUT",
  "MULTIPLE_RESPONSES",
  "conceptSpec",
  "createEndpointDsl",
  "reactionMap",
  "sanitize",
  "specificationProse",
]);
const failures: string[] = [];

const tsFilesBelow = (directory: string): Promise<string[]> =>
  filesBelow(directory, (name) => name.endsWith(".ts"));

function top(path: string): string {
  return relative(sourceRoot, path).split(sep)[0] ?? "";
}

function internalConcern(path: string): string | undefined {
  const parts = relative(sourceRoot, path).split(sep);
  return parts[0] === "internal" && concerns.has(parts[1]) ? parts[1] : undefined;
}

function targetOf(source: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return normalize(resolve(dirname(source), specifier));
  const match = /^@sync-engine\/(.+?)(?:\/|$)/.exec(specifier);
  return match === null ? undefined : join(sourceRoot, match[1]);
}

function repositoryFiles(): string[] {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .filter((path) => existsSync(resolve(root, path)))
    .sort();
}

function sourceDependencies(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const target = targetOf(path, specifier.text);
    if (target !== undefined) found.push(target);
  }
  return found;
}

for (const directory of unsupportedTopLevelDirectories) {
  if (existsSync(join(root, directory))) {
    failures.push(`${directory}/: unsupported top-level directories must be deleted`);
  }
}

for (const sourcePath of await tsFilesBelow(join(root, "tests"))) {
  const parts = relative(join(root, "tests"), sourcePath).split(sep);
  const unsupportedDirectory = parts.find((part) => unsupportedTestDirectories.has(part));
  if (unsupportedDirectory !== undefined) {
    failures.push(
      `${relative(root, sourcePath)}: tests may not live in the unsupported ${unsupportedDirectory} directory`,
    );
  }
}
for (const directory of unsupportedTestDirectories) {
  if (existsSync(join(root, "tests", directory))) {
    failures.push(`tests/${directory}/: unsupported test directories must be deleted`);
  }
}

const shippedFiles = [
  ...(await tsFilesBelow(join(sourceRoot, "command"))),
  ...(
    await Promise.all([...publicSubpaths].map((subpath) => tsFilesBelow(join(sourceRoot, subpath))))
  ).flat(),
  ...(await tsFilesBelow(join(sourceRoot, "internal"))),
];
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")) as {
  compilerOptions: { paths: Record<string, string[]> };
};
for (const [alias, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
  for (const target of targets) {
    if (!target.includes("*") && !existsSync(resolve(root, target))) {
      failures.push(`${alias}: TypeScript path target does not exist (${target})`);
    }
  }
}
for (const sourcePath of shippedFiles) {
  const text = readFileSync(sourcePath, "utf8");
  if (/@deprecated\b/i.test(text)) {
    failures.push(`${relative(root, sourcePath)}: shipped source may not declare deprecated API`);
  }
  const source = ts.createSourceFile(
    sourcePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const foundIdentifiers = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && eliminatedIdentifiers.has(node.text)) {
      foundIdentifiers.add(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const identifier of foundIdentifiers) {
    failures.push(`${relative(root, sourcePath)}: ${identifier} is an eliminated identifier`);
  }
  if (/\bSDK\b/.test(text)) {
    failures.push(
      `${relative(root, sourcePath)}: shipped source may not use the unsupported SDK label`,
    );
  }
}

for (const subpath of publicSubpaths) {
  const directory = join(sourceRoot, subpath);
  const files = await tsFilesBelow(directory);
  if (files.some((file) => relative(directory, file) !== "index.ts")) {
    failures.push(`${subpath}: a public package subpath may contain only index.ts`);
  }
  const index = join(directory, "index.ts");
  const source = ts.createSourceFile(
    index,
    readFileSync(index, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) {
      failures.push(
        `${relative(root, index)}:${source.getLineAndCharacterOfPosition(statement.pos).line + 1}: public entrypoints contain exports only`,
      );
      continue;
    }
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const target = targetOf(index, specifier.text);
    if (target !== undefined && publicSubpaths.has(top(target))) {
      failures.push(
        `${relative(root, index)}: a public entrypoint may not import or re-export another public entrypoint (${specifier.text})`,
      );
    }
  }
}

for (const sourcePath of await tsFilesBelow(join(sourceRoot, "internal"))) {
  const source = ts.createSourceFile(
    sourcePath,
    readFileSync(sourcePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const owner = internalConcern(sourcePath);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
    const target = targetOf(sourcePath, specifier.text);
    if (target === undefined) continue;
    const targetTop = top(target);
    if (publicSubpaths.has(targetTop)) {
      failures.push(
        `${relative(root, sourcePath)}: internal modules may not import public entrypoint ${targetTop}`,
      );
      continue;
    }
    const targetConcern = internalConcern(target);
    if (
      owner !== undefined &&
      targetConcern !== undefined &&
      dependencies.get(owner)?.has(targetConcern) !== true
    ) {
      failures.push(`${relative(root, sourcePath)}: ${owner} may not depend on ${targetConcern}`);
    }
  }
}

const repository = repositoryFiles();
const allowedRootFiles = new Set([
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "bun.lock",
  "package.json",
  "tsconfig.build.json",
  "tsconfig.json",
  "vite.config.ts",
]);
const allowedTestDirectories = new Set([
  "docs",
  "examples",
  "golden",
  "internal",
  "package",
  "utils",
]);
const hashes = new Map<string, string>();
for (const path of repository) {
  const parts = path.split("/");
  const [head] = parts;
  const content = readFileSync(resolve(root, path));
  if (content.length === 0) failures.push(`${path}: repository files may not be empty`);
  const hash = createHash("sha256").update(content).digest("hex");
  const duplicate = hashes.get(hash);
  if (duplicate !== undefined) failures.push(`${path}: exact duplicate of ${duplicate}`);
  else hashes.set(hash, path);

  const known =
    (parts.length === 1 && allowedRootFiles.has(path)) ||
    (head === ".github" && parts[1] === "workflows" && parts.length === 3) ||
    (head === "src" &&
      ((parts[1] === "command" && parts.length === 3 && parts[2] === "artifacts.ts") ||
        (publicSubpaths.has(parts[1] ?? "") && parts.length === 3 && parts[2] === "index.ts") ||
        (parts[1] === "internal" && path.endsWith(".ts")))) ||
    (head === "docs" && path.endsWith(".md")) ||
    (head === "examples" && (path.endsWith(".md") || path.endsWith(".ts"))) ||
    (head === "scripts" && parts.length === 2 && path.endsWith(".ts")) ||
    (head === "tests" &&
      ((parts.length === 2 && parts[1] === "public-api.test.ts") ||
        (parts.length >= 3 && allowedTestDirectories.has(parts[1]))));
  if (!known)
    failures.push(`${path}: file is outside the supported top-level and test directories`);
}

for (const path of repository.filter((candidate) => candidate.includes("/generated/"))) {
  const source = readFileSync(resolve(root, path), "utf8");
  if (!/generated/i.test(source) || !/do not edit/i.test(source)) {
    failures.push(`${path}: generated material must name its provenance and say not to edit it`);
  }
  const example = path.split("/").slice(0, 2).join("/");
  if (!repository.includes(`${example}/generated.config.ts`)) {
    failures.push(`${path}: generated material has no owning generated.config.ts`);
  }
}

const shippedSources = new Set(shippedFiles.map((path) => normalize(path)));
const entrypoints = [
  ...[...publicSubpaths].map((subpath) => join(sourceRoot, subpath, "index.ts")),
  ...[...concerns]
    .map((concern) => join(sourceRoot, "internal", concern, "index.ts"))
    .filter(existsSync),
  join(sourceRoot, "command", "artifacts.ts"),
].map(normalize);
const reachable = new Set<string>();
const pending = entrypoints.filter((path) => shippedSources.has(path));
while (pending.length > 0) {
  const path = pending.pop();
  if (path === undefined || reachable.has(path)) continue;
  reachable.add(path);
  for (const target of sourceDependencies(path)) {
    const normalized = normalize(target);
    if (shippedSources.has(normalized) && !reachable.has(normalized)) pending.push(normalized);
  }
}
for (const path of shippedSources) {
  if (!reachable.has(path)) failures.push(`${relative(root, path)}: shipped source is unreachable`);
}

if (failures.length > 0) {
  throw new Error(
    `Architecture dependency check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}

console.log(`architecture check passed for ${repository.length} repository files`);
