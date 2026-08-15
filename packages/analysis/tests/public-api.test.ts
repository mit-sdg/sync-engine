import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vite-plus/test";

const register = {
  ir: [
    "AnalysisAbortedError",
    "AnalysisAnalyzerIdentity",
    "AnalysisDiagnostic",
    "AnalysisDiagnosticOrigin",
    "AnalysisDiagnosticRaw",
    "AnalysisError",
    "AnalysisErrorCode",
    "AnalysisErrorData",
    "AnalysisIssue",
    "AnalysisIssueCode",
    "AnalysisLimitError",
    "AnalysisLimits",
    "AnalysisManifestProvenance",
    "AnalysisOptions",
    "AnalysisPage",
    "AnalysisPageRequest",
    "AnalysisProvenance",
    "AnalysisResourceUsage",
    "AnalysisSeverity",
    "ApplicationAnalysis",
    "ApplicationAnalysisIdentity",
    "ApplicationAnalysisOperationOptions",
    "ApplicationAnalysisProvenanceFacts",
    "ApplicationIndex",
    "ApplicationSourceDocumentRead",
    "ApplicationSourceIndex",
    "ApplicationSourceQuery",
    "ApplicationSourceReadError",
    "ApplicationSourceReadErrorCode",
    "CatalogFilters",
    "CatalogRequest",
    "CatalogResult",
    "ContractDeclaration",
    "ContractFilters",
    "ContractsRequest",
    "ContractsResult",
    "CreateApplicationAnalysisOptions",
    "DEFAULT_ANALYSIS_RESOURCE_LIMITS",
    "DescriptionDetail",
    "DescriptionResult",
    "DesignDefinition",
    "DesignRef",
    "DesignRefInput",
    "DesignSummary",
    "DiagnosticSeverityCounts",
    "DiagnosticsFilters",
    "DiagnosticsRequest",
    "DiagnosticsResult",
    "ImpactCertainty",
    "ImpactEdge",
    "ImpactRelation",
    "ImpactRequest",
    "ImpactResult",
    "ImpactTrace",
    "ImpactTraceEntry",
    "IndexedSourceDocument",
    "NavigateRequest",
    "NavigationDirection",
    "NavigationNode",
    "NavigationResult",
    "ProvenanceRequest",
    "ProvenanceResult",
    "ReadApplicationSourceDocumentOptions",
    "ReactionPortability",
    "SearchField",
    "SearchHit",
    "SearchRequest",
    "SearchResult",
    "SourceAnchor",
    "SourceAvailability",
    "SourceIndexEntry",
    "SourceIndexIssue",
    "SourceIndexIssueCode",
    "SourcePosition",
    "SourceQueryMatch",
    "SourceQueryMatchMode",
    "SourceQueryOptions",
    "SourceQueryResult",
    "SourceRange",
    "SourceResolution",
    "SourceRole",
    "SourceSpecificity",
    "SourcesRequest",
    "SourcesResult",
    "TraceOptions",
    "createApplicationAnalysis",
    "designRefKey",
    "designRefsForSourceRange",
    "indexApplication",
    "parseDesignRefKey",
    "queryApplicationSources",
    "readApplicationSourceDocument",
    "traceApplicationImpact",
  ],
  project: [
    "AnalyzeApplicationProjectOptions",
    "ApplicationProjectAnalysis",
    "ApplicationProjectDiagnostic",
    "ApplicationProjectDiagnosticCategory",
    "ApplicationProjectDiagnosticPhase",
    "ApplicationProjectDiagnosticRelatedInformation",
    "ApplicationProjectFile",
    "ApplicationProjectProvenance",
    "IndexApplicationSourcesOptions",
    "LoadApplicationProjectOptions",
    "SourceAttributionRoot",
    "analyzeApplicationProject",
    "applicationProjectAnalysisDigest",
    "indexApplicationSources",
    "loadApplicationProject",
    "parseApplicationProjectAnalysis",
    "renderApplicationProjectAnalysis",
    "validateApplicationProjectAnalysis",
  ],
} as const;

function referenceBlock(subpath: keyof typeof register): string {
  const exports = register[subpath].map((name) => `\`${name}\``).join(", ");
  return [
    `<!-- register:analysis-${subpath}:start -->`,
    "",
    exports,
    "",
    `<!-- register:analysis-${subpath}:end -->`,
  ].join("\n");
}

describe("analysis package public API", () => {
  test("the package metadata, barrels, and reference are exact", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const packageRoot = resolve(root, "packages/analysis");
    const corePackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      dependencies: { typescript: string };
      version: string;
    };
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      bin: Record<string, string>;
      dependencies: Record<string, string>;
      exports: Record<string, unknown>;
      peerDependencies: Record<string, string>;
      private?: boolean;
      publishConfig: { access: string; tag: string };
      repository: { directory: string };
      sideEffects: readonly string[];
    };
    expect(manifest.private).toBeUndefined();
    expect(manifest.publishConfig).toEqual({ access: "public", tag: "beta" });
    expect(manifest.repository.directory).toBe("packages/analysis");
    expect(manifest.bin).toEqual({ "sync-engine-analysis": "./dist/command.js" });
    expect(manifest.sideEffects).toEqual(["./dist/project/application-project-worker.js"]);
    expect(manifest.peerDependencies).toEqual({ "@mit-sdg/sync-engine": corePackage.version });
    expect(manifest.dependencies).toEqual({
      typescript: corePackage.dependencies.typescript,
    });
    expect(Object.keys(manifest.exports).sort()).toEqual(
      Object.keys(register)
        .map((subpath) => `./${subpath}`)
        .sort(),
    );

    const reference = readFileSync(resolve(packageRoot, "public-surface.md"), "utf8");
    for (const subpath of Object.keys(register) as Array<keyof typeof register>) {
      const sourceText = readFileSync(resolve(packageRoot, "src", subpath, "index.ts"), "utf8");
      const source = ts.createSourceFile("index.ts", sourceText, ts.ScriptTarget.Latest, true);
      expect(source.statements.every(ts.isExportDeclaration), `${subpath} exports only`).toBe(true);
      const actual = source.statements.flatMap((statement) =>
        ts.isExportDeclaration(statement) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map(({ name }) => name.text)
          : [],
      );
      expect(actual.sort(), subpath).toEqual([...register[subpath]].sort());

      const block = referenceBlock(subpath);
      expect(reference, `${subpath} full package path`).toContain(
        `@mit-sdg/sync-engine-analysis/${subpath}`,
      );
      expect(reference, `${subpath} reference unit`).toContain(block);
      expect(reference.indexOf(block), `${subpath} reference unit is unique`).toBe(
        reference.lastIndexOf(block),
      );
    }
  });
});
