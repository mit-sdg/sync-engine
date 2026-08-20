import { readFile, writeFile } from "node:fs/promises";
import { buildGolden, goldens, hashManifestPath } from "./skill-goldens.ts";

const hashes: Record<string, string> = {};
let changed = 0;

for (const golden of goldens) {
  const built = await buildGolden(golden);
  hashes[golden.role] = built.sha256;
  if ((await readFile(golden.path, "utf8").catch(() => "")) === built.content) continue;
  await writeFile(golden.path, built.content);
  changed++;
}

const manifest = `${JSON.stringify(hashes, null, 2)}\n`;
const current = await readFile(hashManifestPath, "utf8").catch(() => "");
if (manifest !== current) await writeFile(hashManifestPath, manifest);

console.log(`${changed} of ${goldens.length} golden prompts rewritten`);
console.log(manifest.trim());
