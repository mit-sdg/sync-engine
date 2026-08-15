import { conceptDirectories, conceptFailures } from "../src/command/check.ts";

const catalogConceptRoot = "packages/catalog/entries/concept";

/** Repository-only concept parser/source validation, intentionally not an installed CLI mode. */
export async function validateCatalogConcepts(projectRoot = process.cwd()): Promise<number> {
  const directories = await conceptDirectories([catalogConceptRoot], projectRoot);
  const failures = directories.flatMap((directory) => conceptFailures(directory, projectRoot));
  if (failures.length > 0) {
    throw new Error(
      `Catalog concept source check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }
  return directories.length;
}
