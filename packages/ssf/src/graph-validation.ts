import { automaticAliasCandidates, exactPluralPair } from "./automatic-aliases.ts";
import { impliedName, PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedField,
  type SsfDiagnostic,
  type SsfLocalType,
  type SsfSetReference,
} from "./model.ts";
import { pluralize } from "./vendor/plur.ts";

export interface ResolutionFacts {
  /** Owned top-level declarations: the types this State introduces. */
  readonly validStructuralNames: ReadonlySet<string>;
  readonly validAliases: ReadonlyMap<string, string>;
  /** Spellings other than the declared name that resolve to an external type. */
  readonly externalSpellings: ReadonlyMap<string, string>;
  /** The set each subset classifies. */
  readonly parents: ReadonlyMap<ParsedDeclaration, SsfSetReference>;
}

/** What a set's members are: identities this State owns, or individuals of an external type. */
type SetBase = { readonly kind: "owned" | "external"; readonly name: string };

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

/** A declaration as diagnostics name it: a subset by its set name, any other by its type. */
function labelOf(declaration: ParsedDeclaration): string {
  return declaration.declarationKind === "subset"
    ? declaration.setName.text
    : declaration.name.text;
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
  bySetName: ReadonlyMap<string, ParsedDeclaration>,
  parentBySubset: ReadonlyMap<string, string>,
): ReadonlyMap<string, ParsedField> {
  const fields = new Map<string, ParsedField>();
  const visited = new Set<string>();
  let cursor: ParsedDeclaration | undefined = declaration;
  while (cursor !== undefined && !visited.has(cursor.setName.text)) {
    visited.add(cursor.setName.text);
    for (const field of cursor.fields) if (!fields.has(field.name)) fields.set(field.name, field);
    const parent = parentBySubset.get(cursor.setName.text);
    cursor = parent === undefined ? undefined : bySetName.get(parent);
  }
  return fields;
}

