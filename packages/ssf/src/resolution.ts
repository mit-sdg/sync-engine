import type { GrammarResult } from "./grammar.ts";
import { validateTypeGraph, type ResolutionFacts } from "./graph-validation.ts";
import { localIntegrityDiagnostics } from "./local-validation.ts";
import { PRIMITIVES, PRIMITIVE_NAMES } from "./names.ts";
import type {
  ParsedDeclaration,
  ParsedFieldType,
  ParsedReference,
  SsfAlias,
  SsfDeclaration,
  SsfDiagnostic,
  SsfDocument,
  SsfFieldType,
  SsfOwnedType,
  SsfParseOptions,
  SsfStatement,
  SsfTypeReference,
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

function inventory(
  declarations: readonly ParsedDeclaration[],
  facts: ResolutionFacts,
): { identities: readonly SsfOwnedType[]; types: readonly SsfOwnedType[] } {
  const aliasesByTarget = new Map<string, string[]>();
  for (const [name, target] of facts.validAliases) {
    const aliases = aliasesByTarget.get(target) ?? [];
    aliases.push(name);
    aliasesByTarget.set(target, aliases);
  }
  const types = declarations
    .filter(({ name }) => facts.validStructuralNames.has(name.text))
    .map(
      (declaration): SsfOwnedType => ({
        name: declaration.name.text,
        declaredNames: [
          declaration.name.text,
          ...(aliasesByTarget.get(declaration.name.text) ?? []),
        ].sort(),
        roles: [declaration.declarationKind === "subset" ? "subset" : "identity"],
        declarationSpans: [declaration.name.span],
      }),
    )
    .sort(({ name: left }, { name: right }) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    identities: types.filter(({ roles }) => roles[0] === "identity"),
    types,
  };
}

export function resolveGrammar(
  grammar: GrammarResult,
  options: SsfParseOptions,
): { document: SsfDocument; diagnostics: readonly SsfDiagnostic[] } {
  const external = new Set(options.externalTypes ?? []);
  const diagnostics = [
    ...grammar.diagnostics,
    ...localIntegrityDiagnostics(grammar.declarations, grammar.aliases, external),
  ];
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
      inferredName: field.inferredName,
      optional: field.optional,
      value: fieldType(field.value, facts, external),
      span: field.span,
    })),
    opaqueBody: declaration.opaqueBody,
    span: declaration.span,
    signatureSpan: declaration.signatureSpan,
  }));
  const aliases: SsfAlias[] = grammar.aliases.map((alias) => ({
    kind: "alias",
    name: typeReference(alias.name, facts, external),
    target: typeReference(alias.target, facts, external),
    span: alias.span,
  }));
  const statementsByOffset = new Map<number, SsfStatement>([
    ...declarations.map(
      (declaration) => [declaration.signatureSpan.start.offset, declaration] as const,
    ),
    ...aliases.map((alias) => [alias.span.start.offset, alias] as const),
  ]);
  const statements = grammar.statements.map((statement) =>
    statement.kind === "opaque" ? statement : statementsByOffset.get(statement.span.start.offset)!,
  );
  const opaqueLines = statements.flatMap((statement) =>
    statement.kind === "opaque"
      ? [statement]
      : statement.kind === "declaration"
        ? statement.opaqueBody
        : [],
  );
  const owned = inventory(grammar.declarations, facts);
  diagnostics.sort(
    (left, right) =>
      left.span.start.offset - right.span.start.offset ||
      (left.code < right.code ? -1 : left.code > right.code ? 1 : 0),
  );
  return {
    document: {
      statements,
      declarations,
      aliases,
      opaqueLines,
      inventory: { ...owned, external: [...external].sort(), primitives: [...PRIMITIVES] },
    },
    diagnostics,
  };
}
