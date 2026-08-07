export type AnalysisSeverity = "error" | "warning" | "info";

/** Hard construction limits shared by all synchronous analysis operations. */
export interface AnalysisLimits {
  readonly maxGraphNodes?: number;
  readonly maxGraphEdges?: number;
  readonly maxDiagnostics?: number;
  readonly maxSourceDocuments?: number;
  readonly maxSourceAnchors?: number;
  /** Maximum recursive static-value/symbol steps. Defaults to 32. */
  readonly maxStaticResolutionDepth?: number;
  /** Maximum alternatives retained before a value is reported unresolved. Defaults to 32. */
  readonly maxStaticResolutionAlternatives?: number;
  /** Maximum AST nodes inspected during source discovery. Defaults to 100,000. */
  readonly maxAstCandidates?: number;
  /** Maximum AST nodes retained across unique repository source trees. Defaults to 1,000,000. */
  readonly maxAstNodes?: number;
  readonly maxProjectFiles?: number;
  readonly maxProjectFileBytes?: number;
  readonly maxProjectTotalBytes?: number;
}

export interface AnalysisOptions {
  readonly limits?: AnalysisLimits;
  /** Checked at deterministic synchronous checkpoints; this is not timer-preemptive cancellation. */
  readonly signal?: AbortSignal;
}

/** Deduplicated resources retained by one analysis result. */
export interface AnalysisResourceUsage {
  readonly graphNodes: number;
  readonly graphEdges: number;
  readonly diagnostics: number;
  readonly sourceDocuments: number;
  readonly sourceAnchors: number;
  /** Producer-reported AST work; not independently derivable from the durable snapshot. */
  readonly astNodes: number;
  readonly projectFiles: number;
  /** For project artifacts, the exact sum of provenance file `byteLength` records. */
  readonly projectBytes: number;
}

type ResolvedAnalysisLimits = Required<AnalysisLimits>;
type UsageCounter = keyof AnalysisResourceUsage;
type AnalysisLimitName = keyof AnalysisLimits;

/** Exact defaults applied to omitted analysis construction limits. */
export const DEFAULT_ANALYSIS_RESOURCE_LIMITS = {
  maxGraphNodes: 100_000,
  maxGraphEdges: 500_000,
  maxDiagnostics: 10_000,
  maxSourceDocuments: 20_000,
  maxSourceAnchors: 100_000,
  maxStaticResolutionDepth: 32,
  maxStaticResolutionAlternatives: 32,
  maxAstCandidates: 100_000,
  maxAstNodes: 1_000_000,
  maxProjectFiles: 20_000,
  maxProjectFileBytes: 16_777_216,
  maxProjectTotalBytes: 268_435_456,
} as const satisfies ResolvedAnalysisLimits;

const EMPTY_USAGE: AnalysisResourceUsage = {
  graphNodes: 0,
  graphEdges: 0,
  diagnostics: 0,
  sourceDocuments: 0,
  sourceAnchors: 0,
  astNodes: 0,
  projectFiles: 0,
  projectBytes: 0,
};

/** A hard construction limit was exceeded; no partial artifact is returned. */
export class AnalysisLimitError extends Error {
  readonly code = "ANALYSIS_LIMIT_EXCEEDED";

  constructor(
    readonly limit: AnalysisLimitName,
    readonly maximum: number,
    readonly attempted: number,
  ) {
    super(`${limit} is ${maximum}, but analysis attempted to retain ${attempted}`);
    this.name = "AnalysisLimitError";
  }
}

/** An AbortSignal was observed at a synchronous analysis checkpoint. */
export class AnalysisAbortedError extends Error {
  readonly code = "ANALYSIS_ABORTED";

  constructor(readonly reason?: unknown) {
    super("Analysis was aborted");
    this.name = "AnalysisAbortedError";
  }
}

function resolvedLimit(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return selected;
}

