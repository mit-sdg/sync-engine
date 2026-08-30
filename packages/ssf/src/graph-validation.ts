import { automaticAliasCandidates } from "./automatic-aliases.ts";
import { PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedField,
  type SsfDiagnostic,
  type SsfLocalType,
} from "./model.ts";

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

/** Fields a declaration may name: its own, then every ancestor's up the subset chain. */
function constrainableFields(
  declaration: ParsedDeclaration,
  byName: ReadonlyMap<string, ParsedDeclaration>,
  parentBySubset: ReadonlyMap<string, string>,
): ReadonlyMap<string, ParsedField> {
  const fields = new Map<string, ParsedField>();
  const visited = new Set<string>();
  let cursor: ParsedDeclaration | undefined = declaration;
  while (cursor !== undefined && !visited.has(cursor.name.text)) {
    visited.add(cursor.name.text);
    for (const field of cursor.fields) if (!fields.has(field.name)) fields.set(field.name, field);
    const parent = parentBySubset.get(cursor.name.text);
    cursor = parent === undefined ? undefined : byName.get(parent);
  }
  return fields;
}

/** Report uniqueness constraints that name an unavailable field or repeat a combination. */
function validateUniqueConstraints(
  declarations: readonly ParsedDeclaration[],
  uniqueDeclarations: ReadonlyMap<string, ParsedDeclaration>,
  parentBySubset: ReadonlyMap<string, string>,
  diagnostics: SsfDiagnostic[],
): void {
  for (const declaration of declarations) {
    const available = constrainableFields(declaration, uniqueDeclarations, parentBySubset);
    const combinations = new Set<string>();
    for (const constraint of declaration.constraints) {
      const named = new Set<string>();
      for (const field of constraint.fields) {
        if (!available.has(field.text))
          diagnostics.push(
            error({
              code: "SSF_UNKNOWN_UNIQUE_FIELD",
              message: `Uniqueness constraint names ${JSON.stringify(field.text)}, which is not a field of declaration ${JSON.stringify(declaration.name.text)}.`,
              suggestion:
                "Name only fields of this declaration or of a declaration it is a subset of.",
              span: field.span,
            }),
          );
        else if (named.has(field.text))
          diagnostics.push(
            error({
              code: "SSF_DUPLICATE_UNIQUE",
              message: `Uniqueness constraint names field ${JSON.stringify(field.text)} more than once.`,
              suggestion: "Name each field once; a combination constrains distinct fields.",
              span: field.span,
            }),
          );
        named.add(field.text);
      }
      const combination = constraint.fields
        .map(({ text }) => text)
        .sort()
        .join(" and ");
      if (combinations.has(combination))
        diagnostics.push(
          error({
            code: "SSF_DUPLICATE_UNIQUE",
            message: `Declaration ${JSON.stringify(declaration.name.text)} constrains the combination ${JSON.stringify(combination)} more than once.`,
            suggestion: "State each unique combination once; field order does not distinguish it.",
            span: constraint.span,
          }),
        );
      combinations.add(combination);
    }
  }
}

/** Report subset conditions whose field is unavailable or whose value the field cannot hold. */
function validateSubsetConditions(
  declarations: readonly ParsedDeclaration[],
  uniqueDeclarations: ReadonlyMap<string, ParsedDeclaration>,
  parentBySubset: ReadonlyMap<string, string>,
  localTypes: readonly SsfLocalType[],
  diagnostics: SsfDiagnostic[],
): void {
  const valuesByType = new Map(
    localTypes.flatMap(({ name, values }) =>
      values === undefined ? [] : [[name, values] as const],
    ),
  );
  for (const declaration of declarations) {
    const { condition } = declaration;
    if (condition === undefined) continue;
    const field = constrainableFields(declaration, uniqueDeclarations, parentBySubset).get(
      condition.field.text,
    );
    if (field === undefined) {
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_CONDITION",
          message: `Subset condition names ${JSON.stringify(condition.field.text)}, which is not a field of ${JSON.stringify(declaration.name.text)} or of a declaration it is a subset of.`,
          suggestion: "Condition a subset on a field its members carry.",
          span: condition.field.span,
        }),
      );
      continue;
    }
    const typeName = field.value.kind === "named" ? field.value.reference.text : undefined;
    const values = typeName === undefined ? undefined : valuesByType.get(typeName);
    if (values === undefined) {
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_CONDITION",
          message: `Subset condition tests field ${JSON.stringify(condition.field.text)}, whose type ${JSON.stringify(typeName ?? "collection")} is not a declared enumeration.`,
          suggestion:
            "Condition a subset on a field whose type the Types fence declares as `Name is A or B`.",
          span: condition.field.span,
        }),
      );
      continue;
    }
    const seen = new Set<string>();
    for (const tested of condition.values) {
      if (!values.includes(tested.text))
        diagnostics.push(
          error({
            code: "SSF_INVALID_SUBSET_CONDITION",
            message: `Subset condition tests for ${JSON.stringify(tested.text)}, which is not a value of ${JSON.stringify(typeName)}.`,
            suggestion: `Use one of: ${values.join(", ")}.`,
            span: tested.span,
          }),
        );
      else if (seen.has(tested.text))
        diagnostics.push(
          error({
            code: "SSF_INVALID_SUBSET_CONDITION",
            message: `Subset condition tests for ${JSON.stringify(tested.text)} more than once.`,
            suggestion: "List each value once.",
            span: tested.span,
          }),
        );
      seen.add(tested.text);
    }
  }
}

