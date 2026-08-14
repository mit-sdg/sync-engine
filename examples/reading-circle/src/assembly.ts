import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { composition as readingCircleComposition } from "./compositions/ReadingCircle.ts";
import { readingCircleConcepts, vocabulary } from "./vocabulary.ts";

export type ReadingCircleOverrides = ImplementationOverrides<typeof vocabulary>;

export function assembleReadingCircle(instances: ReadingCircleOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...readingCircleConcepts.implementations(), ...instances },
    composition: { ReadingCircle: readingCircleComposition },
  });
}
