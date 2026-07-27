import type { OutcomeContracts } from "./outcomes.ts";
import type { QueryPromise } from "@engine/reads/query-contracts";

export type ErrorConstructor = abstract new (...args: never[]) => Error;

export type PublicErrorCategory =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

/** One refusal branch: the code it returns, the class that signals it, and its sentence. */
export interface RefusalBranch {
  code: string;
  error: ErrorConstructor;
  /** The normative sentence the specification gives this branch. */
  message: string;
}

/** Refusal branches admitted for each action, keyed by the action that may signal them. */
export type RefusalContracts = Record<string, readonly RefusalBranch[]>;

/** Contracts owned by a vocabulary name rather than embedded in its class. */
export interface ConceptMetadata {
  purpose?: string;
  principle?: string;
  queries?: Readonly<Record<string, QueryPromise>>;
  outcomes?: OutcomeContracts;
  refusals?: RefusalContracts;
  publicErrors?: Record<string, PublicErrorCategory>;
}

const metadataByConcept = new WeakMap<object, ConceptMetadata>();

export function attachConceptMetadata(concept: object, metadata: ConceptMetadata): void {
  const existing = metadataByConcept.get(concept);
  if (existing !== undefined && existing !== metadata) {
    throw new Error("One concept instance cannot carry two vocabulary declarations.");
  }
  metadataByConcept.set(concept, metadata);
}

export function conceptMetadataOf(concept: object): ConceptMetadata | undefined {
  return metadataByConcept.get(concept);
}

/**
 * What a thrown error means for the action that threw it: a refusal branch the
 * specification declares here, or one it declares only for other actions —
 * which is a specification the implementation has outgrown, not a refusal.
 */
export type RefusalMatch =
  | { kind: "declared"; code: string; message: string }
  | { kind: "misplaced"; code: string; declaredOn: readonly string[] };

/** Match a thrown error against the concept's specified refusal branches. */
export function refusalFor(
  concept: object,
  action: string,
  thrown: unknown,
): RefusalMatch | undefined {
  if (!(thrown instanceof Error)) return undefined;
  const refusals = metadataByConcept.get(concept)?.refusals;
  if (refusals === undefined) return undefined;
  for (const branch of refusals[action] ?? []) {
    if (thrown instanceof branch.error) {
      return { kind: "declared", code: branch.code, message: branch.message };
    }
  }
  for (const [other, branches] of Object.entries(refusals)) {
    if (other === action) continue;
    for (const branch of branches) {
      if (!(thrown instanceof branch.error)) continue;
      const declaredOn = Object.entries(refusals)
        .filter(([, on]) => on.some((candidate) => candidate.code === branch.code))
        .map(([name]) => name);
      return { kind: "misplaced", code: branch.code, declaredOn };
    }
  }
  return undefined;
}
