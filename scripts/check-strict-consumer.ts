import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [resolve(root, "scripts/build.ts")], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(
  process.execPath,
  [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--project",
    resolve(root, "tests/fixtures/strict-consumer.tsconfig.json"),
  ],
  { cwd: root, stdio: "inherit" },
);
console.log("strict consumer typing check passed");
