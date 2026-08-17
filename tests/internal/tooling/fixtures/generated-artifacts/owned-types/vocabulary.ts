import { vocabulary as declareVocabulary } from "@mit-sdg/sync-engine/advanced";
import linkingSpec from "./Linking.md" with { type: "text" };
import targetingSpec from "./Targeting.md" with { type: "text" };

export class LinkingConcept {
  link({ target: _target }: { target: string }) {
    return {};
  }
}

export class TargetingConcept {
  create({ label }: { label: string }) {
    return { record: `record-${label}` };
  }
}

export const applicationConceptSet = declareVocabulary({
  concepts: {
    Linking: { class: LinkingConcept, spec: linkingSpec },
    Targeting: { class: TargetingConcept, spec: targetingSpec },
  },
  computations: {},
});
