import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkRelease, releaseSourcePaths } from "./release.ts";

const root = resolve(import.meta.dirname, "..");
const sources = new Map(
  releaseSourcePaths.map((path) => [path, readFileSync(resolve(root, path), "utf8")]),
);
const failures = checkRelease(sources);

if (failures.length > 0) {
  throw new Error(`Release check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

console.log(`release check passed for ${releaseSourcePaths.length} source-owned files`);
