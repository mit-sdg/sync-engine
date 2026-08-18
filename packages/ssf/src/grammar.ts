import { ENUM_VALUE, FIELD_NAME, inferredFieldName, TYPE_NAME } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedEnumeration,
  type ParsedField,
  type ParsedFieldType,
  type ParsedNamed,
  type ParsedReference,
  type SourceLine,
  type SsfDiagnostic,
  type SsfMultiplicity,
  type SsfRuleLine,
  type SsfToken,
} from "./model.ts";
import { lineSpan, ruleLine, span, words } from "./source.ts";

const NEAR_MISS_STRUCTURAL = new Map<string, SsfMultiplicity>([
  ["array", "sequence"],
  ["list", "sequence"],
  ["sequence", "sequence"],
  ["sequences", "sequence"],
  ["singleton", "element"],
]);
const RULE_MARKER = "Rule:";
const NEAR_MISS_RULE_MARKERS = [
  "rule:",
  "RULE:",
  "Invariant:",
  "invariant:",
  "Note:",
  "note:",
] as const;

export interface GrammarResult {
  readonly declarations: readonly ParsedDeclaration[];
  readonly aliases: readonly ParsedAlias[];
  readonly rules: readonly SsfRuleLine[];
  readonly diagnostics: readonly SsfDiagnostic[];
}

interface ParsingDeclaration extends ParsedDeclaration {
  hasMalformedField: boolean;
}

function multiplicityOf(structural: string | undefined): SsfMultiplicity | undefined {
  if (structural === "seq") return "sequence";
  if (structural === "set" || structural === "element") return structural;
  return structural === undefined ? undefined : NEAR_MISS_STRUCTURAL.get(structural);
}

function parseDeclaration(line: SourceLine): ParsingDeclaration | undefined {
  const authored = words(line);
  let first = 0;
  if (authored[first] === "a" || authored[first] === "an") first += 1;
  const topMultiplicity = multiplicityOf(authored[first]);
  const subsetMultiplicity = multiplicityOf(authored[first + 1]);
  let declarationKind: "collection" | "subset";
  let multiplicity: SsfMultiplicity;
  let structuralIndex: number;
  let nameIndex: number;
  let parentIndex: number | undefined;

  if (topMultiplicity !== undefined) {
    declarationKind = "collection";
    multiplicity = topMultiplicity;
    structuralIndex = first;
    nameIndex = first + 1 + (authored[first + 1] === "of" ? 1 : 0);
  } else if (
    TYPE_NAME.test(authored[first] ?? "") &&
    subsetMultiplicity !== undefined &&
    subsetMultiplicity !== "sequence"
  ) {
    declarationKind = "subset";
    multiplicity = subsetMultiplicity;
    structuralIndex = first + 1;
    nameIndex = first;
    parentIndex = structuralIndex + 1 + (authored[structuralIndex + 1] === "of" ? 1 : 0);
  } else return undefined;

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
    name: { text: nameToken.text, span: nameToken.span },
    declarationKind,
    multiplicity,
    ...(parentToken === undefined
      ? {}
      : { parent: { text: parentToken.text, span: parentToken.span } }),
    fields: [],
    rules: [],
    span: lineSpan(line),
    signatureSpan: lineSpan(line),
    signature: line,
    structuralIndex,
    authoredStructural: authored[structuralIndex]!,
    hasWith,
    hasMalformedField: false,
  };
}

function parseAlias(line: SourceLine): ParsedAlias | undefined {
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
  const authored = line.tokens;
  const first = authored[0]?.text === "a" || authored[0]?.text === "an" ? 1 : 0;
  const optionalIndex = authored.findIndex(
    (token, index) => index >= first && token.text === "optional",
  );
  const tokens = authored.filter((_, index) => index >= first && index !== optionalIndex);
  const explicitName =
    tokens[0]?.text !== "set" &&
    tokens[0]?.text !== "seq" &&
    FIELD_NAME.test(tokens[0]?.text ?? "");
  const valueStart = explicitName ? 1 : 0;

  let value: ParsedFieldType | undefined;
  const structural = tokens[valueStart]?.text;
  if (structural === "set" || structural === "seq") {
    let elementStart = valueStart + 1;
    if (tokens[elementStart]?.text === "of") elementStart += 1;
    const element = enumerationValues(tokens, elementStart) ?? namedType(tokens[elementStart]);
    if (
      element !== undefined &&
      (element.kind === "enumeration" || elementStart + 1 === tokens.length)
    )
      value = {
        kind: "collection",
        multiplicity: structural === "set" ? "set" : "sequence",
        element,
        span: span(tokens[valueStart]!.span.start, tokens.at(-1)!.span.end),
      };
  } else {
    value = scalarEnumeration(tokens, valueStart) ?? namedType(tokens[valueStart]);
    if (value?.kind === "named" && valueStart + 1 !== tokens.length) value = undefined;
  }
  const inferred =
    value?.kind === "named"
      ? value.reference
      : value?.kind === "collection" && value.element.kind === "named"
        ? value.element.reference
        : undefined;
  const name = explicitName ? tokens[0]?.text : inferredFieldName(inferred?.text ?? "");
  const nameSpan = explicitName ? tokens[0]?.span : inferred?.span;
  if (name === "" || nameSpan === undefined || value === undefined) return undefined;
  return {
    name,
    nameSpan,
    inferredName: !explicitName,
    optional: optionalIndex >= 0,
    value,
    span: lineSpan(line),
  };
}

