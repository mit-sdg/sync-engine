import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ownedDependencyManifests, projectReleaseManifests } from "./release.ts";

const root = resolve(import.meta.dirname, "..");
const paths = ["package.json", ...ownedDependencyManifests];
const sources = new Map(
  await Promise.all(
    paths.map(async (path) => [path, await readFile(resolve(root, path), "utf8")] as const),
  ),
);
const projected = projectReleaseManifests(sources);
let changed = 0;

for (const [path, source] of projected) {
  if (source === sources.get(path)) continue;
  await writeFile(resolve(root, path), source);
  changed++;
}

console.log(`updated ${changed} of ${ownedDependencyManifests.length} release manifests`);
