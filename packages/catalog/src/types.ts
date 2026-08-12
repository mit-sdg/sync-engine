export type EntryKind = "concept" | "recipe";

export interface ImplementationManifest {
  summary: string;
  sources: string[];
}

interface EntryBase {
  schema: 2;
  id: string;
  kind: EntryKind;
  summary: string;
  design: string;
  sources: string[];
  directory: string;
}

export interface ConceptManifest extends EntryBase {
  kind: "concept";
  implementations: Record<string, ImplementationManifest>;
}

export interface RecipeManifest extends EntryBase {
  kind: "recipe";
  requires: string[];
}

export type EntryManifest = ConceptManifest | RecipeManifest;

export interface CatalogSource {
  selector: string;
  path: string;
}
