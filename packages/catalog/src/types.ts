export type EntryKind = "computation" | "concept" | "recipe";

export interface CatalogFile {
  source: string;
  target: string;
}

export interface ConceptIntegration {
  name: string;
  registration: string;
  export: string;
}

export interface ComputationIntegration {
  module: string;
  exports: string[];
}

export interface RecipeIntegration {
  module: string;
  test?: string;
  members: string[];
}

export interface ConceptVariant {
  summary: string;
  files: CatalogFile[];
  packages?: Record<string, string>;
}

export interface EntryManifest {
  schema: 1;
  id: string;
  kind: EntryKind;
  summary: string;
  requires?: string[];
  packages?: Record<string, string>;
  files?: CatalogFile[];
  variants?: Record<string, ConceptVariant>;
  concept?: ConceptIntegration;
  computation?: ComputationIntegration;
  recipe?: RecipeIntegration;
}

export interface CatalogEntry {
  directory: string;
  manifest: EntryManifest;
}

export interface CatalogConfig {
  concepts: string;
  computations: string;
  recipes: string;
  conceptSet: string;
  declarations: string;
  registrations: string;
  composition: string;
}

export interface LockedFile {
  source: string;
  target: string;
  hash: string;
}

export interface LockedConceptIntegration extends ConceptIntegration {
  kind: "concept";
}

export interface LockedComputationIntegration extends ComputationIntegration {
  kind: "computation";
}

export interface LockedRecipeIntegration extends RecipeIntegration {
  kind: "recipe";
}

export type LockedIntegration =
  | LockedConceptIntegration
  | LockedComputationIntegration
  | LockedRecipeIntegration;

export interface LockedEntry {
  kind: EntryKind;
  catalogVersion: string;
  sourceDigest: string;
  requires: string[];
  packages: Record<string, string>;
  variant?: string;
  files: LockedFile[];
  integration?: LockedIntegration;
}

export interface CatalogLock {
  schema: 1;
  paths: InitPaths;
  entries: Record<string, LockedEntry>;
}

export interface InitPaths {
  concepts?: string;
  computations?: string;
  recipes?: string;
  conceptSet?: string;
  declarations?: string;
  registrations?: string;
  composition?: string;
}

export interface AddOptions {
  variants: Map<string, string>;
  recipeFile?: string;
}
