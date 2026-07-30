import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";
import { externalWorkflowActions } from "./workflow.ts";
import {
  workspaceCatalog,
  workspaceById,
  workspaceRepositoryPath,
  type Workspace,
} from "./workspaces.ts";

export interface ArchitectureProject {
  /** Text for every repository file plus any untracked source files to inspect. */
  files: ReadonlyMap<string, string>;
  /** Tracked and unignored files subject to repository-layout checks. */
  repositoryFiles?: readonly string[];
  /** Existing directories which may be empty and therefore absent from `files`. */
  directories?: ReadonlySet<string>;
  /** Roots whose copied source is intentionally independent of other projects. */
  projectDirectories?: ReadonlySet<string>;
}

export interface ArchitectureResult {
  failures: string[];
  /** Runtime import SCCs, each also reported as a structural failure. */
  runtimeCycles: string[][];
}

interface PackageJson {
  exports: Record<string, unknown>;
}

interface WorkspaceSurface {
  workspace: Workspace;
  publicSubpaths: Set<string>;
}

interface TsConfig {
  compilerOptions: { paths: Record<string, string[]> };
}

interface SourceDependency {
  specifier: string;
  target?: string;
  typeOnly: boolean;
}

const engineRoot = "src/engine";
const concerns = new Set(["reactions", "reads", "boundary", "hosting", "tooling", "utils"]);
const dependencies = new Map([
  ["reactions", new Set(["reactions", "reads", "utils"])],
  ["reads", new Set(["reads", "reactions", "utils"])],
  ["boundary", new Set(["boundary", "reactions", "reads", "utils"])],
  ["hosting", new Set(["hosting", "reactions", "reads", "utils"])],
  ["tooling", new Set(["tooling", "boundary", "reactions", "reads", "utils"])],
  ["utils", new Set(["utils"])],
]);
const reactionAreas = new Set(["authoring", "concepts", "runtime"]);
const reactionDependencies = new Map([
  ["root", new Set(["root", "authoring", "concepts"])],
  ["authoring", new Set(["root", "authoring", "concepts"])],
  ["concepts", new Set(["root", "concepts"])],
  ["runtime", new Set(["root", "authoring", "concepts", "runtime"])],
]);
const boundaryAreas = new Set(["protocol", "invocation", "assembly", "client", "gateway", "wire"]);
const boundaryDependencies = new Map([
  ["protocol", new Set(["protocol"])],
  ["invocation", new Set(["invocation", "protocol"])],
  ["wire", new Set(["wire", "protocol"])],
  ["assembly", new Set(["assembly", "protocol", "invocation", "wire"])],
  ["client", new Set(["client", "protocol", "invocation"])],
  ["gateway", new Set(["gateway", "protocol", "invocation", "assembly", "client", "wire"])],
]);
const unsupportedBoundaryAreas = new Set(["http"]);
const unsupportedTopLevelDirectories = new Set([
  "cli",
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
const allowedRootFiles = new Set([
  ".gitattributes",
  ".gitignore",
  "AGENTS.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "bun.lock",
  "package.json",
  "tsconfig.build.json",
  "tsconfig.json",
  "vite.config.ts",
]);
const allowedTestDirectories = new Set([
  "docs",
  "examples",
  "fixtures",
  "internal",
  "package",
  "utils",
]);

function normalized(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/")).replace(/^\.\//, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filesBelow(files: ReadonlyMap<string, string>, directory: string): string[] {
  const prefix = `${normalized(directory).replace(/\/$/, "")}/`;
  return [...files.keys()].filter((path) => path.startsWith(prefix) && path.endsWith(".ts")).sort();
}

function top(path: string): string {
  return normalized(path).split("/")[1] ?? "";
}

function engineConcern(path: string): string | undefined {
  const parts = normalized(path).split("/");
  return parts[0] === "src" && parts[1] === "engine" && concerns.has(parts[2])
    ? parts[2]
    : undefined;
}

function nestedArea(path: string, concern: string, areas: Set<string>): string | undefined {
  if (engineConcern(path) !== concern) return undefined;
  const [area] = posix.relative(`${engineRoot}/${concern}`, normalized(path)).split("/");
  return area !== undefined && areas.has(area) ? area : "root";
}

function sourceFile(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function importDeclarationIsTypeOnly(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) return false;
  if (clause.isTypeOnly) return true;
  if (clause.name !== undefined || clause.namedBindings === undefined) return false;
  return (
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.length > 0 &&
    clause.namedBindings.elements.every((element) => element.isTypeOnly)
  );
}

function exportDeclarationIsTypeOnly(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  return (
    node.exportClause !== undefined &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every((element) => element.isTypeOnly)
  );
}

function stronglyConnectedComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  function connect(node: string): void {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of [...(graph.get(node) ?? [])].sort()) {
      if (!indexes.has(target)) {
        connect(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indexes.get(target) ?? 0));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    component.sort();
    if (component.length > 1 || (graph.get(node)?.has(node) ?? false)) cycles.push(component);
  }

  for (const node of [...graph.keys()].sort()) {
    if (!indexes.has(node)) connect(node);
  }
  return cycles.sort(([left], [right]) => (left ?? "").localeCompare(right ?? ""));
}

export function checkArchitecture(project: ArchitectureProject): ArchitectureResult {
  const files = new Map([...project.files].map(([path, text]) => [normalized(path), text]));
  const configuredWorkspaces: readonly Workspace[] = workspaceCatalog;
  const repository = (project.repositoryFiles ?? [...files.keys()])
    .map(normalized)
    .filter((path) => files.has(path))
    .sort();
  const directories = new Set([...(project.directories ?? [])].map(normalized));
  for (const path of files.keys()) {
    let directory = posix.dirname(path);
    while (directory !== ".") {
      directories.add(directory);
      directory = posix.dirname(directory);
    }
  }
  const projectDirectories = new Set(
    [...(project.projectDirectories ?? [])].map(
      (path) => `${normalized(path).replace(/\/$/, "")}/`,
    ),
  );
  const failures: string[] = [];
  const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}") as Partial<TsConfig>;
  const pathAliases = tsconfig.compilerOptions?.paths ?? {};
  const workspaceSurfaces: WorkspaceSurface[] = [];
  for (const workspace of configuredWorkspaces) {
    const manifestSource = files.get(workspace.packageManifest);
    if (manifestSource === undefined) continue;
    const packageJson = JSON.parse(manifestSource) as Partial<PackageJson>;
    const packageExports = packageJson.exports ?? {};
    const publicSubpaths = new Set<string>();
    const sourceDirectory = workspaceRepositoryPath(workspace, workspace.sourceDirectory);

    for (const [key, value] of Object.entries(packageExports)) {
      const match = /^\.\/([a-z0-9-]+)$/.exec(key);
      if (match === null) {
        failures.push(`${key}: package export is not a supported one-level public subpath`);
        continue;
      }
      const subpath = match[1] ?? "";
      publicSubpaths.add(subpath);
      const expectedTypes = `./dist/${subpath}/index.d.ts`;
      const expectedImport = `./dist/${subpath}/index.js`;
      if (
        typeof value !== "object" ||
        value === null ||
        (value as Record<string, unknown>).types !== expectedTypes ||
        (value as Record<string, unknown>).import !== expectedImport
      ) {
        failures.push(
          `${key}: package export must map types to ${expectedTypes} and import to ${expectedImport}`,
        );
      }
      const sourceEntrypoint = `${sourceDirectory}/${subpath}/index.ts`;
      if (!files.has(sourceEntrypoint)) {
        failures.push(`${key}: package export has no source entrypoint at ${sourceEntrypoint}`);
      }
    }

    for (const path of files.keys()) {
      const match = new RegExp(`^${escapeRegExp(sourceDirectory)}/([^/]+)/index\\.ts$`).exec(path);
      const subpath = match?.[1];
      if (
        subpath !== undefined &&
        !workspace.internalSourceDirectories.includes(subpath) &&
        !publicSubpaths.has(subpath)
      ) {
        failures.push(`${path}: public source entrypoint has no matching package export`);
      }
    }
    workspaceSurfaces.push({ workspace, publicSubpaths });
  }
  const coreSurface = workspaceSurfaces.find(({ workspace }) => workspace.id === "core");
  const workspaceSurfacesById = new Map(
    workspaceSurfaces.map((surface) => [surface.workspace.id, surface]),
  );
  const publicSubpaths = coreSurface?.publicSubpaths ?? new Set<string>();

  function modulePath(path: string): string | undefined {
    const candidate = normalized(path);
    const candidates = [candidate, `${candidate}.ts`, `${candidate}/index.ts`];
    if (candidate.endsWith(".js")) candidates.splice(1, 0, `${candidate.slice(0, -3)}.ts`);
    return candidates.find((possible) => files.has(possible));
  }

  const aliases = Object.entries(pathAliases).sort(
    ([left], [right]) => right.replace("*", "").length - left.replace("*", "").length,
  );
  function aliasPath(specifier: string): string | undefined {
    for (const [alias, targets] of aliases) {
      const star = alias.indexOf("*");
      const prefix = star === -1 ? alias : alias.slice(0, star);
      const suffix = star === -1 ? "" : alias.slice(star + 1);
      if (
        (star === -1 && specifier !== alias) ||
        (star !== -1 && (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)))
      ) {
        continue;
      }
      const capture =
        star === -1 ? "" : specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets) {
        const resolved = modulePath(target.replace("*", capture));
        if (resolved !== undefined) return resolved;
      }
    }
    return undefined;
  }

  function targetOf(source: string, specifier: string): string | undefined {
    if (specifier.startsWith(".")) {
      return modulePath(posix.join(posix.dirname(source), specifier));
    }
    return aliasPath(specifier);
  }

  const dependencyCache = new Map<string, SourceDependency[]>();
  function sourceDependencies(path: string): SourceDependency[] {
    const cached = dependencyCache.get(path);
    if (cached !== undefined) return cached;
    const source = sourceFile(path, files.get(path) ?? "");
    const found: SourceDependency[] = [];
    function add(specifier: ts.Expression | undefined, typeOnly: boolean): void {
      if (specifier === undefined || !ts.isStringLiteral(specifier)) return;
      found.push({ specifier: specifier.text, target: targetOf(path, specifier.text), typeOnly });
    }
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node)) {
        add(node.moduleSpecifier, importDeclarationIsTypeOnly(node));
      } else if (ts.isExportDeclaration(node)) {
        add(node.moduleSpecifier, exportDeclarationIsTypeOnly(node));
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        add(node.moduleReference.expression, node.isTypeOnly);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        add(node.argument.literal, true);
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        add(node.arguments[0], false);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    dependencyCache.set(path, found);
    return found;
  }

  for (const directory of unsupportedTopLevelDirectories) {
    if (directories.has(directory)) {
      failures.push(`${directory}/: unsupported top-level directories must be deleted`);
    }
  }

  for (const sourcePath of filesBelow(files, "tests")) {
    const parts = posix.relative("tests", sourcePath).split("/");
    const unsupportedDirectory = parts.find((part) => unsupportedTestDirectories.has(part));
    if (unsupportedDirectory !== undefined) {
      failures.push(
        `${sourcePath}: tests may not live in the unsupported ${unsupportedDirectory} directory`,
      );
    }
  }
  for (const directory of unsupportedTestDirectories) {
    if (directories.has(`tests/${directory}`)) {
      failures.push(`tests/${directory}/: unsupported test directories must be deleted`);
    }
  }
  for (const area of unsupportedBoundaryAreas) {
    if (directories.has(`src/engine/boundary/${area}`)) {
      failures.push(`src/engine/boundary/${area}/: unsupported boundary areas must be deleted`);
    }
  }

  const shippedFiles = workspaceSurfaces.flatMap(({ workspace, publicSubpaths: subpaths }) => {
    const sourceDirectory = workspaceRepositoryPath(workspace, workspace.sourceDirectory);
    if (workspace.id !== "core") return filesBelow(files, sourceDirectory);
    return [
      ...filesBelow(files, `${sourceDirectory}/command`).filter(
        (path) => !path.startsWith(`${sourceDirectory}/command/scaffold/`),
      ),
      ...[...subpaths].flatMap((subpath) => filesBelow(files, `${sourceDirectory}/${subpath}`)),
      ...filesBelow(files, `${sourceDirectory}/engine`),
    ];
  });
  const uniqueShippedFiles = [...new Set(shippedFiles)].sort();
  for (const [alias, targets] of Object.entries(pathAliases)) {
    for (const target of targets) {
      const path = normalized(target);
      if (!target.includes("*") && !files.has(path) && !directories.has(path)) {
        failures.push(`${alias}: TypeScript path target does not exist (${target})`);
      }
    }
  }
  for (const sourcePath of uniqueShippedFiles) {
    const text = files.get(sourcePath) ?? "";
    if (/@deprecated\b/i.test(text)) {
      failures.push(`${sourcePath}: shipped source may not declare deprecated API`);
    }
    const source = sourceFile(sourcePath, text);
    const foundIdentifiers = new Set<string>();
    function visit(node: ts.Node): void {
      if (ts.isIdentifier(node) && eliminatedIdentifiers.has(node.text)) {
        foundIdentifiers.add(node.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const identifier of foundIdentifiers) {
      failures.push(`${sourcePath}: ${identifier} is an eliminated identifier`);
    }
    if (/\bSDK\b/.test(text)) {
      failures.push(`${sourcePath}: shipped source may not use the unsupported SDK label`);
    }
  }

  for (const { workspace, publicSubpaths: workspacePublicSubpaths } of workspaceSurfaces) {
    const sourceDirectory = workspaceRepositoryPath(workspace, workspace.sourceDirectory);
    const publicEntrypoints = new Set(
      [...workspacePublicSubpaths].map((subpath) => `${sourceDirectory}/${subpath}/index.ts`),
    );
    for (const subpath of workspacePublicSubpaths) {
      const directory = `${sourceDirectory}/${subpath}`;
      const paths = filesBelow(files, directory);
      if (
        workspace.publicSubpathContainsOnlyEntrypoint &&
        paths.some((path) => posix.relative(directory, path) !== "index.ts")
      ) {
        failures.push(`${subpath}: a public package subpath may contain only index.ts`);
      }
      const index = `${directory}/index.ts`;
      const text = files.get(index);
      if (text === undefined) continue;
      const source = sourceFile(index, text);
      for (const statement of source.statements) {
        if (!ts.isExportDeclaration(statement)) {
          failures.push(
            `${index}:${source.getLineAndCharacterOfPosition(statement.pos).line + 1}: public entrypoints contain exports only`,
          );
          continue;
        }
        const specifier = statement.moduleSpecifier;
        if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
        const target = targetOf(index, specifier.text);
        if (target !== undefined && publicEntrypoints.has(target)) {
          failures.push(
            `${index}: a public entrypoint may not import or re-export another public entrypoint (${specifier.text})`,
          );
        }
      }
    }
  }

  function checkEngineTargetSpelling(sourcePath: string, dependency: SourceDependency): void {
    const target = dependency.target;
    if (target === undefined || engineConcern(target) === undefined) return;
    const specifier = dependency.specifier;
    if (specifier.startsWith("@engine/") && specifier.endsWith(".ts")) {
      failures.push(`${sourcePath}: @engine imports must omit the .ts extension (${specifier})`);
    }
    const owner = engineConcern(sourcePath);
    if (owner === undefined) {
      if (!specifier.startsWith("@engine/")) {
        failures.push(`${sourcePath}: imports of engine modules must use @engine (${specifier})`);
      }
      return;
    }
    const targetConcern = engineConcern(target);
    if (targetConcern === owner) {
      if (!specifier.startsWith(".")) {
        failures.push(
          `${sourcePath}: imports within the ${owner} concern must be relative (${specifier})`,
        );
      } else if (!specifier.endsWith(".ts")) {
        failures.push(
          `${sourcePath}: relative engine imports must include the .ts extension (${specifier})`,
        );
      }
    } else if (!specifier.startsWith("@engine/")) {
      failures.push(
        `${sourcePath}: imports crossing engine concerns must use @engine (${specifier})`,
      );
    }
  }

  for (const sourcePath of uniqueShippedFiles) {
    if (
      engineConcern(sourcePath) === undefined &&
      !sourcePath.startsWith("src/command/") &&
      !publicSubpaths.has(top(sourcePath))
    ) {
      continue;
    }
    for (const dependency of sourceDependencies(sourcePath)) {
      checkEngineTargetSpelling(sourcePath, dependency);
    }
  }

  const coreSourceDirectory = `${workspaceRepositoryPath(
    workspaceById("core"),
    workspaceById("core").sourceDirectory,
  )}/engine/`;
  for (const { workspace } of workspaceSurfaces) {
    if (workspace.id === "core") continue;
    const sourceDirectory = workspaceRepositoryPath(workspace, workspace.sourceDirectory);
    for (const sourcePath of filesBelow(files, sourceDirectory)) {
      for (const dependency of sourceDependencies(sourcePath)) {
        const reachesCoreInternals =
          dependency.specifier.startsWith("@engine/") ||
          dependency.specifier === "src/engine" ||
          dependency.specifier.includes("/src/engine/") ||
          dependency.target?.startsWith(coreSourceDirectory) === true;
        if (reachesCoreInternals) {
          failures.push(
            `${sourcePath}: workspace packages may not import core internals (${dependency.specifier})`,
          );
          continue;
        }
        for (const peerId of workspace.peerWorkspaceIds) {
          const peer = workspaceById(peerId);
          if (
            dependency.specifier !== peer.packageName &&
            !dependency.specifier.startsWith(`${peer.packageName}/`)
          ) {
            continue;
          }
          const peerSurface = workspaceSurfacesById.get(peerId);
          const isPublic = [...(peerSurface?.publicSubpaths ?? [])].some(
            (subpath) => dependency.specifier === `${peer.packageName}/${subpath}`,
          );
          if (!isPublic) {
            failures.push(
              `${sourcePath}: ${workspace.id} may import only public ${peer.id} entrypoints (${dependency.specifier})`,
            );
          }
        }
      }
    }
  }

  for (const { workspace } of workspaceSurfaces) {
    if (workspace.forbiddenWorkspaceIds.length === 0) continue;
    const sourceDirectory = `${workspaceRepositoryPath(workspace, workspace.sourceDirectory)}/`;
    const workspaceSources = uniqueShippedFiles.filter((path) => path.startsWith(sourceDirectory));
    for (const sourcePath of workspaceSources) {
      for (const dependency of sourceDependencies(sourcePath)) {
        for (const forbiddenId of workspace.forbiddenWorkspaceIds) {
          const forbidden = workspaceById(forbiddenId);
          const forbiddenSourceDirectory = `${workspaceRepositoryPath(
            forbidden,
            forbidden.sourceDirectory,
          )}/`;
          if (
            dependency.specifier === forbidden.packageName ||
            dependency.specifier.startsWith(`${forbidden.packageName}/`) ||
            dependency.target?.startsWith(forbiddenSourceDirectory)
          ) {
            failures.push(
              `${sourcePath}: ${workspace.id} may not depend on ${forbidden.id} (${dependency.specifier})`,
            );
          }
        }
      }
    }
  }

  for (const sourcePath of filesBelow(files, engineRoot)) {
    if (sourcePath.endsWith("/index.ts")) {
      failures.push(`${sourcePath}: engine index barrels are forbidden`);
    }
    const owner = engineConcern(sourcePath);
    for (const dependency of sourceDependencies(sourcePath)) {
      const specifier = dependency.specifier;
      const target = dependency.target;
      if (
        specifier.startsWith("@mit-sdg/sync-engine/") ||
        (target !== undefined && publicSubpaths.has(top(target)))
      ) {
        failures.push(
          `${sourcePath}: engine modules may not import public entrypoints (${specifier})`,
        );
        continue;
      }
      if (target === undefined) continue;
      const targetConcern = engineConcern(target);
      if (
        owner !== undefined &&
        targetConcern !== undefined &&
        dependencies.get(owner)?.has(targetConcern) !== true
      ) {
        failures.push(`${sourcePath}: ${owner} may not depend on ${targetConcern}`);
        continue;
      }

      const sourceReactionArea = nestedArea(sourcePath, "reactions", reactionAreas);
      const targetReactionArea = nestedArea(target, "reactions", reactionAreas);
      const isReactionBridge =
        sourceReactionArea === "root" && posix.basename(sourcePath) === "engine.ts";
      if (
        sourceReactionArea !== undefined &&
        targetReactionArea !== undefined &&
        !isReactionBridge &&
        reactionDependencies.get(sourceReactionArea)?.has(targetReactionArea) !== true
      ) {
        failures.push(
          `${sourcePath}: forbidden area dependency reactions/${sourceReactionArea} -> reactions/${targetReactionArea}`,
        );
      } else if (owner === "reads" && targetReactionArea === "runtime") {
        failures.push(`${sourcePath}: forbidden area dependency reads -> reactions/runtime`);
      }

      const sourceBoundaryArea = nestedArea(sourcePath, "boundary", boundaryAreas);
      const targetBoundaryArea = nestedArea(target, "boundary", boundaryAreas);
      if (
        sourceBoundaryArea !== undefined &&
        targetBoundaryArea !== undefined &&
        boundaryDependencies.get(sourceBoundaryArea)?.has(targetBoundaryArea) !== true
      ) {
        failures.push(
          `${sourcePath}: forbidden area dependency boundary/${sourceBoundaryArea} -> boundary/${targetBoundaryArea}`,
        );
      }
    }
  }

  function projectDirectoryOf(path: string): string | undefined {
    return [...projectDirectories].find((directory) => path.startsWith(directory));
  }

  function isRequiredWorkspaceFile(path: string): boolean {
    return workspaceCatalog.some((workspace) => {
      const workspaceRelative =
        workspace.directory === "."
          ? path
          : path.startsWith(`${workspace.directory}/`)
            ? path.slice(workspace.directory.length + 1)
            : undefined;
      return (
        workspaceRelative !== undefined &&
        (workspace.requiredPackedFiles as readonly string[]).includes(workspaceRelative)
      );
    });
  }

  const hashes = new Map<string, string>();
  for (const path of repository) {
    const parts = path.split("/");
    const [head] = parts;
    const content = files.get(path) ?? "";
    if (content.length === 0) failures.push(`${path}: repository files may not be empty`);
    const hash = createHash("sha256").update(content).digest("hex");
    const duplicate = hashes.get(hash);
    const isCopiedPackageArtifact =
      duplicate !== undefined &&
      posix.basename(path) === posix.basename(duplicate) &&
      isRequiredWorkspaceFile(path) &&
      isRequiredWorkspaceFile(duplicate);
    if (
      duplicate !== undefined &&
      !isCopiedPackageArtifact &&
      (projectDirectoryOf(path) === undefined ||
        projectDirectoryOf(duplicate) === undefined ||
        projectDirectoryOf(path) === projectDirectoryOf(duplicate))
    ) {
      failures.push(`${path}: exact duplicate of ${duplicate}`);
    } else {
      hashes.set(hash, path);
    }

    const workspace = workspaceCatalog.find(
      (candidate) =>
        candidate.directory !== "." &&
        (path === candidate.directory || path.startsWith(`${candidate.directory}/`)),
    );
    const workspaceRelative =
      workspace === undefined ? undefined : posix.relative(workspace.directory, path);
    const knownWorkspaceFile =
      workspace !== undefined &&
      workspaceRelative !== undefined &&
      (workspace.declarationSnapshot === path ||
        (workspace.requiredPackedFiles as readonly string[]).includes(workspaceRelative) ||
        ["tsconfig.json", "tsconfig.build.json"].includes(workspaceRelative) ||
        (workspaceRelative.startsWith("src/") && workspaceRelative.endsWith(".ts")) ||
        (workspaceRelative.startsWith("tests/") && workspaceRelative.endsWith(".ts")));
    const known =
      (parts.length === 1 && allowedRootFiles.has(path)) ||
      (head === ".github" &&
        ((parts[1] === "workflows" && parts.length === 3) ||
          path === ".github/CODEOWNERS" ||
          path === ".github/dependabot.yml")) ||
      (head === "src" &&
        ((parts[1] === "command" &&
          ((parts.length === 3 && path.endsWith(".ts")) ||
            (parts.length >= 3 && parts[2] === "scaffold"))) ||
          (publicSubpaths.has(parts[1] ?? "") && parts.length === 3 && parts[2] === "index.ts") ||
          (parts[1] === "engine" && path.endsWith(".ts")))) ||
      (head === "docs" && (path.endsWith(".md") || path === "docs/llms.txt")) ||
      (head === "examples" &&
        (path.endsWith(".md") || path.endsWith(".ts") || path.endsWith(".json"))) ||
      (head === "scripts" && parts.length === 2 && path.endsWith(".ts")) ||
      (head === "tests" &&
        ((parts.length === 2 && parts[1] === "public-api.test.ts") ||
          (parts.length >= 3 && allowedTestDirectories.has(parts[1] ?? "")))) ||
      knownWorkspaceFile;
    if (!known)
      failures.push(`${path}: file is outside the supported top-level and test directories`);
  }

  for (const path of repository.filter((candidate) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(candidate),
  )) {
    const source = files.get(path) ?? "";
    for (const { use, reference } of externalWorkflowActions(source)) {
      if (!/^[0-9a-fA-F]{40}$/.test(reference)) {
        failures.push(`${path}: external action ${use} must use an exact 40-hex SHA`);
      }
    }
  }

  for (const path of repository.filter((candidate) => candidate.includes("/generated/"))) {
    const source = files.get(path) ?? "";
    if (!/generated/i.test(source) || !/do not edit/i.test(source)) {
      failures.push(`${path}: generated material must name its provenance and say not to edit it`);
    }
    const example = path.split("/").slice(0, 2).join("/");
    if (!repository.includes(`${example}/generated.config.ts`)) {
      failures.push(`${path}: generated material has no owning generated.config.ts`);
    }
  }

  const shippedSources = new Set(uniqueShippedFiles);
  const configuredInternalEntrypoints = Object.entries(pathAliases)
    .filter(([alias]) => alias.startsWith("@sync-engine/internal/") && !alias.includes("*"))
    .flatMap(([, targets]) => targets)
    .map((target) => modulePath(target))
    .filter((path): path is string => path !== undefined);
  const internalEntrypoints = configuredInternalEntrypoints.flatMap((path) =>
    shippedSources.has(path)
      ? [path]
      : sourceDependencies(path)
          .map(({ target }) => target)
          .filter((target): target is string => target !== undefined && shippedSources.has(target)),
  );
  const entrypoints = [
    ...workspaceSurfaces.flatMap(({ workspace, publicSubpaths: subpaths }) => {
      const sourceDirectory = workspaceRepositoryPath(workspace, workspace.sourceDirectory);
      return [...subpaths].map((subpath) => `${sourceDirectory}/${subpath}/index.ts`);
    }),
    ...internalEntrypoints,
    "src/command/main.ts",
  ];
  const reachable = new Set<string>();
  const pending = entrypoints.filter((path) => shippedSources.has(path));
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || reachable.has(path)) continue;
    reachable.add(path);
    for (const { target } of sourceDependencies(path)) {
      if (target !== undefined && shippedSources.has(target) && !reachable.has(target)) {
        pending.push(target);
      }
    }
  }
  for (const path of shippedSources) {
    if (!reachable.has(path)) {
      failures.push(`${path}: shipped source is unreachable`);
    }
  }

  const runtimeGraph = new Map<string, Set<string>>();
  const runtimeFiles = uniqueShippedFiles;
  const runtimeFileSet = new Set(runtimeFiles);
  for (const path of runtimeFiles) {
    runtimeGraph.set(
      path,
      new Set(
        sourceDependencies(path)
          .filter(
            ({ target, typeOnly }) =>
              !typeOnly && target !== undefined && runtimeFileSet.has(target),
          )
          .map(({ target }) => target as string),
      ),
    );
  }

  const runtimeCycles = stronglyConnectedComponents(runtimeGraph);
  for (const cycle of runtimeCycles) {
    failures.push(`runtime import cycle: ${cycle.join(", ")}`);
  }

  return { failures, runtimeCycles };
}
