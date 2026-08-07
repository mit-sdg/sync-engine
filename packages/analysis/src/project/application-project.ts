import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  validateApplicationManifest,
  type ApplicationDiagnostic,
  type ApplicationManifestV5,
} from "@mit-sdg/sync-engine/tooling";
import ts from "typescript";
import { indexApplicationWithController } from "../ir/application-impact.ts";
import {
  AnalysisAbortedError,
  AnalysisController,
  AnalysisLimitError,
  type AnalysisOptions,
  type AnalysisSeverity,
} from "../ir/analysis-foundation.ts";
import type {
  ApplicationProjectAnalysis,
  ApplicationProjectDiagnostic,
  ApplicationProjectDiagnosticCategory,
  ApplicationProjectDiagnosticPhase,
  ApplicationProjectDiagnosticRelatedInformation,
} from "../ir/project-data.ts";
import { validateApplicationProjectAnalysis } from "../ir/application-project-format.ts";
import { analysisProvenance, freezeAnalysisData } from "../ir/analysis-provenance.ts";
import {
  indexApplicationSourcesWithController,
  type SourceAttributionRoot,
} from "./source-index.ts";
import { loadTypeScriptProjectGraph } from "./typescript-project.ts";

export interface LoadApplicationProjectOptions extends AnalysisOptions {
  readonly repositoryRoot: string;
  readonly tsconfigPath: string;
  readonly sourceRevision: string;
  readonly manifest: ApplicationManifestV5;
  readonly manifestSourceRevision: string;
  readonly expectedManifestDigest: string;
  readonly readFile?: (absolutePath: string) => string | undefined;
  readonly sourceRoots?: readonly SourceAttributionRoot[];
}

/** Filesystem-backed options accepted by the cancellable worker API. */
export type AnalyzeApplicationProjectOptions = Omit<LoadApplicationProjectOptions, "readFile">;

interface WorkerSuccess {
  readonly type: "success";
  readonly analysis: ApplicationProjectAnalysis;
}

interface WorkerFailure {
  readonly type: "error";
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
    readonly code?: string;
    readonly limit?: keyof NonNullable<LoadApplicationProjectOptions["limits"]>;
    readonly maximum?: number;
    readonly attempted?: number;
  };
}

type WorkerResponse = WorkerSuccess | WorkerFailure;

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

const CATEGORY_SEVERITY: Record<ts.DiagnosticCategory, AnalysisSeverity> = {
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Suggestion]: "info",
  [ts.DiagnosticCategory.Message]: "info",
};

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function requiredString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function diagnosticDetailKey(detail: ApplicationProjectDiagnosticRelatedInformation): string {
  return JSON.stringify([
    detail.path ?? "",
    detail.startOffset ?? -1,
    detail.endOffset ?? -1,
    detail.code,
    detail.severity,
    detail.category,
    detail.source ?? "",
    detail.message,
    detail.line ?? -1,
    detail.column ?? -1,
  ]);
}

function diagnosticKey(diagnostic: ApplicationProjectDiagnostic): string {
  return JSON.stringify([
    PHASE_RANK[diagnostic.phase],
    diagnostic.projectConfigPath ?? "",
    diagnosticDetailKey(diagnostic),
    diagnostic.relatedInformation?.map(diagnosticDetailKey) ?? [],
  ]);
}

function manifestDiagnosticKey(diagnostic: ApplicationDiagnostic): string {
  return JSON.stringify([
    diagnostic.severity,
    diagnostic.code,
    diagnostic.definition.kind,
    diagnostic.definition.name,
    diagnostic.endpoint?.name ?? "",
    diagnostic.endpoint?.path ?? "",
    diagnostic.message,
  ]);
}

/**
 * Load and analyze a TypeScript project as source data only. This synchronous
 * expert primitive supports custom reads and observes cancellation at compiler
 * and deterministic checkpoints; `createProgram` and config parsing are not
 * timer-preemptive.
 */
