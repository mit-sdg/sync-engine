import { renderInputContracts } from "@engine/boundary/protocol/endpoints";
import { renderWireTypes, wireHelperNames } from "@engine/boundary/wire/wire-renderer";
import { assertApplicationLocality } from "@engine/boundary/assembly/locality-validation";
import { renderApp } from "@engine/reads/render";
import { ordinal } from "@engine/utils/ordinal";
import {
  assertCompatibleGenerator,
  isSemVer,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "@engine/utils/package-version";
import type { ApplicationManifestV1 } from "./manifest.ts";
import type { PlannedWireProjection } from "./wire-projection.ts";

type ArtifactKind = "specification" | "wire";

interface ArtifactPlanEntry {
  path: string;
  content: string;
  kind: ArtifactKind;
}

export interface ArtifactPlan {
  entries: ArtifactPlanEntry[];
}

interface GeneratedPlanOptions {
  title: string;
  specification?: string;
  specificationBanner?: string;
  wire?: string;
  wireName?: string;
  wireBanner?: string;
  conceptSet?: { from: string; export: string };
  strictLeaves?: boolean;
  /** Ordered contracts derived from the logical wire by transport packages. */
  projections?: readonly PlannedWireProjection[];
}

export type ArtifactStatus =
  | { path: string; kind: ArtifactKind; status: "missing" | "changed" | "unchanged" }
  | { path: string; kind: ArtifactKind; status: "failed" };

export interface ArtifactFilesystem {
  read(path: string): Promise<string | undefined>;
  /** The adapter must write a same-directory temporary file and rename it. */
  writeAtomic(path: string, content: string): Promise<void>;
}

function normalizeArtifactPath(path: string): string {
  if (
    typeof path !== "string" ||
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("%") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes(":")
  ) {
    throw new Error(
      `Artifact path "${path}" must be a non-empty relative POSIX path without URL metacharacters.`,
    );
  }
  const parts = path.split("/");
  const unsafe = parts.some((part) => part === "" || part === "." || part === "..");
  if (unsafe) {
    throw new Error(`Artifact path "${path}" escapes or does not normalize within its directory.`);
  }
  return parts.join("/");
}

export function artifactPlan(entries: readonly ArtifactPlanEntry[]): ArtifactPlan {
  const paths = new Set<string>();
  const planned = entries.map((entry) => {
    const path = normalizeArtifactPath(entry.path);
    if (paths.has(path)) throw new Error(`Artifact plan contains duplicate path "${path}".`);
    paths.add(path);
    if (typeof entry.content !== "string") {
      throw new Error(`Artifact "${path}" content must be a string.`);
    }
    return { ...entry, path };
  });
  return { entries: planned.sort((left, right) => ordinal(left.path, right.path)) };
}

export function planGenerated(
  manifest: ApplicationManifestV1,
  options: GeneratedPlanOptions,
): ArtifactPlan {
  if (manifest.format !== "sync-engine.application-manifest" || manifest.version !== 1) {
    throw new Error("generated artifacts: requires an application manifest at version 1.");
  }
  assertCompatibleGenerator(manifest.generator, "generated artifacts");
  assertApplicationLocality("generated artifacts", manifest.application);
  const specification = options.specification ?? "application.md";
  const wire = options.wire ?? "wire.ts";
  const wireName = options.wireName ?? "ApplicationWire";
  const projections = options.projections ?? [];
  const typeNames = new Set<string>();
  const reserveTypeName = (name: string, label: string) => {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`generated artifacts: ${label} name "${name}" is not a type name.`);
    }
    if (typeNames.has(name)) {
      throw new Error(`generated artifacts: duplicate generated type name "${name}".`);
    }
    typeNames.add(name);
  };
  reserveTypeName(wireName, "wire");
  reserveTypeName("AppWideError", "logical app-wide error");
  reserveTypeName("Json", "logical JSON");
  if (options.conceptSet !== undefined) {
    for (const name of wireHelperNames([manifest.wire, ...projections.map(({ wire }) => wire)])) {
      reserveTypeName(name, "logical helper");
    }
  }
  for (const projection of projections) {
    reserveTypeName(projection.name, "projected wire");
    const appWideErrorName =
      projection.render?.appWideErrorName ?? `${projection.name}AppWideError`;
    reserveTypeName(appWideErrorName, "projected app-wide error");
    if (projection.provenance.name.trim() === "" || !isSemVer(projection.provenance.version)) {
      throw new Error(
        "generated artifacts: projection provenance needs a package name and SemVer version.",
      );
    }
  }
  const generator = `${PACKAGE_NAME}@${PACKAGE_VERSION}`;
  const manifestProducer = `${manifest.generator.name}@${manifest.generator.version}`;
  const specificationProvenance =
    `<!-- Manifest producer: ${manifestProducer}; ` +
    `concept specification: sync-engine.concept-specification@1; renderer: ${generator}. -->`;
  const specificationBanner =
    options.specificationBanner === undefined
      ? `<!-- Generated from the ${options.title} assembly. Do not edit. -->\n${specificationProvenance}`
      : `${options.specificationBanner}\n${specificationProvenance}`;
  const projectionBanner =
    projections.length === 0
      ? ""
      : `\n// Projectors: ${projections.map(({ provenance }) => `${provenance.name}@${provenance.version}`).join(", ")}.`;
  const wireBanner =
    options.wireBanner === undefined
      ? `// Generated by ${generator} from the ${options.title} assembly. Do not edit.${projectionBanner}`
      : `${options.wireBanner}\n// Generator: ${generator}.${projectionBanner}`;
  const logicalWire = renderWireTypes(manifest.wire, {
    moduleName: wireName,
    banner: wireBanner,
    ...(options.conceptSet === undefined ? {} : { conceptSet: options.conceptSet }),
    sharedWires: projections.map(({ wire }) => wire),
    strictLeaves: options.strictLeaves ?? false,
  });
  const renderedWire = projections.reduce(
    (rendered, projection) =>
      rendered +
      "\n" +
      renderWireTypes(projection.wire, {
        moduleName: projection.name,
        appWideErrorName: projection.render?.appWideErrorName ?? `${projection.name}AppWideError`,
        ...(options.conceptSet === undefined ? {} : { conceptSet: options.conceptSet }),
        strictLeaves: options.strictLeaves ?? false,
        preamble: false,
      }),
    logicalWire,
  );
  return artifactPlan([
    {
      path: specification,
      kind: "specification",
      content:
        `${specificationBanner}\n\n` +
        renderApp({
          title: options.title,
          concepts: manifest.concepts,
          app: manifest.application,
          design: manifest.design,
        }) +
        "\n" +
        renderInputContracts(manifest.inputContracts),
    },
    { path: wire, kind: "wire", content: renderedWire },
  ]);
}

