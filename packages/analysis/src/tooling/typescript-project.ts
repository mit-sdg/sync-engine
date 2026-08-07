import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { AnalysisController } from "./analysis-foundation.ts";

export interface TypeScriptProjectFile {
  readonly path: string;
  readonly digest: string;
}

export interface LoadedTypeScriptProject {
  readonly configPath: string;
  readonly parsed: ts.ParsedCommandLine;
  readonly program: ts.Program;
}

interface ReadPath {
  readonly absolute: string;
  readonly repositoryFile: boolean;
}

interface ReadSnapshot extends ReadPath {
  readonly text: string | undefined;
  readonly digest: string | undefined;
}

interface ParsedProject {
  readonly configPath: string;
  readonly parsed: ts.ParsedCommandLine;
  readonly references: readonly string[];
}

export interface LoadTypeScriptProjectGraphOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly controller: AnalysisController;
}

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

function resolveExisting(path: string, label: string): string {
  try {
    return realpathSync(resolve(path));
  } catch (error) {
    throw new Error(`${label} could not be resolved: ${resolve(path)}`, { cause: error });
  }
}

export class TypeScriptProjectGraph {
  readonly repositoryRoot: string;
  readonly compilerLibraryRoot: string;
  readonly rootConfigPath: string;
  readonly projects: readonly LoadedTypeScriptProject[];
  readonly projectReferences: readonly string[];

  private readonly controller: AnalysisController;
  private readonly underlyingRead: (path: string) => string | undefined;
  private readonly customRead: boolean;
  private readonly snapshots = new Map<string, ReadSnapshot>();
  private readFailure: unknown;

  constructor(options: LoadTypeScriptProjectGraphOptions) {
    this.controller = options.controller;
    this.repositoryRoot = resolveExisting(options.repositoryRoot, "repositoryRoot");
    if (!statSync(this.repositoryRoot).isDirectory()) {
      throw new Error(`repositoryRoot is not a directory: ${this.repositoryRoot}`);
    }
    this.compilerLibraryRoot = resolveExisting(
      dirname(ts.getDefaultLibFilePath({})),
      "TypeScript library root",
    );
    this.underlyingRead = options.readFile ?? ((path: string) => ts.sys.readFile(path));
    this.customRead = options.readFile !== undefined;

    const unresolvedConfig = isAbsolute(options.tsconfigPath)
      ? resolve(options.tsconfigPath)
      : resolve(this.repositoryRoot, options.tsconfigPath);
    if (!pathInside(this.repositoryRoot, unresolvedConfig)) {
      throw new Error(`tsconfigPath escapes repositoryRoot: ${options.tsconfigPath}`);
    }
    this.rootConfigPath = resolveExisting(unresolvedConfig, "tsconfigPath");
    if (!pathInside(this.repositoryRoot, this.rootConfigPath)) {
      throw new Error(`tsconfigPath resolves outside repositoryRoot: ${options.tsconfigPath}`);
    }

    const parsed = this.loadProjectConfigs();
    const parsedByPath = new Map(parsed.map((project) => [project.configPath, project.parsed]));
    const projects = parsed.map(
      (project): LoadedTypeScriptProject => ({
        configPath: project.configPath,
        parsed: project.parsed,
        program: this.createProgram(project, parsedByPath),
      }),
    );
    this.projects = projects;
    this.projectReferences = parsed
      .filter(({ configPath }) => configPath !== this.rootConfigPath)
      .map(({ configPath }) => this.projectPath(configPath))
      .sort(ordinal);
  }

  projectPath(path: string): string {
    return portablePath(relative(this.repositoryRoot, path)) || ".";
  }

  diagnosticPath(fileName: string): string {
    const absolute = isAbsolute(fileName)
      ? resolve(fileName)
      : resolve(this.repositoryRoot, fileName);
    if (pathInside(this.repositoryRoot, absolute)) return this.projectPath(absolute);
    if (pathInside(this.compilerLibraryRoot, absolute)) {
      return `typescript/${portablePath(relative(this.compilerLibraryRoot, absolute))}`;
    }
    return portablePath(absolute);
  }

  readFile = (path: string): string | undefined => {
    try {
      return this.immutableRead(path);
    } catch (error) {
      this.readFailure ??= error;
      throw error;
    }
  };

