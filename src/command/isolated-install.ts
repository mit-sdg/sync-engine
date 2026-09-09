import { spawn } from "node:child_process";
import { cp, lstat, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Stage a fresh project outside its workspace, preserving trusted user configuration. */
export async function stageProject<T>(
  root: string,
  prepare: (stage: string) => Promise<T>,
): Promise<T> {
  const stage = await mkdtemp(join(tmpdir(), "sync-engine-setup-"));
  try {
    // Bun discovers ancestor workspaces even if this package declares workspaces: [].
    for (let parent = dirname(stage); ; parent = dirname(parent)) {
      for (const name of ["package.json", "bunfig.toml", ".npmrc"]) {
        try {
          await lstat(join(parent, name));
          throw new Error(`Unsafe setup staging ancestor: ${join(parent, name)}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      if (parent === dirname(parent)) break;
    }
    const result = await prepare(stage);
    if ((await readdir(root)).length !== 0) throw new Error("Setup destination is no longer empty");
    // Copy once across filesystems. Keep the destination directory itself (it may be cwd).
    const transfer = await mkdtemp(join(root, ".sync-engine-setup-"));
    const published: string[] = [];
    try {
      const names = await readdir(stage);
      for (const name of names) {
        await cp(join(stage, name), join(transfer, name), {
          recursive: true,
          verbatimSymlinks: true,
        });
      }
      for (const name of names) {
        await rename(join(transfer, name), join(root, name));
        published.push(name);
      }
    } catch (error) {
      for (const name of published.reverse())
        await rm(join(root, name), { recursive: true, force: true });
      throw error;
    } finally {
      await rm(transfer, { recursive: true, force: true });
    }
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function bunInstall(root: string): Promise<void> {
  await new Promise<void>((fulfill, reject) => {
    const child = spawn("bun", ["install", "--ignore-scripts"], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? fulfill() : reject(new Error(`Bun install exited ${String(code)}`)),
    );
  });
}
