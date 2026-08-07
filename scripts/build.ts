import { execFileSync } from "node:child_process";
import { chmod, cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesBelow } from "../src/command/files-below.ts";
import { writeGuidanceResource } from "./guidance.ts";
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

async function rewriteCoreAliases(workspace: Workspace): Promise<void> {
  if (workspace.scaffold === undefined) return;
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
  const source = workspacePath(root, workspace, workspace.sourceDirectory);
  const dist = workspacePath(root, workspace, workspace.distDirectory);
  const guidanceResource =
    workspace.id === "analysis" ? resolve(source, "guidance/guidance-resource.json") : undefined;
  if (guidanceResource !== undefined) await writeGuidanceResource(root, guidanceResource);
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
  await rewriteCoreAliases(workspace);
  await rejectForbiddenWorkspaceImports(workspace, dist, [".js", ".d.ts"]);
  if (guidanceResource !== undefined) {
    await cp(guidanceResource, resolve(dist, "guidance/guidance-resource.json"));
  }

  if (workspace.scaffold !== undefined) {
    await cp(
      resolve(root, workspace.scaffold.source),
      resolve(root, workspace.scaffold.destination),
      {
        recursive: true,
      },
    );
    await chmod(resolve(root, workspace.scaffold.executable), 0o755);
  }
}

for (const workspace of workspaceBuildOrder) await buildWorkspace(workspace);
