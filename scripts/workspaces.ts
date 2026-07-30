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
  readonly tagPrefix: string;
  readonly verifiedTarball: string;
  readonly buildAfter: readonly string[];
  readonly peerWorkspaceIds: readonly string[];
  readonly forbiddenWorkspaceIds: readonly string[];
  readonly internalSourceDirectories: readonly string[];
  readonly publicSubpathContainsOnlyEntrypoint: boolean;
  readonly copiesExamples: boolean;
  readonly requiredPackedFiles: readonly string[];
  readonly packageBudget: Readonly<{ files: number; packedBytes: number; unpackedBytes: number }>;
  readonly scaffold?: Readonly<{ source: string; destination: string; executable: string }>;
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
    tagPrefix: "v",
    verifiedTarball: "package.tgz",
    buildAfter: [],
    peerWorkspaceIds: [],
    forbiddenWorkspaceIds: ["http"],
    internalSourceDirectories: ["command", "engine"],
    publicSubpathContainsOnlyEntrypoint: true,
    copiesExamples: true,
    requiredPackedFiles: [
      "LICENSE",
      "NOTICE",
      "README.md",
      "SECURITY.md",
      "SUPPORT.md",
      "package.json",
    ],
    packageBudget: { files: 420, packedBytes: 500_000, unpackedBytes: 1_500_000 },
    scaffold: {
      source: "src/command/scaffold",
      destination: "dist/command/scaffold",
      executable: "dist/command/main.js",
    },
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
    tagPrefix: "http-v",
    verifiedTarball: "http-package.tgz",
    buildAfter: ["core"],
    peerWorkspaceIds: ["core"],
    forbiddenWorkspaceIds: [],
    internalSourceDirectories: [],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    requiredPackedFiles: ["LICENSE", "NOTICE", "README.md", "package.json"],
    packageBudget: { files: 80, packedBytes: 150_000, unpackedBytes: 600_000 },
  },
] as const satisfies readonly Workspace[];

export type WorkspaceId = (typeof workspaceCatalog)[number]["id"];

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

export function workspaceReleaseTag(workspace: Workspace, version: string): string {
  return `${workspace.tagPrefix}${version}`;
}
