import { ENUM_VALUE, FIELD_NAME, inferredFieldName, TYPE_NAME } from "./names.ts";
import type {
  ParsedAlias,
  ParsedCollection,
  ParsedDeclaration,
  ParsedEnumeration,
  ParsedField,
  ParsedFieldType,
  ParsedNamed,
  ParsedReference,
  ParsedStatement,
  SourceLine,
  SsfDiagnostic,
  SsfMultiplicity,
  SsfToken,
} from "./model.ts";
import { lineSpan, opaqueLine, span, words } from "./source.ts";

const CANONICAL_STRUCTURAL = new Set(["element", "seq", "set"]);
const NEAR_MISS_STRUCTURAL = new Map<string, SsfMultiplicity>([
  ["array", "sequence"],
  ["list", "sequence"],
  ["sequence", "sequence"],
  ["sequences", "sequence"],
  ["singleton", "element"],
]);

export interface GrammarResult {
  readonly declarations: readonly ParsedDeclaration[];
  readonly aliases: readonly ParsedAlias[];
  readonly statements: readonly ParsedStatement[];
  readonly diagnostics: readonly SsfDiagnostic[];
}

function multiplicityOf(structural: string): SsfMultiplicity | undefined {
  if (structural === "seq") return "sequence";
  if (structural === "set" || structural === "element") return structural;
  return NEAR_MISS_STRUCTURAL.get(structural);
}

function parseDeclaration(line: SourceLine): ParsedDeclaration | undefined {
  if (/^[ \t]/.test(line.text)) return undefined;
  const authored = words(line);
  let first = 0;
  if (authored[first] === "a" || authored[first] === "an") first += 1;
  const topStructural = authored[first];
  const subsetStructural = authored[first + 1];
  let declarationKind: "collection" | "subset";
  let structuralIndex: number;
  let nameIndex: number;
  let parentIndex: number | undefined;

  if (
    topStructural !== undefined &&
    (CANONICAL_STRUCTURAL.has(topStructural) || NEAR_MISS_STRUCTURAL.has(topStructural))
  ) {
    declarationKind = "collection";
    structuralIndex = first;
    nameIndex = first + 1 + (authored[first + 1] === "of" ? 1 : 0);
  } else if (
    TYPE_NAME.test(authored[first] ?? "") &&
    subsetStructural !== undefined &&
    (CANONICAL_STRUCTURAL.has(subsetStructural) || NEAR_MISS_STRUCTURAL.has(subsetStructural))
  ) {
    declarationKind = "subset";
    structuralIndex = first + 1;
    nameIndex = first;
    parentIndex = structuralIndex + 1 + (authored[structuralIndex + 1] === "of" ? 1 : 0);
  } else return undefined;

  const structural = authored[structuralIndex] ?? "";
  const multiplicity = multiplicityOf(structural);
  if (multiplicity === undefined || (declarationKind === "subset" && multiplicity === "sequence")) {
    return undefined;
  }
  const nameToken = line.tokens[nameIndex];
  const parentToken = parentIndex === undefined ? undefined : line.tokens[parentIndex];
  if (
    nameToken === undefined ||
    !TYPE_NAME.test(nameToken.text) ||
    (parentIndex !== undefined && (parentToken === undefined || !TYPE_NAME.test(parentToken.text)))
  )
    return undefined;

  const consumed = parentIndex ?? nameIndex;
  const trailing = authored.slice(consumed + 1);
  const hasWith = trailing[0] === "with";
  if (trailing.length > 1 || (trailing.length > 0 && !hasWith)) return undefined;

  return {
    kind: "declaration",
    name: { text: nameToken.text, span: nameToken.span },
    declarationKind,
    multiplicity,
    ...(parentToken === undefined
      ? {}
      : { parent: { text: parentToken.text, span: parentToken.span } }),
    fields: [],
    opaqueBody: [],
    span: lineSpan(line),
    signatureSpan: lineSpan(line),
    signature: line,
    structuralIndex,
    authoredStructural: structural,
    hasWith,
  };
}

function parseAlias(line: SourceLine): ParsedAlias | undefined {
  if (/^[ \t]/.test(line.text)) return undefined;
  const tokens = line.tokens;
  if (
    tokens.length !== 4 ||
    tokens[0]?.text !== "alias" ||
    !TYPE_NAME.test(tokens[1]?.text ?? "") ||
    tokens[2]?.text !== "for" ||
    !TYPE_NAME.test(tokens[3]?.text ?? "")
  )
    return undefined;
  return {
    kind: "alias",
    name: { text: tokens[1].text, span: tokens[1].span },
    target: { text: tokens[3].text, span: tokens[3].span },
    span: lineSpan(line),
  };
}

