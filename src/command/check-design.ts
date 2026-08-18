import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  parseApplicationDesignDocument,
  validateAuthoredApplicationDesignForm,
  type AuthoredApplicationDesignDocument,
} from "@engine/tooling/authored-application-design";
import { scanDesignMarkdown } from "@engine/tooling/markdown-design-source";
import {
  validateSimpleStateForm,
  type SimpleStateFormIssue,
} from "@engine/tooling/simple-state-form";
import { parseSpec, type ConceptSpecDiagnostic } from "@engine/reactions/concepts/concept-spec";
import { specificationTypeNameEvidence } from "@engine/tooling/specification-type-evidence";

export interface CheckedDesignDocument {
  readonly path: string;
  readonly kind: "concept" | "application";
}

const usage = `sync-engine check-design <paths...>
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

/** Check explicit authored-design files without consulting an assembly or project state. */
export async function checkDesignFiles(
  paths: readonly string[],
  root = process.cwd(),
): Promise<readonly CheckedDesignDocument[]> {
  const checked: CheckedDesignDocument[] = [];
  const applicationDocuments: AuthoredApplicationDesignDocument[] = [];
  const failures: string[] = [];

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
          continue;
        }
        const stateAdvice = stateIssues.filter(({ severity }) => severity === "advice");
        if (stateAdvice.length > 0) console.warn(describeSimpleStateFormIssues(stateAdvice));
        checked.push({ path: label, kind: "concept" });
        continue;
      }

      try {
        applicationDocuments.push(parseApplicationDesignDocument(markdown, label));
        checked.push({ path: label, kind: "application" });
      } catch (applicationError) {
        const detail = resemblesConcept(markdown, label)
          ? describeConceptSpecDiagnostics(label, parsed.diagnostics)
          : describe(applicationError);
        failures.push(`Design document ${label} is invalid: ${detail}`);
      }
    } catch (error) {
      failures.push(`Design document ${label} is invalid: ${describe(error)}`);
    }
  }

  for (const issue of validateAuthoredApplicationDesignForm(applicationDocuments)) {
    failures.push(
      `Design document ${issue.location.source} is invalid: ${issue.location.source}:${issue.location.line}:${issue.location.column}: [${issue.code}] ${issue.message}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
  return checked;
}

export async function checkDesignCommand(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args.some((argument) => argument.startsWith("-"))) {
    throw new Error(usage);
  }
  const checked = await checkDesignFiles(args);
  console.log(
    `Design form check passed for ${checked.length} file${checked.length === 1 ? "" : "s"}.`,
  );
}
