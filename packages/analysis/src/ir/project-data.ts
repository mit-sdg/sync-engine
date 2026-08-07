import type { ApplicationDiagnostic } from "@mit-sdg/sync-engine/tooling";
import type { ApplicationIndex } from "./application-impact.ts";
import type { AnalysisProvenance } from "./analysis-provenance.ts";
import type { AnalysisResourceUsage, AnalysisSeverity } from "./analysis-foundation.ts";
import type { ApplicationSourceIndex } from "./source-data.ts";

export interface ApplicationProjectFile {
  /** POSIX path relative to the resolved repository root. */
  readonly path: string;
  /** SHA-256 of the exact UTF-8 text observed by analysis. */
  readonly digest: string;
  /** Exact UTF-8 byte length of the observed file. */
  readonly byteLength: number;
}

export type ApplicationProjectDiagnosticPhase =
  | "config"
  | "options"
  | "global"
  | "syntactic"
  | "semantic";

export type ApplicationProjectDiagnosticCategory = "warning" | "error" | "suggestion" | "message";

export interface ApplicationProjectDiagnosticRelatedInformation {
  /** Normalized analysis severity. */
  readonly severity: AnalysisSeverity;
  /** Exact TypeScript diagnostic category. */
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
  /** Project-relative config that produced this diagnostic. */
  readonly projectConfigPath?: string;
  readonly relatedInformation?: readonly ApplicationProjectDiagnosticRelatedInformation[];
}

export interface ApplicationProjectProvenance extends AnalysisProvenance {
  /** Caller assertion; project analysis does not inspect Git or another VCS. */
  readonly sourceRevision: string;
  /** Caller assertion identifying the revision claimed for the supplied manifest. */
  readonly manifestSourceRevision: string;
  readonly manifestDigest: string;
  /** SHA-256 over the ordered repository-relative path, digest, and byte-length records. */
  readonly sourceDigest: string;
  readonly tsconfigPath: string;
  readonly typescriptVersion: string;
  /** Every transitive referenced config in deterministic ordinal path order. */
  readonly projectReferences: readonly string[];
  readonly files: readonly ApplicationProjectFile[];
}

/**
 * One static, checkout-bound analysis retaining source metadata and digests,
 * never source bytes. Shape validation is not semantic source authentication.
 */
export interface ApplicationProjectAnalysis {
  readonly format: "sync-engine.application-project-analysis";
  readonly version: 2;
  readonly manifestDigest: string;
  readonly provenance: ApplicationProjectProvenance;
  readonly diagnostics: readonly ApplicationProjectDiagnostic[];
  readonly manifestDiagnostics: readonly ApplicationDiagnostic[];
  readonly applicationIndex: ApplicationIndex;
  readonly sourceIndex: ApplicationSourceIndex;
  readonly resourceUsage: AnalysisResourceUsage;
}
