import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceBuildOrder } from "./workspaces.ts";

type PackageManifest = {
  name?: unknown;
  version?: unknown;
  peerDependencies?: Record<string, unknown>;
};

const root = resolve(import.meta.dirname, "..");
const publishedWorkspaces = workspaceBuildOrder.filter(
  (workspace) => workspace.publication === "npm",
);

function fail(message: string): never {
  throw new Error(`Release source check failed: ${message}`);
}

function manifest(path: string): PackageManifest {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(root, path), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail(`${path} must contain a package object`);
    }
    return parsed as PackageManifest;
  } catch (error) {
    return fail(
      `${path} cannot be read (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return fail(`git ${args.join(" ")} failed`);
  }
}

const core = manifest("package.json");
const version = typeof core.version === "string" ? core.version : undefined;
const beta = /^1\.0\.0-beta\.(0|[1-9]\d*)$/.exec(version ?? "");
if (beta === null || !Number.isSafeInteger(Number(beta[1]))) {
  fail("package.json version must be a canonical 1.0.0-beta.N version");
}
const refName = process.env.GITHUB_REF_NAME;
if (refName !== `v${version}`) fail(`expected tag v${version}; received ${String(refName)}`);
const sha = process.env.GITHUB_SHA;
if (sha === undefined || git(["rev-parse", "HEAD"]) !== sha) {
  fail("checked-out commit must equal GITHUB_SHA");
}

for (const workspace of publishedWorkspaces) {
  const packed = manifest(workspace.packageManifest);
  if (packed.name !== workspace.packageName || packed.version !== version) {
    fail(`${workspace.packageManifest} must name ${workspace.packageName} at ${version}`);
  }
  for (const peerId of workspace.peerWorkspaceIds) {
    const peer = publishedWorkspaces.find((candidate) => candidate.id === peerId);
    if (peer === undefined || packed.peerDependencies?.[peer.packageName] !== version) {
      fail(
        `${workspace.packageManifest} must peer-depend on ${peer?.packageName ?? peerId}@${version}`,
      );
    }
  }
}

git(["fetch", "--force", "--no-tags", "origin", `refs/tags/${refName}:refs/tags/${refName}`]);
if (git(["cat-file", "-t", `refs/tags/${refName}`]) !== "tag") fail(`${refName} must be annotated`);
if (git(["rev-parse", `refs/tags/${refName}^{}`]) !== sha)
  fail(`${refName} must resolve to GITHUB_SHA`);
git(["fetch", "--no-tags", "origin", "main"]);
git(["merge-base", "--is-ancestor", sha, "origin/main"]);

const artifactDirectory = process.argv[2];
if (artifactDirectory !== undefined) {
  const directory = resolve(root, artifactDirectory);
  let entries: string[];
  try {
    entries = readdirSync(directory).sort();
  } catch (error) {
    fail(`cannot read artifact directory ${artifactDirectory} (${String(error)})`);
  }
  const expected = publishedWorkspaces
    .flatMap((workspace) => [workspace.verifiedTarball, `${workspace.verifiedTarball}.sha256`])
    .sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    fail(
      `artifact directory ${artifactDirectory} must contain exactly the verified tarballs and checksums`,
    );
  }
  for (const entry of expected) {
    if (!statSync(resolve(directory, entry)).isFile()) fail(`${entry} must be a file`);
  }
  for (const workspace of publishedWorkspaces) {
    const tarball = resolve(directory, workspace.verifiedTarball);
    const checksumPath = resolve(directory, `${workspace.verifiedTarball}.sha256`);
    const checksum = readFileSync(checksumPath, "utf8");
    if (
      !/^[a-f0-9]{64}  .+\n$/.test(checksum) ||
      checksum.slice(66, -1) !== `${artifactDirectory}/${workspace.verifiedTarball}`
    ) {
      fail(
        `${workspace.verifiedTarball}.sha256 must checksum ${artifactDirectory}/${workspace.verifiedTarball}`,
      );
    }
    try {
      execFileSync("sha256sum", ["--check", checksumPath], {
        cwd: root,
        stdio: "inherit",
      });
      const packed = JSON.parse(
        execFileSync("tar", ["-xOzf", tarball, "package/package.json"], { encoding: "utf8" }),
      ) as PackageManifest;
      if (packed.name !== workspace.packageName || packed.version !== version) {
        fail(`${workspace.verifiedTarball} identity does not match the validated manifest`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Release source check failed:"))
        throw error;
      fail(
        `cannot verify ${workspace.verifiedTarball} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
}
