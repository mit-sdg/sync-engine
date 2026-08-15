import { execFileSync } from "node:child_process";
import { chmod, cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesBelow } from "../src/command/files-below.ts";
import { workspaceBuildOrder, workspaceById, workspacePath, type Workspace } from "./workspaces.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function forbiddenPackageNames(workspace: Workspace): string[] {
  return workspace.forbiddenWorkspaceIds.map((id) => workspaceById(id).packageName);
}

function mentionsPackage(source: string, packageName: string): boolean {
  return source.includes(`"${packageName}`) || source.includes(`'${packageName}`);
}

async function rejectForbiddenWorkspaceImports(
  workspace: Workspace,
  directory: string,
  extensions: readonly string[],
): Promise<void> {
  const forbidden = forbiddenPackageNames(workspace);
  if (forbidden.length === 0) return;
  for (const path of await filesBelow(directory, (name) =>
    extensions.some((extension) => name.endsWith(extension)),
  )) {
    const source = await readFile(path, "utf8");
    const packageName = forbidden.find((candidate) => mentionsPackage(source, candidate));
    if (packageName !== undefined) {
      throw new Error(
        `${relative(root, path)} imports ${packageName}; ${workspace.id} may not depend on that workspace`,
      );
    }
  }
}

async function rewriteRepositoryAliases(workspace: Workspace): Promise<void> {
  const dist = workspacePath(root, workspace, workspace.distDirectory);
  for (const path of await filesBelow(
    dist,
    (name) => name.endsWith(".js") || name.endsWith(".d.ts"),
  )) {
    const source = await readFile(path, "utf8");
    const rewritten = source
      .replace(/(["'])@engine\/([^"']+)\1/g, (_match, quote: string, target: string) => {
        const emittedTarget = resolve(
          dist,
          "engine",
          `${target.replace(/\.ts$/, "")}${path.endsWith(".js") ? ".js" : ".ts"}`,
        );
        let specifier = relative(dirname(path), emittedTarget).split(sep).join("/");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      })
      .replace(/(["'])@root\/([^"']+)\1/g, (_match, quote: string, target: string) => {
        let specifier = relative(dirname(path), resolve(root, target)).split(sep).join("/");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        return `${quote}${specifier}${quote}`;
      });
    if (rewritten.includes("@engine/") || rewritten.includes("@root/")) {
      throw new Error(`build left an unresolved repository alias in ${relative(root, path)}`);
    }
    if (rewritten !== source) await writeFile(path, rewritten);
  }
}

async function buildWorkspace(workspace: Workspace): Promise<void> {
  if (workspace.buildConfig === undefined) return;
  const source = workspacePath(root, workspace, workspace.sourceDirectory);
  const dist = workspacePath(root, workspace, workspace.distDirectory);
  await rejectForbiddenWorkspaceImports(workspace, source, [".ts"]);
  await rm(dist, { recursive: true, force: true });
  execFileSync(
    "bun",
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "-p",
      workspacePath(root, workspace, workspace.buildConfig),
    ],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  await rewriteRepositoryAliases(workspace);
  await rejectForbiddenWorkspaceImports(workspace, dist, [".js", ".d.ts"]);

  for (const asset of workspace.assets) {
    const sourceAsset = workspacePath(root, workspace, asset.source);
    await cp(sourceAsset, workspacePath(root, workspace, asset.destination), {
      recursive: true,
      filter: (path) => {
        const entry = relative(sourceAsset, path).split(sep).join("/");
        return !(asset.exclude ?? []).some(
          (excluded) => entry === excluded || entry.startsWith(`${excluded}/`),
        );
      },
    });
  }
  for (const executable of workspace.bins)
    await chmod(workspacePath(root, workspace, executable), 0o755);
}

for (const workspace of workspaceBuildOrder) await buildWorkspace(workspace);
