import type { GrammarResult } from "./grammar.ts";
import { validateTypeGraph, type ResolutionFacts } from "./graph-validation.ts";
import { PRIMITIVES, PRIMITIVE_NAMES, TYPE_NAME } from "./names.ts";
import {
  error,
  type ParsedFieldType,
  type ParsedReference,
  type SsfAlias,
  type SsfDeclaration,
  type SsfDiagnostic,
  type SsfDocument,
  type SsfFieldType,
  type SsfParseOptions,
  type SsfStatement,
  type SsfTypeReference,
} from "./model.ts";

function typeReference(
  reference: ParsedReference,
  facts: ResolutionFacts,
  external: ReadonlySet<string>,
): SsfTypeReference {
  const aliasTarget = facts.validAliases.get(reference.text);
  const owned = facts.validStructuralNames.has(reference.text) ? reference.text : aliasTarget;
  return {
    text: reference.text,
    normalized: owned ?? reference.text,
    referenceKind: PRIMITIVE_NAMES.has(reference.text)
      ? "primitive"
      : external.has(reference.text)
        ? "external"
        : owned !== undefined
          ? "owned"
          : "unresolved",
    span: reference.span,
  };
}

function fieldType(
  value: ParsedFieldType,
  facts: ResolutionFacts,
  external: ReadonlySet<string>,
): SsfFieldType {
  if (value.kind === "named")
    return { kind: "named", reference: typeReference(value.reference, facts, external) };
  if (value.kind === "enumeration")
    return { kind: "enumeration", values: value.values, span: value.span };
  return {
    kind: "collection",
    multiplicity: value.multiplicity,
    span: value.span,
    element:
      value.element.kind === "named"
        ? { kind: "named", reference: typeReference(value.element.reference, facts, external) }
        : { kind: "enumeration", values: value.element.values, span: value.element.span },
  };
}

export function resolveGrammar(
  grammar: GrammarResult,
  options: SsfParseOptions,
): { document: SsfDocument; diagnostics: readonly SsfDiagnostic[] } {
  const external = new Set(options.externalTypes ?? []);
  const diagnostics: SsfDiagnostic[] = [...grammar.diagnostics];
  for (const name of external) {
    const invalidName = !TYPE_NAME.test(name);
    if (!invalidName && !PRIMITIVE_NAMES.has(name)) continue;
    external.delete(name);
    diagnostics.push(
      error({
        code: invalidName ? "SSF_INVALID_EXTERNAL_NAME" : "SSF_NAME_COLLISION",
        message: `External type ${JSON.stringify(name)} ${invalidName ? "is not a valid SSF type name." : "collides with the SSF primitive of the same name."}`,
        suggestion: invalidName
          ? "Start with uppercase ASCII; continue only with ASCII letters, digits, or `_`."
          : "Rename the external type; external and primitive names share one namespace.",
        externalType: name,
      }),
    );
  }
  const facts = validateTypeGraph(
    grammar.declarations,
    grammar.aliases,
    external,
    options.evidenceTypeNames ?? [],
    diagnostics,
  );
  const declarations: SsfDeclaration[] = grammar.declarations.map((declaration) => ({
    kind: "declaration",
    name: typeReference(declaration.name, facts, external),
    declarationKind: declaration.declarationKind,
    multiplicity: declaration.multiplicity,
    ...(declaration.parent === undefined
      ? {}
      : { parent: typeReference(declaration.parent, facts, external) }),
    fields: declaration.fields.map((field) => ({
      kind: "field",
      name: field.name,
      optional: field.optional,
      unique: field.unique,
      value: fieldType(field.value, facts, external),
      span: field.span,
    })),
    rules: declaration.rules,
    span: declaration.span,
    signatureSpan: declaration.signatureSpan,
  }));
  const aliases: SsfAlias[] = grammar.aliases.map((alias) => ({
    kind: "alias",
    name: typeReference(alias.name, facts, external),
    target: typeReference(alias.target, facts, external),
    span: alias.span,
  }));
  const statements: SsfStatement[] = [...declarations, ...aliases, ...grammar.rules].sort(
    (left, right) => left.span.start.offset - right.span.start.offset,
  );
  const ownedTypeNames = [...facts.validStructuralNames, ...facts.validAliases.keys()].sort();
  diagnostics.sort((left, right) => {
    const byOffset = (left.span?.start.offset ?? -1) - (right.span?.start.offset ?? -1);
    if (byOffset !== 0) return byOffset;
    const byCode = left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    if (byCode !== 0) return byCode;
    const leftExternal = left.externalType ?? "";
    const rightExternal = right.externalType ?? "";
    return leftExternal < rightExternal ? -1 : leftExternal > rightExternal ? 1 : 0;
  });
  return {
    document: {
      statements,
      declarations,
      aliases,
      rules: grammar.rules,
      inventory: {
        ownedTypeNames,
        external: [...external].sort(),
        primitives: [...PRIMITIVES],
      },
    },
    diagnostics,
  };
}
