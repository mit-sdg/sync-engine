import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { readingCircleConcepts, vocabulary } from "./vocabulary.ts";
import * as ReadingCircle from "./compositions/ReadingCircle.ts";

export type ReadingCircleOverrides = ImplementationOverrides<typeof vocabulary>;

export function assembleReadingCircle(instances: ReadingCircleOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...readingCircleConcepts.implementations(), ...instances },
    composition: ReadingCircle,
  });
}