  private immutableRead(path: string): string | undefined {
    this.controller.checkpoint();
    const resolved = this.readablePath(path, true)!;
    const current = this.underlyingRead(resolved.absolute);
    this.controller.checkpoint();
    if (current !== undefined && typeof current !== "string") {
      throw new Error(`readFile returned a non-string value for ${resolved.absolute}`);
    }
    const currentDigest = current === undefined ? undefined : digest(current);
    const previous = this.snapshots.get(resolved.absolute);
    if (
      previous !== undefined &&
      (previous.digest !== currentDigest || previous.text !== current)
    ) {
      const pathLabel = previous.repositoryFile
        ? this.projectPath(previous.absolute)
        : previous.absolute;
      throw new Error(`project file changed during analysis: ${pathLabel}`);
    }
    if (previous !== undefined) return previous.text;
    if (resolved.repositoryFile && current !== undefined) {
      this.controller.addProjectFile(Buffer.byteLength(current, "utf8"));
    }
    this.snapshots.set(resolved.absolute, { ...resolved, text: current, digest: currentDigest });
    return current;
  }

  verifyReads(): void {
    for (const snapshot of this.snapshots.values()) {
      this.controller.checkpoint();
      if (snapshot.text !== undefined) this.readFile(snapshot.absolute);
    }
  }

  files(): TypeScriptProjectFile[] {
    return [...this.snapshots.values()]
      .filter(
        (snapshot): snapshot is ReadSnapshot & { text: string; digest: string } =>
          snapshot.repositoryFile && snapshot.text !== undefined && snapshot.digest !== undefined,
      )
      .map((snapshot) => ({ path: this.projectPath(snapshot.absolute), digest: snapshot.digest }))
      .sort((left, right) => ordinal(left.path, right.path));
  }

  private readablePath(path: string, rejectOutside: boolean): ReadPath | undefined {
    this.controller.checkpoint();
    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.repositoryRoot, path);
    const inRepository = pathInside(this.repositoryRoot, absolute);
    const inCompiler = pathInside(this.compilerLibraryRoot, absolute);
    if (!inRepository && !inCompiler) {
      if (rejectOutside) throw new Error(`project read escapes repositoryRoot: ${absolute}`);
      return undefined;
    }

