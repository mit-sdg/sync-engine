import {
  createApplicationAnalysis,
  DEFAULT_ANALYSIS_RESOURCE_LIMITS,
  type AnalysisLimits,
  type ApplicationAnalysis,
  type CreateApplicationAnalysisOptions,
} from "@mit-sdg/sync-engine-analysis/ir";
import {
  analyzeApplicationProject,
  applicationProjectAnalysisDigest,
  type AnalyzeApplicationProjectOptions,
  type ApplicationProjectAnalysis,
} from "@mit-sdg/sync-engine-analysis/project";

const limits: AnalysisLimits = DEFAULT_ANALYSIS_RESOURCE_LIMITS;
const createAnalysis: (options: CreateApplicationAnalysisOptions) => ApplicationAnalysis =
  createApplicationAnalysis;
const analyzeProject: (
  options: AnalyzeApplicationProjectOptions,
) => Promise<ApplicationProjectAnalysis> = analyzeApplicationProject;
const digestProject: (analysis: ApplicationProjectAnalysis) => string =
  applicationProjectAnalysisDigest;

void [limits, createAnalysis, analyzeProject, digestProject];
