import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import ts from "typescript";
import { filesBelow } from "./files-below.ts";

export type SetupInstaller = (root: string) => Promise<void>;

export interface SetupOptions {
  /** Override installation for tests, or use false for an explicit offline dry install. */
  readonly install?: SetupInstaller | false;
}

export interface SetupResult {
  readonly root: string;
  readonly manifestUpdated: boolean;
  readonly installation: "completed" | "not-needed" | "skipped";
  readonly written: readonly string[];
  readonly verified: readonly string[];
  readonly guidance: readonly string[];
}

const CORE = "@mit-sdg/sync-engine";
const IDENTIFIERS: Readonly<Record<string, readonly string[]>> = {
  "src/concepts.ts": ["applicationConceptSet"],
  "src/assembly.ts": ["assembleApplication"],
};
// Shipped as a constant rather than a template file: npm renames a packed `.gitignore`
// to `.npmignore`, so the template directory cannot carry one.
const GITIGNORE = `node_modules/
*.tsbuildinfo
*.log
.env
.env.*
.DS_Store
`;
const STANDARD_SCRIPTS = {
  generate: "sync-engine artifacts pin",
  check: "sync-engine check && sync-engine artifacts check && tsc --noEmit",
  start: "bun src/main.ts",
} as const;

function setupDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "setup");
}

async function templates(): Promise<Map<string, string>> {
  const directory = setupDirectory();
  const result = new Map<string, string>([[".gitignore", GITIGNORE]]);
  for (const path of await filesBelow(directory)) {
    result.set(relative(directory, path).replaceAll("\\", "/"), await readFile(path, "utf8"));
  }
  return result;
}

function packageObject(source: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`sync-engine setup: ${path} is not valid JSON (${String(error)}).`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`sync-engine setup: ${path} must contain a package object.`);
  }
  const manager = (parsed as Record<string, unknown>).packageManager;
  if (manager !== undefined && (typeof manager !== "string" || !manager.startsWith("bun@"))) {
    throw new Error(
      `sync-engine setup: ${path} packageManager must name Bun when present (for example, "bun@1.4.0").`,
    );
  }
  return parsed as Record<string, unknown>;
}

function exportsIdentifiers(source: string, identifiers: readonly string[]): boolean {
  const diagnostics = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.Latest },
    fileName: "setup-target.ts",
    reportDiagnostics: true,
  }).diagnostics;
  if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    return false;
  }
  const file = ts.createSourceFile("setup-target.ts", source, ts.ScriptTarget.Latest, true);
  const exported = new Set<string>();
  const hasExport = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true;
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) exported.add(element.name.text);
      }
      continue;
    }
    if (!hasExport(statement)) continue;
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) exported.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
      }
    }
  }
  return identifiers.every((identifier) => exported.has(identifier));
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

function dependencySection(
  manifest: Record<string, unknown>,
  key: DependencySection,
  create = false,
): Record<string, string> | undefined {
  const value = manifest[key];
  if (value === undefined) {
    if (!create) return undefined;
    const created: Record<string, string> = {};
    manifest[key] = created;
    return created;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`sync-engine setup: package.json ${key} must be an object.`);
  }
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== "string") {
      throw new Error(`sync-engine setup: package.json ${key}.${name} must be a string.`);
    }
  }
  return value as Record<string, string>;
}

function requirements(
  manifest: Record<string, unknown>,
  name: string,
): Array<{ section: DependencySection; range: string }> {
  return DEPENDENCY_SECTIONS.flatMap((section) => {
    const dependencies = dependencySection(manifest, section);
    const range = dependencies?.[name];
    return range === undefined ? [] : [{ section, range }];
  });
}

function rangeWithin(candidate: string, supported: string): boolean {
  try {
    return semver.validRange(candidate) !== null && semver.subset(candidate, supported);
  } catch {
    return false;
  }
}

function ensureDependency(
  manifest: Record<string, unknown>,
  name: string,
  destination: "dependencies" | "devDependencies",
  required: string,
  compatible: (range: string) => boolean,
): boolean {
  const declared = requirements(manifest, name);
  if (new Set(declared.map(({ range }) => range)).size > 1) {
    throw new Error(`sync-engine setup: conflicting ${name} package declarations.`);
  }
  if (declared.length > 0) {
    const range = declared[0]?.range ?? "";
    if (!compatible(range)) {
      throw new Error(`sync-engine setup: ${name} ${range} is incompatible with ${required}.`);
    }
    return false;
  }
  dependencySection(manifest, destination, true)![name] = required;
  return true;
}

function ensureScripts(manifest: Record<string, unknown>): boolean {
  const value = manifest.scripts;
  let scripts: Record<string, string>;
  if (value === undefined) {
    scripts = {};
    manifest.scripts = scripts;
  } else {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("sync-engine setup: package.json scripts must be an object.");
    }
    for (const [name, command] of Object.entries(value)) {
      if (typeof command !== "string") {
        throw new Error(`sync-engine setup: package.json scripts.${name} must be a string.`);
      }
    }
    scripts = value as Record<string, string>;
  }

  let changed = false;
  for (const [name, command] of Object.entries(STANDARD_SCRIPTS)) {
    if (scripts[name] !== undefined) continue;
    scripts[name] = command;
    changed = true;
  }
  return changed;
}

interface PackageRequirements {
  version: string;
  packageManager: string;
  typescriptRange: string;
  bunTypesRange: string;
  nodeTypesRange: string;
}

