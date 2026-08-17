import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import { wireProjectionFacts } from "@engine/boundary/gateway/transport-binding";
import { pascal, slug } from "@engine/utils/case";
import {
  applyArtifactPlan,
  checkArtifactPlan,
  type ArtifactFilesystem,
  type ArtifactPlan,
  type ArtifactStatus,
  planGenerated,
} from "./artifact-plan.ts";
import {
  applicationManifest,
  registerConfiguredAuthoredDesign,
  type ApplicationManifestV1,
} from "./manifest.ts";
import { checkAuthoredDesign } from "./authored-design-orchestration.ts";
import { authoritativeComputationInputs } from "./computation-source-analysis.ts";
import {
  registeredConceptSources,
  type RegisteredConceptSource,
} from "./concept-source-discovery.ts";
import { typeScriptSourceContext, type TypeScriptSourceContext } from "./typescript-shapes.ts";
import type { PlannedWireProjection, WireProjection } from "./wire-projection.ts";
import { ownedTypeNameSpellings, parseSimpleStateForm } from "@ssf";

type InspectableAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

/**
 * What a project's `generated.config.ts` declares. `assemble`, `title`, and
 * `design` are required; generated output paths and names follow from the title
 * and the config's own location unless overridden.
 */
export interface GeneratedApplicationDesign {
  /** Versioned shape of the authored application-design registration. */
  version: 1;
  /** Every application-design document, in registration order. */
  documents: readonly URL[];
}

export interface GeneratedApplication {
  assemble: () => InspectableAssembly;
  /** Release resources owned by this generation descriptor after assembly drain. */
  close?: () => void | Promise<void>;
  /** The application's name, used as the document title and to derive the rest. */
  title: string;
  /** Authored design sources checked for this exact application variant. */
  design: GeneratedApplicationDesign;
  /** Where generated files are written; defaults to `generated/` beside the config. */
  directory?: URL;
  /** The read-back's filename; defaults to the title, slugged, with `.md`. */
  specification?: string;
  /** The read-back's banner; defaults to one naming the assembly. */
  specificationBanner?: string;
  /** The wire contract's filename; defaults to `wire.ts`. */
  wire?: string;
  /** The wire contract's type name; defaults to the title in Pascal case, with `Wire`. */
  wireName?: string;
  /** The wire contract's banner; defaults to one naming the assembly. */
  wireBanner?: string;
  /**
   * The module whose exported concept set anchors generated wire types and source
   * analysis; defaults to `src/concepts.ts` beside the config, exporting
   * `applicationConceptSet`.
   */
  conceptSet?: { module?: URL; export?: string };
  /** Ordered transport-specific contracts appended after the logical wire. */
  projections?: readonly WireProjection[];
}

export type ResolvedApplication = GeneratedApplication & {
  directory: URL;
  specification: string;
  wire: string;
  wireName: string;
  /** The concept-set module analyzed at the generated-operation boundary. */
  conceptSetModule: URL;
  /** The specifier the generated wire imports its concept-set type anchor from. */
  conceptSetFrom: { from: string; export: string };
};

export interface GeneratedSourceAnalysis {
  /** Shared checker context; config checking reuses it for source-shape diagnostics. */
  context: TypeScriptSourceContext;
  /** Static registrations corresponding exactly to the selected canonical concepts. */
  concepts: readonly RegisteredConceptSource[];
}

interface OperationSourceAnalysis {
  context: TypeScriptSourceContext;
  concepts: readonly RegisteredConceptSource[];
  computationInputs: Map<string, ReturnType<typeof authoritativeComputationInputs>>;
}

/** Source analysis belongs to one inspection so later operations always observe disk edits. */
function sourceAnalysisForOperation(conceptSetModulePath: string): OperationSourceAnalysis {
  const context = typeScriptSourceContext(conceptSetModulePath);
  return {
    context,
    concepts: registeredConceptSources(conceptSetModulePath, context),
    computationInputs: new Map(),
  };
}

const configurationSource = new WeakMap<object, URL>();

