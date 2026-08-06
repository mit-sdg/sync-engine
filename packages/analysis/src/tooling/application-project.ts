import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  validateApplicationManifest,
  type ApplicationManifestV4,
} from "@mit-sdg/sync-engine/tooling";
import ts from "typescript";
import { indexApplication, type ApplicationIndex } from "./application-impact.ts";
import { indexApplicationSources, type ApplicationSourceIndex } from "./source-index.ts";

export interface LoadApplicationProjectOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath: string;
  readonly sourceRevision: string;
  readonly manifest: ApplicationManifestV4;
  readonly manifestSourceRevision: string;
  readonly expectedManifestDigest: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
}

export interface ApplicationProjectFile {
  /** POSIX path relative to the resolved repository root. */
  readonly path: string;
  /** SHA-256 of the exact UTF-8 text observed by analysis. */
  readonly digest: string;
}

export type ApplicationProjectDiagnosticPhase =
  | "config"
  | "options"
  | "global"
  | "syntactic"
  | "semantic";

export type ApplicationProjectDiagnosticCategory = "warning" | "error" | "suggestion" | "message";

export interface ApplicationProjectDiagnosticRelatedInformation {
  readonly category: ApplicationProjectDiagnosticCategory;
  readonly code: number;
  readonly message: string;
  readonly source?: string;
  readonly path?: string;
  readonly startOffset?: number;
  readonly endOffset?: number;
  readonly line?: number;
  readonly column?: number;
}

/** Plain-data TypeScript diagnostic with one stable collection phase. */
export interface ApplicationProjectDiagnostic extends ApplicationProjectDiagnosticRelatedInformation {
  readonly phase: ApplicationProjectDiagnosticPhase;
  readonly relatedInformation?: readonly ApplicationProjectDiagnosticRelatedInformation[];
}

export interface ApplicationProjectProvenance {
  readonly sourceRevision: string;
  readonly manifestSourceRevision: string;
  readonly manifestDigest: string;
  /** SHA-256 over the ordered repository-relative file digest records. */
  readonly sourceDigest: string;
  readonly tsconfigPath: string;
  readonly typescriptVersion: string;
  readonly projectReferences: readonly string[];
  readonly files: readonly ApplicationProjectFile[];
}

/** One static, checkout-bound analysis without an executable project value. */
export interface ApplicationProjectAnalysis {
  readonly format: "sync-engine.application-project-analysis";
  readonly version: 1;
  readonly provenance: ApplicationProjectProvenance;
  readonly diagnostics: readonly ApplicationProjectDiagnostic[];
  readonly applicationIndex: ApplicationIndex;
  readonly sourceIndex: ApplicationSourceIndex;
}

interface ReadPath {
  readonly absolute: string;
  readonly repositoryFile: boolean;
}

interface ReadSnapshot extends ReadPath {
  readonly text: string | undefined;
  readonly digest: string | undefined;
}

const PHASE_RANK: Record<ApplicationProjectDiagnosticPhase, number> = {
  config: 0,
  options: 1,
  global: 2,
  syntactic: 3,
  semantic: 4,
};

