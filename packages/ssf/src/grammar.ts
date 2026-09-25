import { ENUM_VALUE, FIELD_NAME, impliedName, RESERVED_NAMES, TYPE_NAME } from "./names.ts";
import {
  error,
  type ParsedAlias,
  type ParsedDeclaration,
  type ParsedField,
  type ParsedFieldType,
  type ParsedNamed,
  type ParsedReference,
  type ParsedSubsetCondition,
  type ParsedUniqueConstraint,
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
  /** Token index of an uppercase subset name, the retired spelling of a subset. */
  readonly typedSubsetNameIndex?: number;
}

function multiplicityOf(structural: string | undefined): SsfMultiplicity | undefined {
  if (structural === "seq") return "sequence";
  if (structural === "set" || structural === "element") return structural;
  return structural === undefined ? undefined : NEAR_MISS_STRUCTURAL.get(structural);
}

/** A lowercase set name the grammar does not read as a keyword. */
function isSetName(text: string | undefined): text is string {
  return text !== undefined && FIELD_NAME.test(text) && !RESERVED_NAMES.has(text);
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
  let typedSubsetNameIndex: number | undefined;

  if (topMultiplicity !== undefined) {
    declarationKind = "collection";
    multiplicity = topMultiplicity;
    structuralIndex = first;
    nameIndex = first + 1 + (authored[first + 1] === "of" ? 1 : 0);
  } else if (
    (isSetName(authored[first]) || TYPE_NAME.test(authored[first] ?? "")) &&
    subsetMultiplicity !== undefined &&
    subsetMultiplicity !== "sequence"
  ) {
    declarationKind = "subset";
    multiplicity = subsetMultiplicity;
    structuralIndex = first + 1;
    if (!isSetName(authored[first])) typedSubsetNameIndex = first;
    nameIndex = structuralIndex + 1 + (authored[structuralIndex + 1] === "of" ? 1 : 0);
    if (isSetName(authored[nameIndex])) {
      parentIndex = nameIndex;
      nameIndex += 1;
    }
  } else return undefined;

  const nameToken = line.tokens[nameIndex];
  if (nameToken === undefined || !TYPE_NAME.test(nameToken.text)) return undefined;
  const setNameToken = declarationKind === "subset" ? line.tokens[first]! : nameToken;
  const parentToken = parentIndex === undefined ? undefined : line.tokens[parentIndex];

  let trailing = nameIndex + 1;
  let condition: ParsedSubsetCondition | undefined;
  if (declarationKind === "subset" && authored[trailing] === "where") {
    const where = line.tokens[trailing]!;
    const field = line.tokens[trailing + 1];
    if (field === undefined || !FIELD_NAME.test(field.text) || authored[trailing + 2] !== "is")
      return undefined;
    const values: ParsedReference[] = [];
    let cursor = trailing + 3;
    for (; cursor < line.tokens.length; cursor += 1) {
      const token = line.tokens[cursor]!;
      if ((cursor - trailing - 3) % 2 === 0) {
        if (!ENUM_VALUE.test(token.text)) break;
        values.push({ text: token.text, span: token.span });
      } else if (token.text !== "or") break;
    }
    const last = values.at(-1);
    if (last === undefined || cursor - trailing - 3 !== values.length * 2 - 1) return undefined;
    condition = {
      field: { text: field.text, span: field.span },
      values,
      span: span(where.span.start, last.span.end),
    };
    trailing = cursor;
  }
  const hasWith = authored[trailing] === "with";
  if (authored.length > trailing + (hasWith ? 1 : 0)) return undefined;

  return {
    name: { text: nameToken.text, span: nameToken.span },
    setName: {
      text:
        declarationKind === "subset" && typedSubsetNameIndex === undefined
          ? setNameToken.text
          : impliedName(setNameToken.text),
      span: setNameToken.span,
    },
    declarationKind,
    multiplicity,
    ...(parentToken === undefined
      ? {}
      : { parent: { text: parentToken.text, span: parentToken.span } }),
    ...(condition === undefined ? {} : { condition }),
    fields: [],
    constraints: [],
    rules: [],
    span: lineSpan(line),
    signatureSpan: lineSpan(line),
    signature: line,
    structuralIndex,
    authoredStructural: authored[structuralIndex]!,
    hasWith,
    hasMalformedField: false,
    ...(typedSubsetNameIndex === undefined ? {} : { typedSubsetNameIndex }),
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

function namedType(token: SsfToken | undefined): ParsedNamed | undefined {
  return token !== undefined && TYPE_NAME.test(token.text)
    ? { kind: "named", reference: { text: token.text, span: token.span } }
    : undefined;
}

const FIELD_MODIFIERS = ["optional", "unique"] as const;
const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([...FIELD_MODIFIERS, "set", "seq"]);

type FieldModifier = (typeof FIELD_MODIFIERS)[number];

function fieldModifier(text: string | undefined): FieldModifier | undefined {
  return FIELD_MODIFIERS.find((modifier) => modifier === text);
}

/** Index of each authored modifier token, ignoring a leading article. */
function modifierIndexes(authored: readonly SsfToken[], article: number): readonly number[] {
  return authored.flatMap((token, index) =>
    index >= article && fieldModifier(token.text) !== undefined ? [index] : [],
  );
}

function articleLength(authored: readonly SsfToken[]): number {
  return authored[0]?.text === "a" || authored[0]?.text === "an" ? 1 : 0;
}

/**
 * Parse a field's tokens: an optional article, its modifiers, an optional name, and a
 * named value. A field written without a name takes the one its value's type implies.
 */
function parseFieldTokens(authored: readonly SsfToken[]): Omit<ParsedField, "span"> | undefined {
  const article = articleLength(authored);
  const indexes = modifierIndexes(authored, article);
  const modifiers = new Set(indexes.map((index) => fieldModifier(authored[index]!.text)!));
  if (modifiers.size !== indexes.length) return undefined;
  const tokens = authored.filter((_, index) => index >= article && !indexes.includes(index));
  const first = tokens[0];
  if (first === undefined) return undefined;
  const implicitName = first.text === "set" || first.text === "seq" || TYPE_NAME.test(first.text);
  if (!implicitName && !FIELD_NAME.test(first.text)) return undefined;
  const valueTokens = implicitName ? tokens : tokens.slice(1);

  let value: ParsedFieldType | undefined;
  const structural = valueTokens[0]?.text;
  if (structural === "set" || structural === "seq") {
    let elementStart = 1;
    if (valueTokens[elementStart]?.text === "of") elementStart += 1;
    const element = namedType(valueTokens[elementStart]);
    if (element !== undefined && elementStart + 1 === valueTokens.length)
      value = {
        kind: "collection",
        multiplicity: structural === "set" ? "set" : "sequence",
        element,
        span: span(valueTokens[0]!.span.start, valueTokens.at(-1)!.span.end),
      };
  } else {
    value = valueTokens.length === 1 ? namedType(valueTokens[0]) : undefined;
  }
  if (value === undefined) return undefined;
  const typeName = value.kind === "named" ? value.reference : value.element.reference;
  const name = implicitName ? impliedName(typeName.text) : first.text;
  if (RESERVED_FIELD_NAMES.has(name)) return undefined;
  return {
    name,
    nameSpan: implicitName ? typeName.span : first.span,
    implicitName,
    optional: modifiers.has("optional"),
    unique: modifiers.has("unique"),
    value,
  };
}

function parseField(line: SourceLine): ParsedField | undefined {
  const parsed = parseFieldTokens(line.tokens);
  return parsed === undefined ? undefined : { ...parsed, span: lineSpan(line) };
}

/** Parse `unique fieldName (and fieldName)*`; the field modifier is shorthand for one name. */
function parseUniqueConstraint(line: SourceLine): ParsedUniqueConstraint | undefined {
  const tokens = line.tokens;
  if (tokens[0]?.text !== "unique") return undefined;
  const fields: ParsedReference[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (index % 2 === 1) {
      if (!FIELD_NAME.test(token.text)) return undefined;
      fields.push({ text: token.text, span: token.span });
    } else if (token.text !== "and") return undefined;
  }
  if (fields.length === 0 || tokens.length !== fields.length * 2) return undefined;
  return { fields, span: lineSpan(line) };
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

function orphanedLineDiagnostic(
  line: SourceLine,
  marker?: string,
  body: "field" | "uniqueness constraint" = "field",
): SsfDiagnostic {
  const nearMiss = marker !== undefined && marker !== RULE_MARKER;
  const subject = marker === undefined ? `valid SSF ${body}` : `indented \`${marker}\` line`;
  return error({
    code: "SSF_ORPHANED_LINE",
    message: `This ${subject} has no enclosing SSF declaration${nearMiss ? ` and does not use the exact \`${RULE_MARKER}\` marker` : ""}.`,
    suggestion:
      marker === undefined
        ? `Add an enclosing declaration ending in \`with\` before this ${body}.`
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
    message: `This ${field ? "indented" : "top-level"} line is not ${field ? "an SSF field, uniqueness constraint, or" : "an SSF declaration, alias, or"} \`${RULE_MARKER}\` line.`,
    suggestion: field
      ? `Use a complete field, a \`unique fieldName (and fieldName)*\` constraint, or prefix prose with the exact \`${RULE_MARKER}\` marker.`
      : `Use a complete declaration or alias, or prefix prose with the exact \`${RULE_MARKER}\` marker.`,
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
  const hasBody = hasFields || declaration.constraints.length > 0;
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
  const typedNameIndex = declaration.typedSubsetNameIndex;
  if (typedNameIndex !== undefined) replacements.set(typedNameIndex, declaration.setName.text);
  const canonicalLine = `${correctedTokens(tokens, replacements)}${hasBody && !declaration.hasWith ? " with" : ""}`;
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
        message: `Add \`a\` or \`an\` before subset \`${declaration.setName.text}\`.`,
        suggestion: subsetArticleSuggestion,
        span: declaration.setName.span,
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
  if (typedNameIndex !== undefined) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message: `Subset \`${tokens[typedNameIndex]!.text}\` is a named set, not a type, so its name begins with a lowercase letter.`,
        suggestion: subsetMissingArticle ? subsetArticleSuggestion : canonicalLine,
        span: tokens[typedNameIndex]!.span,
      }),
    );
  }
  if (declaration.hasWith && !hasBody && !declaration.hasMalformedField) {
    diagnostics.push(
      error({
        code: "SSF_MALFORMED_DECLARATION",
        message:
          "A declaration ending in `with` must have at least one indented field or constraint.",
        suggestion: "Remove `with` or add an indented field or uniqueness constraint.",
        span: tokens.at(-1)?.span ?? declaration.signatureSpan,
      }),
    );
  }
  if (hasBody && !declaration.hasWith) {
    const end = declaration.signatureSpan.end;
    diagnostics.push(
      error({
        code: "SSF_MISSING_WITH",
        message: "A declaration with an indented body must include `with`.",
        suggestion: subsetMissingArticle ? subsetArticleSuggestion : canonicalLine,
        span: span(end, end),
      }),
    );
  }
  return diagnostics;
}

