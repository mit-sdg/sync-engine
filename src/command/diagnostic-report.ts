import { describeError } from "@engine/utils/redaction";

/** The complete severity vocabulary emitted by the validation commands. */
export type DiagnosticSeverity = "advice" | "error" | "info" | "warning";

/**
 * One machine-readable validation finding. Unknown source coordinates and
 * suggestions are omitted rather than represented with invented values.
 */
export interface DiagnosticRecord {
  readonly code: string;
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly suggestion?: string;
}

export type DiagnosticReportCommand = "artifacts check" | "check" | "check-design";

/** Versioned JSON contract shared by the diagnostic-producing validation commands. */
export interface DiagnosticReport {
  readonly format: "sync-engine.diagnostic-report";
  readonly version: 1;
  readonly command: DiagnosticReportCommand;
  readonly status: "passed" | "failed";
  readonly diagnostics: readonly DiagnosticRecord[];
}

/** Normalize optional fields so every producer omits unavailable facts consistently. */
export function diagnosticRecord(record: DiagnosticRecord): DiagnosticRecord {
  return {
    code: record.code,
    ...(record.path === undefined ? {} : { path: record.path }),
    ...(record.line === undefined ? {} : { line: record.line }),
    ...(record.column === undefined ? {} : { column: record.column }),
    severity: record.severity,
    message: record.message,
    ...(record.suggestion === undefined ? {} : { suggestion: record.suggestion }),
  };
}

export function failedDiagnostic(code: string, error: unknown): DiagnosticRecord {
  return diagnosticRecord({
    code,
    severity: "error",
    message: describeError(error),
  });
}

export function diagnosticReport(
  command: DiagnosticReportCommand,
  status: DiagnosticReport["status"],
  diagnostics: readonly DiagnosticRecord[],
): DiagnosticReport {
  return {
    format: "sync-engine.diagnostic-report",
    version: 1,
    command,
    status,
    diagnostics,
  };
}

/** Render exactly one newline-terminated JSON document for stdout. */
export function renderJsonDocument(document: object): string {
  return `${JSON.stringify(document)}\n`;
}

export function writeJsonDocument(document: object): void {
  process.stdout.write(renderJsonDocument(document));
}
