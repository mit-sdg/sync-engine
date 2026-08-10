export type EntryKind = "concept" | "recipe";
export type FileClass = "owned" | "rendered";

export interface FileDeclaration {
  source: string;
  target: string;
  render?: "floor";
}
export interface FloorManifest {
  summary: string;
  packages?: Record<string, string>;
  files: FileDeclaration[];
}
export interface ConceptMetadata {
  name: string;
  export: string;
  registration: string;
}
export interface RecipeMetadata {
  module: string;
  test: string;
  members: string[];
  routes: Record<string, string>;
}
export interface EntryManifest {
  schema: 1;
  id: string;
  kind: EntryKind;
  summary: string;
  requires: string[];
  packages: Record<string, string>;
  files: FileDeclaration[];
  directory: string;
  concept?: ConceptMetadata;
  recipe?: RecipeMetadata;
  defaultFloor?: string;
  floors?: Record<string, FloorManifest>;
}
export interface TrackedFile {
  source: string;
  target: string;
  hash: string;
  class: FileClass;
}
export interface ConceptIntegration extends ConceptMetadata {
  kind: "concept";
}
export interface RecipeIntegration extends RecipeMetadata {
  kind: "recipe";
}
export type EntryIntegration = ConceptIntegration | RecipeIntegration;
export interface LockEntry {
  kind: EntryKind;
  catalogVersion: string;
  sourceDigest: string;
  requires: string[];
  floor?: string;
  packages: Record<string, string>;
  integration: EntryIntegration;
  files: TrackedFile[];
}
export interface GeneratedFile {
  target: string;
  hash: string;
}
export interface CatalogLock {
  schema: 1;
  floor?: string;
  paths: { concepts: "src/concepts"; recipes: "src/composition"; generated: "src/catalog" };
  entries: Record<string, LockEntry>;
  generated: GeneratedFile[];
}
export interface PlannedFile {
  source: string;
  target: string;
  contents: string;
  hash: string;
  class: FileClass | "generated";
  entry?: string;
}
