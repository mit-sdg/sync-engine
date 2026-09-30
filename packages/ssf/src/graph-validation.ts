import {
  automaticAliasCandidates,
  exactPluralPair,
  sameQualifiedName,
} from "./automatic-aliases.ts";
import { identifierOf, impliedName, PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedField,
  type SsfDiagnostic,
  type SsfLocalType,
  type SsfReferenceKind,
  type SsfSpan,
} from "./model.ts";
import { span } from "./source.ts";
import { pluralize } from "./vendor/plur.ts";

/** What a set's members are: identities this State owns, or individuals of an external type. */
export interface SetBase {
  readonly kind: "owned" | "external";
  readonly name: string;
}

/** A subset resolved from its phrase: `Trusted Verified Users` qualifies `Verified Users`. */
export interface SubsetFact {
  /** The declared phrase. */
  readonly name: string;
  readonly qualifier: string;
  /** The spelling a signature would use for the root: its singular where one is authored. */
  readonly rootType: string;
  readonly parent: {
    readonly text: string;
    readonly normalized: string;
    readonly referenceKind: Extract<SsfReferenceKind, "external" | "owned" | "subset">;
    readonly span: SsfSpan;
  };
  readonly identifiers: readonly string[];
  readonly qualifierPrefix: string;
}

export interface ResolutionFacts {
  /** Owned top-level declarations: the types this State introduces. */
  readonly validStructuralNames: ReadonlySet<string>;
  readonly validAliases: ReadonlyMap<string, string>;
  /** Spellings other than the declared name that resolve to an external type. */
  readonly externalSpellings: ReadonlyMap<string, string>;
  /** Each declared subset that resolves, by its declaration. */
  readonly subsets: ReadonlyMap<ParsedDeclaration, SubsetFact>;
  /** The subset a qualified phrase such as `Verified User` names, if one is declared. */
  readonly subsetNamed: (phrase: string) => SubsetFact | undefined;
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

function typeOf(field: ParsedField): string {
  return field.value.kind === "named"
    ? field.value.reference.text
    : field.value.element.reference.text;
}

/** Fields a declaration may name: its own, then every ancestor's up the subset chain. */
function constrainableFields(
  declaration: ParsedDeclaration,
  parentOf: ReadonlyMap<ParsedDeclaration, ParsedDeclaration>,
): ReadonlyMap<string, ParsedField> {
  const fields = new Map<string, ParsedField>();
  const visited = new Set<ParsedDeclaration>();
  let cursor: ParsedDeclaration | undefined = declaration;
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor);
    for (const field of cursor.fields) if (!fields.has(field.name)) fields.set(field.name, field);
    cursor = parentOf.get(cursor);
  }
  return fields;
}

