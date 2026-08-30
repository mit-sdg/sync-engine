import type {
  ConceptSpecificationIR,
  SpecificationLocationIR,
  SpecificationTypeIR,
} from "@engine/reads/ir";

export interface SpecificationTypeNameOccurrence {
  readonly name: string;
  readonly location: SpecificationLocationIR;
}

function typeNameOccurrences(
  type: SpecificationTypeIR,
): readonly SpecificationTypeNameOccurrence[] {
  switch (type.kind) {
    case "named":
      return [
        { name: type.name, location: type.location },
        ...type.arguments.flatMap(typeNameOccurrences),
      ];
    case "union":
      return type.members.flatMap(typeNameOccurrences);
    case "null":
    case "undefined":
      return [];
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/** Every located named type in action and query parameters and results. */
export function specificationTypeNameOccurrences(
  specification: ConceptSpecificationIR,
): readonly SpecificationTypeNameOccurrence[] {
  return [...specification.actions, ...specification.queries].flatMap((member) => [
    ...member.parameters.flatMap(({ type }) => typeNameOccurrences(type)),
    ...member.result.fields.flatMap(({ type }) => typeNameOccurrences(type)),
  ]);
}

/** Exact authored action/query parameter and result type spellings for SSF resolution. */
export function specificationTypeNameEvidence(
  specification: ConceptSpecificationIR,
): readonly string[] {
  return specificationTypeNameOccurrences(specification).map(({ name }) => name);
}