/** The module specifier a file in `directory` uses to reach `target`. */
function specifierFrom(directory: URL, target: URL): string {
  const path = relative(fileURLToPath(directory), fileURLToPath(target)).split(/[\\/]/).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function requiredDesignUrl(value: unknown, label: string): { url: URL; path: string } {
  if (!(value instanceof URL)) {
    throw new Error(`generated config: ${label} must be a URL.`);
  }
  if (value.protocol !== "file:") {
    throw new Error(`generated config: ${label} must be a local file URL, not ${value.protocol}.`);
  }
  try {
    return { url: value, path: fileURLToPath(value) };
  } catch {
    throw new Error(`generated config: ${label} must be a local file URL.`);
  }
}

function resolveDesign(value: unknown): GeneratedApplicationDesign {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("generated config: design block is required.");
  }
  const design = value as Record<string, unknown>;
  if (design.version !== 1) {
    throw new Error("generated config: design.version must be 1.");
  }
  if (design.vocabulary !== undefined) {
    throw new Error(
      "generated config: design.vocabulary was removed; list application documents containing `instances`, `bindings`, `types`, or composition coverage in design.documents.",
    );
  }
  if (!Array.isArray(design.documents)) {
    throw new Error(
      "generated config: design.documents must be an array (use [] when there are no design documents).",
    );
  }

  const documents = design.documents.map((document, index) => {
    const label = `design.documents[${index}]`;
    return { label, ...requiredDesignUrl(document, label) };
  });

  const firstRegistration = new Map<string, string>();
  for (const source of documents) {
    const first = firstRegistration.get(source.path);
    if (first !== undefined) {
      throw new Error(`generated config: ${source.label} duplicates ${first}: ${source.path}.`);
    }
    firstRegistration.set(source.path, source.label);
  }
  for (const source of documents) {
    if (!existsSync(source.path)) {
      throw new Error(`generated config: ${source.label} does not exist: ${source.path}.`);
    }
  }

  return { version: 1, documents: documents.map(({ url }) => url) };
}

/** Fill and validate defaults relative to the declaring generated config. */
export function resolveApplication(
  application: GeneratedApplication,
  config: URL,
): ResolvedApplication {
  if (typeof application !== "object" || application === null || Array.isArray(application)) {
    throw new Error(
      "generated config: default export must be an application configuration object.",
    );
  }
  if ((application as { vocabulary?: unknown }).vocabulary !== undefined) {
    throw new Error(
      "generated config: top-level vocabulary was replaced by conceptSet; point conceptSet.module at the application concept-set export.",
    );
  }
  if (typeof application.title !== "string" || application.title.trim() === "") {
    throw new Error("generated config: title must name the application.");
  }
  if (typeof application.assemble !== "function") {
    throw new Error("generated config: assemble must build the application.");
  }
  if (application.close !== undefined && typeof application.close !== "function") {
    throw new Error("generated config: close must release generation resources.");
  }
  if (application.projections !== undefined && !Array.isArray(application.projections)) {
    throw new Error("generated config: projections must be an array.");
  }
  const design = resolveDesign(application.design);
  const directory = application.directory ?? new URL("./generated/", config);
  const module = application.conceptSet?.module ?? new URL("./src/concepts.ts", config);
  if (!existsSync(module)) {
    throw new Error(
      `generated config: no concept-set module at ${fileURLToPath(module)} — ` +
        "point `conceptSet.module` at the file exporting the application concept set.",
    );
  }
  const resolved: ResolvedApplication = {
    ...application,
    design,
    directory,
    specification: application.specification ?? `${slug(application.title)}.md`,
    wire: application.wire ?? "wire.ts",
    conceptSetModule: module,
    wireName: application.wireName ?? `${pascal(application.title)}Wire`,
    conceptSetFrom: {
      from: posix.normalize(specifierFrom(directory, module)),
      export: application.conceptSet?.export ?? "applicationConceptSet",
    },
  };
  configurationSource.set(resolved, config);
  return resolved;
}

