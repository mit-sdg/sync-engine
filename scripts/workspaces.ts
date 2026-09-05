import { resolve } from "node:path";

export interface Workspace {
  readonly id: string;
  readonly packageName: string;
  readonly directory: string;
  readonly packageManifest: string;
  readonly sourceDirectory: string;
  readonly distDirectory: string;
  readonly buildConfig?: string;
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
  readonly assets: readonly Readonly<{
    source: string;
    destination: string;
    exclude?: readonly string[];
  }>[];
  readonly bins: readonly string[];
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
    declarationSnapshot: "tests/packaging/declarations.snapshot.txt",
    verifiedTarball: "package.tgz",
    buildAfter: ["ssf"],
    peerWorkspaceIds: [],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["http", "analysis", "catalog", "skill"],
    internalSourceDirectories: ["command", "engine"],
    runtimeEntrypoints: ["command/main.ts"],
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
    packageBudget: { files: 470, packedBytes: 560_000, unpackedBytes: 1_920_000 },
    assets: [
      { source: "src/command/setup", destination: "dist/command/setup" },
      {
        source: "packages/ssf/dist",
        destination: "dist/engine/tooling/ssf-package",
      },
    ],
    bins: ["dist/command/main.js"],
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
    forbiddenWorkspaceIds: ["http", "catalog", "skill", "ssf"],
    internalSourceDirectories: [],
    runtimeEntrypoints: ["command.ts", "project/application-project-worker.ts"],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: [
      "LICENSE",
      "NOTICE",
      "README.md",
      "public-surface.md",
      "package.json",
      "dist/command.js",
      "dist/project/application-project-worker.js",
    ],
    packageBudget: { files: 46, packedBytes: 90_000, unpackedBytes: 420_000 },
    assets: [],
    bins: ["dist/command.js"],
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
    forbiddenWorkspaceIds: ["analysis", "catalog", "skill", "ssf"],
    internalSourceDirectories: [],
    runtimeEntrypoints: [],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: ["LICENSE", "NOTICE", "README.md", "public-surface.md", "package.json"],
    packageBudget: { files: 80, packedBytes: 150_000, unpackedBytes: 600_000 },
    assets: [],
    bins: [],
  },
  {
    id: "catalog",
    packageName: "@mit-sdg/sync-engine-catalog",
    directory: "packages/catalog",
    packageManifest: "packages/catalog/package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: undefined,
    verifiedTarball: "catalog-package.tgz",
    buildAfter: [],
    peerWorkspaceIds: [],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["analysis", "http", "skill", "ssf"],
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
    packageBudget: { files: 220, packedBytes: 500_000, unpackedBytes: 2_000_000 },
    assets: [{ source: "entries", destination: "dist/entries", exclude: ["_typecheck"] }],
    bins: ["dist/command.js"],
  },
  {
    id: "skill",
    packageName: "@mit-sdg/sync-engine-skill",
    directory: "packages/skill",
    packageManifest: "packages/skill/package.json",
    sourceDirectory: "skills/sync-engine/scripts",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: undefined,
    verifiedTarball: "skill-package.tgz",
    buildAfter: ["core", "analysis", "catalog"],
    peerWorkspaceIds: [],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["http", "ssf"],
    internalSourceDirectories: [],
    runtimeEntrypoints: ["command.ts"],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "npm",
    requiredPackedFiles: [
      "LICENSE",
      "NOTICE",
      "README.md",
      "package.json",
      "dist/adapters/antigravity.js",
      "dist/adapters/claude-code.js",
      "dist/adapters/codex.js",
      "dist/adapters/cursor.js",
      "dist/adapters/paseo.js",
      "dist/adapters/pi.js",
      "dist/bootstrap.js",
      "dist/command.js",
      "dist/harness.js",
      "dist/prompt.js",
      "dist/records.js",
      "dist/roles.js",
      "dist/work.js",
      "skills/sync-engine/SKILL.md",
      "skills/sync-engine/prompts/brief.md",
      "skills/sync-engine/prompts/guidance/api/application-example.md",
      "skills/sync-engine/prompts/guidance/api/composition.md",
      "skills/sync-engine/prompts/guidance/api/http-client.md",
      "skills/sync-engine/prompts/guidance/api/http-host.md",
      "skills/sync-engine/prompts/guidance/catalog.md",
      "skills/sync-engine/prompts/guidance/design/authored-format.md",
      "skills/sync-engine/prompts/guidance/design/boundary.md",
      "skills/sync-engine/prompts/guidance/design/contracts.md",
      "skills/sync-engine/prompts/guidance/design/decomposition.md",
      "skills/sync-engine/prompts/guidance/design/ssf-reading.md",
      "skills/sync-engine/prompts/guidance/design/ssf.md",
      "skills/sync-engine/prompts/guidance/implementation/application.md",
      "skills/sync-engine/prompts/guidance/implementation/concepts.md",
      "skills/sync-engine/prompts/guidance/implementation/evidence.md",
      "skills/sync-engine/prompts/guidance/implementation/framework-safety.md",
      "skills/sync-engine/prompts/guidance/implementation/frontend.md",
      "skills/sync-engine/prompts/roles/application-worker.md",
      "skills/sync-engine/prompts/roles/concept-worker.md",
      "skills/sync-engine/prompts/roles/critic-contracts.md",
      "skills/sync-engine/prompts/roles/critic-decomposition.md",
      "skills/sync-engine/prompts/roles/critic-implementation.md",
      "skills/sync-engine/prompts/roles/critic-verification.md",
      "skills/sync-engine/prompts/roles/designer-contracts.md",
      "skills/sync-engine/prompts/roles/designer-decomposition.md",
      "skills/sync-engine/prompts/roles/evidence-worker.md",
      "skills/sync-engine/prompts/roles/frontend-worker.md",
      "skills/sync-engine/references/harnesses.md",
      "skills/sync-engine/references/workflow.md",
      "skills/sync-engine/release.json",
      "skills/sync-engine/scripts/adapters/antigravity.ts",
      "skills/sync-engine/scripts/adapters/claude-code.ts",
      "skills/sync-engine/scripts/adapters/codex.ts",
      "skills/sync-engine/scripts/adapters/cursor.ts",
      "skills/sync-engine/scripts/adapters/paseo.ts",
      "skills/sync-engine/scripts/adapters/pi.ts",
      "skills/sync-engine/scripts/bootstrap.ts",
      "skills/sync-engine/scripts/command.ts",
      "skills/sync-engine/scripts/harness.ts",
      "skills/sync-engine/scripts/prompt.ts",
      "skills/sync-engine/scripts/records.ts",
      "skills/sync-engine/scripts/roles.ts",
      "skills/sync-engine/scripts/work.ts",
    ],
    packageBudget: { files: 64, packedBytes: 140_000, unpackedBytes: 560_000 },
    assets: [],
    bins: ["dist/command.js"],
  },
  {
    id: "ssf",
    packageName: "@mit-sdg/sync-engine-ssf",
    directory: "packages/ssf",
    packageManifest: "packages/ssf/package.json",
    sourceDirectory: "src",
    distDirectory: "dist",
    buildConfig: "tsconfig.build.json",
    declarationSnapshot: undefined,
    verifiedTarball: "ssf-package.tgz",
    buildAfter: [],
    peerWorkspaceIds: [],
    rootRuntimeDependencies: [],
    forbiddenWorkspaceIds: ["core", "http", "analysis", "catalog", "skill"],
    internalSourceDirectories: [],
    runtimeEntrypoints: ["index.ts"],
    publicSubpathContainsOnlyEntrypoint: false,
    copiesExamples: false,
    publication: "private",
    requiredPackedFiles: ["README.md", "package.json", "dist/index.js", "dist/index.d.ts"],
    packageBudget: { files: 28, packedBytes: 30_000, unpackedBytes: 100_000 },
    assets: [],
    bins: [],
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
