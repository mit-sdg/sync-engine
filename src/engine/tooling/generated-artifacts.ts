import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
import {
  checkAuthoredDesign,
  type ConceptSpecificationSourceInput,
  type ResolveComputationInputs,
} from "./authored-design-orchestration.ts";
import type { PlannedWireProjection, WireProjection } from "./wire-projection.ts";

type InspectableAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

/**
 * What a project's `generated.config.ts` declares. `assemble`, `title`, and
 * `design` are required; generated output paths and names follow from the title
 * and the config's own location unless overridden.
 */
export interface GeneratedApplicationDesign {
  /** Versioned shape of the authored application-design registration. */
  version: 1;
  /** The optional application vocabulary-design document. */
  vocabulary?: URL;
  /** Every other application-design document, in registration order. */
  documents: readonly URL[];
}

export interface GeneratedAuthoredDesignAdapters {
  /** Strict static trace from selected concept instances to their imported Markdown. */
  conceptSources: (
    assembly: InspectableAssembly,
  ) =>
    | readonly ConceptSpecificationSourceInput[]
    | Promise<readonly ConceptSpecificationSourceInput[]>;
  /** Authoritative TypeScript analysis for executable computation input optionality. */
  resolveComputationInputs: ResolveComputationInputs;
}

export interface GeneratedApplication {
  assemble: () => InspectableAssembly;
  /** Release resources owned by this generation descriptor after assembly drain. */
  close?: () => void | Promise<void>;
  /** The application's name, used as the document title and to derive the rest. */
  title: string;
  /** Authored design sources checked for this exact application variant. */
  design: GeneratedApplicationDesign;
  /** Required source-analysis adapters when selected concepts or computations need them. */
  authoredDesignAdapters?: GeneratedAuthoredDesignAdapters;
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
   * The executable module whose export anchors generated wire types to concept
   * signatures; defaults to `src/concept-set.ts` beside the config, exporting
   * `vocabulary`. This is distinct from the authored `design.vocabulary` document.
   */
  vocabulary?: { module?: URL; export?: string };
  /** Ordered transport-specific contracts appended after the logical wire. */
  projections?: readonly WireProjection[];
}

export type ResolvedApplication = GeneratedApplication & {
  directory: URL;
  specification: string;
  wire: string;
  wireName: string;
  /** The specifier the generated wire imports its executable type anchor from. */
  vocabularyFrom: { from: string; export: string };
};

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
  if (!Array.isArray(design.documents)) {
    throw new Error(
      "generated config: design.documents must be an array (use [] when there are no design documents).",
    );
  }

  const vocabulary =
    design.vocabulary === undefined
      ? undefined
      : {
          label: "design.vocabulary",
          ...requiredDesignUrl(design.vocabulary, "design.vocabulary"),
        };
  const documents = design.documents.map((document, index) => {
    const label = `design.documents[${index}]`;
    return { label, ...requiredDesignUrl(document, label) };
  });
  const registered = [...(vocabulary === undefined ? [] : [vocabulary]), ...documents];

  const firstRegistration = new Map<string, string>();
  for (const source of registered) {
    const first = firstRegistration.get(source.path);
    if (first !== undefined) {
      throw new Error(`generated config: ${source.label} duplicates ${first}: ${source.path}.`);
    }
    firstRegistration.set(source.path, source.label);
  }
  for (const source of registered) {
    if (!existsSync(source.path)) {
      throw new Error(`generated config: ${source.label} does not exist: ${source.path}.`);
    }
  }

  return {
    version: 1,
    ...(vocabulary === undefined ? {} : { vocabulary: vocabulary.url }),
    documents: documents.map(({ url }) => url),
  };
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
  if (application.authoredDesignAdapters !== undefined) {
    if (
      typeof application.authoredDesignAdapters !== "object" ||
      application.authoredDesignAdapters === null ||
      typeof application.authoredDesignAdapters.conceptSources !== "function" ||
      typeof application.authoredDesignAdapters.resolveComputationInputs !== "function"
    ) {
      throw new Error(
        "generated config: authoredDesignAdapters must provide conceptSources and resolveComputationInputs functions.",
      );
    }
  }

  const design = resolveDesign(application.design);
  const directory = application.directory ?? new URL("./generated/", config);
  const module = application.vocabulary?.module ?? new URL("./src/concept-set.ts", config);
  if (!existsSync(module)) {
    throw new Error(
      `generated config: no vocabulary module at ${fileURLToPath(module)} — ` +
        "point `vocabulary.module` at the file exporting the concept set.",
    );
  }
  return {
    ...application,
    design,
    directory,
    specification: application.specification ?? `${slug(application.title)}.md`,
    wire: application.wire ?? "wire.ts",
    wireName: application.wireName ?? `${pascal(application.title)}Wire`,
    vocabularyFrom: {
      from: posix.normalize(specifierFrom(directory, module)),
      export: application.vocabulary?.export ?? "vocabulary",
    },
  };
}

