import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  parseApplicationDesignDocument,
  validateAuthoredApplicationDesignForm,
  type ApplicationDesignFormIssue,
  type AuthoredApplicationDesignDocument,
} from "@engine/tooling/authored-application-design";
import { scanDesignMarkdown } from "@engine/tooling/markdown-design-source";
import {
  validateSimpleStateForm,
  type SimpleStateFormIssue,
} from "@engine/tooling/simple-state-form";
import { parseSpec, type ConceptSpecDiagnostic } from "@engine/reactions/concepts/concept-spec";
import { specificationTypeNameEvidence } from "@engine/tooling/specification-type-evidence";
import { parseCommandOptions, type OutputFormat } from "./command-options.ts";
import {
  diagnosticReport,
  failedDiagnostic,
  writeJsonDocument,
  type DiagnosticRecord,
  type DiagnosticReport,
} from "./diagnostic-report.ts";

export interface CheckedDesignDocument {
  readonly path: string;
  readonly kind: "concept" | "application";
}

interface DesignCheckOutcome {
  readonly checked: readonly CheckedDesignDocument[];
  readonly failures: readonly string[];
  readonly diagnostics: readonly DiagnosticRecord[];
  readonly advice: readonly (readonly SimpleStateFormIssue[])[];
}

const usage = `sync-engine check-design <paths...> [--format json]
  Check explicit concept, composition, and application-types Markdown without loading configuration or application source.`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeConceptSpecDiagnostics(
  source: string,
  diagnostics: readonly ConceptSpecDiagnostic[],
): string {
  return diagnostics
    .map(
      ({ code, message, location }) =>
        `${source}:${location.line}:${location.column}: [${code}] ${message}`,
    )
    .join("\n");
}

function describeSimpleStateFormIssues(issues: readonly SimpleStateFormIssue[]): string {
  return issues
    .map(
      ({ code, message, suggestion, location }) =>
        `${location.source}:${location.line}:${location.column}: [${code}] ${message}\n  suggestion: ${suggestion}`,
    )
    .join("\n");
}

function conceptSpecDiagnostics(
  source: string,
  diagnostics: readonly ConceptSpecDiagnostic[],
): DiagnosticRecord[] {
  return diagnostics.map(
    ({ code, message, location }): DiagnosticRecord => ({
      code,
      path: source,
      line: location.line,
      column: location.column,
      severity: "error",
      message,
    }),
  );
}

function simpleStateFormDiagnostics(issues: readonly SimpleStateFormIssue[]): DiagnosticRecord[] {
  return issues.map(
    ({ code, message, suggestion, severity, location }): DiagnosticRecord => ({
      code,
      path: location.source,
      line: location.line,
      column: location.column,
      severity,
      message,
      suggestion,
    }),
  );
}

function applicationFormDiagnostic(issue: ApplicationDesignFormIssue): DiagnosticRecord {
  return {
    code: issue.code,
    path: issue.location.source,
    line: issue.location.line,
    column: issue.location.column,
    severity: "error",
    message: issue.message,
  };
}

function invalidDocumentDiagnostic(source: string, error: unknown): DiagnosticRecord {
  return {
    code: "DESIGN_DOCUMENT_INVALID",
    path: source,
    severity: "error",
    message: describe(error),
  };
}

function resemblesConcept(markdown: string, source: string): boolean {
  try {
    const scanned = scanDesignMarkdown(markdown, source);
    const sectionNames = new Set(["Purpose", "Principle", "Types", "State", "Actions", "Queries"]);
    return (
      scanned.headings.filter(({ level, text }) => level === 2 && sectionNames.has(text)).length >=
      2
    );
  } catch {
    return false;
  }
}

