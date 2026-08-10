export type EntryKind = "concept" | "recipe";
export type FileClass = "owned" | "rendered";

export interface FileDeclaration {
  source: string;
  target: string;
  render?: "floor";
}
export interface FloorManifest {
  summary: string;
  packages: Record<string, string>;
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
interface EntryBase {
  schema: 1;
  id: string;
  summary: string;
  packages: Record<string, string>;
  files: FileDeclaration[];
  directory: string;
}
export interface ConceptManifest extends EntryBase {
  kind: "concept";
  requires: [];
  concept: ConceptMetadata;
  defaultFloor: string;
  floors: Record<string, FloorManifest>;
}
export interface RecipeManifest extends EntryBase {
  kind: "recipe";
  requires: string[];
  recipe: RecipeMetadata;
}
export type EntryManifest = ConceptManifest | RecipeManifest;

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
interface LockEntryBase {
  catalogVersion: string;
  sourceDigest: string;
  requires: string[];
  packages: Record<string, string>;
  files: TrackedFile[];
}
export interface ConceptLockEntry extends LockEntryBase {
  kind: "concept";
  requires: [];
  floor: string;
  integration: ConceptIntegration;
}
export interface RecipeLockEntry extends LockEntryBase {
  kind: "recipe";
  integration: RecipeIntegration;
}
export type LockEntry = ConceptLockEntry | RecipeLockEntry;
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

export interface MaterializedEntry {
  entry: EntryManifest;
  floor?: string;
  packages: Record<string, string>;
  integration: EntryIntegration;
  files: MaterializedFile[];
  sourceDigest: string;
}
export interface MaterializedFile {
  source: string;
  target: string;
  contents: string;
  hash: string;
  class: FileClass;
}
export interface EntryPlannedFile extends MaterializedFile {
  ownership: "entry";
  entry: string;
}
export interface GeneratedPlannedFile {
  source: "generated";
  target: string;
  contents: string;
  hash: string;
  class: "generated";
  ownership: "generated";
}
export type PlannedFile = EntryPlannedFile | GeneratedPlannedFile;
