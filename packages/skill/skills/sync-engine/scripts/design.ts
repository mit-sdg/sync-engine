import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export interface DesignDigest {
  readonly digest: string;
  readonly files: number;
}

export class DesignDigestError extends Error {
  override readonly name = "DesignDigestError";
}

interface AuthoredFile {
  readonly path: string;
  readonly relativePath: string;
}

async function authoredMarkdown(root: string, directory: string): Promise<AuthoredFile[]> {
  const files: AuthoredFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new DesignDigestError(`Design contains a symbolic link: ${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await authoredMarkdown(root, path)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({
        path,
        relativePath: relative(root, path).split(sep).join("/"),
      });
    }
  }
  return files;
}

/** A concept file carries its concept's name; compositions carry prose titles. */
async function requireConceptFileNames(files: readonly AuthoredFile[]): Promise<void> {
  for (const file of files) {
    if (!file.relativePath.startsWith("concepts/")) continue;
    const heading = (await readFile(file.path, "utf8")).match(/^#\s+(\S+)\s*$/m)?.[1];
    if (heading === undefined) {
      throw new DesignDigestError(`Concept declares no name heading: ${file.relativePath}`);
    }
    const name = file.relativePath.slice("concepts/".length, -".md".length);
    if (name !== heading) {
      throw new DesignDigestError(
        `Concept file name does not match its concept: ${file.relativePath} declares ${heading}; rename it to concepts/${heading}.md`,
      );
    }
  }
}

/** Concept implementation depends on concept specifications, not on composition prose. */
export type DesignScope = "all" | "concepts";

export function designScope(role: string): DesignScope {
  return role === "concept-worker" ? "concepts" : "all";
}

export async function digestDesign(
  directory: string,
  scope: DesignScope = "all",
): Promise<DesignDigest> {
  const root = resolve(directory);
  const rootEntry = await lstat(root);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
    throw new DesignDigestError(`Design root must be a directory, not a symbolic link: ${root}`);
  }

  const authored = await authoredMarkdown(root, root);
  if (authored.length === 0) {
    throw new DesignDigestError(`Design contains no Markdown files: ${root}`);
  }
  const files = (
    scope === "concepts"
      ? authored.filter((file) => file.relativePath.startsWith("concepts/"))
      : authored
  ).sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  const brief = files.find((file) => file.relativePath.endsWith("brief.md"));
  if (brief !== undefined) {
    throw new DesignDigestError(
      `The brief is product authority the coordinator keeps editing, not role-owned design: move ${brief.relativePath} out of ${root}`,
    );
  }

  await requireConceptFileNames(files);

  const hash = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file.path);
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    const framing = Buffer.allocUnsafe(16);
    framing.writeBigUInt64BE(BigInt(pathBytes.byteLength), 0);
    framing.writeBigUInt64BE(BigInt(content.byteLength), 8);
    hash.update(framing);
    hash.update(pathBytes);
    hash.update(content);
  }
  return { digest: hash.digest("hex"), files: files.length };
}

export async function requireDesignDigest(
  directory: string,
  expected: string,
  scope: DesignScope = "all",
): Promise<DesignDigest> {
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new DesignDigestError(`Expected design digest must be 64 lowercase hexadecimal digits`);
  }
  const actual = await digestDesign(directory, scope);
  if (actual.digest !== expected) {
    throw new DesignDigestError(
      `Design digest changed: expected ${expected}, found ${actual.digest}`,
    );
  }
  return actual;
}
