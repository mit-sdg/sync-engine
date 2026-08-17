import { PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import type { ParsedAlias, ParsedDeclaration, SsfDiagnostic } from "./model.ts";

export interface ResolutionFacts {
  readonly validStructuralNames: ReadonlySet<string>;
  readonly validAliases: ReadonlyMap<string, string>;
}

function groupsOf<T>(items: readonly T[], nameOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = nameOf(item);
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}

function cycleMembers(parentBySubset: ReadonlyMap<string, string>): ReadonlySet<string> {
  const cyclic = new Set<string>();
  for (const start of parentBySubset.keys()) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let cursor: string | undefined = start;
    while (cursor !== undefined && parentBySubset.has(cursor)) {
      const cycleStart = pathIndex.get(cursor);
      if (cycleStart !== undefined) {
        for (const name of path.slice(cycleStart)) cyclic.add(name);
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      cursor = parentBySubset.get(cursor);
    }
  }
  return cyclic;
}

/** Resolve order-independent alias and subset graphs and report every invalid edge. */
export function validateTypeGraph(
  declarations: readonly ParsedDeclaration[],
  aliases: readonly ParsedAlias[],
  external: ReadonlySet<string>,
  diagnostics: SsfDiagnostic[],
): ResolutionFacts {
  const declarationGroups = groupsOf(declarations, ({ name }) => name.text);
  const uniqueDeclarations = new Map(
    [...declarationGroups].flatMap(([name, group]) =>
      group.length === 1 ? [[name, group[0]!] as const] : [],
    ),
  );
  const eligible = new Map(
    [...uniqueDeclarations].filter(([name]) => !external.has(name) && !PRIMITIVE_NAMES.has(name)),
  );
  const aliasGroups = groupsOf(aliases, ({ name }) => name.text);
  const occupied = new Set([...declarationGroups.keys(), ...external, ...PRIMITIVES]);

  // Candidate aliases have an unambiguous namespace owner and target a structural
  // declaration directly. Whether that target has a valid subset chain is checked below.
  const candidateAliases = new Map<string, string>();
  for (const alias of aliases) {
    if (
      aliasGroups.get(alias.name.text)?.length === 1 &&
      !occupied.has(alias.name.text) &&
      eligible.has(alias.target.text)
    ) {
      candidateAliases.set(alias.name.text, alias.target.text);
    }
  }

  const parentBySubset = new Map<string, string>();
  for (const declaration of declarations) {
    if (declaration.declarationKind !== "subset" || declaration.parent === undefined) continue;
    const authoredParent = declaration.parent.text;
    const parent = eligible.has(authoredParent)
      ? authoredParent
      : candidateAliases.get(authoredParent);
    if (parent === declaration.name.text) {
      diagnostics.push({
        code: "SSF_SUBSET_SELF_PARENT",
        message:
          authoredParent === declaration.name.text
            ? `Subset ${JSON.stringify(declaration.name.text)} cannot be its own parent.`
            : `Subset ${JSON.stringify(declaration.name.text)} cannot be its own parent through alias ${JSON.stringify(authoredParent)}.`,
        suggestion:
          "Name a different owned structural declaration or its alias as the subset parent.",
        span: declaration.parent.span,
      });
      continue;
    }
    if (parent === undefined) {
      const category = external.has(authoredParent)
        ? "external type"
        : PRIMITIVE_NAMES.has(authoredParent)
          ? "SSF primitive"
          : aliasGroups.has(authoredParent)
            ? "invalid alias"
            : declarationGroups.has(authoredParent)
              ? "ambiguous duplicate declaration"
              : "unresolved name";
      diagnostics.push({
        code: "SSF_INVALID_SUBSET_PARENT",
        message: `Subset parent ${JSON.stringify(authoredParent)} is an ${category}; a parent must be an exact owned structural declaration or explicit alias.`,
        suggestion:
          "Declare the parent as a unique identity or subset, or use an exact explicit alias for one.",
        span: declaration.parent.span,
      });
      continue;
    }
    if (
      declarationGroups.get(declaration.name.text)?.length === 1 &&
      eligible.has(declaration.name.text)
    ) {
      parentBySubset.set(declaration.name.text, parent);
    }
  }

  const cyclicNames = cycleMembers(parentBySubset);
  for (const declaration of declarations) {
    if (
      declaration.declarationKind === "subset" &&
      cyclicNames.has(declaration.name.text) &&
      declaration.parent !== undefined
    )
      diagnostics.push({
        code: "SSF_SUBSET_CYCLE",
        message: `Subset parent edge ${JSON.stringify(`${declaration.name.text} -> ${declaration.parent.text}`)} participates in a cycle after exact alias resolution.`,
        suggestion: "Make every subset chain terminate at a top-level identity declaration.",
        span: declaration.parent.span,
      });
  }

  const validStructuralNames = new Set<string>();
  for (const [name, declaration] of eligible) {
    if (declaration.declarationKind === "collection") validStructuralNames.add(name);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, declaration] of eligible) {
      const parent = parentBySubset.get(name);
      if (
        declaration.declarationKind === "subset" &&
        !cyclicNames.has(name) &&
        parent !== undefined &&
        validStructuralNames.has(parent) &&
        !validStructuralNames.has(name)
      ) {
        validStructuralNames.add(name);
        changed = true;
      }
    }
  }

  for (const declaration of declarations) {
    if (
      declaration.declarationKind === "subset" &&
      declaration.parent !== undefined &&
      !cyclicNames.has(declaration.name.text) &&
      parentBySubset.has(declaration.name.text) &&
      !validStructuralNames.has(parentBySubset.get(declaration.name.text)!)
    ) {
      diagnostics.push({
        code: "SSF_INVALID_SUBSET_PARENT",
        message: `Subset parent ${JSON.stringify(declaration.parent.text)} does not resolve to a valid owned subset because its canonical parent chain is invalid.`,
        suggestion:
          "Repair the parent chain so it terminates at a unique top-level identity declaration.",
        span: declaration.parent.span,
      });
    }
  }

  const validAliases = new Map<string, string>();
  for (const alias of aliases) {
    const target = alias.target.text;
    const candidateTarget = candidateAliases.get(alias.name.text);
    if (validStructuralNames.has(target)) {
      if (candidateTarget === target) validAliases.set(alias.name.text, target);
      continue;
    }
    {
      const category = aliasGroups.has(target)
        ? "another alias (alias chains are not allowed)"
        : external.has(target)
          ? "an external type"
          : PRIMITIVE_NAMES.has(target)
            ? "a primitive"
            : declarationGroups.has(target)
              ? "an invalid or ambiguous structural declaration"
              : "an unresolved name";
      diagnostics.push({
        code: "SSF_INVALID_ALIAS_TARGET",
        message: `Alias target ${JSON.stringify(target)} is ${category}; an alias must target one valid owned structural declaration.`,
        suggestion:
          "Target the exact name of a unique identity or subset declaration; do not target another alias.",
        span: alias.target.span,
      });
    }
  }
  return { validStructuralNames, validAliases };
}