async function inspectDesignFiles(
  paths: readonly string[],
  root: string,
): Promise<DesignCheckOutcome> {
  const checked: CheckedDesignDocument[] = [];
  const applicationDocuments: AuthoredApplicationDesignDocument[] = [];
  const failures: string[] = [];
  const diagnostics: DiagnosticRecord[] = [];
  const advice: Array<readonly SimpleStateFormIssue[]> = [];

  for (const supplied of paths) {
    const absolute = resolve(root, supplied);
    const label = (relative(root, absolute) || supplied).split(sep).join("/");
    try {
      if (!(await stat(absolute)).isFile()) throw new Error("path is not a regular file");
      const markdown = await readFile(absolute, "utf8");
      const parsed = parseSpec(markdown);
      if (parsed.specification !== undefined) {
        const stateFence = scanDesignMarkdown(markdown, label).fences.find(
          ({ info }) => info === "state",
        );
        const stateIssues =
          stateFence === undefined
            ? []
            : validateSimpleStateForm(stateFence, {
                externalTypes: parsed.specification.externalTypes,
                evidenceTypeNames: specificationTypeNameEvidence(parsed.specification),
              });
        const stateErrors = stateIssues.filter(({ severity }) => severity === "error");
        if (stateErrors.length > 0) {
          failures.push(
            `Design document ${label} is invalid: ${describeSimpleStateFormIssues(stateErrors)}`,
          );
          diagnostics.push(...simpleStateFormDiagnostics(stateErrors));
          continue;
        }
        const stateAdvice = stateIssues.filter(({ severity }) => severity === "advice");
        if (stateAdvice.length > 0) {
          advice.push(stateAdvice);
          diagnostics.push(...simpleStateFormDiagnostics(stateAdvice));
        }
        checked.push({ path: label, kind: "concept" });
        continue;
      }

      try {
        applicationDocuments.push(parseApplicationDesignDocument(markdown, label));
        checked.push({ path: label, kind: "application" });
      } catch (applicationError) {
        const conceptShaped = resemblesConcept(markdown, label);
        const detail = conceptShaped
          ? describeConceptSpecDiagnostics(label, parsed.diagnostics)
          : describe(applicationError);
        failures.push(`Design document ${label} is invalid: ${detail}`);
        diagnostics.push(
          ...(conceptShaped
            ? conceptSpecDiagnostics(label, parsed.diagnostics)
            : [invalidDocumentDiagnostic(label, applicationError)]),
        );
      }
    } catch (error) {
      failures.push(`Design document ${label} is invalid: ${describe(error)}`);
      diagnostics.push(invalidDocumentDiagnostic(label, error));
    }
  }

  for (const issue of validateAuthoredApplicationDesignForm(applicationDocuments)) {
    failures.push(
      `Design document ${issue.location.source} is invalid: ${issue.location.source}:${issue.location.line}:${issue.location.column}: [${issue.code}] ${issue.message}`,
    );
    diagnostics.push(applicationFormDiagnostic(issue));
  }
  return { checked, failures, diagnostics, advice };
}

function printStateAdvice(advice: readonly (readonly SimpleStateFormIssue[])[]): void {
  for (const issues of advice) console.warn(describeSimpleStateFormIssues(issues));
}

function throwDesignFailures(failures: readonly string[]): void {
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

/** Check explicit authored-design files without consulting an assembly or project state. */
export async function checkDesignFiles(
  paths: readonly string[],
  root = process.cwd(),
): Promise<readonly CheckedDesignDocument[]> {
  const outcome = await inspectDesignFiles(paths, root);
  printStateAdvice(outcome.advice);
  throwDesignFailures(outcome.failures);
  return outcome.checked;
}

export async function checkDesignCommand(
  args: readonly string[],
  render: "text" | "silent" = "text",
): Promise<DiagnosticReport> {
  const options = parseCommandOptions(args, usage, { format: true, operands: "required" });
  const output: OutputFormat | "silent" = render === "silent" ? "silent" : options.format;

  let outcome: DesignCheckOutcome;
  try {
    outcome = await inspectDesignFiles(options.operands, process.cwd());
  } catch (error) {
    if (output !== "json") throw error;
    const report = diagnosticReport("check-design", "failed", [
      failedDiagnostic("CHECK_DESIGN_FAILURE", error),
    ]);
    writeJsonDocument(report);
    return report;
  }

  const report = diagnosticReport(
    "check-design",
    outcome.failures.length === 0 ? "passed" : "failed",
    outcome.diagnostics,
  );
  if (output === "json") {
    writeJsonDocument(report);
    return report;
  }
  if (output === "text") printStateAdvice(outcome.advice);
  throwDesignFailures(outcome.failures);
  if (output === "text") {
    console.log(
      `Design form check passed for ${outcome.checked.length} file${outcome.checked.length === 1 ? "" : "s"}.`,
    );
  }
  return report;
}
