import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Assembly } from "@engine/boundary/assembly/assembly-facade";
import type { HttpFloor } from "@engine/boundary/http/http-floor";
import { projectAssemblyHttpWire } from "@engine/boundary/http/http-floor";
import type { ProductionHttpProfile } from "@engine/boundary/http/http-profile";
import { projectAssemblyProductionHttpWire } from "@engine/boundary/http/http-profile";
import { pascal, slug } from "@engine/utils/case";
import {
  applyArtifactPlan,
  checkArtifactPlan,
  type ArtifactFilesystem,
  type ArtifactPlan,
  type ArtifactStatus,
  planGenerated,
} from "./artifact-plan.ts";
import { applicationManifest, type ApplicationManifestV3 } from "./manifest.ts";

type InspectableAssembly = Assembly<Record<string, new (...args: never[]) => object>>;

/**
 * What a project's `generated.config.ts` declares. Only `assemble` and `title`
 * are required — every path and name below follows from the title and the
 * config's own location, and each may be overridden.
 */
export interface GeneratedApplication {
  assemble: () => InspectableAssembly;
  /** Release resources owned by this generation descriptor after assembly drain. */
  close?: () => void | Promise<void>;
  /** The application's name, used as the document title and to derive the rest. */
  title: string;
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
  /** HTTP-projected contract name; defaults to `${wireName}Http`. */
  httpWireName?: string;
  /**
   * The module whose export anchors generated wire types to concept
   * signatures; defaults to `src/concept-set.ts` beside the config, exporting
   * `vocabulary`.
   */
  vocabulary?: { module?: URL; export?: string };
  httpProfile?: ProductionHttpProfile;
  httpFloor?: HttpFloor;
}

type ResolvedApplication = GeneratedApplication & {
  directory: URL;
  specification: string;
  wire: string;
  wireName: string;
  /** The specifier the generated wire imports its type anchor from. */
  vocabularyFrom: { from: string; export: string };
};

/** The module specifier a file in `directory` uses to reach `target`. */
function specifierFrom(directory: URL, target: URL): string {
  const path = relative(fileURLToPath(directory), fileURLToPath(target)).split(/[\\/]/).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

/**
 * Fill an application's defaults from its title and the location of the config
 * that declared it.
 */
export function resolveApplication(
  application: GeneratedApplication,
  config: URL,
): ResolvedApplication {
  if (typeof application.title !== "string" || application.title.trim() === "") {
    throw new Error("generated config: title must name the application.");
  }
  if (typeof application.assemble !== "function") {
    throw new Error("generated config: assemble must build the application.");
  }
  if (application.close !== undefined && typeof application.close !== "function") {
    throw new Error("generated config: close must release generation resources.");
  }
  if (application.httpProfile !== undefined && application.httpFloor !== undefined) {
    throw new Error("generated config: httpProfile and httpFloor are mutually exclusive.");
  }
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

function completeGeneratedPlan(
  application: ResolvedApplication,
  assembled: InspectableAssembly,
): {
  manifest: ApplicationManifestV3;
  plan: ArtifactPlan;
} {
  const manifest = applicationManifest(assembled);
  const httpWire =
    application.httpFloor !== undefined
      ? projectAssemblyHttpWire(assembled, manifest.wire, application.httpFloor)
      : application.httpProfile !== undefined
        ? projectAssemblyProductionHttpWire(assembled, manifest.wire)
        : undefined;
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
      httpWire,
      httpWireName: application.httpWireName,
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
    return await inspect(assembled);
  } finally {
    try {
      if (assembled !== undefined) {
        await assembled.beginDrain();
        await assembled.whenIdle();
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
    (assembled) => completeGeneratedPlan(application, assembled).plan,
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
