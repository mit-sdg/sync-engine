import type { ConceptSpecificationIR, SpecificationLocationIR } from "@engine/reads/ir";
import { ownedTypeNameSpellings, type SsfDocument } from "@ssf";
import { specificationTypeNameOccurrences } from "./specification-type-evidence.ts";

export interface SpecificationSignatureTypeIssue {
  readonly severity: "error";
  readonly code: "SSF_UNDECLARED_TYPE";
  readonly message: string;
  readonly suggestion: string;
  readonly location: SpecificationLocationIR;
}

/** Check signatures only after their spelling evidence has resolved State ownership. */
export function validateSpecificationSignatureTypes(
  specification: ConceptSpecificationIR,
  document: SsfDocument,
): readonly SpecificationSignatureTypeIssue[] {
  const declared = new Set([
    ...ownedTypeNameSpellings(document.inventory),
    ...document.inventory.external,
    ...document.inventory.primitives,
    ...specification.localTypes.map(({ name }) => name),
  ]);
  return specificationTypeNameOccurrences(specification)
    .filter(({ name }) => !declared.has(name))
    .map(({ name, location }) => ({
      severity: "error" as const,
      code: "SSF_UNDECLARED_TYPE" as const,
      message: `Type ${JSON.stringify(name)} is not owned, external, concept-local, or an SSF primitive.`,
      suggestion: `Declare it in the Types fence as \`external ${name}\`, \`${name} is VALUE_A or VALUE_B\`, or \`opaque ${name}\`.`,
      location,
    }));
}
