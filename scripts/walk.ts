import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * The one directory walk the scripts share: every regular file below
 * `directory`, depth-first in directory order, narrowed to those whose base
 * name `filter` accepts when one is given. Symlinks are not followed and
 * non-file entries are skipped; callers that need a stable order sort the
 * result themselves.
 */
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