function enumerationValues(
  tokens: readonly SsfToken[],
  start: number,
): ParsedEnumeration | undefined {
  const first = tokens[start];
  if (first === undefined) return undefined;
  const values: ParsedReference[] = [];
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) return undefined;
    if ((index - start) % 2 === 0) {
      if (!ENUM_VALUE.test(token.text)) return undefined;
      values.push({ text: token.text, span: token.span });
    } else if (token.text !== "or") return undefined;
  }
  if (values.length < 2 || tokens.length - start !== values.length * 2 - 1) return undefined;
  return {
    kind: "enumeration",
    values: values.map(({ text }) => text),
    valueReferences: values,
    span: span(first.span.start, tokens.at(-1)?.span.end ?? first.span.end),
  };
}

function scalarEnumeration(
  tokens: readonly SsfToken[],
  start: number,
): ParsedEnumeration | undefined {
  const marker = tokens[start];
  if (marker?.text !== "of") return undefined;
  const parsed = enumerationValues(tokens, start + 1);
  return parsed === undefined
    ? undefined
    : { ...parsed, span: span(marker.span.start, parsed.span.end) };
}

function namedType(token: SsfToken | undefined): ParsedNamed | undefined {
  return token !== undefined && TYPE_NAME.test(token.text)
    ? { kind: "named", reference: { text: token.text, span: token.span } }
    : undefined;
}

function parseField(line: SourceLine): ParsedField | undefined {
  if (!/^[ \t]/.test(line.text)) return undefined;
  const original = [...line.tokens];
  let first = 0;
  if (original[first]?.text === "a" || original[first]?.text === "an") first += 1;
  const optionalIndex = original.findIndex(
    (token, index) => index >= first && token.text === "optional",
  );
  const tokens = original.filter((_, index) => index >= first && index !== optionalIndex);
  if (tokens.length === 0) return undefined;

  let name: string | undefined;
  let nameSpan = tokens[0]?.span;
  let inferredName = false;
  let valueStart = 0;
  if (
    tokens[0]?.text !== "set" &&
    tokens[0]?.text !== "seq" &&
    FIELD_NAME.test(tokens[0]?.text ?? "")
  ) {
    name = tokens[0]?.text;
    valueStart = 1;
  }

  let value: ParsedFieldType | undefined;
  const structural = tokens[valueStart]?.text;
  if (structural === "set" || structural === "seq") {
    let elementStart = valueStart + 1;
    if (tokens[elementStart]?.text === "of") elementStart += 1;
    const element = enumerationValues(tokens, elementStart) ?? namedType(tokens[elementStart]);
    if (
      element !== undefined &&
      (element.kind === "enumeration" || elementStart + 1 === tokens.length)
    ) {
      value = {
        kind: "collection",
        multiplicity: structural === "set" ? "set" : "sequence",
        element,
        span: span(
          tokens[valueStart]!.span.start,
          tokens.at(-1)?.span.end ?? tokens[valueStart]!.span.end,
        ),
      } satisfies ParsedCollection;
      if (name === undefined && element.kind === "named") {
        name = inferredFieldName(element.reference.text);
        nameSpan = element.reference.span;
        inferredName = true;
      }
    }
  } else {
    value = scalarEnumeration(tokens, valueStart) ?? namedType(tokens[valueStart]);
    const consumed =
      value?.kind === "named" ? valueStart + 1 : value?.kind === "enumeration" ? tokens.length : -1;
    if (consumed !== tokens.length) value = undefined;
    if (name === undefined && value?.kind === "named") {
      name = inferredFieldName(value.reference.text);
      nameSpan = value.reference.span;
      inferredName = true;
    }
  }
  if (name === undefined || nameSpan === undefined || value === undefined) return undefined;
  return {
    name,
    nameSpan,
    inferredName,
    optional: optionalIndex >= 0,
    value,
    span: lineSpan(line),
  };
}

function structurallyLooksLikeDeclaration(line: SourceLine): boolean {
  if (/^[ \t]/.test(line.text)) return false;
  const authored = words(line);
  const first = authored[0] === "a" || authored[0] === "an" ? 1 : 0;
  const structural = authored[first];
  return (
    (structural !== undefined &&
      (CANONICAL_STRUCTURAL.has(structural) || NEAR_MISS_STRUCTURAL.has(structural))) ||
    (TYPE_NAME.test(structural ?? "") &&
      authored[first + 1] !== undefined &&
      (CANONICAL_STRUCTURAL.has(authored[first + 1]!) ||
        NEAR_MISS_STRUCTURAL.has(authored[first + 1]!)))
  );
}

