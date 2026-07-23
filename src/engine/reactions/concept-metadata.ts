import type { OutcomeContracts } from "./outcomes.ts";
import type { QueryPromise } from "../reads/query-contracts.ts";

export type ErrorConstructor = abstract new (...args: never[]) => Error;

export type PublicErrorCategory =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

/** Error classes admitted as refusals, grouped by the action that may throw them. */
export type RefusalContracts = Record<string, Record<string, ErrorConstructor>>;

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

export interface RegisteredRefusal {
  code: string;
  error: Error;
}

/** Match a thrown error to an action's vocabulary-declared refusal branch. */
export function registeredRefusalOf(
  concept: object,
  action: string,
  thrown: unknown,
): RegisteredRefusal | undefined {
  if (!(thrown instanceof Error)) return undefined;
  const refusals = metadataByConcept.get(concept)?.refusals?.[action];
  if (refusals === undefined) return undefined;
  for (const [code, Constructor] of Object.entries(refusals)) {
    if (thrown instanceof Constructor) return { code, error: thrown };
  }
  return undefined;
}
