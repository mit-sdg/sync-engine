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
 * Relate only exact authored evidence to one non-element structure or subset owner.
 * The pluralizer's output is compared, never inserted into the inventory. A name the
 * Types fence already claims is not a candidate: joining it would make one spelling both
 * owned and declared, which the single type namespace forbids.
 */
export function automaticAliasCandidates(
  declarations: readonly ParsedDeclaration[],
  eligibleStructuralNames: ReadonlySet<string>,
  evidenceTypeNames: readonly string[],
  explicitAliasNames: ReadonlySet<string>,
  external: ReadonlySet<string>,
  local: ReadonlySet<string>,
): {
  readonly aliases: ReadonlyMap<string, string>;
  readonly ambiguities: readonly {
    readonly candidates: readonly string[];
    readonly owners: readonly string[];
  }[];
} {
  const declarationsByName = new Map(
    declarations.map((declaration) => [declaration.name.text, declaration] as const),
  );
  const owners = [...eligibleStructuralNames]
    .filter((name) => declarationsByName.get(name)?.multiplicity !== "element")
    .sort();
  const candidates = [
    ...new Set([...stateFieldTypeEvidence(declarations), ...evidenceTypeNames]),
  ].sort();
  const matches: Array<readonly [candidate: string, owner: string]> = [];

  for (const candidate of candidates) {
    if (
      !TYPE_NAME.test(candidate) ||
      eligibleStructuralNames.has(candidate) ||
      explicitAliasNames.has(candidate) ||
      external.has(candidate) ||
      local.has(candidate) ||
      PRIMITIVE_NAMES.has(candidate)
    ) {
      continue;
    }
    for (const owner of owners) {
      if (exactPluralPair(owner, candidate)) matches.push([candidate, owner]);
    }
  }

  const ownersByCandidate = new Map<string, string[]>();
  const candidatesByOwner = new Map<string, string[]>();
  for (const [candidate, owner] of matches) {
    const candidateOwners = ownersByCandidate.get(candidate) ?? [];
    candidateOwners.push(owner);
    ownersByCandidate.set(candidate, candidateOwners);
    const ownerCandidates = candidatesByOwner.get(owner) ?? [];
    ownerCandidates.push(candidate);
    candidatesByOwner.set(owner, ownerCandidates);
  }

  const ambiguities: { candidates: string[]; owners: string[] }[] = [];
  for (const [candidate, candidateOwners] of ownersByCandidate) {
    if (candidateOwners.length > 1)
      ambiguities.push({ candidates: [candidate], owners: candidateOwners });
  }
  for (const [owner, ownerCandidates] of candidatesByOwner) {
    if (ownerCandidates.length > 1)
      ambiguities.push({ candidates: ownerCandidates, owners: [owner] });
  }
  return {
    aliases: new Map(
      matches.flatMap(([candidate, owner]) =>
        ownersByCandidate.get(candidate)?.length === 1 && candidatesByOwner.get(owner)?.length === 1
          ? [[candidate, owner] as const]
          : [],
      ),
    ),
    ambiguities,
  };
}
