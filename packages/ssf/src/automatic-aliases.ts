import { PRIMITIVE_NAMES, TYPE_NAME } from "./names.ts";
import type { ParsedDeclaration } from "./model.ts";
import { pluralize } from "./vendor/plur.ts";

/** Exact named State field references that can evidence an automatic alias. */
export function stateFieldTypeEvidence(
  declarations: readonly ParsedDeclaration[],
): readonly string[] {
  return declarations.flatMap(({ fields }) =>
    fields.flatMap(({ value }) => {
      if (value.kind === "named") return [value.reference.text];
      if (value.kind === "collection" && value.element.kind === "named") {
        return [value.element.reference.text];
      }
      return [];
    }),
  );
}

function exactPluralPair(left: string, right: string): boolean {
  return pluralize(left) === right || pluralize(right) === left;
}

/**
 * Relate only exact authored evidence to one non-element structural owner.
 * The pluralizer's output is compared, never inserted into the inventory.
 */
export function automaticAliasCandidates(
  declarations: readonly ParsedDeclaration[],
  eligibleStructuralNames: ReadonlySet<string>,
  evidenceTypeNames: readonly string[],
  explicitAliasNames: ReadonlySet<string>,
  external: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const declarationsByName = new Map(
    declarations.map((declaration) => [declaration.name.text, declaration] as const),
  );
  const owners = [...eligibleStructuralNames]
    .filter((name) => declarationsByName.get(name)?.multiplicity !== "element")
    .sort();
  const candidates = [
    ...new Set([...stateFieldTypeEvidence(declarations), ...evidenceTypeNames]),
  ].sort();
  const aliases = new Map<string, string>();

  for (const candidate of candidates) {
    if (
      !TYPE_NAME.test(candidate) ||
      eligibleStructuralNames.has(candidate) ||
      explicitAliasNames.has(candidate) ||
      external.has(candidate) ||
      PRIMITIVE_NAMES.has(candidate)
    ) {
      continue;
    }
    const matches = owners.filter((owner) => exactPluralPair(owner, candidate));
    if (matches.length === 1) aliases.set(candidate, matches[0]!);
  }
  return aliases;
}