export async function checkArtifactPlan(
  plan: ArtifactPlan,
  filesystem: ArtifactFilesystem,
): Promise<ArtifactStatus[]> {
  return Promise.all(
    plan.entries.map(async ({ path, content, kind }) => {
      try {
        const current = await filesystem.read(path);
        return {
          path,
          kind,
          status: current === undefined ? "missing" : current === content ? "unchanged" : "changed",
        } as ArtifactStatus;
      } catch {
        return { path, kind, status: "failed" };
      }
    }),
  );
}

export async function applyArtifactPlan(
  plan: ArtifactPlan,
  filesystem: ArtifactFilesystem,
): Promise<ArtifactStatus[]> {
  // Revalidate every entry before the first effect, including plans assembled by hand.
  const validated = artifactPlan(
    plan.entries.map(({ path, content, kind }) => ({ path, content, kind })),
  );
  const status = await checkArtifactPlan(validated, filesystem);
  if (status.some(({ status: state }) => state === "failed")) return status;
  const byPath = new Map(validated.entries.map((entry) => [entry.path, entry]));
  for (let index = 0; index < status.length; index++) {
    const entryStatus = status[index];
    if (entryStatus === undefined || entryStatus.status === "unchanged") continue;
    const entry = byPath.get(entryStatus.path);
    if (entry === undefined) continue;
    try {
      await filesystem.writeAtomic(entry.path, entry.content);
    } catch {
      status[index] = {
        path: entry.path,
        kind: entry.kind,
        status: "failed",
      };
    }
  }
  return status;
}
