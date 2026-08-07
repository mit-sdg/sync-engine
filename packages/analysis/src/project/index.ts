export {
  applicationProjectAnalysisDigest,
  parseApplicationProjectAnalysis,
  renderApplicationProjectAnalysis,
  validateApplicationProjectAnalysis,
} from "../ir/application-project-format.ts";
export { analyzeApplicationProject, loadApplicationProject } from "./application-project.ts";
export { indexApplicationSources } from "./source-index.ts";
export type {
  ApplicationProjectAnalysis,
  ApplicationProjectDiagnostic,
  ApplicationProjectDiagnosticCategory,
  ApplicationProjectDiagnosticPhase,
  ApplicationProjectDiagnosticRelatedInformation,
  ApplicationProjectFile,
  ApplicationProjectProvenance,
} from "../ir/project-data.ts";
export type {
  AnalyzeApplicationProjectOptions,
  LoadApplicationProjectOptions,
} from "./application-project.ts";
export type { IndexApplicationSourcesOptions, SourceAttributionRoot } from "./source-index.ts";