const CATEGORY_NAME: Record<ts.DiagnosticCategory, ApplicationProjectDiagnosticCategory> = {
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Suggestion]: "suggestion",
  [ts.DiagnosticCategory.Message]: "message",
};

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function scriptKind(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  if (lower.endsWith(".json")) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function pathInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function requiredString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function resolveExisting(path: string, label: string): string {
  try {
    return realpathSync(resolve(path));
  } catch (error) {
    throw new Error(`${label} could not be resolved: ${resolve(path)}`, { cause: error });
  }
}

function projectPath(repositoryRoot: string, path: string): string {
  return portablePath(relative(repositoryRoot, path)) || ".";
}

function diagnosticKey(diagnostic: ApplicationProjectDiagnostic): string {
  return JSON.stringify([
    PHASE_RANK[diagnostic.phase],
    diagnostic.path ?? "",
    diagnostic.startOffset ?? -1,
    diagnostic.endOffset ?? -1,
    diagnostic.code,
    diagnostic.category,
    diagnostic.source ?? "",
    diagnostic.message,
    diagnostic.relatedInformation ?? [],
  ]);
}

/**
 * Load and analyze a TypeScript project as source data only. This never imports
 * the project or interprets a manifest-producing configuration module.
 */
export function loadApplicationProject(
  options: LoadApplicationProjectOptions,
): ApplicationProjectAnalysis {
  requiredString(options.repositoryRoot, "repositoryRoot");
  requiredString(options.tsconfigPath, "tsconfigPath");
  requiredString(options.sourceRevision, "sourceRevision");
  requiredString(options.manifestSourceRevision, "manifestSourceRevision");
  requiredString(options.expectedManifestDigest, "expectedManifestDigest");
  if (options.readFile !== undefined && typeof options.readFile !== "function") {
    throw new Error("readFile must be a function when supplied");
  }

  const repositoryRoot = resolveExisting(options.repositoryRoot, "repositoryRoot");
  if (!statSync(repositoryRoot).isDirectory()) {
    throw new Error(`repositoryRoot is not a directory: ${repositoryRoot}`);
  }
  const unresolvedConfig = isAbsolute(options.tsconfigPath)
    ? resolve(options.tsconfigPath)
    : resolve(repositoryRoot, options.tsconfigPath);
  if (!pathInside(repositoryRoot, unresolvedConfig)) {
    throw new Error(`tsconfigPath escapes repositoryRoot: ${options.tsconfigPath}`);
  }
  const configPath = resolveExisting(unresolvedConfig, "tsconfigPath");
  if (!pathInside(repositoryRoot, configPath)) {
    throw new Error(`tsconfigPath resolves outside repositoryRoot: ${options.tsconfigPath}`);
  }

  const manifest = options.manifest;
  validateApplicationManifest(manifest);
  if (options.sourceRevision !== options.manifestSourceRevision) {
    throw new Error(
      `sourceRevision ${JSON.stringify(options.sourceRevision)} does not match manifestSourceRevision ${JSON.stringify(options.manifestSourceRevision)}`,
    );
  }
  if (manifest.digest !== options.expectedManifestDigest) {
    throw new Error(
      `expectedManifestDigest ${JSON.stringify(options.expectedManifestDigest)} does not match manifest digest ${JSON.stringify(manifest.digest)}`,
    );
  }

  const compilerLibraryRoot = resolveExisting(
    dirname(ts.getDefaultLibFilePath({})),
    "TypeScript library root",
  );
  const underlyingRead = options.readFile ?? ((path: string) => ts.sys.readFile(path));
  const snapshots = new Map<string, ReadSnapshot>();

  const readablePath = (path: string, rejectOutside: boolean): ReadPath | undefined => {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
    const inRepository = pathInside(repositoryRoot, absolute);
    const inCompiler = pathInside(compilerLibraryRoot, absolute);
    if (!inRepository && !inCompiler) {
      if (rejectOutside) throw new Error(`project read escapes repositoryRoot: ${absolute}`);
      return undefined;
    }

    let canonical = absolute;
    if (ts.sys.fileExists(absolute) || ts.sys.directoryExists(absolute)) {
      canonical = realpathSync(absolute);
      if (inRepository && !pathInside(repositoryRoot, canonical)) {
        throw new Error(`project path resolves outside repositoryRoot: ${absolute}`);
      }
      if (!inRepository && !pathInside(compilerLibraryRoot, canonical)) {
        if (rejectOutside)
          throw new Error(`TypeScript library path resolves outside its root: ${absolute}`);
        return undefined;
      }
    }
    return {
      absolute: canonical,
      repositoryFile:
        pathInside(repositoryRoot, canonical) && !pathInside(compilerLibraryRoot, canonical),
    };
  };

  const immutableRead = (path: string): string | undefined => {
    const resolved = readablePath(path, true)!;
    const current = underlyingRead(resolved.absolute);
    if (current !== undefined && typeof current !== "string") {
      throw new Error(`readFile returned a non-string value for ${resolved.absolute}`);
    }
    const currentDigest = current === undefined ? undefined : digest(current);
    const previous = snapshots.get(resolved.absolute);
    if (
      previous !== undefined &&
      (previous.digest !== currentDigest || previous.text !== current)
    ) {
      const pathLabel = previous.repositoryFile
        ? projectPath(repositoryRoot, previous.absolute)
        : previous.absolute;
      throw new Error(`project file changed during analysis: ${pathLabel}`);
    }
    if (previous !== undefined) return previous.text;
    snapshots.set(resolved.absolute, { ...resolved, text: current, digest: currentDigest });
    return current;
  };

  const fileExists = (path: string): boolean => {
    const candidate = readablePath(path, false);
    if (candidate === undefined) return false;
    if (ts.sys.fileExists(candidate.absolute)) return true;
    return options.readFile === undefined ? false : immutableRead(candidate.absolute) !== undefined;
  };

  const directoryPath = (path: string): string | undefined => {
    const candidate = readablePath(path, false);
    if (candidate === undefined || !ts.sys.directoryExists(candidate.absolute)) return undefined;
    return candidate.absolute;
  };

  const readDirectory = (
    rootDir: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[],
    depth?: number,
  ): string[] => {
    const root = directoryPath(rootDir);
    return root === undefined
      ? []
      : ts.sys.readDirectory(root, extensions, excludes, includes, depth);
  };

  const parseHost: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    fileExists,
    readFile: immutableRead,
    readDirectory,
  };
  const loaded = ts.readConfigFile(configPath, immutableRead);
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config ?? {},
    parseHost,
    dirname(configPath),
    undefined,
    configPath,
  );
  const configDiagnostics = [
    ...(loaded.error === undefined ? [] : [loaded.error]),
    ...parsed.errors,
  ];

  const assertProjectPath = (path: string, label: string): void => {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(dirname(configPath), path);
    if (!pathInside(repositoryRoot, absolute)) {
      throw new Error(`${label} escapes repositoryRoot: ${path}`);
    }
    if (ts.sys.fileExists(absolute) || ts.sys.directoryExists(absolute)) {
      const canonical = realpathSync(absolute);
      if (!pathInside(repositoryRoot, canonical)) {
        throw new Error(`${label} resolves outside repositoryRoot: ${path}`);
      }
    }
  };
  for (const fileName of parsed.fileNames) assertProjectPath(fileName, "tsconfig source file");
  for (const reference of parsed.projectReferences ?? []) {
    assertProjectPath(reference.path, "tsconfig project reference");
  }
  for (const [name, value] of [
    ["baseUrl", parsed.options.baseUrl],
    ["rootDir", parsed.options.rootDir],
    ["outDir", parsed.options.outDir],
    ["declarationDir", parsed.options.declarationDir],
    ["outFile", parsed.options.outFile],
    ["tsBuildInfoFile", parsed.options.tsBuildInfoFile],
  ] as const) {
    if (value !== undefined) assertProjectPath(value, `compilerOptions.${name}`);
  }
  for (const [name, values] of [
    ["rootDirs", parsed.options.rootDirs],
    ["typeRoots", parsed.options.typeRoots],
  ] as const) {
    for (const value of values ?? []) assertProjectPath(value, `compilerOptions.${name}`);
  }
  const pathsBase = parsed.options.baseUrl ?? dirname(configPath);
  for (const [alias, targets] of Object.entries(parsed.options.paths ?? {})) {
    for (const target of targets) {
      const fixedPrefix = target.slice(
        0,
        target.indexOf("*") < 0 ? undefined : target.indexOf("*"),
      );
      assertProjectPath(
        resolve(pathsBase, fixedPrefix || "."),
        `compilerOptions.paths[${JSON.stringify(alias)}]`,
      );
    }
  }

  const baseHost = ts.createCompilerHost(parsed.options, true);
  const getSourceFile: ts.CompilerHost["getSourceFile"] = (
    fileName,
    languageVersionOrOptions,
    onError,
  ) => {
    let text: string | undefined;
    try {
      text = immutableRead(fileName);
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error));
      throw error;
    }
    if (text === undefined) {
      onError?.(`File not found: ${fileName}`);
      return undefined;
    }
    return ts.createSourceFile(
      fileName,
      text,
      languageVersionOrOptions,
      true,
      scriptKind(fileName),
    );
  };
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile,
    getSourceFileByPath: (fileName, _path, languageVersionOrOptions, onError) =>
      getSourceFile(fileName, languageVersionOrOptions, onError),
    getCurrentDirectory: () => repositoryRoot,
    fileExists,
    readFile: immutableRead,
    readDirectory,
    directoryExists: (path) => directoryPath(path) !== undefined,
    getDirectories: (path) => {
      const directory = directoryPath(path);
      return directory === undefined ? [] : ts.sys.getDirectories(directory);
    },
    realpath: (path) => readablePath(path, true)!.absolute,
  };
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: configDiagnostics,
  });

  const diagnosticPath = (fileName: string): string => {
    const absolute = isAbsolute(fileName) ? resolve(fileName) : resolve(repositoryRoot, fileName);
    if (pathInside(repositoryRoot, absolute)) return projectPath(repositoryRoot, absolute);
    if (pathInside(compilerLibraryRoot, absolute)) {
      return `typescript/${portablePath(relative(compilerLibraryRoot, absolute))}`;
    }
    return portablePath(absolute);
  };
  const diagnosticDetail = (
    diagnostic: ts.DiagnosticRelatedInformation | ts.Diagnostic,
  ): ApplicationProjectDiagnosticRelatedInformation => {
    const source = "source" in diagnostic ? diagnostic.source : undefined;
    const base = {
      category: CATEGORY_NAME[diagnostic.category],
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ...(source === undefined ? {} : { source }),
    };
    if (diagnostic.file === undefined) return base;
    const path = diagnosticPath(diagnostic.file.fileName);
    if (diagnostic.start === undefined) return { ...base, path };
    const start = diagnostic.start;
    const location = diagnostic.file.getLineAndCharacterOfPosition(start);
    return {
      ...base,
      path,
      startOffset: start,
      endOffset: start + (diagnostic.length ?? 0),
      line: location.line + 1,
      column: location.character + 1,
    };
  };
  const serializeDiagnostic = (
    phase: ApplicationProjectDiagnosticPhase,
    diagnostic: ts.Diagnostic,
  ): ApplicationProjectDiagnostic => {
    const detail = diagnosticDetail(diagnostic);
    const relatedInformation = diagnostic.relatedInformation
      ?.map(diagnosticDetail)
      .sort((left, right) => ordinal(JSON.stringify(left), JSON.stringify(right)));
    return {
      phase,
      ...detail,
      ...(relatedInformation === undefined || relatedInformation.length === 0
        ? {}
        : { relatedInformation }),
    };
  };
  const collected: ApplicationProjectDiagnostic[] = [
    ...program
      .getConfigFileParsingDiagnostics()
      .map((diagnostic) => serializeDiagnostic("config", diagnostic)),
    ...program
      .getOptionsDiagnostics()
      .map((diagnostic) => serializeDiagnostic("options", diagnostic)),
    ...program
      .getGlobalDiagnostics()
      .map((diagnostic) => serializeDiagnostic("global", diagnostic)),
    ...program
      .getSyntacticDiagnostics()
      .map((diagnostic) => serializeDiagnostic("syntactic", diagnostic)),
    ...program
      .getSemanticDiagnostics()
      .map((diagnostic) => serializeDiagnostic("semantic", diagnostic)),
  ];
  const diagnostics = [
    ...new Map(
      collected
        .sort((left, right) => ordinal(diagnosticKey(left), diagnosticKey(right)))
        .map((diagnostic) => [diagnosticKey(diagnostic), diagnostic]),
    ).values(),
  ];

  const applicationIndex = indexApplication(manifest);
  const sourceIndex = indexApplicationSources({
    manifest,
    program,
    projectRoot: repositoryRoot,
    readFile: immutableRead,
  });

  for (const snapshot of snapshots.values()) {
    if (snapshot.text !== undefined) immutableRead(snapshot.absolute);
  }
  const files = [...snapshots.values()]
    .filter(
      (snapshot): snapshot is ReadSnapshot & { text: string; digest: string } =>
        snapshot.repositoryFile && snapshot.text !== undefined && snapshot.digest !== undefined,
    )
    .map((snapshot) => ({
      path: projectPath(repositoryRoot, snapshot.absolute),
      digest: snapshot.digest,
    }))
    .sort((left, right) => ordinal(left.path, right.path));
  const sourceDigest = digest(JSON.stringify(files));
  const projectReferences = (parsed.projectReferences ?? [])
    .map(({ path }) => {
      const absolute = isAbsolute(path) ? resolve(path) : resolve(dirname(configPath), path);
      return projectPath(repositoryRoot, absolute);
    })
    .sort(ordinal);

  return {
    format: "sync-engine.application-project-analysis",
    version: 1,
    provenance: {
      sourceRevision: options.sourceRevision,
      manifestSourceRevision: options.manifestSourceRevision,
      manifestDigest: manifest.digest,
      sourceDigest,
      tsconfigPath: projectPath(repositoryRoot, configPath),
      typescriptVersion: ts.version,
      projectReferences,
      files,
    },
    diagnostics,
    applicationIndex,
    sourceIndex,
  };
}