function structurallyLooksLikeField(line: SourceLine): boolean {
  if (!/^[ \t]/.test(line.text)) return false;
  const authored = words(line);
  const hasArticle = authored[0] === "a" || authored[0] === "an";
  const field = authored.slice(hasArticle ? 1 : 0);
  if (hasArticle && (field.length === 0 || field.length === 1)) return true;
  if (field[0] === "of" || field[0] === "optional" || field[0] === "set" || field[0] === "seq")
    return true;
  return (
    (hasArticle && TYPE_NAME.test(field[1] ?? "")) ||
    field[1] === "optional" ||
    field[1] === "set" ||
    field[1] === "seq" ||
    field[1] === "of"
  );
}

function malformedStructuralDiagnostic(
  line: SourceLine,
  kind: "alias" | "declaration" | "field",
): SsfDiagnostic {
  if (kind === "alias")
    return {
      code: "SSF_MALFORMED_ALIAS",
      message:
        "This line begins like an SSF alias but does not have the complete `alias Name for Target` form.",
      suggestion: "Use exactly `alias Name for Target` with uppercase SSF type names.",
      span: lineSpan(line),
    };
  return {
    code: kind === "declaration" ? "SSF_MALFORMED_DECLARATION" : "SSF_MALFORMED_FIELD",
    message:
      kind === "declaration"
        ? "This line begins like an SSF declaration but does not have one complete structural form."
        : "This indented line begins like an SSF field but does not have one complete field form.",
    suggestion:
      kind === "declaration"
        ? "Use one canonical `a set of Name`, `a seq of Name`, `an element Name`, or subset declaration; put fields on following indented lines after `with`."
        : "Use `fieldName Type`, `optional fieldName Type`, or a canonical set/sequence field, optionally prefixed by an article.",
    span: lineSpan(line),
  };
}

function correctedTokens(
  tokens: readonly SsfToken[],
  replacements: ReadonlyMap<number, string>,
): string {
  return tokens.map(({ text }, index) => replacements.get(index) ?? text).join(" ");
}

function articleFor(structural: SsfMultiplicity): "a" | "an" {
  return structural === "element" ? "an" : "a";
}

function canonicalStructural(structural: SsfMultiplicity): "element" | "seq" | "set" {
  return structural === "sequence" ? "seq" : structural;
}

function declarationDiagnostics(
  declaration: ParsedDeclaration,
  hasFieldLikeBody: boolean,
): SsfDiagnostic[] {
  const diagnostics: SsfDiagnostic[] = [];
  const tokens = declaration.signature.tokens;
  const authored = words(declaration.signature);
  const canonical = canonicalStructural(declaration.multiplicity);
  const replacements = new Map<number, string>();
  if (declaration.authoredStructural !== canonical)
    replacements.set(declaration.structuralIndex, canonical);
  const collectionHasArticle =
    declaration.declarationKind === "collection" && declaration.structuralIndex === 1;
  const subsetMissingArticle =
    declaration.declarationKind === "subset" && declaration.structuralIndex === 1;
  if (collectionHasArticle) replacements.set(0, articleFor(declaration.multiplicity));
  const canonicalLine = `${correctedTokens(tokens, replacements)}${hasFieldLikeBody && !declaration.hasWith ? " with" : ""}`;
  const subsetArticleSuggestion = `Use \`a ${canonicalLine}\` or \`an ${canonicalLine}\`.`;
  const structuralToken = tokens[declaration.structuralIndex];

  if (declaration.declarationKind === "collection" && declaration.structuralIndex === 0) {
    diagnostics.push({
      code: "SSF_ARTICLE",
      message: `Use \`${articleFor(declaration.multiplicity)}\` before \`${canonical}\`.`,
      suggestion: `${articleFor(declaration.multiplicity)} ${canonicalLine}`,
      span: structuralToken?.span ?? declaration.signatureSpan,
    });
  } else if (subsetMissingArticle) {
    diagnostics.push({
      code: "SSF_ARTICLE",
      message: `Add \`a\` or \`an\` before subset \`${declaration.name.text}\`.`,
      suggestion: subsetArticleSuggestion,
      span: declaration.name.span,
    });
  } else if (declaration.authoredStructural !== canonical && structuralToken !== undefined) {
    diagnostics.push({
      code: "SSF_NEAR_MISS_KEYWORD",
      message: `Use the SSF keyword \`${canonical}\` instead of \`${declaration.authoredStructural}\`.`,
      suggestion: canonicalLine,
      span: structuralToken.span,
    });
  } else if (collectionHasArticle) {
    const expected = articleFor(declaration.multiplicity);
    const article = authored[0];
    if ((article === "a" || article === "an") && article !== expected && tokens[0] !== undefined) {
      diagnostics.push({
        code: "SSF_ARTICLE",
        message: `Use \`${expected}\` before \`${canonical}\`.`,
        suggestion: canonicalLine,
        span: tokens[0].span,
      });
    }
  }
  if (
    declaration.hasWith &&
    declaration.fields.length === 0 &&
    declaration.opaqueBody.length === 0
  ) {
    diagnostics.push({
      code: "SSF_MALFORMED_DECLARATION",
      message: "A declaration ending in `with` must have an indented body.",
      suggestion: "Remove `with` or add at least one indented field.",
      span: tokens.at(-1)?.span ?? declaration.signatureSpan,
    });
  }
  if (hasFieldLikeBody && !declaration.hasWith) {
    const end = declaration.signatureSpan.end;
    diagnostics.push({
      code: "SSF_MISSING_WITH",
      message: "A declaration with indented fields must include `with`.",
      suggestion: subsetMissingArticle ? subsetArticleSuggestion : canonicalLine,
      span: span(end, end),
    });
  }
  return diagnostics;
}

