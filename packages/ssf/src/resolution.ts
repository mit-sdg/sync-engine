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
  local: ReadonlySet<string>,
): SsfTypeReference | undefined {
  const aliasTarget = facts.validAliases.get(reference.text);
  const owned = facts.validStructuralNames.has(reference.text) ? reference.text : aliasTarget;
  const referenceKind: SsfTypeReference["referenceKind"] | undefined = PRIMITIVE_NAMES.has(
    reference.text,
  )
    ? "primitive"
    : external.has(reference.text)
      ? "external"
      : owned !== undefined
        ? "owned"
        : local.has(reference.text)
          ? "local"
          : undefined;
  return referenceKind === undefined
    ? undefined
    : {
        text: reference.text,
        normalized: owned ?? reference.text,
        referenceKind,
        span: reference.span,
      };
}

/** A name no kind claims. Structural uses already diagnose; field values fail below. */
function unresolved(reference: ParsedReference): SsfTypeReference {
  return {
    text: reference.text,
    normalized: reference.text,
    referenceKind: "unresolved",
    span: reference.span,
  };
}

function structuralReference(
  reference: ParsedReference,
  facts: ResolutionFacts,
  external: ReadonlySet<string>,
  local: ReadonlySet<string>,
): SsfTypeReference {
  return typeReference(reference, facts, external, local) ?? unresolved(reference);
}

function resolveReference(
  reference: ParsedReference,
  facts: ResolutionFacts,
  external: ReadonlySet<string>,
  local: ReadonlySet<string>,
  diagnostics: SsfDiagnostic[],
): SsfTypeReference {
  const resolved = typeReference(reference, facts, external, local);
  if (resolved !== undefined) return resolved;
  diagnostics.push(
    error({
      code: "SSF_UNDECLARED_TYPE",
      message: `Type ${JSON.stringify(reference.text)} is not owned, external, concept-local, or an SSF primitive.`,
      suggestion: `Declare it in the Types fence as \`external ${reference.text}\`, \`${reference.text} is <VALUE_A or VALUE_B>\`, or \`opaque ${reference.text}\`.`,
      span: reference.span,
    }),
  );
  return unresolved(reference);
}

function fieldType(
  value: ParsedFieldType,
  resolve: (reference: ParsedReference) => SsfTypeReference,
): SsfFieldType {
  if (value.kind === "named") return { kind: "named", reference: resolve(value.reference) };
  return {
    kind: "collection",
    multiplicity: value.multiplicity,
    span: value.span,
    element: { kind: "named", reference: resolve(value.element.reference) },
  };
}

export function resolveGrammar(
  grammar: GrammarResult,
  options: SsfParseOptions,
): { document: SsfDocument; diagnostics: readonly SsfDiagnostic[] } {
  const external = new Set(options.externalTypes ?? []);
  const local = new Set((options.localTypes ?? []).map(({ name }) => name));
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
    options.localTypes ?? [],
    diagnostics,
  );
  const structural = (reference: ParsedReference): SsfTypeReference =>
    structuralReference(reference, facts, external, local);
  const resolve = (reference: ParsedReference): SsfTypeReference =>
    resolveReference(reference, facts, external, local, diagnostics);
  const declarations: SsfDeclaration[] = grammar.declarations.map((declaration) => ({
    kind: "declaration",
    name: structural(declaration.name),
    declarationKind: declaration.declarationKind,
    multiplicity: declaration.multiplicity,
    ...(declaration.parent === undefined ? {} : { parent: structural(declaration.parent) }),
    ...(declaration.condition === undefined
      ? {}
      : {
          condition: {
            field: declaration.condition.field.text,
            values: declaration.condition.values.map(({ text }) => text),
            span: declaration.condition.span,
          },
        }),
    fields: declaration.fields.map((field) => ({
      kind: "field",
      name: field.name,
      optional: field.optional,
      unique: field.unique,
      value: fieldType(field.value, resolve),
      span: field.span,
    })),
    constraints: declaration.constraints.map((constraint) => ({
      kind: "unique" as const,
      fields: constraint.fields.map(({ text }) => text),
      span: constraint.span,
    })),
    rules: declaration.rules,
    span: declaration.span,
    signatureSpan: declaration.signatureSpan,
  }));
  const aliases: SsfAlias[] = grammar.aliases.map((alias) => ({
    kind: "alias",
    name: structural(alias.name),
    target: structural(alias.target),
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