function updateManifest(manifest: Record<string, unknown>, required: PackageRequirements): boolean {
  let changed = false;
  if (manifest.packageManager === undefined) {
    manifest.packageManager = required.packageManager;
    changed = true;
  }
  changed =
    ensureDependency(
      manifest,
      CORE,
      "dependencies",
      required.version,
      (range) => range === required.version,
    ) || changed;
  changed =
    ensureDependency(manifest, "typescript", "devDependencies", required.typescriptRange, (range) =>
      rangeWithin(range, required.typescriptRange),
    ) || changed;
  changed =
    ensureDependency(manifest, "@types/bun", "devDependencies", required.bunTypesRange, (range) =>
      rangeWithin(range, required.bunTypesRange),
    ) || changed;
  changed =
    ensureDependency(manifest, "@types/node", "devDependencies", required.nodeTypesRange, (range) =>
      rangeWithin(range, required.nodeTypesRange),
    ) || changed;
  changed = ensureScripts(manifest) || changed;
  return changed;
}

async function bunInstall(root: string): Promise<void> {
  await new Promise<void>((resolveInstall, rejectInstall) => {
    const child = spawn("bun", ["install"], { cwd: root, stdio: "inherit" });
    child.once("error", rejectInstall);
    child.once("close", (code, signal) => {
      if (code === 0) resolveInstall();
      else {
        rejectInstall(
          new Error(
            signal === null
              ? `bun install exited with status ${String(code)}`
              : `bun install ended from signal ${signal}`,
          ),
        );
      }
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Initialize a supported concept-free application without replacing application-owned files. */
export async function setupProject(
  directory = ".",
  options: SetupOptions = {},
): Promise<SetupResult> {
  const root = resolve(process.cwd(), directory);
  if (!existsSync(root)) {
    throw new Error(`sync-engine setup: directory does not exist: ${directory}`);
  }
  const packagePath = resolve(root, "package.json");
  const packageManifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
    packageManager: string;
    dependencies: { typescript: string };
    devDependencies: { "@types/bun": string; "@types/node": string };
  };
  const manifest = existsSync(packagePath)
    ? packageObject(await readFile(packagePath, "utf8"), relative(process.cwd(), packagePath))
    : { private: true, type: "module" };
  const manifestUpdated = updateManifest(manifest, {
    version: packageManifest.version,
    packageManager: packageManifest.packageManager,
    typescriptRange: packageManifest.dependencies.typescript,
    bunTypesRange: packageManifest.devDependencies["@types/bun"],
    nodeTypesRange: packageManifest.devDependencies["@types/node"],
  });

  const guidance: string[] = [];
  let installation: SetupResult["installation"] = "not-needed";
  if (manifestUpdated) {
    await writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
    if (options.install === false) {
      installation = "skipped";
      guidance.push(
        "Bun installation was explicitly skipped; run `bun install` before validation.",
      );
    } else {
      try {
        await (options.install ?? bunInstall)(root);
        installation = "completed";
      } catch (error) {
        throw new Error(
          `sync-engine setup: package.json was updated, but Bun installation failed (${describe(error)}). ` +
            "No setup source or configuration files were written; fix the installation and rerun setup.",
        );
      }
    }
  }

  const source = await templates();
  const existing = new Map<string, string>();
  for (const path of source.keys()) {
    const target = resolve(root, path);
    if (existsSync(target)) existing.set(path, await readFile(target, "utf8"));
  }

  const verified: string[] = [];
  const eligible = new Set<string>();
  for (const [path, contents] of source) {
    const current = existing.get(path);
    if (current === contents) verified.push(path);
    else if (current === undefined) eligible.add(path);
    else guidance.push(`Existing application-owned file left unchanged: ${path}`);
  }

  const canUse = (path: string): boolean => {
    if (eligible.has(path)) return true;
    const contents = existing.get(path);
    return contents !== undefined && exportsIdentifiers(contents, IDENTIFIERS[path] ?? []);
  };
  if (eligible.has("src/assembly.ts") && !canUse("src/concepts.ts")) {
    eligible.delete("src/assembly.ts");
    guidance.push(
      "Integration required: src/assembly.ts needs the applicationConceptSet export from src/concepts.ts.",
    );
  }
  if (
    eligible.has("generated.config.ts") &&
    (!canUse("src/assembly.ts") || !canUse("src/concepts.ts"))
  ) {
    eligible.delete("generated.config.ts");
    guidance.push(
      "Integration required: generated.config.ts needs the application's assembly and concept-set modules.",
    );
  }
  if (eligible.has("src/main.ts") && !canUse("src/assembly.ts")) {
    eligible.delete("src/main.ts");
    guidance.push(
      "Integration required: src/main.ts needs an assembleApplication export from src/assembly.ts.",
    );
  }

  const order = [
    ".gitignore",
    "tsconfig.json",
    "src/text.d.ts",
    "src/concepts.ts",
    "src/assembly.ts",
    "generated.config.ts",
    "src/main.ts",
  ];
  const written: string[] = [];
  try {
    for (const path of order) {
      if (!eligible.has(path)) continue;
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source.get(path) ?? "", { flag: "wx" });
      written.push(path);
    }
  } catch (error) {
    throw new Error(
      `sync-engine setup: wrote ${written.length} setup file${written.length === 1 ? "" : "s"} before failing ` +
        `(${describe(error)}). Existing application files were not replaced; rerun setup after fixing the filesystem error.`,
    );
  }
  return {
    root,
    manifestUpdated,
    installation,
    written,
    verified: verified.sort(),
    guidance,
  };
}
