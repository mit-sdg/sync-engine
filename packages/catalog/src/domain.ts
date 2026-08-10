export const CONCEPT_TARGET = "$concepts/";
export const RECIPE_TARGET = "$recipes/";
export const CATALOG_PATHS = {
  concepts: "src/concepts",
  recipes: "src/composition",
  generated: "src/catalog",
} as const;
export const GENERATED_TARGETS = [
  "src/catalog/composition.generated.ts",
  "src/catalog/registrations.generated.ts",
  "src/catalog/text.generated.d.ts",
] as const;
export const ENTRY_ID = /^(?:concept|recipe)\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
export const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

export function installedTarget(target: string): string {
  return target
    .replace(CONCEPT_TARGET, `${CATALOG_PATHS.concepts}/`)
    .replace(RECIPE_TARGET, `${CATALOG_PATHS.recipes}/`);
}
export function targetToken(kind: "concept" | "recipe"): string {
  return kind === "concept" ? CONCEPT_TARGET : RECIPE_TARGET;
}
export function targetRoot(kind: "concept" | "recipe"): string {
  return `${kind === "concept" ? CATALOG_PATHS.concepts : CATALOG_PATHS.recipes}/`;
}