export function loadApplicationProject(
  options: LoadApplicationProjectOptions,
): ApplicationProjectAnalysis {
  const controller = new AnalysisController(options);
  requiredString(options.repositoryRoot, "repositoryRoot");
  requiredString(options.tsconfigPath, "tsconfigPath");
  requiredString(options.sourceRevision, "sourceRevision");
  requiredString(options.manifestSourceRevision, "manifestSourceRevision");
  requiredString(options.expectedManifestDigest, "expectedManifestDigest");
  if (options.readFile !== undefined && typeof options.readFile !== "function") {
    throw new Error("readFile must be a function when supplied");
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
  const manifestDiagnostics = [
    ...new Map(
      [...manifest.diagnostics]
        .sort((left, right) => ordinal(manifestDiagnosticKey(left), manifestDiagnosticKey(right)))
        .map((diagnostic) => [manifestDiagnosticKey(diagnostic), structuredClone(diagnostic)]),
    ).values(),
  ];
  for (const _diagnostic of manifestDiagnostics) controller.addDiagnostic();

  const graph = loadTypeScriptProjectGraph({
    repositoryRoot: options.repositoryRoot,
    tsconfigPath: options.tsconfigPath,
    readFile: options.readFile,
    controller,
  });
  const cancellationToken: ts.CancellationToken = {
    isCancellationRequested: () => controller.signal?.aborted === true,
    throwIfCancellationRequested: () => controller.checkpoint(),
  };
  const diagnosticDetail = (
    diagnostic: ts.DiagnosticRelatedInformation | ts.Diagnostic,
  ): ApplicationProjectDiagnosticRelatedInformation => {
    const source = "source" in diagnostic ? diagnostic.source : undefined;
    const base = {
      severity: CATEGORY_SEVERITY[diagnostic.category],
      category: CATEGORY_NAME[diagnostic.category],
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ...(source === undefined ? {} : { source }),
    };
    if (diagnostic.file === undefined) return base;
    const path = graph.diagnosticPath(diagnostic.file.fileName);
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
    projectConfigPath: string,
    diagnostic: ts.Diagnostic,
  ): ApplicationProjectDiagnostic => {
    const detail = diagnosticDetail(diagnostic);
    const relatedInformation =
      diagnostic.relatedInformation === undefined
        ? undefined
        : [
            ...new Map(
              diagnostic.relatedInformation
                .map(diagnosticDetail)
                .sort((left, right) =>
                  ordinal(diagnosticDetailKey(left), diagnosticDetailKey(right)),
                )
                .map((related) => [diagnosticDetailKey(related), related]),
            ).values(),
          ];
    return {
      phase,
      projectConfigPath,
      ...detail,
      ...(relatedInformation === undefined || relatedInformation.length === 0
        ? {}
        : { relatedInformation }),
    };
  };
  const collected: ApplicationProjectDiagnostic[] = [];
  for (const { configPath, program } of graph.projects) {
    controller.checkpoint();
    const projectConfigPath = graph.projectPath(configPath);
    collected.push(
      ...program
        .getConfigFileParsingDiagnostics()
        .map((diagnostic) => serializeDiagnostic("config", projectConfigPath, diagnostic)),
      ...program
        .getOptionsDiagnostics(cancellationToken)
        .map((diagnostic) => serializeDiagnostic("options", projectConfigPath, diagnostic)),
      ...program
        .getGlobalDiagnostics(cancellationToken)
        .map((diagnostic) => serializeDiagnostic("global", projectConfigPath, diagnostic)),
      ...program
        .getSyntacticDiagnostics(undefined, cancellationToken)
        .map((diagnostic) => serializeDiagnostic("syntactic", projectConfigPath, diagnostic)),
      ...program
        .getSemanticDiagnostics(undefined, cancellationToken)
        .map((diagnostic) => serializeDiagnostic("semantic", projectConfigPath, diagnostic)),
    );
    controller.checkpoint();
  }
  const diagnostics = [
    ...new Map(
      collected
        .sort((left, right) => ordinal(diagnosticKey(left), diagnosticKey(right)))
        .map((diagnostic) => [diagnosticKey(diagnostic), diagnostic]),
    ).values(),
  ];
  for (const _diagnostic of diagnostics) controller.addDiagnostic();

  const applicationIndex = indexApplicationWithController(manifest, controller);
  const sourceIndex = indexApplicationSourcesWithController(
    {
      manifest,
      program: graph.projects.map(({ program }) => program),
      projectRoot: graph.repositoryRoot,
      readFile: graph.readFile,
      sourceRoots: options.sourceRoots,
      limits: options.limits,
      signal: options.signal,
    },
    applicationIndex,
    controller,
  );

  graph.verifyReads();
  const files = graph.files();
  const sourceDigest = digest(JSON.stringify(files));
  const analysis: ApplicationProjectAnalysis = {
    format: "sync-engine.application-project-analysis",
    version: 2,
    manifestDigest: manifest.digest,
    provenance: {
      ...analysisProvenance(manifest),
      sourceRevision: options.sourceRevision,
      manifestSourceRevision: options.manifestSourceRevision,
      manifestDigest: manifest.digest,
      sourceDigest,
      tsconfigPath: graph.projectPath(graph.rootConfigPath),
      typescriptVersion: ts.version,
      projectReferences: graph.projectReferences,
      files,
    },
    diagnostics,
    manifestDiagnostics,
    applicationIndex,
    sourceIndex,
    resourceUsage: controller.usage(),
  };
  validateApplicationProjectAnalysis(analysis);
  return freezeAnalysisData(analysis);
}

function plainCloneable(value: unknown, path: string, active = new WeakSet<object>()): void {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain only structured-cloneable plain data`);
  }
  if (active.has(value)) throw new TypeError(`${path} must not contain cycles`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain objects and arrays`);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => plainCloneable(entry, `${path}[${index}]`, active));
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${path} must not contain symbol fields`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${path}.${key} must be an enumerable data field`);
      }
      plainCloneable(descriptor.value, `${path}.${key}`, active);
    }
  } finally {
    active.delete(value);
  }
}

