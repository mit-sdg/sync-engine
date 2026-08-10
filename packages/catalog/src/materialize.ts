import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  EntryIntegration,
  EntryManifest,
  MaterializedEntry,
  MaterializedFile,
} from "./types.ts";
import { installedTarget } from "./domain.ts";
import { renderFloor, transformConceptSpecifier } from "./transforms.ts";

export const digest = (source: string): string => createHash("sha256").update(source).digest("hex");

export function integrationFor(entry: EntryManifest): EntryIntegration {
  return entry.kind === "concept"
    ? {
        kind: "concept",
        name: entry.concept.name,
        export: entry.concept.export,
        registration: installedTarget(entry.concept.registration),
      }
    : {
        kind: "recipe",
        module: installedTarget(entry.recipe.module),
        test: installedTarget(entry.recipe.test),
        members: entry.recipe.members,
        routes: entry.recipe.routes,
      };
}

export async function materialize(entry: EntryManifest, floor: string): Promise<MaterializedEntry> {
  const declarations =
    entry.kind === "concept" ? [...entry.files, ...entry.floors[floor]!.files] : entry.files;
  const files: MaterializedFile[] = [];
  for (const declaration of declarations) {
    const target = installedTarget(declaration.target);
    let contents = transformConceptSpecifier(
      await readFile(resolve(entry.directory, declaration.source), "utf8"),
      target,
    );
    if (declaration.render === "floor")
      contents = renderFloor(
        contents,
        floor,
        Object.keys(entry.kind === "concept" ? entry.floors : {}),
      );
    files.push({
      source: declaration.source,
      target,
      contents,
      hash: digest(contents),
      class: declaration.render === "floor" ? "rendered" : "owned",
    });
  }
  const packages =
    entry.kind === "concept"
      ? { ...entry.packages, ...entry.floors[floor]!.packages }
      : entry.packages;
  const integration = integrationFor(entry);
  const sourceDigest = digest(
    JSON.stringify({
      schema: entry.schema,
      id: entry.id,
      kind: entry.kind,
      summary: entry.summary,
      requires: entry.requires,
      packages,
      files: files.map(({ source, target, class: fileClass }) => ({
        source,
        target,
        class: fileClass,
      })),
      integration,
      floor: entry.kind === "concept" ? floor : undefined,
    }) + files.map((file) => file.contents).join("\0"),
  );
  return {
    entry,
    ...(entry.kind === "concept" ? { floor } : {}),
    packages,
    integration,
    files,
    sourceDigest,
  };
}
