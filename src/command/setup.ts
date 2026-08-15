import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import ts from "typescript";
import { filesBelow } from "./files-below.ts";

export interface SetupResult {
  readonly root: string;
  readonly written: readonly string[];
  readonly verified: readonly string[];
  readonly guidance: readonly string[];
}

const IDENTIFIERS: Readonly<Record<string, readonly string[]>> = {
  "src/concepts.ts": ["applicationConceptSet"],
  "src/assembly.ts": ["assembleApplication"],
};

function setupDirectory(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "setup");
}

async function templates(): Promise<Map<string, string>> {
  const directory = setupDirectory();
  const result = new Map<string, string>();
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
      `sync-engine setup: ${path} packageManager must name Bun when present (for example, "bun@1.3.14").`,
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
  if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))
    return false;
  const file = ts.createSourceFile("setup-target.ts", source, ts.ScriptTarget.Latest, true);
  const exported = new Set<string>();
  const hasExport = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ===
      true;
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined) {
      if (ts.isNamedExports(statement.exportClause))
        for (const element of statement.exportClause.elements) exported.add(element.name.text);
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
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name)) exported.add(declaration.name.text);
  }
  return identifiers.every((identifier) => exported.has(identifier));
}

function dependencyGuidance(
  manifest: Record<string, unknown>,
  version: string,
  typescriptRange: string,
  nodeTypesRange: string,
): string[] {
  const all = ["dependencies", "devDependencies", "peerDependencies"].flatMap((key) => {
    const value = manifest[key];
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : [];
  });
  const guidance: string[] = [];
  const requirements = (name: string): string[] =>
    all
      .filter(([candidate]) => candidate === name)
      .map(([, range]) => range)
      .filter((range): range is string => typeof range === "string");
  const core = requirements("@mit-sdg/sync-engine");
  if (new Set(core).size > 1)
    throw new Error("sync-engine setup: conflicting @mit-sdg/sync-engine package declarations.");
  if (core.length === 0)
    guidance.push(`Dependency required: bun add --exact @mit-sdg/sync-engine@${version}`);
  else if (core[0] !== version)
    throw new Error(
      `sync-engine setup: @mit-sdg/sync-engine must be declared at ${version}; found ${core[0]}.`,
    );
  const nodeTypes = requirements("@types/node");
  if (new Set(nodeTypes).size > 1)
    throw new Error("sync-engine setup: conflicting @types/node package declarations.");
  if (nodeTypes.length === 0)
    guidance.push(
      `Development dependency required: bun add --dev --exact @types/node@"${nodeTypesRange}"`,
    );
  const typescript = requirements("typescript");
  if (new Set(typescript).size > 1)
    throw new Error("sync-engine setup: conflicting TypeScript package declarations.");
  if (typescript.length === 0)
    guidance.push(
      `Development dependency recommended: bun add --dev --exact typescript@"${typescriptRange}"`,
    );
  else if (
    !(semver.valid(typescript[0]) !== null
      ? semver.satisfies(typescript[0], typescriptRange)
      : semver.subset(typescript[0] ?? "", typescriptRange))
  )
    throw new Error(
      `sync-engine setup: TypeScript ${typescript[0]} is incompatible with ${typescriptRange}.`,
    );
  const scripts = manifest.scripts;
  const records =
    typeof scripts === "object" && scripts !== null && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>)
      : {};
  if (typeof records.generate !== "string")
    guidance.push('package.json script: "generate": "sync-engine artifacts pin"');
  if (typeof records.check !== "string" && typeof records.typecheck !== "string") {
    guidance.push('package.json script: "check": "sync-engine check && tsc --noEmit"');
  }
  if (typeof records.start !== "string")
    guidance.push('package.json script: "start": "bun src/main.ts"');
  return guidance;
}

/** Initialize missing concept-free application files in an existing Bun package. */
export async function setupProject(directory = "."): Promise<SetupResult> {
  const root = resolve(process.cwd(), directory);
  if (!existsSync(root))
    throw new Error(`sync-engine setup: directory does not exist: ${directory}`);
  const packagePath = resolve(root, "package.json");
  if (!existsSync(packagePath)) {
    throw new Error(
      `sync-engine setup: ${directory} has no package.json. Create a Bun package first with \`bun init -y\`.`,
    );
  }
  const manifest = packageObject(
    await readFile(packagePath, "utf8"),
    relative(process.cwd(), packagePath),
  );
  const packageManifest = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as {
    version: string;
    dependencies: { typescript: string };
    devDependencies: { "@types/node": string };
  };
  const source = await templates();
  const existing = new Map<string, string>();
  for (const path of source.keys()) {
    const target = resolve(root, path);
    if (existsSync(target)) existing.set(path, await readFile(target, "utf8"));
  }

  const verified: string[] = [];
  const eligible = new Set<string>();
  const guidance = dependencyGuidance(
    manifest,
    packageManifest.version,
    packageManifest.dependencies.typescript,
    packageManifest.devDependencies["@types/node"],
  );
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
    "tsconfig.json",
    "src/concepts.ts",
    "src/assembly.ts",
    "generated.config.ts",
    "src/main.ts",
  ];
  const written: string[] = [];
  for (const path of order) {
    if (!eligible.has(path)) continue;
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source.get(path) ?? "");
    written.push(path);
  }
  return { root, written, verified: verified.sort(), guidance };
}