function fieldDiagnostics(line: SourceLine): readonly SsfDiagnostic[] {
  if (!/^[ \t]/.test(line.text)) return [];
  const tokens = line.tokens;
  const hasArticle = tokens[0]?.text === "a" || tokens[0]?.text === "an";
  const optionalIndex = tokens.findIndex(({ text }) => text === "optional");
  if (optionalIndex < 0) return [];
  const collectionIndex = tokens.findIndex(({ text }) => text === "set" || text === "seq");
  const optionalToken = tokens[optionalIndex];
  if (optionalToken === undefined) return [];
  if (collectionIndex >= 0)
    return [
      {
        code: "SSF_OPTIONAL_COLLECTION",
        message: "SSF collections are never optional; an empty collection represents absence.",
        suggestion: "Remove `optional` from this field.",
        span: optionalToken.span,
      },
    ];
  const expectedOptionalIndex = hasArticle ? 1 : 0;
  if (optionalIndex !== expectedOptionalIndex) {
    const withoutOptional = tokens
      .filter((_, index) => index !== optionalIndex)
      .map(({ text }) => text);
    if (hasArticle) withoutOptional[0] = "an";
    withoutOptional.splice(expectedOptionalIndex, 0, "optional");
    return [
      {
        code: "SSF_MISPLACED_OPTIONAL",
        message:
          "The `optional` modifier must precede the field name and follow the article when present.",
        suggestion: withoutOptional.join(" "),
        span: optionalToken.span,
      },
    ];
  }
  if (tokens[0]?.text === "a")
    return [
      {
        code: "SSF_ARTICLE",
        message: "Use `an` before `optional`.",
        suggestion: correctedTokens(tokens, new Map([[0, "an"]])),
        span: tokens[0].span,
      },
    ];
  return [];
}

export function parseGrammar(lines: readonly SourceLine[]): GrammarResult {
  const declarations: ParsedDeclaration[] = [];
  const aliases: ParsedAlias[] = [];
  const statements: ParsedStatement[] = [];
  const diagnostics: SsfDiagnostic[] = [];
  let current: ParsedDeclaration | undefined;

  for (const line of lines) {
    if (line.text.trim() === "") continue;
    if (/^[ \t]/.test(line.text)) {
      const field = parseField(line);
      if (current === undefined) {
        statements.push(opaqueLine(line));
        if (field !== undefined || structurallyLooksLikeField(line))
          diagnostics.push(malformedStructuralDiagnostic(line, "field"));
        continue;
      }
      if (field === undefined) {
        current.opaqueBody.push(opaqueLine(line));
        if (structurallyLooksLikeField(line))
          diagnostics.push(malformedStructuralDiagnostic(line, "field"));
      } else current.fields.push(field);
      diagnostics.push(...fieldDiagnostics(line));
      current.span = span(current.span.start, lineSpan(line).end);
      continue;
    }
    const alias = parseAlias(line);
    if (alias !== undefined) {
      aliases.push(alias);
      statements.push(alias);
      current = undefined;
      continue;
    }
    const declaration = parseDeclaration(line);
    if (declaration === undefined) {
      statements.push(opaqueLine(line));
      if (line.tokens[0]?.text === "alias")
        diagnostics.push(malformedStructuralDiagnostic(line, "alias"));
      else if (structurallyLooksLikeDeclaration(line))
        diagnostics.push(malformedStructuralDiagnostic(line, "declaration"));
      current = undefined;
      continue;
    }
    declarations.push(declaration);
    statements.push(declaration);
    current = declaration;
  }

  for (const declaration of declarations) {
    const hasFieldLikeBody =
      declaration.fields.length > 0 ||
      declaration.opaqueBody.some(({ text }) => {
        const first = text.trimStart().split(/\s+/, 1)[0];
        return first === "a" || first === "an";
      });
    diagnostics.push(...declarationDiagnostics(declaration, hasFieldLikeBody));
  }
  return { declarations, aliases, statements, diagnostics };
}
