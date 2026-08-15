import { pathToFileURL } from "node:url";
import {
  conceptSetVocabulary,
  type AnyRegisteredConcept,
  type RegisteredConceptSet,
} from "@engine/boundary/assembly/concept-set";
import { vocabularyClasses, vocabularyMetadata } from "@engine/reactions/authoring/refs";
import type { ComputationFn } from "@engine/reads/computations";
import type { ConceptSpec } from "@engine/reactions/concepts/concept-spec";
import { rolesOf } from "@engine/reactions/concepts/introspect";
import type { ApplicationManifestV1 } from "@engine/tooling/manifest";

export interface RegisteredSourceConcept {
  name: string;
  className: string;
  specification: ConceptSpec;
  /** Members whose input names TypeScript erased before runtime registration. */
  sourceInputMembers: ReadonlySet<string>;
}

/** Read the registrations retained by an application concept set. */
export function registeredConcepts(conceptSet: unknown): RegisteredSourceConcept[] {
  if (conceptSet === null || typeof conceptSet !== "object") {
    throw new Error("Concept-set export must be an object.");
  }
  const declaration = conceptSetVocabulary(
    conceptSet as RegisteredConceptSet<
      Record<string, AnyRegisteredConcept>,
      Record<string, ComputationFn>
    >,
  );
  const classes = vocabularyClasses(declaration);
  const metadata = vocabularyMetadata(declaration);
  return Object.entries(classes).map(([name, conceptClass]) => {
    const specification = metadata[name]?.specification;
    if (specification === undefined) {
      throw new Error(`Concept-set registration ${JSON.stringify(name)} has no specification.`);
    }
    const prototype = conceptClass.prototype as Record<string, (...args: never[]) => unknown>;
    const sourceInputMembers = new Set(
      [...specification.actions, ...specification.queries]
        .map(({ name: memberName }) => memberName)
        .filter((memberName) => {
          const roles = rolesOf(prototype[memberName]);
          return roles === undefined || roles.length === 0;
        }),
    );
    return { name, className: conceptClass.name, specification, sourceInputMembers };
  });
}

/** Read the same registration facts from an assembled application's manifest. */
export function assembledConcepts(manifest: ApplicationManifestV1): RegisteredSourceConcept[] {
  const applicationImplementations = manifest.conceptImplementations.filter(
    ({ canonical }) => canonical.owner === "application",
  );
  return applicationImplementations.map((implementation) => {
    const concept = manifest.concepts.find(({ name }) => name === implementation.concept);
    if (concept?.specification === undefined) {
      throw new Error(
        `Assembled concept ${JSON.stringify(implementation.concept)} has no specification.`,
      );
    }
    const className = implementation.canonical.constructorName;
    if (className === undefined) {
      throw new Error(
        `Assembled concept ${JSON.stringify(concept.name)} has no canonical class name.`,
      );
    }
    const sourceInputMembers = new Set(
      [...concept.actions, ...concept.queries]
        .filter(({ roles }) => roles === undefined || roles.length === 0)
        .map(({ name }) => name),
    );
    return {
      name: concept.name,
      className,
      specification: concept.specification,
      sourceInputMembers,
    };
  });
}

/** Import an explicitly selected concept-set module. */
export async function loadRegisteredConcepts(
  modulePath: string,
  exportName = "applicationConceptSet",
): Promise<RegisteredSourceConcept[]> {
  const loaded = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
  if (!(exportName in loaded)) {
    throw new Error(`${modulePath} does not export ${JSON.stringify(exportName)}.`);
  }
  return registeredConcepts(loaded[exportName]);
}
