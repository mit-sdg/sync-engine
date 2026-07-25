import { execFileSync } from "node:child_process";
import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesBelow } from "./walk.ts";

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

const dist = resolve(root, "dist");
for (const path of await filesBelow(
  dist,
  (name) => name.endsWith(".js") || name.endsWith(".d.ts"),
)) {
  const source = await readFile(path, "utf8");
  const rewritten = source.replace(
    /(["'])@engine\/([^"']+)\1/g,
    (_match, quote: string, target: string) => {
      const emittedTarget = resolve(
        dist,
        "engine",
        `${target.replace(/\.ts$/, "")}${path.endsWith(".js") ? ".js" : ".ts"}`,
      );
      let specifier = relative(dirname(path), emittedTarget).split(sep).join("/");
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;
      return `${quote}${specifier}${quote}`;
    },
  );
  if (rewritten.includes("@engine/")) {
    throw new Error(`build left an unresolved @engine alias in ${relative(root, path)}`);
  }
  if (rewritten !== source) await writeFile(path, rewritten);
}

await chmod(resolve(root, "dist/command/artifacts.js"), 0o755);
