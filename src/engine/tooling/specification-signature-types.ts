import type { ConceptSpecificationIR, SpecificationLocationIR } from "@engine/reads/ir";
import { ownedTypeNameSpellings, subsetIdentifiedBy, type SsfDocument } from "@ssf";
import { specificationTypeNameOccurrences } from "./specification-type-evidence.ts";

export interface SpecificationSignatureTypeIssue {
  readonly severity: "error";
  readonly code: "SSF_SUBSET_SIGNATURE_TYPE" | "SSF_UNDECLARED_TYPE";
  readonly message: string;
  readonly suggestion: string;
  readonly location: SpecificationLocationIR;
}

/**
 * Check signatures only after their spelling evidence has resolved State ownership. A
 * subset is a State type only: a signature takes the type of the set it qualifies and
 * states membership in a condition, so no argument carries a hidden precondition.
 */
export function validateSpecificationSignatureTypes(
  specification: ConceptSpecificationIR,
  document: SsfDocument,
): readonly SpecificationSignatureTypeIssue[] {
  const declared = new Set([
    ...ownedTypeNameSpellings(document.inventory),
    ...document.inventory.external,
    ...document.inventory.externalSpellings,
    ...document.inventory.primitives,
    ...specification.localTypes.map(({ name }) => name),
  ]);
  return specificationTypeNameOccurrences(specification)
    .filter(({ name }) => !declared.has(name))
    .map(({ name, location }): SpecificationSignatureTypeIssue => {
      const subset = subsetIdentifiedBy(document.inventory, name);
      return subset === undefined
        ? {
            severity: "error",
            code: "SSF_UNDECLARED_TYPE",
            message: `Type ${JSON.stringify(name)} is not owned, external, concept-local, or an SSF primitive.`,
            suggestion: `Declare it in the Types fence as \`external ${name}\`, \`${name} is VALUE_A or VALUE_B\`, or \`opaque ${name}\`.`,
            location,
          }
        : {
            severity: "error",
            code: "SSF_SUBSET_SIGNATURE_TYPE",
            message: `Type ${JSON.stringify(name)} is the subset ${JSON.stringify(subset.name)}, which only State fields may use.`,
            suggestion: `Use the type of the set it qualifies, ${subset.rootType}, and state membership in a condition, such as \`where it is in ${subset.name}\`.`,
            location,
          };
    });
}
