import { vocabulary as declareVocabulary } from "@mit-sdg/sync-engine/advanced";
import spec from "./Malformed.md" with { type: "text" };

export class MalformedConcept {
  record(_: Record<string, never>) {
    return {};
  }
}

export const applicationConceptSet = declareVocabulary({
  concepts: { Malformed: { class: MalformedConcept, spec } },
  computations: {},
});