/** Report uniqueness constraints that name an unavailable field or repeat a combination. */
function validateUniqueConstraints(
  declarations: readonly ParsedDeclaration[],
  parentOf: ReadonlyMap<ParsedDeclaration, ParsedDeclaration>,
  diagnostics: SsfDiagnostic[],
): void {
  for (const declaration of declarations) {
    const available = constrainableFields(declaration, parentOf);
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
  parentOf: ReadonlyMap<ParsedDeclaration, ParsedDeclaration>,
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
    const field = constrainableFields(declaration, parentOf).get(condition.field.text);
    if (field === undefined) {
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_CONDITION",
          message: `Subset condition names ${JSON.stringify(condition.field.text)}, which is not a field of ${JSON.stringify(declaration.name.text)} or of a set it is a subset of.`,
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
 * A subset qualifies a set by name: `Verified Users` is a subset of `Users`, and
 * `Trusted Verified Users` a subset of `Verified Users`.
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
              !external.has(name) || declaration.multiplicity === "element"
                ? "Rename the structural declaration; owned, external, concept-local, and primitive names are one exact namespace."
                : pluralize(name) === name
                  ? `\`${name}\` is spelled the same in the plural, so rename the external type (for example \`${name}Item\`, declared as \`a set of ${name}Items\`), or declare a qualified subset such as \`a set of Tracked ${name}\`.`
                  : `Write the plural, \`${pluralize(name)}\`, to declare a set of the external type; owned, external, concept-local, and primitive names are one exact namespace.`,
            span: declaration.name.span,
          }),
        );
    }
  }
  for (const declaration of declarations) {
    const seenFields = new Set<string>();
    for (const field of declaration.fields) {
      if (seenFields.has(field.name))
        diagnostics.push(
          error({
            code: "SSF_DUPLICATE_FIELD",
            message: `Field ${JSON.stringify(field.name)} occurs more than once in declaration ${JSON.stringify(declaration.name.text)}.`,
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
    const matches = [...external].filter((type) => pluralize(type) === name).sort();
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
      suggestion: owners.some((name) => external.has(name))
        ? "Write the exact external type name, or rename a type so each spelling pairs with only one."
        : "Declare each intended relation explicitly with `alias Candidate for Owner`, or use unambiguous exact spellings.",
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
  const rootDeclarationOf = (base: SetBase): ParsedDeclaration | undefined =>
    base.kind === "owned"
      ? eligible.get(base.name)
      : uniqueDeclarations.get(setOfExternal.get(base.name) ?? "");
  const keyOf = (base: SetBase, qualifiers: readonly string[]): string =>
    `${base.kind}:${base.name}|${qualifiers.join(" ")}`;

  // A subset's phrase is its qualifiers and the head that names its top-level set.
  const resolved: {
    readonly declaration: ParsedDeclaration;
    readonly qualifiers: readonly string[];
    readonly head: string;
    readonly base: SetBase;
    readonly key: string;
  }[] = [];
  for (const subset of subsets) {
    const words = subset.name.text.split(" ");
    const head = words.at(-1)!;
    const base = baseOfType(head);
    if (base !== undefined) {
      const qualifiers = words.slice(0, -1);
      resolved.push({ declaration: subset, qualifiers, head, base, key: keyOf(base, qualifiers) });
      continue;
    }
    const category = local.has(head)
      ? "a concept-local type"
      : PRIMITIVE_NAMES.has(head)
        ? "an SSF primitive"
        : declarationGroups.has(head)
          ? "an invalid or ambiguous structural declaration"
          : undefined;
    diagnostics.push(
      category === undefined
        ? error({
            code: "SSF_UNDECLARED_TYPE",
            message: `Subset ${JSON.stringify(subset.name.text)} qualifies ${JSON.stringify(head)}, which is not owned or external.`,
            suggestion: `Declare the set it qualifies, such as \`a set of ${head}\`, or \`external ${head}\` in the Types fence.`,
            span: subset.name.span,
          })
        : error({
            code: "SSF_INVALID_SUBSET_PARENT",
            message: `Subset ${JSON.stringify(subset.name.text)} qualifies ${JSON.stringify(head)}, which is ${category}; a subset qualifies an owned or external set.`,
            suggestion: "Qualify a top-level set of the concept or an external type.",
            span: subset.name.span,
          }),
    );
  }

  const byKey = groupsOf(resolved, ({ key }) => key);
  for (const group of byKey.values())
    for (const { declaration } of group.slice(1))
      diagnostics.push(
        error({
          code: "SSF_DUPLICATE_SET_NAME",
          message: `Subset ${JSON.stringify(declaration.name.text)} is declared more than once.`,
          suggestion: "Declare each subset once, and put all of its fields on that declaration.",
          span: declaration.name.span,
        }),
      );
  const unique = resolved.filter(({ key }) => byKey.get(key)?.length === 1);

  // Each qualifier appears once among the subsets of one top-level set.
  const byRootQualifier = groupsOf(
    unique,
    ({ base, qualifiers }) => `${keyOf(base, [])}${qualifiers[0]}`,
  );
  for (const group of byRootQualifier.values()) {
    const [first, ...repeats] = group;
    for (const { declaration, qualifiers } of repeats)
      diagnostics.push(
        error({
          code: "SSF_REPEATED_QUALIFIER",
          message: `Qualifier ${JSON.stringify(qualifiers[0])} already qualifies ${JSON.stringify(first!.declaration.name.text)}; a qualifier appears once among the subsets of one set.`,
          suggestion:
            "Use a different qualifier, or make this set a subset of the one the qualifier already names.",
          span: declaration.name.span,
        }),
      );
  }

  // Identifiers in code join the words, and must not collide in either number.
  // An owned set is declared in the plural and an external type in the singular; each
  // other number is known only where it is authored, as a joined spelling.
  const spellingsOf = (base: SetBase): readonly string[] => [
    base.name,
    ...(base.kind === "external" ? [pluralize(base.name)] : []),
    ...[...validAliases].flatMap(([spelling, target]) =>
      base.kind === "owned" && target === base.name ? [spelling] : [],
    ),
    ...[...externalSpellings].flatMap(([spelling, target]) =>
      base.kind === "external" && target === base.name ? [spelling] : [],
    ),
  ];
  const typeNamespace = new Set([
    ...occupied,
    ...aliasGroups.keys(),
    ...validAliases.keys(),
    ...externalSpellings.keys(),
  ]);
  // Identifiers match in either number: `VerifiedUser` and `VerifiedUsers` are one name.
  const identifierOwners: {
    readonly identifier: string;
    readonly key: string;
    readonly prefix: string;
  }[] = [];
  const subsetFacts = new Map<ParsedDeclaration, SubsetFact>();
  const factByKey = new Map<string, SubsetFact>();
  const parentOf = new Map<ParsedDeclaration, ParsedDeclaration>();
  const declarationByKey = new Map(unique.map(({ key, declaration }) => [key, declaration]));
  for (const { declaration, qualifiers, head, base, key } of unique) {
    const qualifierText = qualifiers.join("");
    const identifiers = [
      ...new Set(
        [head, ...spellingsOf(base)].map((spelling) => identifierOf(`${qualifierText}${spelling}`)),
      ),
    ].sort();
    const collision = identifiers.find(
      (identifier) =>
        [...typeNamespace].some((name) => sameQualifiedName(qualifierText, identifier, name)) ||
        identifierOwners.some(
          (owned) =>
            owned.key !== key &&
            (sameQualifiedName(qualifierText, identifier, owned.identifier) ||
              sameQualifiedName(owned.prefix, owned.identifier, identifier)),
        ),
    );
    if (collision !== undefined)
      diagnostics.push(
        error({
          code: "SSF_NAME_COLLISION",
          message: `Subset ${JSON.stringify(declaration.name.text)} takes the identifier ${JSON.stringify(collision)}, which another type in this concept already has in one number or the other.`,
          suggestion: "Choose a qualifier whose joined name no other type or subset uses.",
          span: declaration.name.span,
        }),
      );
    else
      for (const identifier of identifiers)
        identifierOwners.push({ identifier, key, prefix: qualifierText });

    const parentQualifiers = qualifiers.slice(1);
    const words = declaration.name.wordSpans;
    const parentSpan =
      words === undefined || words.length < 2
        ? declaration.name.span
        : span(words[1]!.start, words.at(-1)!.end);
    let parent: SubsetFact["parent"];
    if (parentQualifiers.length === 0) {
      parent = { text: head, normalized: base.name, referenceKind: base.kind, span: parentSpan };
      const root = rootDeclarationOf(base);
      if (root !== undefined) parentOf.set(declaration, root);
    } else {
      const parentText = [...parentQualifiers, head].join(" ");
      const parentDeclaration = declarationByKey.get(keyOf(base, parentQualifiers));
      if (parentDeclaration === undefined)
        diagnostics.push(
          error({
            code: "SSF_INVALID_SUBSET_PARENT",
            message: `Subset ${JSON.stringify(declaration.name.text)} qualifies ${JSON.stringify(parentText)}, which this State does not declare.`,
            suggestion: `Declare \`a set of ${parentText}\`, or qualify a set that exists.`,
            span: declaration.name.span,
          }),
        );
      else parentOf.set(declaration, parentDeclaration);
      parent = {
        text: parentText,
        normalized: parentDeclaration?.name.text ?? parentText,
        referenceKind: "subset",
        span: parentSpan,
      };
    }
    const parentDeclaration = parentOf.get(declaration);
    if (parentDeclaration?.multiplicity === "element")
      diagnostics.push(
        error({
          code: "SSF_INVALID_SUBSET_PARENT",
          message: `Subset ${JSON.stringify(declaration.name.text)} qualifies ${JSON.stringify(parent.text)}, which has one member; a subset qualifies a set or a sequence.`,
          suggestion: `Declare ${JSON.stringify(parentDeclaration.name.text)} as a set, or qualify a set.`,
          span: parentSpan,
        }),
      );
    // A signature names an owned root by its one authored singular, else by its declaration.
    const singulars = [
      ...new Set(spellingsOf(base).filter((spelling) => pluralize(spelling) === base.name)),
    ];
    const fact: SubsetFact = {
      name: declaration.name.text,
      qualifier: qualifiers[0]!,
      rootType: base.kind === "owned" && singulars.length === 1 ? singulars[0]! : base.name,
      parent,
      identifiers,
      qualifierPrefix: qualifierText,
    };
    subsetFacts.set(declaration, fact);
    factByKey.set(key, fact);
  }

  function subsetNamed(phrase: string): SubsetFact | undefined {
    const words = phrase.split(" ");
    const base = words.length < 2 ? undefined : baseOfType(words.at(-1)!);
    return base === undefined ? undefined : factByKey.get(keyOf(base, words.slice(0, -1)));
  }

  validateUniqueConstraints(declarations, parentOf, diagnostics);
  validateSubsetConditions(declarations, parentOf, localTypes, diagnostics);

  // A field named like a qualifier is easily misread as a member of that subset.
  const qualifierNames = new Map(
    unique.flatMap(({ qualifiers }) =>
      qualifiers.map((qualifier) => [impliedName(qualifier), qualifier] as const),
    ),
  );
  for (const declaration of declarations)
    for (const field of declaration.fields) {
      const qualifier = qualifierNames.get(field.name);
      if (field.implicitName || qualifier === undefined) continue;
      const qualified = `${qualifier} ${typeOf(field)}`;
      const subset = subsetNamed(qualified);
      const words = [
        ...(field.optional ? ["optional"] : []),
        ...(field.unique ? ["unique"] : []),
        ...(field.value.kind === "named"
          ? []
          : [field.value.multiplicity === "set" ? "set" : "seq", "of"]),
        qualified,
      ];
      const written = `${/^[AEIOU]/iu.test(words[0]!) ? "an" : "a"} ${words.join(" ")}`;
      diagnostics.push({
        severity: "advice",
        code: "SSF_QUALIFIER_FIELD_NAME",
        message: `Field ${JSON.stringify(field.name)} of ${JSON.stringify(declaration.name.text)} is named like the qualifier ${JSON.stringify(qualifier)} but holds ${JSON.stringify(typeOf(field))}.`,
        suggestion:
          subset === undefined
            ? "Give the field a role name that is not a qualifier."
            : `If it holds members of ${JSON.stringify(subset.name)}, write \`${written}\`; otherwise give it a role name that is not a qualifier.`,
        span: field.nameSpan,
      });
    }

  return {
    validStructuralNames: new Set(eligible.keys()),
    validAliases,
    externalSpellings,
    subsets: subsetFacts,
    subsetNamed,
  };
}
