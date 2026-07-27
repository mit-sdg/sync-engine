/**
 * **`sync-engine new`** — write a runnable project.
 *
 * The generated project is the smallest complete slice: one concept with its
 * specification, class, registry and principle test; a concept set; a
 * composition holding an endpoint; an assembly; and the config the artifact
 * commands read. It is the same shape the getting-started guide builds, so a
 * reader can continue from either one.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { camel, heading, pascal, slug } from "@engine/utils/case";

const reTemplate = /\{\{(\w+)\}\}/g;

/** Walk `dir` recursively and yield every file path relative to it. */
async function* relativeFiles(dir: string, base = dir): AsyncGenerator<string> {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) {
      yield* relativeFiles(full, base);
    } else {
      yield full.slice(base.length + 1);
    }
  }
}

/** Resolve the templates directory relative to this file. */
function templatesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "scaffold");
}

/**
 * Read every file under the templates directory, apply replacements, and
 * return them keyed by their path relative to the project root.
 */
async function projectFiles(name: string, templates: string): Promise<Record<string, string>> {
  const packageManifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  const replacements: Record<string, string> = {
    App: pascal(name),
    app: camel(name),
    heading: heading(name),
    name,
    version: packageManifest.version,
  };
  replacements.slug = slug(replacements.heading);

  const apply = (content: string): string =>
    content.replace(reTemplate, (_match, key: string) => replacements[key] ?? _match);

  const files: Record<string, string> = {};
  for await (const entry of relativeFiles(templates)) {
    files[entry] = apply(await readFile(join(templates, entry), "utf8"));
  }
  return files;
}

/** Write a new project into `directory`, refusing to overwrite existing files. */
export async function scaffoldProject(directory: string): Promise<string[]> {
  const root = resolve(process.cwd(), directory);
  const files = await projectFiles(basename(root), templatesDir());
  const existing = Object.keys(files).filter((path) => existsSync(resolve(root, path)));
  if (existing.length > 0) {
    throw new Error(
      `${directory} already contains ${existing.join(", ")} — refusing to overwrite.`,
    );
  }
  const written: string[] = [];
  for (const [path, contents] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents);
    written.push(path);
  }
  return written;
}
