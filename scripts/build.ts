import { execFileSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await rm(resolve(root, "dist"), { recursive: true, force: true });
execFileSync(
  "bun",
  [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"],
  {
    cwd: root,
    stdio: "inherit",
  },
);
await chmod(resolve(root, "dist/command/artifacts.js"), 0o755);
