import type { ApplicationManifestV1 } from "@mit-sdg/sync-engine/tooling";
import { createApplicationAnalysis, type DesignRef } from "./ir/index.ts";
import { analyzeApplicationProject, applicationProjectAnalysisDigest } from "./project/index.ts";
import type { CliOptions } from "./cli.ts";

/** Loaded lazily by the executable so manifest-only commands never load TypeScript. */
export async function runProjectCliCommand(
  options: CliOptions,
  manifest: ApplicationManifestV1,
  parseRef: (source: string) => DesignRef,
): Promise<unknown> {
  const sourceRevision = "local-analysis";
  const project = await analyzeApplicationProject({
    repositoryRoot: options.rootPath,
    tsconfigPath: options.tsconfigPath,
    sourceRevision,
    manifest,
    manifestSourceRevision: sourceRevision,
    expectedManifestDigest: manifest.digest,
    designSourceBasePath: options.designBasePath,
  });
  const analysis = createApplicationAnalysis({
    manifest,
    project,
    expectedProjectDigest: applicationProjectAnalysisDigest(project),
  });
  const page = { offset: options.offset, limit: options.limit };
  if (options.command === "sources") {
    const ref = parseRef(options.positionals[0] ?? "");
    const result = await analysis.sources({ query: { kind: "ref", ref }, page });
    return {
      ref: options.positionals[0],
      complete: result.complete,
      availability: result.total === 0 ? "unavailable" : "attributed",
      total: result.total,
      nextOffset: result.nextOffset,
      items: result.items.map(({ anchor }) => ({
        path: anchor.range.path,
        start: anchor.range.start,
        end: anchor.range.end,
        role: anchor.role,
        resolution: anchor.resolution,
      })),
      issues: result.issues.map(({ severity, code, message, paths }) => ({
        severity,
        code,
        message,
        paths,
      })),
    };
  }
  const result = await analysis.diagnostics({ page });
  return {
    total: result.total,
    nextOffset: result.nextOffset,
    items: result.items.map(({ severity, origin, code, message, refs, paths }) => ({
      severity,
      origin,
      code,
      message,
      refs,
      paths,
    })),
  };
}