async function prepareConfiguredDesign(
  application: ResolvedApplication,
  assembled: InspectableAssembly,
): Promise<GeneratedSourceAnalysis> {
  const conceptSetModulePath = fileURLToPath(application.conceptSetModule);
  const sourceAnalysis = sourceAnalysisForOperation(conceptSetModulePath);
  const concepts = sourceAnalysis.concepts;
  const uncheckedManifest = applicationManifest(assembled);
  const selectedConcepts = uncheckedManifest.conceptImplementations.filter(
    ({ canonical }) => canonical.owner === "application",
  );
  const sourcesByInstance = new Map(concepts.map((source) => [source.conceptName, source]));
  for (const selected of selectedConcepts) {
    const source = sourcesByInstance.get(selected.concept);
    if (source === undefined) {
      throw new Error(
        `generated source analysis: selected concept ${JSON.stringify(selected.concept)} is absent from the configured concept-set module.`,
      );
    }
    if (source.className !== selected.canonical.constructorName) {
      throw new Error(
        `generated source analysis: selected concept ${JSON.stringify(selected.concept)} uses canonical class ${JSON.stringify(selected.canonical.constructorName)}, but the configured concept-set module registers ${JSON.stringify(source.className)}.`,
      );
    }
  }
  const selectedNames = new Set(selectedConcepts.map(({ concept }) => concept));
  const extra = concepts.find(({ conceptName }) => !selectedNames.has(conceptName));
  if (extra !== undefined) {
    throw new Error(
      `generated source analysis: configured concept-set module registers unselected concept ${JSON.stringify(extra.conceptName)}.`,
    );
  }

  const checked = await checkAuthoredDesign({
    assembly: assembled,
    design: application.design,
    conceptSources: concepts.map(({ conceptName, specPath, specText }) => ({
      instance: conceptName,
      url: pathToFileURL(specPath),
      content: specText,
    })),
    resolveOwnedTypeNames: ({ specification }) =>
      ownedTypeNameSpellings(
        parseSimpleStateForm(specification.state.body, {
          externalTypes: specification.externalTypes.map(({ name }) => name),
        }).document.inventory,
      ),
    resolveComputationInputs: ({ computations }) => {
      const names = computations.map(({ name }) => name);
      const key = names.join("\0");
      const cached = sourceAnalysis.computationInputs.get(key);
      if (cached !== undefined) return cached;
      const inputs = authoritativeComputationInputs(
        conceptSetModulePath,
        names,
        sourceAnalysis.context,
      );
      sourceAnalysis.computationInputs.set(key, inputs);
      return inputs;
    },
  });
  const specificationPath = fileURLToPath(
    new URL(application.specification, application.directory),
  );
  registerConfiguredAuthoredDesign(assembled, {
    checked,
    paths: {
      relativePath(path) {
        const linked = relative(dirname(specificationPath), path).split(/[\\/]/).join("/");
        return linked.startsWith(".") ? linked : `./${linked}`;
      },
    },
  });
  return { context: sourceAnalysis.context, concepts };
}

async function completeGeneratedPlan(
  application: ResolvedApplication,
  assembled: InspectableAssembly,
): Promise<{
  manifest: ApplicationManifestV1;
  plan: ArtifactPlan;
}> {
  const manifest = applicationManifest(assembled);
  const projectionFacts = wireProjectionFacts(assembled, manifest.wire);
  const projections: PlannedWireProjection[] = (application.projections ?? []).map((projection) => {
    if (
      projection === null ||
      typeof projection !== "object" ||
      typeof projection.project !== "function"
    ) {
      throw new Error("generated config: every projection must provide project(facts).");
    }
    return { ...projection.project(projectionFacts), provenance: projection.provenance };
  });
  return {
    manifest,
    plan: planGenerated(manifest, {
      title: application.title,
      specification: application.specification,
      specificationBanner: application.specificationBanner,
      wire: application.wire,
      wireName: application.wireName,
      wireBanner: application.wireBanner,
      conceptSet: application.conceptSetFrom,
      strictLeaves: true,
      projections,
    }),
  };
}

export async function inspectGenerated<T>(
  application: ResolvedApplication,
  inspect: (
    assembly: InspectableAssembly,
    sourceAnalysis: GeneratedSourceAnalysis,
  ) => T | Promise<T>,
): Promise<T> {
  let assembled: InspectableAssembly | undefined;
  try {
    assembled = application.assemble();
    const sourceAnalysis = await prepareConfiguredDesign(application, assembled);
    return await inspect(assembled, sourceAnalysis);
  } finally {
    try {
      if (assembled !== undefined) {
        await assembled.beginDrain();
      }
    } finally {
      await application.close?.();
    }
  }
}

export async function renderGenerated(application: ResolvedApplication) {
  const { manifest, plan } = await inspectGenerated(application, (assembled) =>
    completeGeneratedPlan(application, assembled),
  );
  const specification = plan.entries.find(({ kind }) => kind === "specification")?.content;
  const wire = plan.entries.find(({ kind }) => kind === "wire")?.content;
  if (specification === undefined || wire === undefined) {
    throw new Error("generated artifacts: complete plan omitted required output.");
  }
  return {
    metrics: {
      reactions: manifest.application.reactions.length,
      views: manifest.application.views.length,
      formers: manifest.application.formers.length,
      compute: JSON.stringify(manifest.application).match(/"op":"compute"/g)?.length ?? 0,
    },
    specification,
    wire,
  };
}