function resolveLimits(limits: AnalysisLimits = {}): ResolvedAnalysisLimits {
  return {
    maxGraphNodes: resolvedLimit(
      limits.maxGraphNodes,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxGraphNodes,
      "maxGraphNodes",
    ),
    maxGraphEdges: resolvedLimit(
      limits.maxGraphEdges,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxGraphEdges,
      "maxGraphEdges",
    ),
    maxDiagnostics: resolvedLimit(
      limits.maxDiagnostics,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxDiagnostics,
      "maxDiagnostics",
    ),
    maxSourceDocuments: resolvedLimit(
      limits.maxSourceDocuments,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxSourceDocuments,
      "maxSourceDocuments",
    ),
    maxSourceAnchors: resolvedLimit(
      limits.maxSourceAnchors,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxSourceAnchors,
      "maxSourceAnchors",
    ),
    maxStaticResolutionDepth: resolvedLimit(
      limits.maxStaticResolutionDepth,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxStaticResolutionDepth,
      "maxStaticResolutionDepth",
    ),
    maxStaticResolutionAlternatives: resolvedLimit(
      limits.maxStaticResolutionAlternatives,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxStaticResolutionAlternatives,
      "maxStaticResolutionAlternatives",
    ),
    maxAstCandidates: resolvedLimit(
      limits.maxAstCandidates,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxAstCandidates,
      "maxAstCandidates",
    ),
    maxAstNodes: resolvedLimit(
      limits.maxAstNodes,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxAstNodes,
      "maxAstNodes",
    ),
    maxProjectFiles: resolvedLimit(
      limits.maxProjectFiles,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxProjectFiles,
      "maxProjectFiles",
    ),
    maxProjectFileBytes: resolvedLimit(
      limits.maxProjectFileBytes,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxProjectFileBytes,
      "maxProjectFileBytes",
    ),
    maxProjectTotalBytes: resolvedLimit(
      limits.maxProjectTotalBytes,
      DEFAULT_ANALYSIS_RESOURCE_LIMITS.maxProjectTotalBytes,
      "maxProjectTotalBytes",
    ),
  };
}

export class AnalysisController {
  readonly limits: ResolvedAnalysisLimits;
  readonly signal: AbortSignal | undefined;
  private readonly counts: Record<UsageCounter, number> = { ...EMPTY_USAGE };

  constructor(options: AnalysisOptions = {}) {
    this.signal = options.signal;
    if (this.signal?.aborted === true) throw new AnalysisAbortedError(this.signal.reason);
    this.limits = resolveLimits(options.limits);
  }

  checkpoint(): void {
    if (this.signal?.aborted === true) throw new AnalysisAbortedError(this.signal.reason);
  }

  private add(counter: UsageCounter, amount: number, limit: AnalysisLimitName): void {
    this.checkpoint();
    const attempted = this.counts[counter] + amount;
    const maximum = this.limits[limit];
    if (attempted > maximum) throw new AnalysisLimitError(limit, maximum, attempted);
    this.counts[counter] = attempted;
  }

  addGraphNode(): void {
    this.add("graphNodes", 1, "maxGraphNodes");
  }

  addGraphEdge(): void {
    this.add("graphEdges", 1, "maxGraphEdges");
  }

  addDiagnostic(): void {
    this.add("diagnostics", 1, "maxDiagnostics");
  }

  addSourceDocument(): void {
    this.add("sourceDocuments", 1, "maxSourceDocuments");
  }

  addSourceAnchor(): void {
    this.add("sourceAnchors", 1, "maxSourceAnchors");
  }

  addAstNode(): void {
    this.add("astNodes", 1, "maxAstNodes");
  }

  addProjectFile(byteLength: number): void {
    this.checkpoint();
    if (byteLength > this.limits.maxProjectFileBytes) {
      throw new AnalysisLimitError(
        "maxProjectFileBytes",
        this.limits.maxProjectFileBytes,
        byteLength,
      );
    }
    const files = this.counts.projectFiles + 1;
    if (files > this.limits.maxProjectFiles) {
      throw new AnalysisLimitError("maxProjectFiles", this.limits.maxProjectFiles, files);
    }
    const bytes = this.counts.projectBytes + byteLength;
    if (bytes > this.limits.maxProjectTotalBytes) {
      throw new AnalysisLimitError("maxProjectTotalBytes", this.limits.maxProjectTotalBytes, bytes);
    }
    this.counts.projectFiles = files;
    this.counts.projectBytes = bytes;
  }

  usage(): AnalysisResourceUsage {
    return { ...this.counts };
  }
}

export function usageDelta(
  before: AnalysisResourceUsage,
  after: AnalysisResourceUsage,
): AnalysisResourceUsage {
  return {
    graphNodes: after.graphNodes - before.graphNodes,
    graphEdges: after.graphEdges - before.graphEdges,
    diagnostics: after.diagnostics - before.diagnostics,
    sourceDocuments: after.sourceDocuments - before.sourceDocuments,
    sourceAnchors: after.sourceAnchors - before.sourceAnchors,
    astNodes: after.astNodes - before.astNodes,
    projectFiles: after.projectFiles - before.projectFiles,
    projectBytes: after.projectBytes - before.projectBytes,
  };
}

export function combineResourceUsage(
  ...values: readonly AnalysisResourceUsage[]
): AnalysisResourceUsage {
  const result = { ...EMPTY_USAGE };
  for (const value of values) {
    for (const key of Object.keys(result) as UsageCounter[]) result[key] += value[key];
  }
  return result;
}
