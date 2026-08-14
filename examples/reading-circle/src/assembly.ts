import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { composition as readingCircleComposition } from "./compositions/ReadingCircle.ts";
import { applicationConcepts } from "./concepts.ts";

export type ReadingCircleOverrides = ImplementationOverrides<typeof applicationConcepts>;

export function assembleReadingCircle(instances: ReadingCircleOverrides = {}) {
  return assemble({
    conceptSet: applicationConcepts,
    instances: { ...applicationConcepts.implementations(), ...instances },
    composition: { ReadingCircle: readingCircleComposition },
  });
}
