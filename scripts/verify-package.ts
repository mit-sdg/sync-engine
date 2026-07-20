import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { filesBelow } from "./walk.ts";
import { applicationExamples } from "../examples/register.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(resolve(tmpdir(), "sync-engine-package-"));
const tarball = resolve(temporary, "sync-engine.tgz");
const consumer = resolve(temporary, "consumer");
const standalone = resolve(temporary, "application");
const expectedAuthor = "Barish Namazov and Eagon Meng";

function run(command: string, args: string[], cwd = root): void {
  execFileSync(command, args, {
    cwd,
    env: { ...process.env, BUN_INSTALL_CACHE_DIR: resolve(temporary, "cache"), TMPDIR: temporary },
    stdio: "inherit",
  });
}

function requireEntry(entries: Set<string>, path: string): void {
  if (!entries.has(`package/${path}`)) throw new Error(`packed package omits ${path}`);
}

function packedPathExists(entries: Set<string>, path: string): boolean {
  const entry = `package/${path.replace(/\/+$/, "")}`;
  return (
    entries.has(entry) ||
    entries.has(`${entry}/`) ||
    [...entries].some((item) => item.startsWith(`${entry}/`))
  );
}

async function verifyPackedDocLinks(entries: Set<string>, installed: string): Promise<void> {
  for (const entry of entries) {
    if (!entry.startsWith("package/") || !entry.endsWith(".md")) continue;
    const documentPath = entry.slice("package/".length);
    const markdown = await readFile(resolve(installed, documentPath), "utf8");
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:)/.test(target) || target.startsWith("#")) continue;
      const relativeTarget = target.split("#", 1)[0].replace(/^<|>$/g, "");
      const packedTarget = posix.normalize(posix.join(posix.dirname(documentPath), relativeTarget));
      if (packedTarget.startsWith("../") || !packedPathExists(entries, packedTarget)) {
        throw new Error(`${documentPath} links to ${target}, which is absent from the package`);
      }
    }
  }
}

try {
  const examples = Object.values(applicationExamples).map(({ directory }) => directory);
  run("bun", ["pm", "pack", "--filename", tarball, "--ignore-scripts", "--quiet"]);

  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const entries = new Set(listing.trim().split("\n"));
  if ([...entries].some((entry) => entry.endsWith(".map"))) {
    throw new Error("packed package contains source maps whose implementation sources are omitted");
  }

  for (const path of await filesBelow(resolve(root, "examples"))) {
    requireEntry(entries, relative(root, path));
  }

  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    author: string;
    bin: Record<string, string>;
    exports: Record<string, { import: string; types: string }>;
    license: string;
  };
  if (packageJson.license !== "Apache-2.0") {
    throw new Error(`package license is ${packageJson.license}; expected Apache-2.0`);
  }
  if (packageJson.author !== expectedAuthor) {
    throw new Error(`package author is ${packageJson.author}; expected ${expectedAuthor}`);
  }
  for (const path of ["LICENSE", "README.md", "package.json"]) requireEntry(entries, path);
  if (packageJson.bin["sync-engine"] !== "./dist/command/artifacts.js") {
    throw new Error("package must expose the generated-artifact command as sync-engine");
  }
  requireEntry(entries, packageJson.bin["sync-engine"].replace(/^\.\//, ""));
  for (const target of Object.values(packageJson.exports)) {
    requireEntry(entries, target.import.replace(/^\.\//, ""));
    requireEntry(entries, target.types.replace(/^\.\//, ""));
  }

  await writeFile(
    resolve(temporary, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@mit-sdg/sync-engine": `file:${tarball}` },
    })}\n`,
  );
  run("bun", ["install", "--ignore-scripts", "--cwd", temporary]);

  const installed = resolve(temporary, "node_modules/@mit-sdg/sync-engine");
  await verifyPackedDocLinks(entries, installed);

  for (const example of examples) {
    run(
      "bun",
      [`node_modules/@mit-sdg/sync-engine/examples/${example}/src/scenario.ts`],
      temporary,
    );
    run(
      "bunx",
      [
        "sync-engine",
        "artifacts",
        "pin",
        "--config",
        `node_modules/@mit-sdg/sync-engine/examples/${example}/generated.config.ts`,
      ],
      temporary,
    );
    run(
      resolve(temporary, "node_modules/.bin/sync-engine"),
      [
        "artifacts",
        "check",
        "--config",
        resolve(installed, `examples/${example}/generated.config.ts`),
      ],
      installed,
    );
  }

  await cp(resolve(root, "tests/package/application"), standalone, { recursive: true });
  await rename(resolve(standalone, "tsconfig.project.json"), resolve(standalone, "tsconfig.json"));
  const standaloneManifest = JSON.parse(
    await readFile(resolve(standalone, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  standaloneManifest.dependencies["@mit-sdg/sync-engine"] = `file:${tarball}`;
  await writeFile(
    resolve(standalone, "package.json"),
    `${JSON.stringify(standaloneManifest, null, 2)}\n`,
  );
  run("bun", ["install", "--ignore-scripts"], standalone);
  run("bun", ["run", "generate"], standalone);
  run("bun", ["run", "typecheck"], standalone);
  run("bun", ["run", "principle"], standalone);
  run("bun", ["run", "start"], standalone);

  await writeFile(
    resolve(temporary, "runtime-import.mjs"),
    `await Promise.all(${JSON.stringify(
      Object.keys(packageJson.exports).map((entrypoint) =>
        entrypoint === "." ? "@mit-sdg/sync-engine" : `@mit-sdg/sync-engine/${entrypoint.slice(2)}`,
      ),
    )}.map((entrypoint) => import(entrypoint)));\n`,
  );
  run("bun", [resolve(temporary, "runtime-import.mjs")], temporary);

  await mkdir(consumer);
  await writeFile(
    resolve(consumer, "all-entrypoints.ts"),
    Object.keys(packageJson.exports)
      .map((entrypoint) => {
        const specifier =
          entrypoint === "."
            ? "@mit-sdg/sync-engine"
            : `@mit-sdg/sync-engine/${entrypoint.slice(2)}`;
        return `import type * as ${entrypoint.replace(/[^a-z]/gi, "_")} from ${JSON.stringify(specifier)};`;
      })
      .join("\n"),
  );
  await copyFile(
    resolve(root, "tests/package/consumer-contract.ts"),
    resolve(consumer, "contract.ts"),
  );
  await writeFile(
    resolve(consumer, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: {
        lib: ["ESNext", "DOM"],
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        skipLibCheck: true,
      },
      files: ["all-entrypoints.ts", "contract.ts"],
    })}\n`,
  );
  run(
    "bun",
    [
      resolve(root, "node_modules/typescript/bin/tsc"),
      "--project",
      resolve(consumer, "tsconfig.json"),
    ],
    temporary,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
