import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseSpec } from "@engine/reactions/concepts/concept-spec";

export interface CheckedConceptSpecification {
  readonly path: string;
  readonly definition: string;
}

const usage = `sync-engine check-concepts <paths...>
  Parse draft concept specifications without loading application source or configuration.`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Parse explicit draft concept files without consulting an application or writing evidence. */
export async function checkConceptFiles(
  paths: readonly string[],
  root = process.cwd(),
): Promise<readonly CheckedConceptSpecification[]> {
  const checked: CheckedConceptSpecification[] = [];
  for (const supplied of paths) {
    const absolute = resolve(root, supplied);
    const label = relative(root, absolute) || supplied;
    try {
      if (!(await stat(absolute)).isFile()) throw new Error("path is not a regular file");
      const specification = parseSpec(await readFile(absolute, "utf8"));
      checked.push({ path: label, definition: specification.definitionName });
    } catch (error) {
      throw new Error(`Concept specification ${label} is invalid: ${describe(error)}`);
    }
  }
  return checked;
}

export async function checkConceptsCommand(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args.some((argument) => argument.startsWith("-"))) {
    throw new Error(usage);
  }
  const checked = await checkConceptFiles(args);
  console.log(
    `Concept specification syntax check passed for ${checked.length} file${checked.length === 1 ? "" : "s"}.`,
  );
}
