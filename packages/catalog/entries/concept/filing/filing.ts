import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export class RootNotFound extends Error {}
export class PathLeavesRoot extends Error {}
export class InvalidPath extends Error {}
export class InvalidEncoding extends Error {}
export class FileNotFound extends Error {}
export class InvalidSource extends Error {}

export type ResolutionStatus =
  | "found"
  | "missing"
  | "outside"
  | "nonlocal"
  | "invalid"
  | "unknown-file";

type RootRecord = { root: string; name: string };
type FileRecord = {
  file: string;
  root: string;
  path: string;
  name: string;
  content: Uint8Array;
  digest: string;
};

type Resolution = { status: ResolutionStatus; path?: string; target?: string };
type PathStatus = "canonical" | "outside" | "invalid";
type LoadedEntry = { path: string; content: Uint8Array };
type FileLoadResult = {
  status: "loaded" | "problem";
  root?: string;
  file?: string;
  digest?: string;
  count?: number;
  changed?: boolean;
  code?: string;
  detail?: string;
};
type DirectoryLoadResult = {
  status: "loaded" | "problem";
  root?: string;
  count?: number;
  changed?: boolean;
  code?: string;
  detail?: string;
};
type LoadProblemCode =
  | "DIRECTORY_MISSING"
  | "DIRECTORY_UNREADABLE"
  | "DIRECTORY_UNSUPPORTED"
  | "ENTRY_UNNAMEABLE"
  | "ENTRY_UNREADABLE"
  | "ENTRY_UNSUPPORTED"
  | "FILE_MISSING";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const scheme = /^[a-z][a-z\d+.-]*:/i;

function hasForbiddenSegmentCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "/" || character === "\\" || code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function digest(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function copyBytes(content: Uint8Array): Uint8Array {
  if (!(content instanceof Uint8Array)) throw new TypeError("File content must be bytes.");
  return Uint8Array.from(content);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isScalarText(value: unknown): value is string {
  return typeof value === "string" && value.isWellFormed();
}

function isPathSegment(value: unknown): value is string {
  return (
    isScalarText(value) &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    value.normalize("NFC") === value &&
    !hasForbiddenSegmentCharacter(value)
  );
}

function pathStatus(path: unknown): PathStatus {
  if (typeof path !== "string" || path === "") return "invalid";
  if (path.startsWith("/")) return "outside";
  let depth = 0;
  let canonical = true;
  for (const segment of path.split("/")) {
    if (segment === "..") {
      if (depth === 0) return "outside";
      depth -= 1;
      canonical = false;
    } else if (segment === ".") {
      canonical = false;
    } else {
      if (!isPathSegment(segment)) return "invalid";
      depth += 1;
    }
  }
  return canonical ? "canonical" : "invalid";
}

function isDirectoryPath(prefix: unknown): prefix is string {
  return prefix === "" || pathStatus(prefix) === "canonical";
}

function comparePaths(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function rootIdentity(name: string): string {
  return `root:${JSON.stringify(name)}`;
}

function fileIdentity(root: string, path: string): string {
  return `file:${JSON.stringify([root, path])}`;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function problem(code: LoadProblemCode, detail: string) {
  return { status: "problem" as const, code, detail };
}

/** Keep independent, named byte trees with stable identities and exact change detection. */
export class FilingConcept {
  readonly #rootsByName = new Map<string, RootRecord>();
  readonly #rootsByID = new Map<string, RootRecord>();
  readonly #filesByID = new Map<string, FileRecord>();
  readonly #fileIDsByRoot = new Map<string, Map<string, string>>();

  ensureRoot({ name }: { name: string }) {
    if (typeof name !== "string") throw new TypeError("A root name must be text.");
    const existing = this.#rootsByName.get(name);
    if (existing !== undefined) return { root: existing.root };

    const root = rootIdentity(name);
    const record = { root, name };
    this.#rootsByName.set(name, record);
    this.#rootsByID.set(root, record);
    this.#fileIDsByRoot.set(root, new Map());
    return { root };
  }

  /** Read one complete host file before replacing its named singleton tree. */
  async replaceTreeFromFile({
    name,
    source,
    path,
  }: {
    name: string;
    source: string;
    path: string;
  }): Promise<FileLoadResult> {
    if (!isScalarText(name) || name === "" || !isScalarText(source) || source === "")
      throw new InvalidSource();
    const status = pathStatus(path);
    if (status === "outside") throw new PathLeavesRoot();
    if (status === "invalid") throw new InvalidPath();

    let sourceStatus: Awaited<ReturnType<typeof lstat>>;
    try {
      sourceStatus = await lstat(source);
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
        return problem("FILE_MISSING", "This required file is missing.");
      }
      return problem("ENTRY_UNREADABLE", "This file could not be read.");
    }
    if (sourceStatus.isSymbolicLink() || !sourceStatus.isFile()) {
      return problem("ENTRY_UNSUPPORTED", "Only directories and ordinary files may be loaded.");
    }

    let content: Uint8Array;
    try {
      content = Uint8Array.from(await readFile(source));
    } catch {
      return problem("ENTRY_UNREADABLE", "This file could not be read.");
    }

    const loaded = this.#replaceTree(name, [{ path, content }]);
    return {
      status: "loaded" as const,
      ...loaded,
      file: fileIdentity(loaded.root, path),
      digest: digest(content),
    };
  }

  /** Read a complete host tree before replacing the corresponding named tree. */
  async replaceTreeFromDirectory({
    name,
    directory,
  }: {
    name: string;
    directory: string;
  }): Promise<DirectoryLoadResult> {
    if (!isScalarText(name) || name === "" || !isScalarText(directory) || directory === "")
      throw new InvalidSource();

    let rootStatus: Awaited<ReturnType<typeof lstat>>;
    try {
      rootStatus = await lstat(directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
        return problem("DIRECTORY_MISSING", "This required directory is missing.");
      }
      return problem("DIRECTORY_UNREADABLE", "This directory could not be read.");
    }
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
      return problem(
        "DIRECTORY_UNSUPPORTED",
        "This required location must be a directory that is not a symbolic link.",
      );
    }

    const entries: LoadedEntry[] = [];
    const visit = async (
      current: string,
      prefix: string,
    ): Promise<ReturnType<typeof problem> | undefined> => {
      let children: { name: string }[];
      try {
        children = await readdir(current, { withFileTypes: true });
      } catch {
        return problem("DIRECTORY_UNREADABLE", "This directory could not be read.");
      }
      children.sort((left, right) => comparePaths(left.name, right.name));

      for (const child of children) {
        if (!isPathSegment(child.name)) {
          return problem("ENTRY_UNNAMEABLE", "Every loaded name must be a portable path segment.");
        }
        const source = join(current, child.name);
        const path = prefix === "" ? child.name : `${prefix}/${child.name}`;
        let childStatus: Awaited<ReturnType<typeof lstat>>;
        try {
          childStatus = await lstat(source);
        } catch {
          return problem("DIRECTORY_UNREADABLE", "This directory could not be read.");
        }
        if (childStatus.isSymbolicLink()) {
          return problem("ENTRY_UNSUPPORTED", "Only directories and ordinary files may be loaded.");
        }
        if (childStatus.isDirectory()) {
          const failure = await visit(source, path);
          if (failure !== undefined) return failure;
          continue;
        }
        if (!childStatus.isFile()) {
          return problem("ENTRY_UNSUPPORTED", "Only directories and ordinary files may be loaded.");
        }
        try {
          entries.push({ path, content: Uint8Array.from(await readFile(source)) });
        } catch {
          return problem("ENTRY_UNREADABLE", "This file could not be read.");
        }
      }
      return undefined;
    };

    const failure = await visit(directory, "");
    if (failure !== undefined) return failure;
    return { status: "loaded" as const, ...this.#replaceTree(name, entries) };
  }

  putFile({ root, path, content }: { root: string; path: string; content: Uint8Array }) {
    return this.#place(root, path, content);
  }

  putBase64File({ root, path, encoded }: { root: string; path: string; encoded: string }) {
    if (typeof encoded !== "string") throw new InvalidEncoding();
    const content = Buffer.from(encoded, "base64");
    if (content.toString("base64") !== encoded) throw new InvalidEncoding();
    return this.#place(root, path, content);
  }

  #place(root: string, path: string, content: Uint8Array) {
    if (!this.#rootsByID.has(root)) throw new RootNotFound();
    const status = pathStatus(path);
    if (status === "outside") throw new PathLeavesRoot();
    if (status === "invalid") throw new InvalidPath();

    const nextContent = copyBytes(content);
    const nextDigest = digest(nextContent);
    const filesAtRoot = this.#fileIDsByRoot.get(root)!;
    const previousID = filesAtRoot.get(path);
    if (previousID !== undefined) {
      const previous = this.#filesByID.get(previousID)!;
      const changed = !sameBytes(previous.content, nextContent);
      previous.content = nextContent;
      previous.digest = nextDigest;
      return { file: previous.file, digest: nextDigest, changed };
    }

    const file = fileIdentity(root, path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    const record = { file, root, path, name, content: nextContent, digest: nextDigest };
    this.#filesByID.set(file, record);
    filesAtRoot.set(path, file);
    return { file, digest: nextDigest, changed: true };
  }

  #replaceTree(name: string, entries: LoadedEntry[]) {
    const existingRoot = this.#rootsByName.get(name);
    const root = existingRoot?.root ?? rootIdentity(name);
    const previous = this.#fileIDsByRoot.get(root) ?? new Map<string, string>();
    const nextIDs = new Map<string, string>();
    const nextRecords = new Map<string, FileRecord>();
    let changed = previous.size !== entries.length;

    for (const entry of entries) {
      const status = pathStatus(entry.path);
      if (status === "outside") throw new PathLeavesRoot();
      if (status === "invalid") throw new InvalidPath();
      const content = copyBytes(entry.content);
      const file = previous.get(entry.path) ?? fileIdentity(root, entry.path);
      const prior = this.#filesByID.get(file);
      if (prior === undefined || !sameBytes(prior.content, content)) changed = true;
      nextIDs.set(entry.path, file);
      nextRecords.set(file, {
        file,
        root,
        path: entry.path,
        name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
        content,
        digest: digest(content),
      });
    }

    if (existingRoot === undefined) {
      const record = { root, name };
      this.#rootsByName.set(name, record);
      this.#rootsByID.set(root, record);
    }
    for (const [path, file] of previous) if (!nextIDs.has(path)) this.#filesByID.delete(file);
    for (const [file, record] of nextRecords) this.#filesByID.set(file, record);
    this.#fileIDsByRoot.set(root, nextIDs);
    return { root, count: entries.length, changed };
  }

  discard({ file }: { file: string }) {
    const record = this.#filesByID.get(file);
    if (record === undefined) throw new FileNotFound();
    this.#filesByID.delete(file);
    this.#fileIDsByRoot.get(record.root)!.delete(record.path);
    return { root: record.root, path: record.path, name: record.name };
  }

  _root({ root }: { root: string }): { name: string }[] {
    const record = this.#rootsByID.get(root);
    return record === undefined ? [] : [{ name: record.name }];
  }

  _named({ name }: { name: string }): { root: string }[] {
    const record = this.#rootsByName.get(name);
    return record === undefined ? [] : [{ root: record.root }];
  }

  _file({
    file,
  }: {
    file: string;
  }): { root: string; path: string; name: string; content: Uint8Array; digest: string }[] {
    const record = this.#filesByID.get(file);
    return record === undefined
      ? []
      : [
          {
            root: record.root,
            path: record.path,
            name: record.name,
            content: copyBytes(record.content),
            digest: record.digest,
          },
        ];
  }

  _text({ file }: { file: string }): { text: string }[] {
    const record = this.#filesByID.get(file);
    if (record === undefined) return [];
    try {
      return [{ text: decoder.decode(record.content) }];
    } catch {
      return [];
    }
  }

  _files(): { file: string; root: string; path: string }[] {
    return [...this.#rootsByID.keys()]
      .flatMap((root) =>
        [...this.#fileIDsByRoot.get(root)!.values()]
          .map((file) => this.#filesByID.get(file)!)
          .sort((left, right) => comparePaths(left.path, right.path)),
      )
      .map(({ file, root, path }) => ({ file, root, path }));
  }

  _at({ root, path }: { root: string; path: string }): { file: string; digest: string }[] {
    if (pathStatus(path) !== "canonical") return [];
    const file = this.#fileIDsByRoot.get(root)?.get(path);
    const record = file === undefined ? undefined : this.#filesByID.get(file);
    return record === undefined ? [] : [{ file: record.file, digest: record.digest }];
  }

  _under({
    root,
    prefix,
  }: {
    root: string;
    prefix: string;
  }): { file: string; path: string; digest: string }[] {
    if (!isDirectoryPath(prefix)) return [];
    const filesAtRoot = this.#fileIDsByRoot.get(root);
    if (filesAtRoot === undefined) return [];
    const beginning = prefix === "" ? "" : `${prefix}/`;
    return [...filesAtRoot.values()]
      .map((file) => this.#filesByID.get(file)!)
      .filter((record) => beginning === "" || record.path.startsWith(beginning))
      .sort((left, right) => comparePaths(left.path, right.path))
      .map(({ file, path, digest: fileDigest }) => ({ file, path, digest: fileDigest }));
  }

  _resolve({
    file,
    address,
  }: {
    file: string;
    address: string;
  }): { target: string; path: string }[] {
    const resolution = this.#resolution(file, address);
    return resolution.status === "found"
      ? [{ target: resolution.target!, path: resolution.path! }]
      : [];
  }

  _resolution({ file, address }: { file: string; address: string }): { status: ResolutionStatus } {
    return { status: this.#resolution(file, address).status };
  }

  #resolution(file: string, address: string): Resolution {
    const source = this.#filesByID.get(file);
    if (source === undefined) return { status: "unknown-file" };
    if (typeof address !== "string" || !isScalarText(address)) return { status: "invalid" };
    if (address.startsWith("/") || scheme.test(address)) return { status: "nonlocal" };

    const query = address.indexOf("?");
    const fragment = address.indexOf("#");
    const end = Math.min(
      query === -1 ? address.length : query,
      fragment === -1 ? address.length : fragment,
    );
    const referencePath = address.slice(0, end);
    if (referencePath === "") return { status: "found", path: source.path, target: source.file };
    if (referencePath.endsWith("/")) return { status: "invalid" };

    const targetSegments = source.path.split("/").slice(0, -1);
    const rawSegments = referencePath.split("/");
    let endsAtDirectory = false;
    for (let index = 0; index < rawSegments.length; index += 1) {
      const raw = rawSegments[index]!;
      if (raw === "") return { status: "invalid" };

      let segment: string;
      try {
        segment = decodeURIComponent(raw);
      } catch {
        return { status: "invalid" };
      }
      if (segment.includes("/") || !isScalarText(segment) || segment.normalize("NFC") !== segment) {
        return { status: "invalid" };
      }
      if (segment === ".") {
        endsAtDirectory = index === rawSegments.length - 1;
        continue;
      }
      if (segment === "..") {
        if (targetSegments.length === 0) return { status: "outside" };
        targetSegments.pop();
        endsAtDirectory = index === rawSegments.length - 1;
        continue;
      }
      if (!isPathSegment(segment)) return { status: "invalid" };
      targetSegments.push(segment);
      endsAtDirectory = false;
    }
    if (endsAtDirectory || targetSegments.length === 0) return { status: "invalid" };

    const path = targetSegments.join("/");
    const target = this.#fileIDsByRoot.get(source.root)?.get(path);
    return target === undefined ? { status: "missing", path } : { status: "found", path, target };
  }
}
