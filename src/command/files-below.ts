import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

/** List regular files depth-first without following symlinks. */
export async function filesBelow(
  directory: string,
  filter?: (name: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(path, filter);
      return entry.isFile() && (filter === undefined || filter(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}
