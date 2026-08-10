import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
export function portablePath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== ".." && !DEVICE.test(part))
  );
}
export function assertPortablePath(path: string, label = "path"): void {
  if (!portablePath(path))
    throw new Error(`${label} is not a portable project-relative path: ${path}`);
}
function escapes(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}
export function within(root: string, path: string): string {
  assertPortablePath(path);
  const target = resolve(root, path);
  if (escapes(root, target)) throw new Error(`path escapes the project: ${path}`);
  return target;
}
export async function assertNoSymlinkTraversal(root: string, target: string): Promise<void> {
  if (escapes(root, target)) throw new Error("catalog target escapes the project");
  const rootReal = await realpath(root);
  let cursor = dirname(target);
  while (cursor !== root) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink())
        throw new Error(`catalog refuses to traverse symlink: ${relative(root, cursor)}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(cursor);
    if (parent === cursor) throw new Error("catalog target escapes the project");
    cursor = parent;
  }
  if ((await realpath(root)) !== rootReal) throw new Error("project root changed while planning");
}
