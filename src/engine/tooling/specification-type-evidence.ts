import type { ConceptSpecificationIR, SpecificationTypeIR } from "@engine/reads/ir";

function typeNames(type: SpecificationTypeIR): readonly string[] {
  if (type.kind === "named") {
    return [type.name, ...type.arguments.flatMap(typeNames)];
  }
  return type.kind === "union" ? type.members.flatMap(typeNames) : [];
}

/** Exact authored action/query parameter and result type spellings for SSF resolution. */
export function specificationTypeNameEvidence(
  specification: ConceptSpecificationIR,
): readonly string[] {
  return [...specification.actions, ...specification.queries].flatMap((member) => [
    ...member.parameters.flatMap(({ type }) => typeNames(type)),
    ...member.result.fields.flatMap(({ type }) => typeNames(type)),
  ]);
}