async function canonicalPath(path: string): Promise<string> {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return resolve(await canonicalPath(parent), basename(absolute));
  }
}

async function safeArtifactTargets(
  application: ResolvedApplication,
  plan: ArtifactPlan,
  sourceAnalysis: GeneratedSourceAnalysis,
): Promise<Map<string, string>> {
  const inputs: Array<{ label: string; path: string }> = [];
  const config = configurationSource.get(application);
  if (config !== undefined) inputs.push({ label: "generated config", path: fileURLToPath(config) });
  application.design.documents.forEach((document, index) =>
    inputs.push({
      label: `design document ${index + 1}`,
      path: fileURLToPath(document),
    }),
  );
  inputs.push({
    label: "concept-set module",
    path: fileURLToPath(application.conceptSetModule),
  });
  for (const concept of sourceAnalysis.concepts) {
    inputs.push(
      { label: `concept specification for ${concept.conceptName}`, path: concept.specPath },
      { label: `concept implementation for ${concept.conceptName}`, path: concept.classPath },
    );
  }

  const authoritative = new Map<string, string>();
  for (const input of inputs) {
    const path = await canonicalPath(input.path);
    if (!authoritative.has(path)) authoritative.set(path, input.label);
  }

  const targets = new Map<string, string>();
  const targetOwners = new Map<string, string>();
  for (const entry of plan.entries) {
    const target = await canonicalPath(fileURLToPath(new URL(entry.path, application.directory)));
    const input = authoritative.get(target);
    if (input !== undefined) {
      throw new Error(
        `generated artifacts: output ${JSON.stringify(entry.path)} collides with authoritative ${input}: ${target}.`,
      );
    }
    const other = targetOwners.get(target);
    if (other !== undefined) {
      throw new Error(
        `generated artifacts: outputs ${JSON.stringify(other)} and ${JSON.stringify(entry.path)} resolve to the same target: ${target}.`,
      );
    }
    targets.set(entry.path, target);
    targetOwners.set(target, entry.path);
  }
  return targets;
}

async function generatedPlan(
  application: ResolvedApplication,
  artifact: "all" | "specification" | "wire" = "all",
): Promise<{ plan: ArtifactPlan; targets: Map<string, string> }> {
  return inspectGenerated(application, async (assembled, sourceAnalysis) => {
    const complete = (await completeGeneratedPlan(application, assembled)).plan;
    const plan =
      artifact === "all"
        ? complete
        : { entries: complete.entries.filter(({ kind }) => kind === artifact) };
    return { plan, targets: await safeArtifactTargets(application, plan, sourceAnalysis) };
  });
}

function nodeFilesystem(targets: ReadonlyMap<string, string>): ArtifactFilesystem {
  const targetFor = (path: string): string => {
    const target = targets.get(path);
    if (target === undefined) throw new Error(`generated artifacts: unresolved target ${path}.`);
    return target;
  };
  return {
    async read(path) {
      try {
        return await readFile(targetFor(path), "utf8");
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async writeAtomic(path, content) {
      const target = targetFor(path);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporary, content);
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    },
  };
}

function assertNoArtifactFailures(
  status: readonly ArtifactStatus[],
  operation: "apply" | "check",
): void {
  const failed = status.filter(({ status: state }) => state === "failed");
  if (failed.length > 0) {
    throw new Error(
      `generated artifacts: failed to ${operation} ${failed.map(({ path }) => path).join(", ")}`,
    );
  }
}

export async function pinGenerated(
  application: ResolvedApplication,
  artifact: "all" | "specification" | "wire" = "all",
): Promise<void> {
  const { plan, targets } = await generatedPlan(application, artifact);
  const status = await applyArtifactPlan(plan, nodeFilesystem(targets));
  assertNoArtifactFailures(status, "apply");
}

export async function checkGenerated(application: ResolvedApplication): Promise<void> {
  const { plan, targets } = await generatedPlan(application);
  const status = await checkArtifactPlan(plan, nodeFilesystem(targets));
  assertNoArtifactFailures(status, "check");
  const mismatches = status.filter(({ status: state }) => state !== "unchanged");
  if (mismatches.length > 0) {
    throw new Error(
      `${mismatches.map(({ path }) => path).join(" and ")} differ from generated output; inspect the changes and run the matching pin command`,
    );
  }
}
