import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  InvalidLabelName,
  LabelAlreadyApplied,
  LabelNameTaken,
  LabelNotApplied,
  LabelNotFound,
} from "./labeling.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { LabelingMemoryConcept } from "./labeling.memory.ts";
//#endfloor

//#class memory LabelingMemoryConcept
export const labeling = registerConcept({
  class: LabelingMemoryConcept, // selected-class
  spec,
  refusals: {
    INVALID_LABEL_NAME: InvalidLabelName,
    LABEL_NAME_TAKEN: LabelNameTaken,
    LABEL_NOT_FOUND: LabelNotFound,
    LABEL_ALREADY_APPLIED: LabelAlreadyApplied,
    LABEL_NOT_APPLIED: LabelNotApplied,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new LabelingMemoryConcept(),
    //#endfloor
  },
});