async function prepareConfiguredDesign(
  application: ResolvedApplication,
  assembled: InspectableAssembly,
): Promise<void> {
  const adapters = application.authoredDesignAdapters;
  const conceptSources = await adapters?.conceptSources(assembled);
  // The generated-operation boundary performs this exactly once for this exact assembly. Every
  // manifest/spec/wire consumer below reuses the attached checked model and loaded documents.
  const checked = await checkAuthoredDesign({
    assembly: assembled,
    design: application.design,
    ...(conceptSources === undefined ? {} : { conceptSources }),
    ...(adapters === undefined
      ? {}
      : { resolveComputationInputs: adapters.resolveComputationInputs }),
  });
  if (checked.concepts.length > 0 && checked.sources.concepts === undefined) {
    throw new Error(
      "generated artifacts: authoredDesignAdapters.conceptSources is required to prove concept Markdown source paths.",
    );
  }
  const unvalidated = checked.computationInputValidation.filter(
    ({ status }) => status !== "validated",
  );
  if (unvalidated.length > 0) {
    throw new Error(
      `generated artifacts: authoredDesignAdapters.resolveComputationInputs is required to prove input optionality for ${unvalidated.map(({ name }) => JSON.stringify(name)).join(", ")}.`,
    );
  }
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
      vocabulary: application.vocabularyFrom,
      strictLeaves: true,
      projections,
    }),
  };
}

export async function inspectGenerated<T>(
  application: ResolvedApplication,
  inspect: (assembly: InspectableAssembly) => T | Promise<T>,
): Promise<T> {
  let assembled: InspectableAssembly | undefined;
  try {
    assembled = application.assemble();
    await prepareConfiguredDesign(application, assembled);
    return await inspect(assembled);
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

async function generatedPlan(
  application: ResolvedApplication,
  artifact: "all" | "specification" | "wire" = "all",
): Promise<ArtifactPlan> {
  const plan = await inspectGenerated(
    application,
    async (assembled) => (await completeGeneratedPlan(application, assembled)).plan,
  );
  if (artifact === "all") return plan;
  return { entries: plan.entries.filter(({ kind }) => kind === artifact) };
}

function nodeFilesystem(directory: URL): ArtifactFilesystem {
  return {
    async read(path) {
      try {
        return await readFile(new URL(path, directory), "utf8");
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return undefined;
        throw error;
      }
    },
    async writeAtomic(path, content) {
      const target = fileURLToPath(new URL(path, directory));
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
  const status = await applyArtifactPlan(
    await generatedPlan(application, artifact),
    nodeFilesystem(application.directory),
  );
  assertNoArtifactFailures(status, "apply");
}

export async function checkGenerated(application: ResolvedApplication): Promise<void> {
  const status = await checkArtifactPlan(
    await generatedPlan(application),
    nodeFilesystem(application.directory),
  );
  assertNoArtifactFailures(status, "check");
  const mismatches = status.filter(({ status: state }) => state !== "unchanged");
  if (mismatches.length > 0) {
    throw new Error(
      `${mismatches.map(({ path }) => path).join(" and ")} differ from generated output; inspect the changes and run the matching pin command`,
    );
  }
}
