import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { filesBelow } from "./walk.ts";
import { applicationExamples } from "../examples/register.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(resolve(tmpdir(), "sync-engine-package-"));
const consumer = resolve(temporary, "consumer");
const standalone = resolve(temporary, "application");
const multiInstance = resolve(temporary, "multi-instance");
const expectedAuthor = "Barish Namazov and Eagon Meng";

function commandEnv(): NodeJS.ProcessEnv {
  return { ...process.env, BUN_INSTALL_CACHE_DIR: resolve(temporary, "cache"), TMPDIR: temporary };
}

function run(command: string, args: string[], cwd = root, timeout?: number): void {
  execFileSync(command, args, {
    cwd,
    env: commandEnv(),
    stdio: "inherit",
    ...(timeout === undefined ? {} : { timeout }),
  });
}

function runNpm(args: string[], cwd = root): void {
  run("bun", ["run", "npm", ...args], cwd);
}

function requireEntry(entries: Set<string>, path: string): void {
  if (!entries.has(`package/${path}`)) throw new Error(`packed package omits ${path}`);
}

interface NpmPackResult {
  filename: string;
  size: number;
  unpackedSize: number;
  files: Array<{ path: string; mode: number }>;
}

function packWithNpm(cwd = root, destination = temporary): NpmPackResult {
  const output = execFileSync(
    "bun",
    ["run", "npm", "pack", "--json", "--loglevel=error", "--pack-destination", destination],
    {
      cwd,
      env: commandEnv(),
      encoding: "utf8",
      stdio: ["inherit", "pipe", "inherit"],
    },
  );
  const jsonStart = output.search(/^\[/m);
  if (jsonStart === -1) throw new Error("npm pack did not emit its JSON manifest");
  const parsed = JSON.parse(output.slice(jsonStart)) as NpmPackResult[];
  if (parsed.length !== 1) throw new Error(`npm pack described ${parsed.length} artifacts`);
  const packed = parsed[0];
  if (packed.size <= 0 || packed.unpackedSize <= 0) {
    throw new Error("npm pack reported an empty artifact");
  }
  return packed;
}

function requireExecutable(packed: NpmPackResult, path: string): void {
  // Windows archives do not carry a meaningful POSIX executable bit. The
  // Linux publication job and every POSIX package check enforce it.
  if (process.platform === "win32") return;
  const mode = packed.files.find((file) => file.path === path)?.mode;
  if (mode === undefined || (mode & 0o100) === 0) {
    throw new Error(`packed package does not mark ${path} executable`);
  }
}

function portablePath(path: string): string {
  return path.split(sep).join(posix.sep);
}

function tarballSpecifier(from: string, tarball: string): string {
  return `file:${portablePath(relative(from, tarball))}`;
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
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
    author: string;
    bin: Record<string, string>;
    exports: Record<string, { import: string; types: string }>;
    license: string;
    name: string;
    version: string;
  };
  const packed = packWithNpm();
  const expectedFilename = `${packageJson.name.replace(/^@/, "").replaceAll("/", "-")}-${packageJson.version}.tgz`;
  if (packed.filename !== expectedFilename) {
    throw new Error(`npm packed ${packed.filename}; expected ${expectedFilename}`);
  }
  const tarball = resolve(temporary, packed.filename);

  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  const entries = new Set(listing.trim().split(/\r?\n/));
  if ([...entries].some((entry) => entry.startsWith("package/docs/tmp-"))) {
    throw new Error("packed package contains temporary internal documentation");
  }
  if ([...entries].some((entry) => entry.endsWith(".map"))) {
    throw new Error("packed package contains source maps whose implementation sources are omitted");
  }

  for (const path of await filesBelow(resolve(root, "examples"))) {
    requireEntry(entries, portablePath(relative(root, path)));
  }

  if (packageJson.license !== "Apache-2.0") {
    throw new Error(`package license is ${packageJson.license}; expected Apache-2.0`);
  }
  if (packageJson.author !== expectedAuthor) {
    throw new Error(`package author is ${packageJson.author}; expected ${expectedAuthor}`);
  }
  for (const path of ["LICENSE", "README.md", "package.json"]) requireEntry(entries, path);
  if (packageJson.bin["sync-engine"] !== "./dist/command/main.js") {
    throw new Error("package must expose the sync-engine command as ./dist/command/main.js");
  }
  const executable = packageJson.bin["sync-engine"].replace(/^\.\//, "");
  requireEntry(entries, executable);
  requireExecutable(packed, executable);
  for (const target of Object.values(packageJson.exports)) {
    requireEntry(entries, target.import.replace(/^\.\//, ""));
    requireEntry(entries, target.types.replace(/^\.\//, ""));
  }

  await mkdir(consumer);
  await writeFile(
    resolve(consumer, "package.json"),
    `${JSON.stringify({
      private: true,
      type: "module",
      dependencies: { "@mit-sdg/sync-engine": tarballSpecifier(consumer, tarball) },
    })}\n`,
  );
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);

  const installed = resolve(consumer, "node_modules/@mit-sdg/sync-engine");
  await verifyPackedDocLinks(entries, installed);
  for (const path of await filesBelow(
    resolve(installed, "dist"),
    (name) => name.endsWith(".js") || name.endsWith(".d.ts"),
  )) {
    const source = await readFile(path, "utf8");
    if (/["']@(?:engine|sync-engine)\//.test(source)) {
      throw new Error(`${relative(installed, path)} contains a repository-only import alias`);
    }
  }

  const scaffold = resolve(temporary, "scaffold");
  run("bun", [resolve(installed, packageJson.bin["sync-engine"]), "new", scaffold], temporary);
  const scaffoldManifest = JSON.parse(
    await readFile(resolve(scaffold, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  if (scaffoldManifest.dependencies["@mit-sdg/sync-engine"] !== packageJson.version) {
    throw new Error(`packed scaffold must depend on version ${packageJson.version}`);
  }
  scaffoldManifest.dependencies["@mit-sdg/sync-engine"] = tarballSpecifier(scaffold, tarball);
  await writeFile(
    resolve(scaffold, "package.json"),
    `${JSON.stringify(scaffoldManifest, null, 2)}\n`,
  );
  run("bun", ["install", "--ignore-scripts"], scaffold);
  run("bun", ["run", "generate"], scaffold);
  run("bun", ["run", "check"], scaffold);
  run("bun", ["run", "principle"], scaffold);
  run("bun", ["run", "start"], scaffold);

  for (const example of examples) {
    const isolated = resolve(temporary, example);
    await cp(resolve(installed, "examples", example), isolated, { recursive: true });
    const manifestPath = resolve(isolated, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    if (manifest.dependencies["@mit-sdg/sync-engine"] !== packageJson.version) {
      throw new Error(`${example} must depend on the package version ${packageJson.version}`);
    }
    manifest.dependencies["@mit-sdg/sync-engine"] = tarballSpecifier(isolated, tarball);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    run("bun", ["install", "--ignore-scripts"], isolated);
    run("bun", ["run", "check"], isolated);
    run("bun", ["run", "start"], isolated);
  }

  await cp(resolve(root, "tests/package/application"), standalone, { recursive: true });
  await rename(resolve(standalone, "tsconfig.project.json"), resolve(standalone, "tsconfig.json"));
  const standaloneManifest = JSON.parse(
    await readFile(resolve(standalone, "package.json"), "utf8"),
  ) as { dependencies: Record<string, string> };
  if (standaloneManifest.dependencies["@mit-sdg/sync-engine"] !== packageJson.version) {
    throw new Error(`package application must depend on version ${packageJson.version}`);
  }
  standaloneManifest.dependencies["@mit-sdg/sync-engine"] = tarballSpecifier(standalone, tarball);
  await writeFile(
    resolve(standalone, "package.json"),
    `${JSON.stringify(standaloneManifest, null, 2)}\n`,
  );
  run("bun", ["install", "--ignore-scripts"], standalone);
  run("bun", ["run", "generate"], standalone);
  run("bun", ["run", "typecheck"], standalone);
  run("bun", ["run", "principle"], standalone);
  run("bun", ["run", "start"], standalone);

  await cp(resolve(root, "tests/package/multi-instance"), multiInstance, { recursive: true });
  const clientProject = resolve(multiInstance, "client");
  const backendProject = resolve(multiInstance, "backend");
  const clientManifestPath = resolve(clientProject, "package.json");
  const clientManifest = JSON.parse(await readFile(clientManifestPath, "utf8")) as {
    dependencies: Record<string, string>;
    name: string;
    version: string;
  };
  if (clientManifest.dependencies["@mit-sdg/sync-engine"] !== packageJson.version) {
    throw new Error(`multi-instance client must depend on version ${packageJson.version}`);
  }
  clientManifest.dependencies["@mit-sdg/sync-engine"] = tarballSpecifier(clientProject, tarball);
  await writeFile(clientManifestPath, `${JSON.stringify(clientManifest, null, 2)}\n`);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], clientProject);

  const installedForClient = resolve(clientProject, "node_modules/@mit-sdg/sync-engine");
  run(
    "bun",
    [
      resolve(installedForClient, packageJson.bin["sync-engine"]),
      "artifacts",
      "pin-wire",
      "--config",
      "generated.config.ts",
    ],
    clientProject,
  );
  run(
    "node",
    [resolve(clientProject, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    clientProject,
  );

  // The packed client names the published engine version. Its temporary
  // installation used the just-built tarball only to generate and compile it.
  clientManifest.dependencies["@mit-sdg/sync-engine"] = packageJson.version;
  await writeFile(clientManifestPath, `${JSON.stringify(clientManifest, null, 2)}\n`);
  const packedClient = packWithNpm(clientProject, multiInstance);
  const expectedClientFilename = `${clientManifest.name
    .replace(/^@/, "")
    .replaceAll("/", "-")}-${clientManifest.version}.tgz`;
  if (packedClient.filename !== expectedClientFilename) {
    throw new Error(
      `npm packed multi-instance client as ${packedClient.filename}; expected ${expectedClientFilename}`,
    );
  }
  const clientEntries = new Set(packedClient.files.map(({ path }) => path));
  for (const path of [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/generated/wire.js",
    "dist/generated/wire.d.ts",
  ]) {
    if (!clientEntries.has(path)) throw new Error(`packed multi-instance client omits ${path}`);
  }
  const clientTarball = resolve(multiInstance, packedClient.filename);

  for (const sourcePath of await filesBelow(resolve(backendProject, "src"), (name) =>
    name.endsWith(".ts"),
  )) {
    const source = await readFile(sourcePath, "utf8");
    if (/(?:\.\.\/)+client(?:\/|["'])/.test(source)) {
      throw new Error(
        `${relative(backendProject, sourcePath)} reaches into the generated client source tree`,
      );
    }
  }

  const backendManifestPath = resolve(backendProject, "package.json");
  const backendManifest = JSON.parse(await readFile(backendManifestPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
  if (backendManifest.dependencies["@mit-sdg/sync-engine"] !== packageJson.version) {
    throw new Error(`multi-instance backend must depend on version ${packageJson.version}`);
  }
  if (
    backendManifest.dependencies["@sync-engine-fixture/multi-instance-client"] !==
    clientManifest.version
  ) {
    throw new Error(`multi-instance backend must depend on client ${clientManifest.version}`);
  }
  backendManifest.dependencies["@mit-sdg/sync-engine"] = tarballSpecifier(backendProject, tarball);
  backendManifest.dependencies["@sync-engine-fixture/multi-instance-client"] = tarballSpecifier(
    backendProject,
    clientTarball,
  );
  await writeFile(backendManifestPath, `${JSON.stringify(backendManifest, null, 2)}\n`);
  runNpm(["install", "--ignore-scripts", "--no-audit", "--no-fund"], backendProject);
  run(
    "node",
    [resolve(backendProject, "node_modules/typescript/bin/tsc"), "--project", "tsconfig.json"],
    backendProject,
  );
  run("node", [resolve(backendProject, "dist/scenario.js")], backendProject, 30_000);

  await copyFile(
    resolve(root, "tests/package/node-runtime-scenario.ts"),
    resolve(consumer, "node-runtime-scenario.ts"),
  );
  await writeFile(
    resolve(consumer, "tsconfig.runtime.json"),
    `${JSON.stringify({
      compilerOptions: {
        lib: ["ESNext", "DOM"],
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: false,
        outDir: "compiled",
        strict: true,
        skipLibCheck: false,
      },
      files: ["node-runtime-scenario.ts"],
    })}\n`,
  );
  run(
    "node",
    [
      resolve(consumer, "node_modules/typescript/bin/tsc"),
      "--project",
      resolve(consumer, "tsconfig.runtime.json"),
    ],
    consumer,
  );
  run("node", [resolve(consumer, "compiled/node-runtime-scenario.js")], consumer);

  await writeFile(
    resolve(consumer, "runtime-import.mjs"),
    `await Promise.all(${JSON.stringify(
      Object.keys(packageJson.exports).map((entrypoint) =>
        entrypoint === "." ? "@mit-sdg/sync-engine" : `@mit-sdg/sync-engine/${entrypoint.slice(2)}`,
      ),
    )}.map((entrypoint) => import(entrypoint)));\n`,
  );
  run("node", [resolve(consumer, "runtime-import.mjs")], consumer);

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
        skipLibCheck: false,
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
