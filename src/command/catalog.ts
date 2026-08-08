import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ConceptSpecificationIR } from "@engine/reads/ir";
import { parseSpec } from "@engine/reactions/concepts/concept-spec";
import { canonicalJson } from "@engine/utils/canonical-json";

const usage = `sync-engine catalog [--concepts <path...>]
  Parse authored concept specifications into canonical path-keyed JSON.
  Defaults to src/concepts.`;

export async function specificationCatalog(
  roots: readonly string[],
  projectRoot = process.cwd(),
): Promise<Record<string, ConceptSpecificationIR>> {
  const canonicalRoot = await realpath(resolve(projectRoot));
  const discovered = await Promise.all(
    roots.map(async (directory) => {
      if (directory.trim() === "") throw new Error("Concept roots must not be blank.");
      let root: string;
      try {
        root = await realpath(resolve(canonicalRoot, directory));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Concept root not found: ${directory}`);
        }
        throw error;
      }
      if (!isWithin(canonicalRoot, root)) {
        throw new Error(`Concept root is outside the current project: ${directory}`);
      }
      if (!(await stat(root)).isDirectory())
        throw new Error(`Concept root is not a directory: ${directory}`);
      return specificationFilesBelow(root, canonicalRoot);
    }),
  );
  const paths = [...new Set(discovered.flat())]
    .map((path) => ({ absolute: path, relative: portable(relative(canonicalRoot, path)) }))
    .sort((left, right) =>
      left.relative < right.relative ? -1 : left.relative > right.relative ? 1 : 0,
    );
  if (paths.length === 0) {
    throw new Error(`No concept specifications found under: ${roots.join(", ")}`);
  }

  const entries: Array<[string, ConceptSpecificationIR]> = [];
  for (const path of paths) {
    try {
      entries.push([path.relative, parseSpec(await readFile(path.absolute, "utf8"))]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse ${path.relative}: ${detail}`);
    }
  }
  return Object.fromEntries(entries);
}

async function specificationFilesBelow(directory: string, projectRoot: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Symbolic links are not allowed inside concept roots: ${portable(relative(projectRoot, path))}`,
        );
      }
      if (entry.isDirectory()) return specificationFilesBelow(path, projectRoot);
      return entry.isFile() && entry.name === "spec.md" ? [path] : [];
    }),
  );
  return files.flat();
}

export async function catalogCommand(args: readonly string[]): Promise<void> {
  let conceptRoots: string[] | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--concepts" && conceptRoots === undefined) {
      conceptRoots = [];
      while (args[index + 1] !== undefined && !args[index + 1].startsWith("-")) {
        conceptRoots.push(args[index + 1]);
        index += 1;
      }
      if (conceptRoots.length === 0 || conceptRoots.some((root) => root.trim() === "")) {
        throw new Error(usage);
      }
      continue;
    }
    throw new Error(usage);
  }
  conceptRoots ??= ["src/concepts"];

  process.stdout.write(canonicalJson(await specificationCatalog(conceptRoots)));
}

function portable(path: string): string {
  if (sep === "/" && path.includes("\\")) {
    throw new Error(`Concept specification path is not portable: ${path}`);
  }
  return path.split(sep).join("/");
}

function isWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
