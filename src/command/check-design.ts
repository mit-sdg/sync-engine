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
import { parseSpec } from "@engine/reactions/concepts/concept-spec";
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

  for (const supplied of paths) {
    const absolute = resolve(root, supplied);
    const label = (relative(root, absolute) || supplied).split(sep).join("/");
    try {
      if (!(await stat(absolute)).isFile()) throw new Error("path is not a regular file");
      const markdown = await readFile(absolute, "utf8");
      let conceptError: unknown;
      let concept: ReturnType<typeof parseSpec> | undefined;
      try {
        concept = parseSpec(markdown);
      } catch (error) {
        conceptError = error;
      }
      if (concept !== undefined) {
        const stateFence = scanDesignMarkdown(markdown, label).fences.find(
          ({ info }) => info === "state",
        );
        const stateIssues =
          stateFence === undefined
            ? []
            : validateSimpleStateForm(stateFence, {
                externalTypes: concept.externalTypes.map(({ name }) => name),
                evidenceTypeNames: specificationTypeNameEvidence(concept),
              });
        if (stateIssues.length > 0) throw new Error(describeSimpleStateFormIssues(stateIssues));
        checked.push({ path: label, kind: "concept" });
        continue;
      }

      try {
        applicationDocuments.push(parseApplicationDesignDocument(markdown, label));
      } catch (applicationError) {
        throw resemblesConcept(markdown, label) ? conceptError : applicationError;
      }
      checked.push({ path: label, kind: "application" });
    } catch (error) {
      throw new Error(`Design document ${label} is invalid: ${describe(error)}`);
    }
  }
  const issue = validateAuthoredApplicationDesignForm(applicationDocuments)[0];
  if (issue !== undefined) {
    throw new Error(
      `Design document ${issue.location.source} is invalid: ${issue.location.source}:${issue.location.line}:${issue.location.column}: [${issue.code}] ${issue.message}`,
    );
  }
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
