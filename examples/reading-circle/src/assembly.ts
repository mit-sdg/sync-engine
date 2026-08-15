import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { composition as readingCircleComposition } from "./compositions/ReadingCircle.ts";
import { applicationConceptSet } from "./concepts.ts";

export type ReadingCircleOverrides = ImplementationOverrides<typeof applicationConceptSet>;

export function assembleReadingCircle(instances: ReadingCircleOverrides = {}) {
  return assemble({
    conceptSet: applicationConceptSet,
    instances: { ...applicationConceptSet.implementations(), ...instances },
    composition: { ReadingCircle: readingCircleComposition },
  });
}