function ruleMarker(line: SourceLine): string | undefined {
  if (line.tokens.length < 2) return undefined;
  const first = line.tokens[0]?.text;
  if (first === RULE_MARKER) return RULE_MARKER;
  return NEAR_MISS_RULE_MARKERS.find((marker) => marker === first);
}

function nearMissRuleDiagnostic(line: SourceLine, marker: string): SsfDiagnostic {
  const markerToken = line.tokens[0];
  const markerStart = (markerToken?.span.start.offset ?? line.start) - line.start;
  const markerEnd = (markerToken?.span.end.offset ?? line.start) - line.start;
  return error({
    code: "SSF_NEAR_MISS_KEYWORD",
    message: `Use the exact SSF prose marker \`${RULE_MARKER}\` instead of \`${marker}\`.`,
    suggestion: `${line.text.slice(0, markerStart)}${RULE_MARKER}${line.text.slice(markerEnd)}`,
    span: markerToken?.span ?? lineSpan(line),
  });
}

function orphanedLineDiagnostic(line: SourceLine, marker?: string): SsfDiagnostic {
  const nearMiss = marker !== undefined && marker !== RULE_MARKER;
  const subject = marker === undefined ? "valid SSF field" : `indented \`${marker}\` line`;
  return error({
    code: "SSF_ORPHANED_LINE",
    message: `This ${subject} has no enclosing SSF declaration${nearMiss ? ` and does not use the exact \`${RULE_MARKER}\` marker` : ""}.`,
    suggestion:
      marker === undefined
        ? "Add an enclosing declaration ending in `with` before this field."
        : nearMiss
          ? `Add an enclosing declaration and use \`${RULE_MARKER}\`; or unindent the corrected line to make it a top-level rule.`
          : "Add an enclosing declaration before this line, or remove its indentation to make it a top-level rule.",
    span: lineSpan(line),
  });
}

function malformedLineDiagnostic(
  line: SourceLine,
  kind: "alias" | "declaration" | "field",
): SsfDiagnostic {
  if (kind === "alias")
    return error({
      code: "SSF_MALFORMED_ALIAS",
      message: "This top-level line is not a complete SSF alias.",
      suggestion: "Use exactly `alias Name for Target` with uppercase SSF type names.",
      span: lineSpan(line),
    });
  const field = kind === "field";
  return error({
    code: field ? "SSF_MALFORMED_FIELD" : "SSF_MALFORMED_DECLARATION",
    message: `This ${field ? "indented" : "top-level"} line is not ${field ? "an SSF field or" : "an SSF declaration, alias, or"} \`${RULE_MARKER}\` line.`,
    suggestion: `Use a complete ${field ? "field" : "declaration or alias"}, or prefix prose with the exact \`${RULE_MARKER}\` marker.`,
    span: lineSpan(line),
  });
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

function declarationDiagnostics(declaration: ParsingDeclaration): SsfDiagnostic[] {
  const diagnostics: SsfDiagnostic[] = [];
  const hasFields = declaration.fields.length > 0;
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
  const canonicalLine = `${correctedTokens(tokens, replacements)}${hasFields && !declaration.hasWith ? " with" : ""}`;
  const subsetArticleSuggestion = `Use \`a ${canonicalLine}\` or \`an ${canonicalLine}\`.`;
  const structuralToken = tokens[declaration.structuralIndex];

  if (declaration.declarationKind === "collection" && declaration.structuralIndex === 0) {
    diagnostics.push(
      error({
        code: "SSF_ARTICLE",
        message: `Use \`${articleFor(declaration.multiplicity)}\` before \`${canonical}\`.`,
        suggestion: `${articleFor(declaration.multiplicity)} ${canonicalLine}`,
        span: structuralToken?.span ?? declaration.signatureSpan,
      }),
    );
  } else if (subsetMissingArticle) {
    diagnostics.push(
      error({
        code: "SSF_ARTICLE",
        message: `Add \`a\` or \`an\` before subset \`${declaration.name.text}\`.`,
        suggestion: subsetArticleSuggestion,
        span: declaration.name.span,
      }),
    );
  } else if (declaration.authoredStructural !== canonical && structuralToken !== undefined) {
    diagnostics.push(
      error({
        code: "SSF_NEAR_MISS_KEYWORD",
        message: `Use the SSF keyword \`${canonical}\` instead of \`${declaration.authoredStructural}\`.`,
        suggestion: canonicalLine,
        span: structuralToken.span,
      }),
    );
  } else if (collectionHasArticle) {
    const expected = articleFor(declaration.multiplicity);
    const article = authored[0];
    if ((article === "a" || article === "an") && article !== expected && tokens[0] !== undefined) {
      diagnostics.push(
        error({
          code: "SSF_ARTICLE",
          message: `Use \`${expected}\` before \`${canonical}\`.`,
          suggestion: canonicalLine,
          span: tokens[0].span,
        }),
      );
    }
  }
  if (declaration.hasWith && declaration.fields.length === 0 && !declaration.hasMalformedField) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message: "A declaration ending in `with` must have at least one indented field.",
        suggestion: "Remove `with` or add at least one indented field.",
        span: tokens.at(-1)?.span ?? declaration.signatureSpan,
      }),
    );
  }
  if (hasFields && !declaration.hasWith) {
    const end = declaration.signatureSpan.end;
    diagnostics.push(
      error({
        code: "SSF_MISSING_WITH",
        message: "A declaration with indented fields must include `with`.",
        suggestion: subsetMissingArticle ? subsetArticleSuggestion : canonicalLine,
        span: span(end, end),
      }),
    );
  }
  return diagnostics;
}

