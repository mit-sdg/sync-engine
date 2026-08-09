import { resolve } from "node:path";

export interface Workspace {
  readonly id: string;
  readonly packageName: string;
  readonly directory: string;
  readonly packageManifest: string;
  readonly sourceDirectory: string;
  readonly distDirectory: string;
  readonly buildConfig: string;
  readonly declarationSnapshot?: string;
  readonly verifiedTarball: string;
  readonly buildAfter: readonly string[];
  readonly peerWorkspaceIds: readonly string[];
  readonly rootRuntimeDependencies: readonly string[];
  readonly forbiddenWorkspaceIds: readonly string[];
  readonly internalSourceDirectories: readonly string[];
  /** Shipped runtime roots reached by URL/process launch rather than static imports. */
  readonly runtimeEntrypoints: readonly string[];
  readonly publicSubpathContainsOnlyEntrypoint: boolean;
  readonly copiesExamples: boolean;
  readonly publication: "npm" | "private";
  readonly requiredPackedFiles: readonly string[];
  readonly packageBudget: Readonly<{ files: number; packedBytes: number; unpackedBytes: number }>;
  readonly assets?: readonly Readonly<{ source: string; destination: string }>[];
  readonly bins?: Readonly<Record<string, string>>;
}

export const workspaceCatalog = [
  {
    id: "core",
    packageName: "@mit-sdg/sync-engine",
    directory: ".",
    packageManifest: "package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: "tests/package/declarations.snapshot.txt",
    verifiedTarball: "package.tgz",
    buildAfter: [],
    peerWorkspaceIds: [],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["http", "analysis"],
    internalSourceDirectories: ["command", "engine"],
    runtimeEntrypoints: [],
    publicSubpathContainsOnlyEntrypoint: true,
    copiesExamples: true,
    publication: "npm",
    requiredPackedFiles: [
      "LICENSE",
      "NOTICE",
      "README.md",
      "SECURITY.md",
      "SUPPORT.md",
      "package.json",
    ],
    packageBudget: { files: 420, packedBytes: 500_000, unpackedBytes: 1_500_000 },
    bins: { "sync-engine": "dist/command/main.js" },
  },
  {
    id: "catalog",
    packageName: "@mit-sdg/catalog",
    directory: "packages/catalog",
    packageManifest: "packages/catalog/package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    verifiedTarball: "catalog-package.tgz",
    buildAfter: [],
    peerWorkspaceIds: ["core"],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["http", "analysis"],
    internalSourceDirectories: [],
    runtimeEntrypoints: ["command.ts"],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: [
      "CONTRIBUTING.md",
      "LICENSE",
      "NOTICE",
      "README.md",
      "public-surface.md",
      "package.json",
      "dist/command.js",
      "dist/entries/index.json",
    ],
    packageBudget: { files: 100, packedBytes: 180_000, unpackedBytes: 700_000 },
    assets: [{ source: "entries", destination: "dist/entries" }],
    bins: { catalog: "dist/command.js" },
  },
  {
    id: "http",
    packageName: "@mit-sdg/sync-engine-http",
    directory: "packages/http",
    packageManifest: "packages/http/package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: "packages/http/tests/declarations.snapshot.txt",
    verifiedTarball: "http-package.tgz",
    buildAfter: ["core"],
    peerWorkspaceIds: ["core"],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["analysis"],
    internalSourceDirectories: [],
    runtimeEntrypoints: [],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: ["LICENSE", "NOTICE", "README.md", "public-surface.md", "package.json"],
    packageBudget: { files: 80, packedBytes: 150_000, unpackedBytes: 600_000 },
  },
  {
    id: "analysis",
    packageName: "@mit-sdg/sync-engine-analysis",
    directory: "packages/analysis",
    packageManifest: "packages/analysis/package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: "packages/analysis/tests/declarations.snapshot.txt",
    verifiedTarball: "analysis-package.tgz",
    buildAfter: ["core"],
    peerWorkspaceIds: ["core"],
    rootRuntimeDependencies: ["typescript"],
    forbiddenWorkspaceIds: ["http"],
    internalSourceDirectories: [],
    runtimeEntrypoints: ["project/application-project-worker.ts"],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: [
      "LICENSE",
      "NOTICE",
      "README.md",
      "public-surface.md",
      "package.json",
      "dist/project/application-project-worker.js",
    ],
    packageBudget: { files: 40, packedBytes: 78_000, unpackedBytes: 380_000 },
  },
] as const satisfies readonly Workspace[];

export function workspaceById(id: string): Workspace {
  const workspace = workspaceCatalog.find((candidate) => candidate.id === id);
  if (workspace === undefined) throw new Error(`Unknown workspace: ${id}`);
  return workspace;
}

function orderWorkspaces(workspaces: readonly Workspace[]): Workspace[] {
  const ordered: Workspace[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(workspace: Workspace): void {
    if (visited.has(workspace.id)) return;
    if (visiting.has(workspace.id)) {
      throw new Error(`Workspace build dependencies contain a cycle at ${workspace.id}`);
    }
    visiting.add(workspace.id);
    for (const dependency of workspace.buildAfter) visit(workspaceById(dependency));
    visiting.delete(workspace.id);
    visited.add(workspace.id);
    ordered.push(workspace);
  }

  for (const workspace of workspaces) visit(workspace);
  return ordered;
}

export const workspaceBuildOrder = orderWorkspaces(workspaceCatalog);

export function workspacePath(root: string, workspace: Workspace, path = ""): string {
  return resolve(root, workspace.directory, path);
}

export function workspaceRepositoryPath(workspace: Workspace, path = ""): string {
  return [workspace.directory, path].filter((part) => part !== "" && part !== ".").join("/");
}