/** Render a repaired field line under its authored indentation. */
function repairedLine(line: SourceLine, tokens: readonly SsfToken[]): string {
  const indentation = line.text.slice(
    0,
    (line.tokens[0]?.span.start.offset ?? line.start) - line.start,
  );
  return `${indentation}${tokens.map(({ text }) => text).join(" ")}`;
}

/** Order a field's tokens canonically: the article, then its modifiers, then the rest. */
function canonicalFieldTokens(
  tokens: readonly SsfToken[],
  field: Omit<ParsedField, "span">,
): readonly SsfToken[] {
  const article = articleLength(tokens);
  const indexes = modifierIndexes(tokens, article);
  return [
    ...tokens.slice(0, article),
    ...FIELD_MODIFIERS.filter((modifier) => field[modifier]).map((modifier) => ({
      ...tokens[indexes[0]!]!,
      text: modifier,
    })),
    ...tokens.filter((_, index) => index >= article && !indexes.includes(index)),
  ];
}

/** The notation's own rule on a field the grammar accepts: a collection is never optional. */
function fieldViolation(
  field: Omit<ParsedField, "span"> | undefined,
): "optional-collection" | undefined {
  return field?.optional === true && field.value.kind === "collection"
    ? "optional-collection"
    : undefined;
}

/** Diagnose a parsed field whose modifiers the grammar accepts but the notation does not. */
function fieldDiagnostic(line: SourceLine, field: ParsedField): SsfDiagnostic | undefined {
  const tokens = line.tokens;
  const article = articleLength(tokens);
  const indexes = modifierIndexes(tokens, article);
  if (fieldViolation(field) === "optional-collection")
    return error({
      code: "SSF_OPTIONAL_COLLECTION",
      message: "SSF collections are never optional; an empty collection represents absence.",
      suggestion: "Remove `optional` from this field.",
      span: tokens[indexes.find((index) => tokens[index]!.text === "optional")!]!.span,
    });
  const misplaced = indexes.find((index, position) => index !== article + position);
  if (misplaced === undefined) return undefined;
  return error({
    code: "SSF_MISPLACED_MODIFIER",
    message: `The \`${tokens[misplaced]!.text}\` modifier must come before the field name.`,
    suggestion: repairedLine(line, canonicalFieldTokens(tokens, field)),
    span: tokens[misplaced]!.span,
  });
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
      const constraint = field === undefined ? parseUniqueConstraint(line) : undefined;
      if (field !== undefined) {
        if (current === undefined) diagnostics.push(orphanedLineDiagnostic(line));
        else {
          current.fields.push(field);
          const diagnostic = fieldDiagnostic(line, field);
          if (diagnostic !== undefined) diagnostics.push(diagnostic);
        }
      } else if (constraint !== undefined) {
        if (current === undefined)
          diagnostics.push(orphanedLineDiagnostic(line, undefined, "uniqueness constraint"));
        else current.constraints.push(constraint);
      } else {
        diagnostics.push(malformedLineDiagnostic(line, "field"));
        if (current !== undefined) current.hasMalformedField = true;
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