/** Resolve order-independent alias and subset graphs and report every invalid edge. */
export function validateTypeGraph(
  declarations: readonly ParsedDeclaration[],
  aliases: readonly ParsedAlias[],
  external: ReadonlySet<string>,
  evidenceTypeNames: readonly string[],
  localTypes: readonly SsfLocalType[],
  diagnostics: SsfDiagnostic[],
): ResolutionFacts {
  const declarationGroups = groupsOf(declarations, ({ name }) => name.text);
  const aliasGroups = groupsOf(aliases, ({ name }) => name.text);
  const occupied = new Set([...declarationGroups.keys(), ...external, ...PRIMITIVES]);

  for (const [name, group] of declarationGroups) {
    for (const declaration of group.slice(1))
      diagnostics.push(
        error({
          code: "SSF_DUPLICATE_DECLARATION",
          message: `Structural declaration ${JSON.stringify(name)} is declared more than once.`,
          suggestion: "Give every structural declaration a unique exact type name.",
          span: declaration.name.span,
        }),
      );
    for (const declaration of group) {
      if (external.has(name) || PRIMITIVE_NAMES.has(name))
        diagnostics.push(
          error({
            code: "SSF_NAME_COLLISION",
            message: `Structural declaration ${JSON.stringify(name)} collides with ${external.has(name) ? "an external type" : "an SSF primitive"}.`,
            suggestion:
              "Rename the structural declaration; owned, external, and primitive names are one exact namespace.",
            span: declaration.name.span,
          }),
        );
      const seenFields = new Set<string>();
      for (const field of declaration.fields) {
        if (seenFields.has(field.name))
          diagnostics.push(
            error({
              code: "SSF_DUPLICATE_FIELD",
              message: `Field ${JSON.stringify(field.name)} occurs more than once in declaration ${JSON.stringify(name)}.`,
              suggestion: "Use a unique field name within this declaration.",
              span: field.nameSpan,
            }),
          );
        seenFields.add(field.name);
      }
    }
  }
  for (const [name, group] of aliasGroups) {
    for (const alias of occupied.has(name) ? group : group.slice(1))
      diagnostics.push(
        error({
          code: "SSF_ALIAS_NAME_COLLISION",
          message: `Alias name ${JSON.stringify(name)} is already used in the SSF type namespace.`,
          suggestion:
            "Give the alias a unique exact name that is not structural, external, primitive, or another alias.",
          span: alias.name.span,
        }),
      );
  }

  const uniqueDeclarations = new Map(
    [...declarationGroups].flatMap(([name, group]) =>
      group.length === 1 ? [[name, group[0]!] as const] : [],
    ),
  );
  const eligible = new Map(
    [...uniqueDeclarations].filter(([name]) => !external.has(name) && !PRIMITIVE_NAMES.has(name)),
  );

  // Explicit aliases take precedence over automatic evidence. Both maps initially
  // target unique structural declarations; target graph validity is checked below.
  const candidateExplicitAliases = new Map<string, string>();
  for (const alias of aliases) {
    if (
      aliasGroups.get(alias.name.text)?.length === 1 &&
      !occupied.has(alias.name.text) &&
      eligible.has(alias.target.text)
    ) {
      candidateExplicitAliases.set(alias.name.text, alias.target.text);
    }
  }
  const automatic = automaticAliasCandidates(
    declarations,
    new Set(eligible.keys()),
    evidenceTypeNames,
    new Set(aliasGroups.keys()),
    external,
  );
  for (const { candidates, owners } of automatic.ambiguities) {
    diagnostics.push({
      severity: "advice",
      code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS",
      message: `Automatic alias inference rejected candidate spellings ${candidates.map((name) => JSON.stringify(name)).join(", ")} for owners ${owners.map((name) => JSON.stringify(name)).join(", ")} because the authored relation is not one-to-one.`,
      suggestion:
        "Declare each intended relation explicitly with `alias Candidate for Owner`, or use unambiguous exact spellings.",
      span: uniqueDeclarations.get(owners[0]!)!.name.span,
    });
  }
  const candidateAutomaticAliases = automatic.aliases;
  const candidateAliases = new Map(candidateExplicitAliases);
  for (const [name, target] of candidateAutomaticAliases) {
    if (!candidateAliases.has(name)) candidateAliases.set(name, target);
  }

  const parentBySubset = new Map<string, string>();
  for (const declaration of declarations) {
    if (declaration.declarationKind !== "subset" || declaration.parent === undefined) continue;
    const authoredParent = declaration.parent.text;
    const parent = eligible.has(authoredParent)
      ? authoredParent
      : candidateAliases.get(authoredParent);
    if (parent === declaration.name.text) {
      diagnostics.push(
        error({
          code: "SSF_SUBSET_SELF_PARENT",
          message:
            authoredParent === declaration.name.text
              ? `Subset ${JSON.stringify(declaration.name.text)} cannot be its own parent.`
              : `Subset ${JSON.stringify(declaration.name.text)} cannot be its own parent through alias ${JSON.stringify(authoredParent)}.`,
          suggestion:
            "Name a different owned structural declaration or its alias as the subset parent.",
          span: declaration.parent.span,
        }),
      );
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
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_PARENT",
          message: `Subset parent ${JSON.stringify(authoredParent)} is an ${category}; a parent must be an exact owned structural declaration or explicit alias.`,
          suggestion:
            "Declare the parent as a unique identity or subset, or use an exact explicit alias for one.",
          span: declaration.parent.span,
        }),
      );
      continue;
    }
    if (
      declarationGroups.get(declaration.name.text)?.length === 1 &&
      eligible.has(declaration.name.text)
    ) {
      parentBySubset.set(declaration.name.text, parent);
    }
  }

  validateUniqueConstraints(declarations, uniqueDeclarations, parentBySubset, diagnostics);
  validateSubsetConditions(
    declarations,
    uniqueDeclarations,
    parentBySubset,
    localTypes,
    diagnostics,
  );

  const cyclicNames = cycleMembers(parentBySubset);
  for (const declaration of declarations) {
    if (
      declaration.declarationKind === "subset" &&
      cyclicNames.has(declaration.name.text) &&
      declaration.parent !== undefined
    )
      diagnostics.push(
        error({
          code: "SSF_SUBSET_CYCLE",
          message: `Subset parent edge ${JSON.stringify(`${declaration.name.text} -> ${declaration.parent.text}`)} participates in a cycle after exact alias resolution.`,
          suggestion: "Make every subset chain terminate at a top-level identity declaration.",
          span: declaration.parent.span,
        }),
      );
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
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_PARENT",
          message: `Subset parent ${JSON.stringify(declaration.parent.text)} does not resolve to a valid owned subset because its canonical parent chain is invalid.`,
          suggestion:
            "Repair the parent chain so it terminates at a unique top-level identity declaration.",
          span: declaration.parent.span,
        }),
      );
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
      diagnostics.push(
        error({
          code: "SSF_INVALID_ALIAS_TARGET",
          message: `Alias target ${JSON.stringify(target)} is ${category}; an alias must target one valid owned structural declaration.`,
          suggestion:
            "Target the exact name of a unique identity or subset declaration; do not target another alias.",
          span: alias.target.span,
        }),
      );
    }
  }
  for (const [name, target] of candidateAutomaticAliases) {
    if (validStructuralNames.has(target) && !validAliases.has(name)) {
      validAliases.set(name, target);
    }
  }
  return { validStructuralNames, validAliases };
}
