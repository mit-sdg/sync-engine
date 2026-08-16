import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  parseApplicationDesignDocument,
  validateAuthoredApplicationDesignForm,
  type AuthoredApplicationDesignDocument,
} from "@engine/tooling/authored-application-design";
import { scanDesignMarkdown } from "@engine/tooling/markdown-design-source";
import { parseSpec } from "@engine/reactions/concepts/concept-spec";

export interface CheckedDesignDocument {
  readonly path: string;
  readonly kind: "concept" | "application";
}

const usage = `sync-engine check-design <paths...>
  Check explicit concept, composition, and application-types Markdown without loading configuration or application source.`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
      try {
        parseSpec(markdown);
        checked.push({ path: label, kind: "concept" });
        continue;
      } catch (error) {
        conceptError = error;
      }

      try {
        applicationDocuments.push(parseApplicationDesignDocument(markdown, label));
      } catch (applicationError) {
        throw resemblesConcept(markdown, label) ? conceptError : applicationError;
      }
      const issue = validateAuthoredApplicationDesignForm(applicationDocuments)[0];
      if (issue !== undefined) {
        throw new Error(
          `${issue.location.source}:${issue.location.line}:${issue.location.column}: [${issue.code}] ${issue.message}`,
        );
      }
      checked.push({ path: label, kind: "application" });
    } catch (error) {
      throw new Error(`Design document ${label} is invalid: ${describe(error)}`);
    }
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