function fieldDiagnostic(line: SourceLine): SsfDiagnostic | undefined {
  const tokens = line.tokens;
  const indentation = line.text.slice(0, (tokens[0]?.span.start.offset ?? line.start) - line.start);
  const hasArticle = tokens[0]?.text === "a" || tokens[0]?.text === "an";
  const optionalIndex = tokens.findIndex(({ text }) => text === "optional");
  if (optionalIndex < 0) return undefined;
  const optionalToken = tokens[optionalIndex]!;
  if (tokens.some(({ text }) => text === "set" || text === "seq"))
    return error({
      code: "SSF_OPTIONAL_COLLECTION",
      message: "SSF collections are never optional; an empty collection represents absence.",
      suggestion: "Remove `optional` from this field.",
      span: optionalToken.span,
    });
  const expectedOptionalIndex = hasArticle ? 1 : 0;
  if (optionalIndex !== expectedOptionalIndex) {
    const withoutOptional = tokens
      .filter((_, index) => index !== optionalIndex)
      .map(({ text }) => text);
    if (hasArticle) withoutOptional[0] = "an";
    withoutOptional.splice(expectedOptionalIndex, 0, "optional");
    return error({
      code: "SSF_MISPLACED_OPTIONAL",
      message:
        "The `optional` modifier must precede the field name and follow the article when present.",
      suggestion: `${indentation}${withoutOptional.join(" ")}`,
      span: optionalToken.span,
    });
  }
  if (tokens[0]?.text === "a")
    return error({
      code: "SSF_ARTICLE",
      message: "Use `an` before `optional`.",
      suggestion: `${indentation}${correctedTokens(tokens, new Map([[0, "an"]]))}`,
      span: tokens[0].span,
    });
  return undefined;
}

export function parseGrammar(lines: readonly SourceLine[]): GrammarResult {
  const declarations: ParsingDeclaration[] = [];
  const aliases: ParsedAlias[] = [];
  const rules: SsfRuleLine[] = [];
  const diagnostics: SsfDiagnostic[] = [];
  let current: ParsingDeclaration | undefined;

  for (const line of lines) {
    if (line.text.trim() === "") continue;
    const indented = (line.tokens[0]?.span.start.offset ?? line.end) > line.start;
    const marker = ruleMarker(line);
    if (marker !== undefined) {
      if (indented) {
        if (current === undefined) diagnostics.push(orphanedLineDiagnostic(line, marker));
        else {
          if (marker === RULE_MARKER) current.rules.push(ruleLine(line));
          else diagnostics.push(nearMissRuleDiagnostic(line, marker));
          current.span = span(current.span.start, lineSpan(line).end);
        }
      } else {
        current = undefined;
        if (marker === RULE_MARKER) rules.push(ruleLine(line));
        else diagnostics.push(nearMissRuleDiagnostic(line, marker));
      }
      continue;
    }
    if (indented) {
      const field = parseField(line);
      if (field === undefined) {
        diagnostics.push(malformedLineDiagnostic(line, "field"));
        if (current !== undefined) current.hasMalformedField = true;
      } else if (current === undefined) diagnostics.push(orphanedLineDiagnostic(line));
      else {
        current.fields.push(field);
        const diagnostic = fieldDiagnostic(line);
        if (diagnostic !== undefined) diagnostics.push(diagnostic);
      }
      if (current !== undefined) current.span = span(current.span.start, lineSpan(line).end);
      continue;
    }

    current = undefined;
    const alias = parseAlias(line);
    if (alias !== undefined) {
      aliases.push(alias);
      continue;
    }
    const declaration = parseDeclaration(line);
    if (declaration === undefined) {
      diagnostics.push(
        malformedLineDiagnostic(line, line.tokens[0]?.text === "alias" ? "alias" : "declaration"),
      );
      continue;
    }
    declarations.push(declaration);
    current = declaration;
  }

  for (const declaration of declarations) diagnostics.push(...declarationDiagnostics(declaration));
  return { declarations, aliases, rules, diagnostics };
}
