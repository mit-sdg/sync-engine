import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import * as readingCircle from "./composition/reading-circle.ts";
import { readingCircleConcepts, vocabulary } from "./concept-set.ts";

export type ReadingCircleOverrides = ImplementationOverrides<typeof vocabulary>;

export function assembleReadingCircle(instances: ReadingCircleOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...readingCircleConcepts.implementations(), ...instances },
    composition: { readingCircle },
  });
}

export type ReadingCircleApp = ReturnType<typeof assembleReadingCircle>;