function workerError(value: WorkerFailure["error"]): Error {
  if (
    value.code === "ANALYSIS_LIMIT_EXCEEDED" &&
    value.limit !== undefined &&
    value.maximum !== undefined &&
    value.attempted !== undefined
  ) {
    return new AnalysisLimitError(value.limit, value.maximum, value.attempted);
  }
  const error = new Error(value.message);
  error.name = value.name || "Error";
  if (value.stack !== undefined) error.stack = value.stack;
  if (value.code !== undefined) {
    Object.defineProperty(error, "code", { value: value.code, enumerable: true });
  }
  return error;
}

/**
 * Analyze a filesystem project in a Node worker. Aborting terminates the worker,
 * so no partial snapshot can be returned or retained by this API.
 */
export async function analyzeApplicationProject(
  options: AnalyzeApplicationProjectOptions,
): Promise<ApplicationProjectAnalysis> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be a plain object");
  }
  const optionsPrototype = Object.getPrototypeOf(options);
  if (optionsPrototype !== Object.prototype && optionsPrototype !== null) {
    throw new TypeError("options must be a plain object");
  }
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== "string") throw new TypeError("options must not contain symbol fields");
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`options.${key} must be an enumerable data field`);
    }
  }
  if (Object.hasOwn(options, "readFile")) {
    throw new TypeError("analyzeApplicationProject does not accept readFile");
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError("signal must be an AbortSignal when supplied");
  }
  if (options.signal?.aborted === true) throw new AnalysisAbortedError(options.signal.reason);
  const { signal, ...workerOptions } = options;
  plainCloneable(workerOptions, "options");
  const clonedOptions = structuredClone(workerOptions);
  const sourceWorker = new URL(import.meta.url).pathname.endsWith(".ts");
  const workerUrl = new URL(
    sourceWorker ? "./application-project-worker.ts" : "./application-project-worker.js",
    import.meta.url,
  );

  return await new Promise<ApplicationProjectAnalysis>((resolve, reject) => {
    const worker = new Worker(workerUrl, {
      ...(sourceWorker ? { execArgv: ["--experimental-transform-types", "--no-warnings"] } : {}),
      name: "sync-engine-project-analysis",
    });
    let settled = false;
    const cleanup = (): void => {
      signal?.removeEventListener("abort", onAbort);
      worker.removeAllListeners();
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      const error = new AnalysisAbortedError(signal?.reason);
      void worker.terminate().then(
        () => reject(error),
        () => reject(error),
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    worker.once("message", (message: WorkerResponse) => {
      if (settled) return;
      if (message === null || typeof message !== "object") {
        fail(new Error("Project analysis worker returned a malformed response"));
        return;
      }
      if (message.type === "error") {
        fail(workerError(message.error));
        return;
      }
      try {
        validateApplicationProjectAnalysis(message.analysis);
      } catch (error) {
        fail(error);
        return;
      }
      settled = true;
      cleanup();
      resolve(freezeAnalysisData(message.analysis));
    });
    worker.once("error", fail);
    worker.once("exit", (code) => {
      if (!settled) fail(new Error(`Project analysis worker exited before responding (${code})`));
    });
    worker.postMessage(clonedOptions);
  });
}

export { applicationProjectAnalysisDigest } from "../ir/application-project-format.ts";