    let canonical = absolute;
    if (ts.sys.fileExists(absolute) || ts.sys.directoryExists(absolute)) {
      canonical = realpathSync(absolute);
      if (inRepository && !pathInside(this.repositoryRoot, canonical)) {
        throw new Error(`project path resolves outside repositoryRoot: ${absolute}`);
      }
      if (!inRepository && !pathInside(this.compilerLibraryRoot, canonical)) {
        if (rejectOutside) {
          throw new Error(`TypeScript library path resolves outside its root: ${absolute}`);
        }
        return undefined;
      }
    }
    return {
      absolute: canonical,
      repositoryFile:
        pathInside(this.repositoryRoot, canonical) &&
        !pathInside(this.compilerLibraryRoot, canonical),
    };
  }

  private fileExists = (path: string): boolean => {
    this.controller.checkpoint();
    const candidate = this.readablePath(path, false);
    if (candidate === undefined) return false;
    if (ts.sys.fileExists(candidate.absolute)) return true;
    return this.customRead && this.readFile(candidate.absolute) !== undefined;
  };

  private directoryPath(path: string): string | undefined {
    this.controller.checkpoint();
    const candidate = this.readablePath(path, false);
    if (candidate === undefined || !ts.sys.directoryExists(candidate.absolute)) return undefined;
    return candidate.absolute;
  }

  private readDirectory: ts.ParseConfigHost["readDirectory"] = (
    rootDir,
    extensions,
    excludes,
    includes,
    depth,
  ) => {
    this.controller.checkpoint();
    const root = this.directoryPath(rootDir);
    return root === undefined
      ? []
      : ts.sys.readDirectory(root, extensions, excludes, includes, depth);
  };

  private assertRepositoryPath(path: string, label: string, base = this.repositoryRoot): void {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(base, path);
    if (!pathInside(this.repositoryRoot, absolute)) {
      throw new Error(`${label} escapes repositoryRoot: ${path}`);
    }
    if (ts.sys.fileExists(absolute) || ts.sys.directoryExists(absolute)) {
      const canonical = realpathSync(absolute);
      if (!pathInside(this.repositoryRoot, canonical)) {
        throw new Error(`${label} resolves outside repositoryRoot: ${path}`);
      }
    }
  }

  private parseConfig(configPath: string): ts.ParsedCommandLine {
    const fatal: ts.Diagnostic[] = [];
    this.readFailure = undefined;
    const host: ts.ParseConfigFileHost = {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: this.fileExists,
      readFile: this.readFile,
      readDirectory: this.readDirectory,
      getCurrentDirectory: () => this.repositoryRoot,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => fatal.push(diagnostic),
    };
    this.controller.checkpoint();
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, host);
    this.controller.checkpoint();
    if (this.readFailure !== undefined) throw this.readFailure;
    if (parsed === undefined) {
      const message = fatal
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n");
      throw new Error(
        `TypeScript project config could not be parsed: ${this.projectPath(configPath)}${message === "" ? "" : ` (${message})`}`,
      );
    }
    parsed.options.disableSourceOfProjectReferenceRedirect = false;
    this.validateParsedConfig(configPath, parsed);
    return parsed;
  }

  private validateParsedConfig(configPath: string, parsed: ts.ParsedCommandLine): void {
    this.assertRepositoryPath(configPath, "tsconfig path");
    const configFile = parsed.options.configFile as ts.TsConfigSourceFile | undefined;
    for (const extended of configFile?.extendedSourceFiles ?? []) {
      this.assertRepositoryPath(extended, "tsconfig extends path", dirname(configPath));
    }
    for (const fileName of parsed.fileNames) {
      this.assertRepositoryPath(fileName, "tsconfig source file", dirname(configPath));
    }
    for (const reference of parsed.projectReferences ?? []) {
      const resolvedReference = ts.resolveProjectReferencePath(reference);
      this.assertRepositoryPath(
        resolvedReference,
        "tsconfig project reference",
        dirname(configPath),
      );
    }
    for (const [name, value] of [
      ["baseUrl", parsed.options.baseUrl],
      ["rootDir", parsed.options.rootDir],
      ["outDir", parsed.options.outDir],
      ["declarationDir", parsed.options.declarationDir],
      ["outFile", parsed.options.outFile],
      ["tsBuildInfoFile", parsed.options.tsBuildInfoFile],
    ] as const) {
      if (value !== undefined) {
        this.assertRepositoryPath(value, `compilerOptions.${name}`, dirname(configPath));
      }
    }
    for (const [name, values] of [
      ["rootDirs", parsed.options.rootDirs],
      ["typeRoots", parsed.options.typeRoots],
    ] as const) {
      for (const value of values ?? []) {
        this.assertRepositoryPath(value, `compilerOptions.${name}`, dirname(configPath));
      }
    }
    const pathsBase = parsed.options.baseUrl ?? dirname(configPath);
    for (const [alias, targets] of Object.entries(parsed.options.paths ?? {})) {
      for (const target of targets) {
        const wildcard = target.indexOf("*");
        const fixedPrefix = target.slice(0, wildcard < 0 ? undefined : wildcard);
        this.assertRepositoryPath(
          resolve(pathsBase, fixedPrefix || "."),
          `compilerOptions.paths[${JSON.stringify(alias)}]`,
          dirname(configPath),
        );
      }
    }
  }

  private resolvedReference(reference: ts.ProjectReference): string {
    const unresolved = resolve(ts.resolveProjectReferencePath(reference));
    this.assertRepositoryPath(unresolved, "tsconfig project reference");
    return resolveExisting(unresolved, "tsconfig project reference");
  }

  private validateSourceReferences(source: ts.SourceFile): void {
    const check = (specifier: string, label: string): void => {
      if (!specifier.startsWith(".") && !isAbsolute(specifier)) return;
      const candidate = resolve(dirname(source.fileName), specifier);
      if (!pathInside(this.repositoryRoot, candidate)) {
        throw new Error(
          `${label} escapes repositoryRoot from ${this.projectPath(source.fileName)}: ${specifier}`,
        );
      }
    };
    for (const reference of source.referencedFiles) {
      check(reference.fileName, "TypeScript source reference");
    }
    const visit = (node: ts.Node): void => {
      this.controller.checkpoint();
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier !== undefined &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        check(node.moduleSpecifier.text, "TypeScript source import");
      } else if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        check(node.arguments[0].text, "TypeScript source import");
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        check(node.argument.literal.text, "TypeScript source import type");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private loadProjectConfigs(): ParsedProject[] {
    const loaded = new Map<string, ParsedProject>();
    const visiting: string[] = [];
    const ordered: ParsedProject[] = [];

    const visit = (configPath: string): void => {
      this.controller.checkpoint();
      if (loaded.has(configPath)) return;
      const cycleAt = visiting.indexOf(configPath);
      if (cycleAt >= 0) {
        const cycle = [...visiting.slice(cycleAt), configPath]
          .map((path) => this.projectPath(path))
          .join(" -> ");
        throw new Error(`TypeScript project references contain a cycle: ${cycle}`);
      }
      visiting.push(configPath);
      try {
        const parsed = this.parseConfig(configPath);
        const references = [
          ...new Set(
            (parsed.projectReferences ?? []).map((reference) => this.resolvedReference(reference)),
          ),
        ].sort((left, right) => ordinal(this.projectPath(left), this.projectPath(right)));
        const project = { configPath, parsed, references };
        for (const reference of references) visit(reference);
        loaded.set(configPath, project);
        ordered.push(project);
      } finally {
        visiting.pop();
      }
    };

    visit(this.rootConfigPath);
    return ordered;
  }

  private createProgram(
    project: ParsedProject,
    parsedByPath: ReadonlyMap<string, ts.ParsedCommandLine>,
  ): ts.Program {
    const baseHost = ts.createCompilerHost(project.parsed.options, true);
    const sourceFiles = new Map<string, ts.SourceFile>();
    const getSourceFile: ts.CompilerHost["getSourceFile"] = (
      fileName,
      languageVersionOrOptions,
      onError,
      shouldCreateNewSourceFile,
    ) => {
      let text: string | undefined;
      try {
        text = this.readFile(fileName);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
        throw error;
      }
      if (text === undefined) {
        onError?.(`File not found: ${fileName}`);
        return undefined;
      }
      const key = this.readablePath(fileName, true)!.absolute;
      if (shouldCreateNewSourceFile !== true) {
        const previous = sourceFiles.get(key);
        if (previous !== undefined) return previous;
      }
      const source = ts.createSourceFile(
        key,
        text,
        languageVersionOrOptions,
        true,
        scriptKind(key),
      );
      sourceFiles.set(key, source);
      return source;
    };
    const cancellationToken: ts.CancellationToken = {
      isCancellationRequested: () => this.controller.signal?.aborted === true,
      throwIfCancellationRequested: () => this.controller.checkpoint(),
    };
    const host: ts.CompilerHost & {
      useSourceOfProjectReferenceRedirect(): boolean;
    } = {
      ...baseHost,
      getSourceFile,
      getSourceFileByPath: (fileName, _path, languageVersionOrOptions, onError, createNew) =>
        getSourceFile(fileName, languageVersionOrOptions, onError, createNew),
      getCurrentDirectory: () => this.repositoryRoot,
      fileExists: this.fileExists,
      readFile: this.readFile,
      readDirectory: (...args) => [...this.readDirectory(...args)],
      directoryExists: (path) => this.directoryPath(path) !== undefined,
      getDirectories: (path) => {
        const directory = this.directoryPath(path);
        return directory === undefined ? [] : ts.sys.getDirectories(directory);
      },
      realpath: (path) => this.readablePath(path, true)!.absolute,
      writeFile: () => undefined,
      getCancellationToken: () => cancellationToken,
      getParsedCommandLine: (fileName) => {
        const unresolved = resolve(fileName);
        if (!pathInside(this.repositoryRoot, unresolved)) return undefined;
        let canonical: string;
        try {
          canonical = realpathSync(unresolved);
        } catch {
          return undefined;
        }
        return parsedByPath.get(canonical);
      },
      useSourceOfProjectReferenceRedirect: () => true,
    };
    this.controller.checkpoint();
    const program = ts.createProgram({
      rootNames: project.parsed.fileNames,
      options: project.parsed.options,
      host,
      projectReferences: project.parsed.projectReferences,
      configFileParsingDiagnostics: project.parsed.errors,
    });
    this.controller.checkpoint();
    for (const source of program.getSourceFiles()) {
      this.controller.checkpoint();
      const absolute = resolve(source.fileName);
      if (
        !pathInside(this.repositoryRoot, absolute) &&
        !pathInside(this.compilerLibraryRoot, absolute)
      ) {
        throw new Error(`TypeScript source resolves outside repositoryRoot: ${source.fileName}`);
      }
      if (pathInside(this.repositoryRoot, absolute)) this.validateSourceReferences(source);
    }
    return program;
  }
}

export function loadTypeScriptProjectGraph(
  options: LoadTypeScriptProjectGraphOptions,
): TypeScriptProjectGraph {
  return new TypeScriptProjectGraph(options);
}