/** Report uniqueness constraints that name an unavailable field or repeat a combination. */
function validateUniqueConstraints(
  declarations: readonly ParsedDeclaration[],
  bySetName: ReadonlyMap<string, ParsedDeclaration>,
  parentBySubset: ReadonlyMap<string, string>,
  diagnostics: SsfDiagnostic[],
): void {
  for (const declaration of declarations) {
    const available = constrainableFields(declaration, bySetName, parentBySubset);
    // The modifier is the one-field line, so it occupies that combination already.
    const combinations = new Set(
      declaration.fields.filter(({ unique }) => unique).map(({ name }) => name),
    );
    for (const constraint of declaration.constraints) {
      const named = new Set<string>();
      for (const field of constraint.fields) {
        if (!available.has(field.text))
          diagnostics.push(
            error({
              code: "SSF_UNKNOWN_UNIQUE_FIELD",
              message: `Uniqueness constraint names ${JSON.stringify(field.text)}, which is not a field of declaration ${JSON.stringify(labelOf(declaration))}.`,
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
            message: `Declaration ${JSON.stringify(labelOf(declaration))} constrains the combination ${JSON.stringify(combination)} more than once.`,
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
  bySetName: ReadonlyMap<string, ParsedDeclaration>,
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
    const field = constrainableFields(declaration, bySetName, parentBySubset).get(
      condition.field.text,
    );
    if (field === undefined) {
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_CONDITION",
          message: `Subset condition names ${JSON.stringify(condition.field.text)}, which is not a field of ${JSON.stringify(labelOf(declaration))} or of a set it is a subset of.`,
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

/** Report exact collisions between a top-level declaration and a Types or primitive name. */
function collisionOf(
  name: string,
  external: ReadonlySet<string>,
  local: ReadonlySet<string>,
): string | undefined {
  return external.has(name)
    ? "an external type"
    : local.has(name)
      ? "a concept-local type"
      : PRIMITIVE_NAMES.has(name)
        ? "an SSF primitive"
        : undefined;
}

/**
 * Resolve the declared types, aliases, and subset graph, and report every invalid edge.
 *
 * A top-level set or sequence whose type is the plural of an external type holds
 * individuals of that type; every other top-level declaration introduces owned identities.
 * A subset is a named set: it classifies the members of its parent set and is not a type.
 */
export function validateTypeGraph(
  declarations: readonly ParsedDeclaration[],
  aliases: readonly ParsedAlias[],
  external: ReadonlySet<string>,
  evidenceTypeNames: readonly string[],
  localTypes: readonly SsfLocalType[],
  diagnostics: SsfDiagnostic[],
): ResolutionFacts {
  const collections = declarations.filter(
    ({ declarationKind }) => declarationKind === "collection",
  );
  const subsets = declarations.filter(({ declarationKind }) => declarationKind === "subset");
  const declarationGroups = groupsOf(collections, ({ name }) => name.text);
  const setGroups = groupsOf(declarations, ({ setName }) => setName.text);
  const aliasGroups = groupsOf(aliases, ({ name }) => name.text);
  const local = new Set(localTypes.map(({ name }) => name));
  const occupied = new Set([...declarationGroups.keys(), ...external, ...local, ...PRIMITIVES]);

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
      const collision = collisionOf(name, external, local);
      if (collision !== undefined)
        diagnostics.push(
          error({
            code: "SSF_NAME_COLLISION",
            message: `Structural declaration ${JSON.stringify(name)} collides with ${collision}.`,
            suggestion:
              external.has(name) && declaration.multiplicity !== "element"
                ? `Write the plural, \`${pluralize(name)}\`, to declare a set of the external type; owned, external, concept-local, and primitive names are one exact namespace.`
                : "Rename the structural declaration; owned, external, concept-local, and primitive names are one exact namespace.",
            span: declaration.name.span,
          }),
        );
    }
  }
  for (const [name, group] of setGroups) {
    if (group.every(({ declarationKind }) => declarationKind === "collection")) continue;
    for (const declaration of group.slice(1))
      diagnostics.push(
        error({
          code: "SSF_DUPLICATE_SET_NAME",
          message: `Set name ${JSON.stringify(name)} is used by more than one declaration.`,
          suggestion:
            "Give every subset a name no other set uses; a top-level declaration's set is named by its type, so `a set of Users` is `users`.",
          span: declaration.setName.span,
        }),
      );
  }
  for (const declaration of declarations) {
    const seenFields = new Set<string>();
    for (const field of declaration.fields) {
      if (seenFields.has(field.name))
        diagnostics.push(
          error({
            code: "SSF_DUPLICATE_FIELD",
            message: `Field ${JSON.stringify(field.name)} occurs more than once in declaration ${JSON.stringify(labelOf(declaration))}.`,
            suggestion: field.implicitName
              ? `Write a distinct name before each field of type \`${field.value.kind === "named" ? field.value.reference.text : field.value.element.reference.text}\`; a field written without a name is named \`${field.name}\`.`
              : "Use a unique field name within this declaration.",
            span: field.nameSpan,
          }),
        );
      seenFields.add(field.name);
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
      group.length === 1 && collisionOf(name, external, local) === undefined
        ? [[name, group[0]!] as const]
        : [],
    ),
  );

  // A set or sequence named for an external type's plural holds that type's individuals.
  const externalSets = new Map<string, string>();
  const ambiguousExternalSets = new Set<string>();
  for (const [name, declaration] of uniqueDeclarations) {
    if (declaration.multiplicity === "element" || aliasGroups.has(name)) continue;
    const matches = [...external].filter((type) => exactPluralPair(type, name)).sort();
    if (matches.length === 1) externalSets.set(name, matches[0]!);
    else if (matches.length > 1) {
      ambiguousExternalSets.add(name);
      diagnostics.push(
        error({
          code: "SSF_NAME_COLLISION",
          message: `Structural declaration ${JSON.stringify(name)} is the plural of several external types: ${matches.map((type) => JSON.stringify(type)).join(", ")}.`,
          suggestion: "Rename one of the external types so each set names exactly one.",
          span: declaration.name.span,
        }),
      );
    }
  }
  const eligible = new Map(
    [...uniqueDeclarations].filter(
      ([name]) => !externalSets.has(name) && !ambiguousExternalSets.has(name),
    ),
  );

  // Explicit aliases take precedence over automatic evidence.
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
    new Set([...aliasGroups.keys(), ...declarationGroups.keys()]),
    external,
    local,
  );
  for (const { candidates, owners } of automatic.ambiguities) {
    const owner = owners[0]!;
    const detail = {
      severity: "advice" as const,
      code: "SSF_AMBIGUOUS_AUTOMATIC_ALIAS" as const,
      message: `Automatic alias inference rejected candidate spellings ${candidates.map((name) => JSON.stringify(name)).join(", ")} for owners ${owners.map((name) => JSON.stringify(name)).join(", ")} because the authored relation is not one-to-one.`,
      suggestion:
        "Declare each intended relation explicitly with `alias Candidate for Owner`, or use unambiguous exact spellings.",
    };
    const declaration = uniqueDeclarations.get(owner);
    diagnostics.push(
      declaration === undefined
        ? { ...detail, externalType: owner }
        : { ...detail, span: declaration.name.span },
    );
  }
  const validAliases = new Map(candidateExplicitAliases);
  const externalSpellings = new Map(externalSets);
  for (const [name, target] of automatic.aliases) {
    if (validAliases.has(name)) continue;
    if (external.has(target)) externalSpellings.set(name, target);
    else validAliases.set(name, target);
  }

  for (const alias of aliases) {
    const target = alias.target.text;
    if (eligible.has(target)) continue;
    const category = aliasGroups.has(target)
      ? "another alias (alias chains are not allowed)"
      : externalSets.has(target)
        ? "a set of an external type"
        : external.has(target)
          ? "an external type"
          : local.has(target)
            ? "a concept-local type"
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
          "Target the exact name of a unique top-level identity declaration; do not target another alias.",
        span: alias.target.span,
      }),
    );
  }

  const baseOfType = (name: string): SetBase | undefined => {
    const owned = eligible.has(name) ? name : validAliases.get(name);
    if (owned !== undefined) return { kind: "owned", name: owned };
    const externalType = external.has(name) ? name : externalSpellings.get(name);
    return externalType === undefined ? undefined : { kind: "external", name: externalType };
  };
  const setOfExternal = new Map([...externalSets].map(([name, type]) => [type, name] as const));
  const bySetName = new Map(
    [...setGroups].flatMap(([name, group]) =>
      group.length === 1 &&
      (group[0]!.declarationKind === "subset" || uniqueDeclarations.has(group[0]!.name.text))
        ? [[name, group[0]!] as const]
        : [],
    ),
  );

  // Resolve each subset's parent set: written, or implied by the type the line names.
  const parents = new Map<ParsedDeclaration, SsfSetReference>();
  const parentBySubset = new Map<string, string>();
  const externalRooted = new Map<string, string>();
  const typeBases = new Map<ParsedDeclaration, SetBase>();
  for (const subset of subsets) {
    const typeName = subset.name.text;
    const base = baseOfType(typeName);
    const written = subset.parent;
    const reference = (text: string, setKind: SsfSetReference["setKind"]): SsfSetReference => ({
      text,
      implicit: written === undefined,
      setKind,
      span: written?.span ?? subset.name.span,
    });
    if (base === undefined) {
      const category = local.has(typeName)
        ? "a concept-local type"
        : PRIMITIVE_NAMES.has(typeName)
          ? "an SSF primitive"
          : declarationGroups.has(typeName)
            ? "an invalid or ambiguous structural declaration"
            : undefined;
      const namedSet = bySetName.get(impliedName(typeName));
      diagnostics.push(
        category === undefined
          ? error({
              code: namedSet === undefined ? "SSF_UNDECLARED_TYPE" : "SSF_INVALID_SUBSET_PARENT",
              message:
                namedSet === undefined
                  ? `Type ${JSON.stringify(typeName)} is not owned, external, concept-local, or an SSF primitive.`
                  : `Subset ${JSON.stringify(subset.setName.text)} names ${JSON.stringify(typeName)} as a type, but ${JSON.stringify(namedSet.setName.text)} is a set, not a type.`,
              suggestion:
                namedSet === undefined
                  ? `Declare it in the Types fence as \`external ${typeName}\`, or declare \`a set of ${typeName}\`.`
                  : `Name the parent set before the type: \`${namedSet.setName.text} ${namedSet.name.text}\`.`,
              span: subset.name.span,
            })
          : error({
              code: "SSF_INVALID_SUBSET_PARENT",
              message: `Subset ${JSON.stringify(subset.setName.text)} classifies ${JSON.stringify(typeName)}, which is ${category}; a subset classifies an owned or external type.`,
              suggestion:
                "Name a top-level set of the concept, or an external type, as the subset's type.",
              span: subset.name.span,
            }),
      );
      if (written !== undefined) parents.set(subset, reference(written.text, "unresolved"));
      else parents.set(subset, reference(impliedName(typeName), "unresolved"));
      continue;
    }
    typeBases.set(subset, base);
    if (written !== undefined && written.text === subset.setName.text) {
      diagnostics.push(
        error({
          code: "SSF_SUBSET_SELF_PARENT",
          message: `Subset ${JSON.stringify(subset.setName.text)} cannot be its own parent.`,
          suggestion: "Name a different set as the subset's parent, or leave it to the type.",
          span: written.span,
        }),
      );
      parents.set(subset, reference(written.text, "unresolved"));
      continue;
    }
    const declaredRoot =
      base.kind === "owned"
        ? eligible.get(base.name)
        : uniqueDeclarations.get(setOfExternal.get(base.name) ?? "");
    const parentName = written?.text ?? declaredRoot?.setName.text;
    if (parentName === undefined) {
      // No set of the external type is declared, so the subset holds its individuals directly.
      parents.set(subset, reference(impliedName(typeName), "external"));
      externalRooted.set(subset.setName.text, base.name);
      continue;
    }
    const parent = bySetName.get(parentName);
    if (parent === undefined) {
      if (
        written !== undefined &&
        base.kind === "external" &&
        declaredRoot === undefined &&
        written.text === impliedName(typeName)
      ) {
        parents.set(subset, reference(written.text, "external"));
        externalRooted.set(subset.setName.text, base.name);
        continue;
      }
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_PARENT",
          message: setGroups.has(parentName)
            ? `Subset parent ${JSON.stringify(parentName)} is an ambiguous duplicate set.`
            : `Subset parent ${JSON.stringify(parentName)} is not a set this State declares.`,
          suggestion:
            "Name a subset or a top-level set's name, such as `users` for `a set of Users`, or leave the parent to the type.",
          span: written?.span ?? subset.name.span,
        }),
      );
      parents.set(subset, reference(parentName, "unresolved"));
      continue;
    }
    parents.set(subset, reference(parentName, "declared"));
    if (bySetName.get(subset.setName.text) === subset)
      parentBySubset.set(subset.setName.text, parentName);
  }

  validateUniqueConstraints(declarations, bySetName, parentBySubset, diagnostics);
  validateSubsetConditions(declarations, bySetName, parentBySubset, localTypes, diagnostics);

  const cyclicNames = cycleMembers(parentBySubset);
  for (const subset of subsets) {
    if (cyclicNames.has(subset.setName.text) && subset.parent !== undefined)
      diagnostics.push(
        error({
          code: "SSF_SUBSET_CYCLE",
          message: `Subset parent edge ${JSON.stringify(`${subset.setName.text} -> ${subset.parent.text}`)} participates in a cycle.`,
          suggestion: "Make every subset chain terminate at a top-level set or an external type.",
          span: subset.parent.span,
        }),
      );
  }

  // A set's base is what its members are; a subset inherits its parent's.
  const setBases = new Map<string, SetBase>();
  for (const [name, declaration] of bySetName) {
    if (declaration.declarationKind !== "collection") continue;
    const externalType = externalSets.get(declaration.name.text);
    if (externalType !== undefined) setBases.set(name, { kind: "external", name: externalType });
    else if (eligible.has(declaration.name.text))
      setBases.set(name, { kind: "owned", name: declaration.name.text });
  }
  for (const [name, type] of externalRooted) setBases.set(name, { kind: "external", name: type });
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, parent] of parentBySubset) {
      const base = setBases.get(parent);
      if (!cyclicNames.has(name) && base !== undefined && !setBases.has(name)) {
        setBases.set(name, base);
        changed = true;
      }
    }
  }

  for (const subset of subsets) {
    const parentName = parentBySubset.get(subset.setName.text);
    const typeBase = typeBases.get(subset);
    if (parentName === undefined || cyclicNames.has(subset.setName.text) || typeBase === undefined)
      continue;
    const parentBase = setBases.get(parentName);
    if (parentBase === undefined) {
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_PARENT",
          message: `Subset parent ${JSON.stringify(parentName)} does not resolve to a valid set because its parent chain is invalid.`,
          suggestion:
            "Repair the parent chain so it terminates at a unique top-level set or an external type.",
          span: subset.parent?.span ?? subset.name.span,
        }),
      );
    } else if (parentBase.kind !== typeBase.kind || parentBase.name !== typeBase.name) {
      diagnostics.push(
        error({
          code: "SSF_SUBSET_TYPE_MISMATCH",
          message: `Subset ${JSON.stringify(subset.setName.text)} names type ${JSON.stringify(subset.name.text)}, but its parent set ${JSON.stringify(parentName)} holds ${JSON.stringify(parentBase.name)}.`,
          suggestion: `Name the type the parent set holds: \`${parentName} ${bySetName.get(parentName)?.name.text ?? parentBase.name}\`.`,
          span: subset.name.span,
        }),
      );
    }
  }

  return {
    validStructuralNames: new Set(eligible.keys()),
    validAliases,
    externalSpellings,
    parents,
  };
}
