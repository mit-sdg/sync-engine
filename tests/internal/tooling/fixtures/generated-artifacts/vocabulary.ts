import { vocabulary as declareVocabulary } from "@mit-sdg/sync-engine/advanced";
import sessioningSpec from "./sessioning.md" with { type: "text" };

export class SessioningConcept {
  start({ user }: { user: string }) {
    return { session: `session-${user}`, expiresAt: new Date(0) };
  }

  current({ session }: { session: string }) {
    return { user: session.slice("session-".length) };
  }
}

export const vocabularyDeclaration = declareVocabulary({
  concepts: {
    Sessioning: { class: SessioningConcept, spec: sessioningSpec },
  },
  computations: {},
});

export const { Sessioning } = vocabularyDeclaration.concepts;
export const vocabulary = vocabularyDeclaration;
